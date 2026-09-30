import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'
import { INPUT_LIMITS, rejectOversized } from '@/lib/input-limits'
import {
  REJECTION_REASONS,
  REJECTION_REASON_VALUES,
  REJECTION_WINDOW,
  recurringReasons,
  type StoredRejection,
} from '@/lib/rejection-feedback'
import { distillRejectionNote } from '@/lib/dna-feedback'
import { Storage } from '@google-cloud/storage'
import type { BrandDNA } from '@/lib/types'

// ─── Why this route exists ───────────────────────────────────────────────────
//
// The counterpart to /api/approve. Approve is the positive signal (this piece
// sounds like me → index it into brand memory). This is the negative signal:
// "I don't like this one" archives the draft and records WHY, so a rejected
// draft (a) never reaches RAG retrieval or the rulebook — archived pieces are
// excluded from every read path that keys on status='approved' — and (b) leaves
// a structured, queryable reason behind for evals and a future feedback loop.
//
// The reasons are a fixed enum (not free strings) so aggregate analysis stays
// clean; the optional note is capped like every other free-text input. Feedback
// is merged into the piece's existing resolved_context jsonb rather than a new
// column, because schema here is untracked/manually-migrated (see CLAUDE.md) —
// this needs no migration to ship.
// ─────────────────────────────────────────────────────────────────────────────

// Pull the persona's recent rejection records (most-recent-first) so the POST
// can decide whether a reason has recurred often enough to suggest as a standing
// rule. Only this route ever sets status='archived', and we still guard on the
// presence of a rejection payload so an archived-for-another-reason piece
// (should one ever exist) can't slip in.
async function loadRecentRejections(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  personaId: string,
): Promise<StoredRejection[]> {
  const { data } = await supabase
    .from('content_pieces')
    .select('resolved_context')
    .eq('workspace_id', workspaceId)
    .eq('persona_id', personaId)
    .eq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(REJECTION_WINDOW)

  return (data || [])
    .map(r => (r.resolved_context as { rejection?: StoredRejection } | null)?.rejection)
    .filter((x): x is StoredRejection => !!x && typeof x === 'object')
}

