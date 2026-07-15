import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireWorkspaceOwnership, requirePersonaInWorkspace, isUuid } from '@/lib/auth-guard'
import { INPUT_LIMITS, rejectOversized } from '@/lib/input-limits'

// ─── GET: list contexts for a persona ────────────────────────
// Query params: workspace_id, persona_id (required); scope, status (optional filters)
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
    const scope = searchParams.get('scope')          // optional: permanent | campaign
    const status = searchParams.get('status')        // optional: active | closed

    if (!workspace_id || !persona_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Ownership guard: contexts contain the user's standing rules and campaign
    // briefs — competitive/strategic material. Listing previously relied on RLS
    // alone; the guard adds the explicit owner check so a policy gap on the
    // contexts table can't turn this into a cross-tenant read.
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure

    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    let query = supabase
      .from('contexts')
      .select('id, scope, tier, name, status, content, created_at, closed_at')
      .eq('workspace_id', workspace_id)
      .eq('persona_id', persona_id)
      .order('created_at', { ascending: true })

    if (scope) query = query.eq('scope', scope)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) {
      console.error('Contexts list failed:', error)
      return NextResponse.json({ error: 'Failed to load contexts' }, { status: 500 })
    }

    return NextResponse.json({ contexts: data })
  } catch (error) {
    console.error('Contexts GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── POST: create a context (permanent rule or campaign) ─────
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workspace_id, persona_id, scope, tier, name, content } = await request.json()

    if (!workspace_id || !persona_id || !scope || !content?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!['permanent', 'campaign'].includes(scope)) {
      // one_time contexts are passed at generation, never stored standalone
      return NextResponse.json({ error: 'Scope must be permanent or campaign' }, { status: 400 })
    }
    if (scope === 'campaign' && !name?.trim()) {
      return NextResponse.json({ error: 'Campaigns require a name' }, { status: 400 })
    }
    if (tier && !['default', 'hard_rule'].includes(tier)) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
    }

    // Length caps matter more for contexts than anywhere else: every ACTIVE
    // permanent context is interpolated into EVERY future generation, so an
    // unbounded rule isn't a one-off cost — it's a standing per-request token
    // tax the user (or an attacker with their session) installs once and we
    // pay forever. Rejected, not truncated, so a half-saved rule can't
    // silently mean something different from what was written.
    const oversized = rejectOversized([
      ['content', content, INPUT_LIMITS.context_content],
      ['name', name, INPUT_LIMITS.context_name],
    ])
    if (oversized) return oversized

    // Ownership guard before insert. The persona check matters doubly here:
    // this route previously never verified persona-belongs-to-workspace at
    // all, so a caller could attach a rule to an arbitrary persona_id. Since
    // generation loads permanent contexts BY persona_id ONLY (not workspace),
    // an unchecked insert here was a potential injection point into another
    // persona's prompts — the guard closes that path in code regardless of
    // what RLS does.
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure

    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    const { data, error } = await supabase
      .from('contexts')
      .insert({
        workspace_id,
        persona_id,
        scope,
        tier: scope === 'permanent' ? (tier || 'default') : null,  // rules default to 'default'; campaigns have no tier
        name: scope === 'campaign' ? name.trim() : null,
        content: content.trim(),
      })
      .select('id, scope, tier, name, status, content, created_at')
      .single()

    if (error) {
      console.error('Context create failed:', error)
      return NextResponse.json({ error: 'Failed to create context' }, { status: 500 })
    }

    return NextResponse.json({ context: data })
  } catch (error) {
    console.error('Contexts POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── PATCH: update a context (edit content, change tier, close) ─
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, workspace_id, content, tier, status } = await request.json()

    if (!id || !workspace_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Ownership guard before update. Updating a context can flip a rule to
    // hard_rule (never overridable in prompts) or resurrect a closed one, so
    // writes must be pinned to the caller's own workspace in code, not just
    // by RLS. The context id itself is UUID-checked to keep garbage out of
    // the query (and out of the logs as 22P02 noise).
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Context not found or update failed' }, { status: 404 })
    }

    // Same standing-token-tax reasoning as POST: an edit can grow a rule just
    // as easily as a create can, so the cap applies on both write paths.
    const oversizedUpdate = rejectOversized([
      ['content', content, INPUT_LIMITS.context_content],
    ])
    if (oversizedUpdate) return oversizedUpdate

    // Build the update object from only the fields provided
    const updates: Record<string, unknown> = {}
    if (typeof content === 'string' && content.trim()) updates.content = content.trim()
    if (tier !== undefined) {
      if (!['default', 'hard_rule'].includes(tier)) {
        return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
      }
      updates.tier = tier
    }
    if (status !== undefined) {
      if (!['active', 'closed'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      updates.status = status
      if (status === 'closed') updates.closed_at = new Date().toISOString()
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('contexts')
      .update(updates)
      .eq('id', id)
      .eq('workspace_id', workspace_id)
      .select('id, scope, tier, name, status, content, closed_at')
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Context not found or update failed' }, { status: 404 })
    }

    return NextResponse.json({ context: data })
  } catch (error) {
    console.error('Contexts PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}