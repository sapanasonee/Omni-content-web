 import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { NextResponse } from 'next/server'
import { DocumentServiceClient } from '@google-cloud/discoveryengine'

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

    // 3. Load content piece from Supabase
    const { data: piece, error: pieceError } = await supabase
      .from('content_pieces')
      .select('*')
      .eq('id', content_piece_id)
      .eq('workspace_id', workspace_id)
      .single()

    if (pieceError || !piece) {
      return NextResponse.json({ error: 'Content piece not found' }, { status: 404 })
    }

    if (piece.status === 'approved') {
      return NextResponse.json({ error: 'Content already approved' }, { status: 400 })
    }

    // 4. Critic check
    const violations = runCriticCheck(piece.body)
    if (violations.length > 0 && !confirmed) {
      return NextResponse.json({
        requires_confirmation: true,
        violations,
        message: 'Content has quality issues. Confirm to approve anyway.',
      }, { status: 200 })
    }

    // 5. Load persona
    const { data: persona, error: personaError } = await supabase
      .from('personas')
      .select('*')
      .eq('id', persona_id)
      .single()

    if (personaError || !persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // 6. Load workspace
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspace_id)
      .single()

    if (workspaceError || !workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

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

    return NextResponse.json({
      success: true,
      quality_score,
      violations,
      critique_passed: violations.length === 0,
      rag_indexed: !piece.rag_excluded && piece.generation_mode === 'standard',
      active_rag_count: Math.min((persona.active_rag_count || 0) + 1, SOLO_RAG_LIMIT),
      archived_id: archivedId,
    })

  } catch (error) {
    console.error('Approve error:', error)
    return NextResponse.json({ error: 'Approval failed' }, { status: 500 })
  }
}

// ─── Critic check ─────────────────────────────────────────────────────────────
function runCriticCheck(body: string): string[] {
  const violations: string[] = []

  const aiPatterns = [
    /in today'?s fast.?paced world/i,
    /as we navigate/i,
    /in the ever.?evolving/i,
    /it'?s not .+, it'?s/i,
    /this isn'?t .+, this is/i,
    /i'?ll be honest/i,
    /if i'?m being honest/i,
    /here'?s the truth:/i,
    /that'?s when it hit me:/i,
  ]

  for (const pattern of aiPatterns) {
    if (pattern.test(body)) {
      violations.push(`Contains AI pattern: "${body.match(pattern)?.[0]}"`)
    }
  }

  const colonCount = (body.match(/:/g) || []).length
  if (colonCount > 3) {
    violations.push(`Too many colons (${colonCount}) — max 3 recommended`)
  }

  if (body.length < 50) {
    violations.push('Content too short — minimum 50 characters')
  }

  return violations
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