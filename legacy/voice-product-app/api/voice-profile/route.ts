import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'
import { loadVoiceProfile, saveVoiceProfile } from '@/lib/voice-profile'

// The review surface for the Observed Voice profile. GET returns the active
// snapshot (what generation currently uses as texture) and the proposed one
// (awaiting the user's "your voice has evolved" review). PATCH applies or
// dismisses the proposal — the ONLY path by which a proposal becomes active,
// keeping the confirm-first invariant structural.

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

    const profile = await loadVoiceProfile(workspace_id, persona_id)
    return NextResponse.json({ active: profile.active, proposed: profile.proposed })
  } catch (error) {
    console.error('Voice-profile GET error:', error)
    return NextResponse.json({ error: 'Failed to load voice profile' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workspace_id, persona_id, action } = await request.json()
    if (!workspace_id || !persona_id || !['accept', 'dismiss'].includes(action)) {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
    }

    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    const profile = await loadVoiceProfile(workspace_id, persona_id)
    if (!profile.proposed) {
      return NextResponse.json({ error: 'No proposed profile to review' }, { status: 400 })
    }

    // Accept promotes the proposal to active; dismiss discards it. Either way
    // the proposal slot clears, and last_distill_approved_count (already set at
    // distill time) prevents an immediate re-proposal — the next one needs
    // DISTILL_EVERY_APPROVALS fresh approvals of new signal.
    const updated = {
      ...profile,
      active: action === 'accept' ? profile.proposed : profile.active,
      proposed: null,
    }
    await saveVoiceProfile(updated)
    return NextResponse.json({ success: true, active: updated.active })
  } catch (error) {
    console.error('Voice-profile PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update voice profile' }, { status: 500 })
  }
}