export async function POST(request: Request) {
  try {
    // 1. Auth
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse
    const { content_piece_id, workspace_id, persona_id, reasons, note } = await request.json()
    if (!content_piece_id || !workspace_id || !persona_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 3. Validate feedback payload — enum reasons, capped note. Both are
    //    optional (a bare "didn't like it" is still a valid signal), but
    //    anything present must be well-formed.
    const rawReasons = Array.isArray(reasons) ? reasons : []
    const cleanReasons = Array.from(
      new Set(rawReasons.filter((r: unknown): r is string =>
        typeof r === 'string' && REJECTION_REASON_VALUES.includes(r),
      )),
    )
    if (rawReasons.length > 0 && cleanReasons.length === 0) {
      return NextResponse.json({ error: 'Invalid feedback reasons' }, { status: 400 })
    }
    const noteStr = typeof note === 'string' ? note.trim() : ''
    const oversized = rejectOversized([['note', noteStr, INPUT_LIMITS.feedback_note]])
    if (oversized) return oversized

    // 4. Ownership guards — same two-step (workspace, then persona in workspace)
    //    every write path uses.
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure

    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    // 5. Load the piece, scoped to the guarded workspace.
    const { data: piece, error: pieceError } = await supabase
      .from('content_pieces')
      .select('id, status, persona_id, resolved_context')
      .eq('id', content_piece_id)
      .eq('workspace_id', workspace_id)
      .single()

    if (pieceError || !piece) {
      return NextResponse.json({ error: 'Content piece not found' }, { status: 404 })
    }
    if (piece.persona_id !== persona_id) {
      return NextResponse.json({ error: 'Content piece does not belong to this persona' }, { status: 400 })
    }
    // Only an un-approved draft can be rejected. An already-approved piece is in
    // brand memory; unwinding that is a different operation, not this one.
    if (piece.status !== 'draft') {
      return NextResponse.json({ error: 'Only drafts can be rejected' }, { status: 400 })
    }

    // 6. Merge the rejection into resolved_context and archive the piece.
    const rc = (piece.resolved_context && typeof piece.resolved_context === 'object')
      ? piece.resolved_context as Record<string, unknown>
      : {}
    rc.rejection = {
      reasons: cleanReasons,
      note: noteStr || null,
      at: new Date().toISOString(),
    }

    const { error: updateError } = await supabase
      .from('content_pieces')
      .update({ status: 'archived', resolved_context: rc })
      .eq('id', content_piece_id)
      .eq('workspace_id', workspace_id)

    if (updateError) {
      console.error('Feedback update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    // 7. Recurrence → suggestion. If a reason has now recurred enough to look
    //    like a systematic blind spot (not a one-off bad draft), propose it as
    //    a standing rule — same contexts suggested→active/closed flow the
    //    edit-rulebook uses, so an accepted rule steers generation through the
    //    existing STANDING PREFERENCES path and nothing steers silently. The
    //    just-archived piece is already committed, so it's counted here.
    //    Non-fatal: any failure just means no suggestion this time.
    let ruleSuggestion: { id: string; content: string; heading: string } | null = null
    try {
      const rejections = await loadRecentRejections(supabase, workspace_id, persona_id)
      const recurring = recurringReasons(rejections)
      if (recurring.length > 0) {
        // Never re-propose a reason already covered by a rule in ANY state:
        // active (already a rule), suggested (a card is already pending), or
        // closed (the user said no — never nag again). The rule content is
        // deterministic per reason, so an exact-content match is a reliable
        // "already handled" test across both this route and the edit-rulebook.
        const { data: existing } = await supabase
          .from('contexts')
          .select('content')
          .eq('persona_id', persona_id)
          .eq('scope', 'permanent')
          .in('status', ['active', 'suggested', 'closed'])
        const taken = new Set((existing || []).map(r => r.content as string))

        // One suggestion per submission (like the rulebook), strongest-first by
        // REJECTION_REASONS order — the first recurring reason not yet handled.
        const pick = recurring.find(r => !taken.has(r.reason.correction))
        if (pick) {
          const { data: suggestion, error: suggErr } = await supabase
            .from('contexts')
            .insert({
              workspace_id,
              persona_id,
              scope: 'permanent',
              tier: 'default',
              status: 'suggested',
              content: pick.reason.correction,
            })
            .select('id, content')
            .single()
          if (suggErr) {
            console.error('Rejection rule suggestion insert failed (non-fatal):', suggErr)
          } else if (suggestion) {
            ruleSuggestion = {
              id: suggestion.id,
              content: suggestion.content,
              heading: `You've rejected ${pick.count} drafts for ${pick.reason.pattern} — make it a standing rule?`,
            }
          }
        }
      }
    } catch (err) {
      console.error('Rejection recurrence check failed (non-fatal):', err)
    }

    // 8. Note → DNA distillation. A free-text note is the richest signal in the
    //    rejection, but raw notes are piece-specific and conversational — never
    //    written to permanent storage as-is. One Flash-Lite call (only when a
    //    note exists) distills it into (a) a structural avoid rule proposed for
    //    the Brand DNA avoid list — the strongest home, since avoid rules are
    //    enforced by BOTH the generation prompt's hard stops and the LLM critic
    //    — and (b) a "what they'd rather have" preference proposed as a standing
    //    rule. Both are suggestions the user confirms on the generate page;
    //    nothing here writes to the DNA. Non-fatal like every LLM side-call.
    let dnaSuggestion: {
      avoid_rule: string | null
      preference: { id: string; content: string } | null
    } | null = null
    if (noteStr) {
      try {
        // Existing avoid list + active rules feed the distiller so it returns
        // null instead of proposing something already covered.
        let existingAvoid: string[] = []
        try {
          const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
          const file = storage
            .bucket(process.env.GCS_BUCKET_NAME!)
            .file(`workspaces/${workspace_id}/personas/${persona_id}/brand_dna.json`)
          const [content] = await file.download()
          const dna: BrandDNA = JSON.parse(content.toString())
          if (Array.isArray(dna.sections?.avoid)) existingAvoid = dna.sections.avoid
        } catch {
          // No DNA file / unreadable — distill without the dedupe context.
        }

        const { data: activeRules } = await supabase
          .from('contexts')
          .select('content')
          .eq('persona_id', persona_id)
          .eq('scope', 'permanent')
          .eq('status', 'active')

        const reasonLabels = REJECTION_REASONS
          .filter(r => cleanReasons.includes(r.value))
          .map(r => r.label)

        const distilled = await distillRejectionNote(
          noteStr,
          reasonLabels,
          existingAvoid,
          (activeRules || []).map(r => r.content as string),
        )

        if (distilled && (distilled.avoid_rule || distilled.preference)) {
          // The preference rides the same suggested→active/closed contexts flow
          // as every other rule suggestion, so accept/dismiss reuses the
          // existing PATCH path and a dismissal is permanent.
          let preference: { id: string; content: string } | null = null
          if (distilled.preference) {
            const { data: prefRow, error: prefErr } = await supabase
              .from('contexts')
              .insert({
                workspace_id,
                persona_id,
                scope: 'permanent',
                tier: 'default',
                status: 'suggested',
                content: distilled.preference,
              })
              .select('id, content')
              .single()
            if (prefErr) console.error('Preference suggestion insert failed (non-fatal):', prefErr)
            else preference = prefRow
          }
          // The avoid rule is ephemeral until accepted — the client writes it
          // into the DNA avoid list via PUT /api/brand-dna on confirm.
          dnaSuggestion = { avoid_rule: distilled.avoid_rule, preference }
        }
      } catch (err) {
        console.error('Note→DNA distillation failed (non-fatal):', err)
      }
    }

    return NextResponse.json({
      success: true,
      rule_suggestion: ruleSuggestion,
      dna_suggestion: dnaSuggestion,
    })
  } catch (error) {
    console.error('Feedback error:', error)
    return NextResponse.json({ error: 'Feedback failed' }, { status: 500 })
  }
}
