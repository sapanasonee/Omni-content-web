import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'
import { INPUT_LIMITS, rejectOversized } from '@/lib/input-limits'

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

// Canonical rejection reasons. UI labels live client-side; only these keys are
// accepted here so a bad/crafted client can't write arbitrary values.
const REJECTION_REASONS = [
  'tone_mismatch',
  'too_flat',
  'weak_hook',
  'weak_structure',
  'weak_closing',
] as const

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
        typeof r === 'string' && (REJECTION_REASONS as readonly string[]).includes(r),
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Feedback error:', error)
    return NextResponse.json({ error: 'Feedback failed' }, { status: 500 })
  }
}
