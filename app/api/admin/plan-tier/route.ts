import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { PLAN_LIMITS, planLimitsFor } from '@/lib/types'
import type { PlanTier } from '@/lib/types'
import { isFounderEmail, createServiceClient, hasServiceRole } from '@/lib/admin'
import { isUuid } from '@/lib/auth-guard'

// Founder-only tier management. See lib/admin.ts for why this is an admin
// action rather than a self-serve upgrade.
//
// Ordering contract, enforced identically in both handlers below:
//   auth → founder allowlist → service-role client → cross-tenant query
// The service-role client bypasses RLS, so it is never constructed until the
// caller has been proven to be a founder.

const VALID_TIERS = Object.keys(PLAN_LIMITS) as PlanTier[]

// Shared preamble. Returns either a failure response or an admin client.
async function requireFounder() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  // 404, not 401/403: a distinct status would confirm to a probing
  // non-founder that an admin surface exists at this path at all. Same
  // information-hiding rationale as requireWorkspaceOwnership in auth-guard.
  const notFound = NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (authError || !user) return { failure: notFound, admin: null, user: null }
  if (!isFounderEmail(user.email)) return { failure: notFound, admin: null, user: null }

  if (!hasServiceRole()) {
    // Only a confirmed founder ever sees this, so it can be specific about the
    // missing configuration rather than vague.
    return {
      failure: NextResponse.json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Add it to the Cloud Run service to manage plan tiers.',
        code: 'service_role_missing',
      }, { status: 503 }),
      admin: null,
      user: null,
    }
  }

  return { failure: null, admin: createServiceClient()!, user }
}

// GET: list every account with its tier and voice usage.
export async function GET() {
  try {
    const { failure, admin } = await requireFounder()
    if (failure) return failure

    const { data: workspaces, error } = await admin!
      .from('workspaces')
      .select('id, owner_id, name, plan_tier, generations_used, created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      console.error('Admin list workspaces error:', error)
      return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 })
    }

    const ids = (workspaces || []).map(w => w.id)
    const { data: personas } = await admin!
      .from('personas')
      .select('id, workspace_id')
      .in('workspace_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])

    const voiceCount = new Map<string, number>()
    for (const p of personas || []) {
      voiceCount.set(p.workspace_id, (voiceCount.get(p.workspace_id) ?? 0) + 1)
    }

    // Resolve owner emails via the admin auth API. Done as one paged listing
    // rather than per-workspace lookups because several workspaces commonly
    // share an owner (re-running onboarding created a new workspace each time
    // before brand voices existed).
    const emailById = new Map<string, string>()
    try {
      const { data: usersPage } = await admin!.auth.admin.listUsers({ page: 1, perPage: 1000 })
      for (const u of usersPage?.users || []) {
        if (u.email) emailById.set(u.id, u.email)
      }
    } catch (err) {
      // Non-fatal: the table is still usable keyed by workspace name/id.
      console.warn('Admin listUsers failed (non-fatal):', err)
    }

    return NextResponse.json({
      accounts: (workspaces || []).map(w => {
        const limits = planLimitsFor(w.plan_tier)
        return {
          workspace_id: w.id,
          name: w.name,
          email: emailById.get(w.owner_id) ?? null,
          plan_tier: w.plan_tier ?? 'solo',
          generations_used: w.generations_used ?? 0,
          voices_used: voiceCount.get(w.id) ?? 0,
          max_voices: limits.max_personas === Infinity ? null : limits.max_personas,
          created_at: w.created_at,
        }
      }),
      valid_tiers: VALID_TIERS,
    })
  } catch (error) {
    console.error('Admin plan-tier GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: set a workspace's tier.
export async function POST(request: Request) {
  try {
    const { failure, admin, user } = await requireFounder()
    if (failure) return failure

    const { workspace_id, tier } = await request.json()

    if (!isUuid(workspace_id)) {
      return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 })
    }
    // Allowlist check against PLAN_LIMITS keys. plan_tier has no CHECK
    // constraint in the database, so an unvalidated value here would persist
    // happily and then silently resolve to solo via planLimitsFor — a grant
    // that looks applied but isn't.
    if (!VALID_TIERS.includes(tier)) {
      return NextResponse.json({
        error: `tier must be one of: ${VALID_TIERS.join(', ')}`,
      }, { status: 400 })
    }

    const { data: before } = await admin!
      .from('workspaces')
      .select('id, name, plan_tier')
      .eq('id', workspace_id)
      .maybeSingle()

    if (!before) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const { error } = await admin!
      .from('workspaces')
      .update({ plan_tier: tier })
      .eq('id', workspace_id)

    if (error) {
      console.error('Admin set tier error:', error)
      return NextResponse.json({ error: 'Failed to update plan tier' }, { status: 500 })
    }

    // Deliberately audit-logged: this is the one place in the app where one
    // account changes another account's entitlements, and there is no billing
    // record to reconcile it against.
    console.log(
      `[admin] plan_tier ${before.plan_tier ?? 'solo'} -> ${tier} on workspace ${workspace_id} by ${user!.email}`,
    )

    // NOTE: downgrading is intentionally non-destructive. If a workspace has
    // more personas than the new tier allows, the extra voices keep working
    // and keep their data — only CREATING another is blocked (the cap in
    // POST /api/personas is checked at create time). Deleting a user's voice
    // as a side effect of a tier change would destroy their Brand DNA and
    // content history, which no plan change should ever do silently.
    return NextResponse.json({ success: true, workspace_id, plan_tier: tier })
  } catch (error) {
    console.error('Admin plan-tier POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
