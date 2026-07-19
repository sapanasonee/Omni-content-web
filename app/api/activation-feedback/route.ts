import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWorkspaceOwnership, requirePersonaInWorkspace, isUuid } from '@/lib/auth-guard'

// The "does this sound like you?" signal on the three activation drafts — the
// direct measurement for the product's core validation metric: % of new users
// who hit "sounds like me" on draft #1. Deliberately separate from approve
// (positive signal that feeds brand memory) and from /api/feedback (rejection
// that archives): this is a lightweight reaction that changes NOTHING about
// the piece's lifecycle — it only lands in resolved_context so the metric is
// queryable per piece from day one:
//   resolved_context->'activation_feedback'->>'sounds_like_me'
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { content_piece_id, workspace_id, persona_id, sounds_like_me } = await request.json()
    if (!content_piece_id || !workspace_id || !persona_id || typeof sounds_like_me !== 'boolean') {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
    }

    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    if (!isUuid(content_piece_id)) {
      return NextResponse.json({ error: 'Content piece not found' }, { status: 404 })
    }

    const { data: piece, error: pieceError } = await supabase
      .from('content_pieces')
      .select('id, persona_id, status, resolved_context')
      .eq('id', content_piece_id)
      .eq('workspace_id', workspace_id)
      .single()

    if (pieceError || !piece) {
      return NextResponse.json({ error: 'Content piece not found' }, { status: 404 })
    }
    if (piece.persona_id !== persona_id) {
      return NextResponse.json({ error: 'Content piece does not belong to this persona' }, { status: 400 })
    }

    // Merge into resolved_context — same pattern as the rejection record. A
    // re-tap overwrites (the user changed their mind), which is fine: the
    // metric wants their settled answer, not their first click.
    const rc = (piece.resolved_context && typeof piece.resolved_context === 'object')
      ? piece.resolved_context as Record<string, unknown>
      : {}
    rc.activation_feedback = {
      sounds_like_me,
      at: new Date().toISOString(),
    }

    const { error: updateError } = await supabase
      .from('content_pieces')
      .update({ resolved_context: rc })
      .eq('id', content_piece_id)
      .eq('workspace_id', workspace_id)

    if (updateError) {
      console.error('Activation feedback update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Activation feedback error:', error)
    return NextResponse.json({ error: 'Feedback failed' }, { status: 500 })
  }
}
