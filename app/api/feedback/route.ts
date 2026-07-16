import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'
import { INPUT_LIMITS, rejectOversized } from '@/lib/input-limits'
import {
  REJECTION_REASON_VALUES,
  REJECTION_WINDOW,
  recurringCorrectives,
  type StoredRejection,
} from '@/lib/rejection-feedback'

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

// Pull the persona's recent rejection records (most-recent-first). Shared by
// the POST (feeds nothing today) and the GET that surfaces active correctives
// on /dna. Only this route ever sets status='archived', and we still guard on
// the presence of a rejection payload so an archived-for-another-reason piece
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Feedback error:', error)
    return NextResponse.json({ error: 'Feedback failed' }, { status: 500 })
  }
}

// GET — the active recurring correctives for a persona: the directives that
// have recurred enough to steer every generation right now. Powers the "what
// we're currently correcting" surface on /dna so the auto-steer is visible, not
// hidden. Read-only; same ownership guards as everything else.
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspace_id = searchParams.get('workspace_id')
    const persona_id = searchParams.get('persona_id')
    if (!workspace_id || !persona_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    const rejections = await loadRecentRejections(supabase, workspace_id, persona_id)
    return NextResponse.json({ correctives: recurringCorrectives(rejections) })
  } catch (error) {
    console.error('Feedback GET error:', error)
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 })
  }
}
