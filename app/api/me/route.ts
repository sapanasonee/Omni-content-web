import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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