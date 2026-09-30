 import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { NextResponse } from 'next/server'
import { DocumentServiceClient } from '@google-cloud/discoveryengine'
import { runLinter } from '@/lib/critic'
import { analyzeEdit, type EditDelta } from '@/lib/rulebook'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'
import { maybeDistillVoiceProfile } from '@/lib/voice-profile'

const DATASTORE_ID = 'omni-content-agent-v2_1780394823768'
const PROJECT_NUMBER = '441385652994'
const SOLO_RAG_LIMIT = 10

function getBucket() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
  return storage.bucket(process.env.GCS_BUCKET_NAME!)
}

function getDiscoveryClient() {
  return new DocumentServiceClient()
}

export async function POST(request: Request) {
  try {
    // 1. Auth check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request
    const { content_piece_id, workspace_id, persona_id, confirmed } = await request.json()

    if (!content_piece_id || !workspace_id || !persona_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 3. Ownership guard BEFORE any data is loaded. Approve has the widest
    //    blast radius of any route — it writes to GCS (no row-level security
    //    there), mutates persona rag counts, and feeds the rulebook — so it
    //    must never proceed past this point on IDs the caller doesn't own,
    //    even if an RLS policy regression would have let the lookups succeed.
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    const workspace = wsGuard.workspace

    const personaGuard = await requirePersonaInWorkspace<{ id: string; active_rag_count: number | null }>(
      supabase, workspace_id, persona_id, 'id, active_rag_count',
    )
    if (personaGuard.failure) return personaGuard.failure
    const persona = personaGuard.persona

    // 4. Load content piece from Supabase
    const { data: piece, error: pieceError } = await supabase
      .from('content_pieces')
      .select('*')
      .eq('id', content_piece_id)
      .eq('workspace_id', workspace_id)
      .single()

    if (pieceError || !piece) {
      return NextResponse.json({ error: 'Content piece not found' }, { status: 404 })
    }

    // The piece must actually belong to the persona the caller named. Without
    // this check a caller could approve a piece under a *different* persona in
    // the same workspace, which would write the GCS approved-content file under
    // the wrong persona's path, bump the wrong persona's rag count, and feed
    // the wrong persona's rulebook history — silent cross-persona data
    // corruption that RAG retrieval would then learn from.
    if (piece.persona_id !== persona_id) {
      return NextResponse.json({ error: 'Content piece does not belong to this persona' }, { status: 400 })
    }

    if (piece.status === 'approved') {
      return NextResponse.json({ error: 'Content already approved' }, { status: 400 })
    }

    // 5. Final linter gate (the LLM critique already ran at generation time;
    //    this re-checks because the body may have been edited since)
    const violations = runLinter(piece.body)
    if (violations.length > 0 && !confirmed) {
      return NextResponse.json({
        requires_confirmation: true,
        violations,
        message: 'Content has quality issues. Confirm to approve anyway.',
      }, { status: 200 })
    }

    // 6. Persona and workspace rows come from the ownership guards above —
    //    the guard's narrow projections replace the old select('*') loads.
    const isSolo = workspace.plan_tier === 'solo'
    let archivedId: string | null = null

    // 7. Solo tier RAG cap — archive oldest if at limit
    if (isSolo && !piece.rag_excluded && piece.generation_mode === 'standard') {
      const currentCount = persona.active_rag_count || 0

      if (currentCount >= SOLO_RAG_LIMIT) {
        const { data: oldest } = await supabase
          .from('content_pieces')
          .select('id')
          .eq('workspace_id', workspace_id)
          .eq('persona_id', persona_id)
          .eq('status', 'approved')
          .eq('rag_excluded', false)
          .eq('generation_mode', 'standard')
          .order('approved_at', { ascending: true })
          .limit(1)
          .single()

        if (oldest) {
          archivedId = oldest.id
          await supabase
            .from('content_pieces')
            .update({ rag_excluded: true })
            .eq('id', oldest.id)
        }
      }
    }

    // 8. Write approved content to GCS and index into Vertex AI Search
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
    const gcsPath = `workspaces/${workspace_id}/personas/${persona_id}/approved_content/approved_${piece.format}_${timestamp}.txt`

    if (!piece.rag_excluded && piece.generation_mode === 'standard') {
      const bucket = getBucket()
      const file = bucket.file(gcsPath)
      await file.save(piece.body, {
        metadata: {
          contentType: 'text/plain',
          metadata: {
            workspace_id,
            persona_id,
            content_piece_id,
            format: piece.format,
            approved_at: new Date().toISOString(),
          },
        },
      })

      // 9. Index into Vertex AI Search (non-fatal)
      await indexIntoVertexSearch(
        content_piece_id,
        `gs://${process.env.GCS_BUCKET_NAME}/${gcsPath}`
      )
    }

    // 10. Update content piece status
    const quality_score = violations.length === 0 ? 3 : violations.length <= 2 ? 2 : 1
    const approvedAt = new Date().toISOString()

    await supabase
      .from('content_pieces')
      .update({
        status: 'approved',
        approved_at: approvedAt,
        quality_score,
        critique_passed: violations.length === 0,
        violations: violations.length > 0 ? violations : null,
      })
      .eq('id', content_piece_id)

    // 11. Update persona RAG count
    if (!piece.rag_excluded && piece.generation_mode === 'standard') {
      const newCount = Math.min((persona.active_rag_count || 0) + 1, SOLO_RAG_LIMIT)
      await supabase
        .from('personas')
        .update({ active_rag_count: newCount })
        .eq('id', persona_id)
    }

    // 12. Diff→rulebook: the user edited before approving, so ONE cheap-model
    //     call categorizes the delta and checks the persona's edit history for
    //     a repeated preference worth proposing as a standing rule. Suggestions
    //     land in contexts with status='suggested' — generation only reads
    //     'active', so nothing changes until the user accepts. Never fatal.
    let ruleSuggestion: { id: string; content: string } | null = null
    const wasEdited =
      typeof piece.original_body === 'string' &&
      piece.original_body.trim() !== '' &&
      piece.body.trim() !== piece.original_body.trim()

    if (wasEdited) {
      try {
        const [{ data: history }, { data: existingRules }] = await Promise.all([
          supabase
            .from('content_edits')
            .select('deltas')
            .eq('persona_id', persona_id)
            .order('created_at', { ascending: false })
            .limit(10),
          // Include closed rules so a dismissed suggestion is never re-proposed.
          supabase
            .from('contexts')
            .select('content')
            .eq('persona_id', persona_id)
            .eq('scope', 'permanent')
            .in('status', ['active', 'suggested', 'closed']),
        ])

        const analysis = await analyzeEdit(
          piece.original_body,
          piece.body,
          (history || []).map(h => h.deltas as EditDelta[]),
          (existingRules || []).map(r => r.content as string),
        )

        if (analysis && analysis.deltas.length > 0) {
          const { error: editInsertError } = await supabase
            .from('content_edits')
            .insert({
              workspace_id,
              persona_id,
              content_piece_id,
              deltas: analysis.deltas,
            })
          if (editInsertError) console.error('content_edits insert failed (non-fatal):', editInsertError)

          if (analysis.suggested_rule) {
            const { data: suggestion, error: suggError } = await supabase
              .from('contexts')
              .insert({
                workspace_id,
                persona_id,
                scope: 'permanent',
                tier: 'default',
                status: 'suggested',
                content: analysis.suggested_rule,
              })
              .select('id, content')
              .single()
            if (suggError) console.error('Rule suggestion insert failed (non-fatal):', suggError)
            else ruleSuggestion = suggestion
          }
        }
      } catch (err) {
        console.error('Rulebook analysis failed (non-fatal):', err)
      }
    }

    // 13. Observed Voice: every DISTILL_EVERY_APPROVALS approvals, distill a
    //     fresh profile proposal from recent behavior (approved pieces, edits,
    //     rejections). Lands as `proposed` — steers nothing until the user
    //     applies it on /dna. Non-fatal; on most approvals this is one cheap
    //     count query and an early return.
    let voiceProfileProposed = false
    try {
      const snapshot = await maybeDistillVoiceProfile(supabase, workspace_id, persona_id)
      voiceProfileProposed = snapshot !== null
    } catch (err) {
      console.error('Voice-profile trigger failed (non-fatal):', err)
    }

    return NextResponse.json({
      success: true,
      quality_score,
      violations,
      critique_passed: violations.length === 0,
      rag_indexed: !piece.rag_excluded && piece.generation_mode === 'standard',
      active_rag_count: Math.min((persona.active_rag_count || 0) + 1, SOLO_RAG_LIMIT),
      archived_id: archivedId,
      rule_suggestion: ruleSuggestion,
      voice_profile_proposed: voiceProfileProposed,
    })

  } catch (error) {
    console.error('Approve error:', error)
    return NextResponse.json({ error: 'Approval failed' }, { status: 500 })
  }
}

// ─── Vertex AI Search indexing ────────────────────────────────────────────────
async function indexIntoVertexSearch(
  content_piece_id: string,
  gcsUri: string
) {
  try {
    const parent = `projects/${PROJECT_NUMBER}/locations/us/collections/default_collection/dataStores/${DATASTORE_ID}/branches/default_branch`
    const discoveryClient = getDiscoveryClient()

    await discoveryClient.importDocuments({
      parent,
      gcsSource: {
        inputUris: [gcsUri],
        dataSchema: 'content',
      },
      reconciliationMode: 'INCREMENTAL',
    } as Parameters<typeof discoveryClient.importDocuments>[0])

    console.log(`Indexed content piece ${content_piece_id} into Vertex AI Search`)
  } catch (err) {
    console.error('Vertex AI Search indexing error (non-fatal):', err)
  }
}