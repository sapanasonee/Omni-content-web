import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaces } from '@/lib/active-workspace'
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
    // authenticated user via owner_id (resolveWorkspaces re-validates the
    // active-workspace cookie the same way), which is exactly the invariant
    // the guard exists to enforce elsewhere. If this route is ever changed to
    // accept a workspace_id parameter, it must adopt requireWorkspaceOwnership
    // like every other route.
    const { active, voices } = await resolveWorkspaces(supabase, user.id)

    if (!active) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    return NextResponse.json({
      workspace_id: active.id,
      persona_id: active.persona_id,
      plan_tier: active.plan_tier,
      generations_used: active.generations_used,
      voice_label: active.voice_label,
      // Every voice on the account, for a workspace/voice switcher UI.
      // Absent any client-supplied ID, so no ownership check is needed here
      // either — resolveWorkspaces already scoped this to `user.id`.
      voices: voices.map(v => ({
        workspace_id: v.id,
        persona_id: v.persona_id,
        display_name: v.persona_display_name,
        voice_label: v.voice_label,
        created_at: v.created_at,
      })),
    })

  } catch (error) {
    console.error('Me error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
