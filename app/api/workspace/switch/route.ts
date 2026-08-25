import { createClient } from '@/lib/supabase/server'
import { requireWorkspaceOwnership } from '@/lib/auth-guard'
import { ACTIVE_WORKSPACE_COOKIE } from '@/lib/active-workspace'
import { NextResponse } from 'next/server'

// The one route that writes the active-workspace cookie. Ownership is
// verified the same way every other client-supplied workspace_id is verified
// in this app (requireWorkspaceOwnership) — a request naming a workspace_id
// the caller doesn't own 404s exactly like it would on any other route, and
// the cookie is never set in that case.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workspace_id } = await request.json().catch(() => ({}))
    const guard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (guard.failure) return guard.failure

    const res = NextResponse.json({ success: true, workspace_id: guard.workspace.id })
    res.cookies.set(ACTIVE_WORKSPACE_COOKIE, guard.workspace.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return res

  } catch (error) {
    console.error('Workspace switch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
