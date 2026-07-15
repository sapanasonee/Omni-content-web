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

    const { data: persona } = await supabase
      .from('personas')
      .select('*')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    return NextResponse.json({
      workspace_id: workspace.id,
      persona_id: persona?.id,
      plan_tier: workspace.plan_tier,
      generations_used: workspace.generations_used,
    })

  } catch (error) {
    console.error('Me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}