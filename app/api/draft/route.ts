import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(request: Request) {
  try {
    // 1. Auth check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request
    const { content_piece_id, workspace_id, body } = await request.json()
    if (!content_piece_id || !workspace_id || typeof body !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (body.trim().length === 0) {
      return NextResponse.json({ error: 'Body cannot be empty' }, { status: 400 })
    }

    // 3. Load the piece. RLS scopes rows to the owner; the workspace_id filter
    //    matches the pattern used by generate/approve. Only drafts are editable.
    const { data: piece, error: pieceError } = await supabase
      .from('content_pieces')
      .select('id, status')
      .eq('id', content_piece_id)
      .eq('workspace_id', workspace_id)
      .single()

    if (pieceError || !piece) {
      return NextResponse.json({ error: 'Content piece not found' }, { status: 404 })
    }
    if (piece.status !== 'draft') {
      return NextResponse.json({ error: 'Only drafts can be edited' }, { status: 400 })
    }

    // 4. Update the working body only. original_body is deliberately left untouched,
    //    so the generated-vs-edited diff stays recoverable at approve time (Phase 2).
    const { error: updateError } = await supabase
      .from('content_pieces')
      .update({ body })
      .eq('id', content_piece_id)
      .eq('workspace_id', workspace_id)

    if (updateError) {
      console.error('Draft update failed:', updateError)
      return NextResponse.json({ error: 'Failed to save edit' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Draft edit error:', error)
    return NextResponse.json({ error: 'Edit failed' }, { status: 500 })
  }
}