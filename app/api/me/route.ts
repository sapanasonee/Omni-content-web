import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // No auth-guard call needed here, and that's deliberate: this route takes
    // NO client-supplied IDs — it resolves the workspace FROM the
    // authenticated user via owner_id, which is exactly the invariant the
    // guard exists to enforce elsewhere. If this query is ever changed to
    // accept a workspace_id parameter, it must adopt requireWorkspaceOwnership
    // like every other route.
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('*')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!workspace) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    // Every client page resolves the persona it generates under from here, so
    // this is where "which brand voice am I working in" is decided.
    //
    // Prefer the workspace's active_persona_id, falling back to the oldest
    // persona. The fallback matters in three real cases: workspaces created
    // before voice switching existed (active_persona_id is null on every
    // pre-existing row), a failed best-effort write in POST /api/personas, and
    // a persona deleted while still selected. Resolving by ownership rather
    // than trusting the column blindly also means a stale id pointing at a
    // deleted or foreign persona degrades to a valid voice instead of a 404
    // loop or a cross-tenant read.
    const { data: personas } = await supabase
      .from('personas')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: true })

    const activeId = workspace.active_persona_id as string | null | undefined
    const persona =
      (activeId && personas?.find(p => p.id === activeId)) || personas?.[0]

    return NextResponse.json({
      workspace_id: workspace.id,
      persona_id: persona?.id,
      persona_display_name: persona?.display_name,
      personas: (personas || []).map(p => ({ id: p.id, display_name: p.display_name })),
      plan_tier: workspace.plan_tier,
      generations_used: workspace.generations_used,
    })

  } catch (error) {
    console.error('Me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}