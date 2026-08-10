import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'

// PUT: set which brand voice this workspace is currently working in.
//
// `workspaces.active_persona_id` has existed in the schema all along but was
// never read or written by any code — the sidebar's voice switcher only set
// React state, so switching appeared to work and then silently did nothing:
// /api/me always resolved the workspace's FIRST persona, so every generation
// went to that one voice regardless of the selection. This route plus the
// /api/me change is what makes the switch real.
//
// Server-side rather than client state because persona_id determines which
// brand_dna.json every subsequent generation reads. A voice selection that
// lived only in the browser would silently reset on reload and could write
// content under the wrong voice — the exact failure this feature exists to
// prevent for people managing multiple clients.
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workspace_id, persona_id } = await request.json()
    if (!workspace_id || !persona_id) {
      return NextResponse.json({ error: 'Missing workspace_id or persona_id' }, { status: 400 })
    }

    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure

    // Pins the persona to the already-trusted workspace. Without it a caller
    // could point their own workspace at another tenant's persona_id, and
    // every downstream read keyed by persona_id (brand_dna.json path, RAG
    // exemplars, voice profile) would follow it.
    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    const { error } = await supabase
      .from('workspaces')
      .update({ active_persona_id: persona_id })
      .eq('id', workspace_id)
      .eq('owner_id', user.id)

    if (error) {
      console.error('Set active persona error:', error)
      return NextResponse.json({ error: 'Failed to switch brand voice' }, { status: 500 })
    }

    return NextResponse.json({ success: true, persona_id })
  } catch (error) {
    console.error('Active persona PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
