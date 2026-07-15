import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'

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
    const status = searchParams.get('status') || 'approved'
    const format = searchParams.get('format')
    // Clamp the page size: parseInt on attacker-controlled input can yield
    // NaN (which PostgREST rejects with a noisy error) or an arbitrarily
    // large number that turns this select('*') into a full-table dump of the
    // workspace in one response. 100 is comfortably above what the library
    // UI ever requests.
    const requestedLimit = parseInt(searchParams.get('limit') || '20', 10)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 20

    if (!workspace_id) {
      return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 })
    }

    // Ownership guard: this endpoint returns full content_pieces rows —
    // drafts and approved posts are exactly the user data a cross-tenant read
    // would exfiltrate. Previously the workspace_id filter was the only
    // scoping besides RLS; the guard makes the owner check explicit so a
    // content_pieces policy gap alone can't expose another tenant's library.
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure

    // persona_id is an optional filter here, but when present it must still
    // be pinned to the guarded workspace — otherwise it silently no-ops for
    // foreign personas, and consistency with the other routes keeps the
    // mental model simple: any persona_id a route accepts is verified.
    if (persona_id) {
      const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
      if (personaGuard.failure) return personaGuard.failure
    }

    let query = supabase
      .from('content_pieces')
      .select('*')
      .eq('workspace_id', workspace_id)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (persona_id) query = query.eq('persona_id', persona_id)
    if (format) query = query.eq('format', format)

    const { data: items, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: items || [] })

  } catch (error) {
    console.error('Library error:', error)
    return NextResponse.json({ error: 'Failed to load library' }, { status: 500 })
  }
}