import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OnboardingClient from './OnboardingClient'
import { planLimitsFor } from '@/lib/types'

export const dynamic = 'force-dynamic'

// The wizard serves two flows that collect the identical Brand DNA:
//
//   (default)        first-run signup — creates workspace + first persona
//   ?mode=add-voice  an existing account adding another brand voice (persona)
//                    to the workspace it already has
//
// Sharing one wizard is deliberate: a second voice needs exactly the same
// profile a first one does, and a parallel "add voice" form would drift from
// onboarding the moment either changed. Only the submit target differs, which
// the client picks from the mode prop below.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { mode?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Without this, an unauthenticated visitor (e.g. a magic link that never
  // actually established a session) could fill out the entire multi-step
  // form and only discover they're signed out when the final POST returns
  // 401.
  if (!user) redirect('/login')

  const addVoice = searchParams.mode === 'add-voice'

  if (!addVoice) return <OnboardingClient mode="signup" />

  // ─── add-voice mode ───────────────────────────────────────────────────────
  // Everything below fails back to a sensible flow rather than erroring: this
  // URL is reachable by hand, and a stale sidebar link can outlive the state
  // that made it valid.
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, plan_tier, active_persona_id')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // No workspace yet — "add a voice" is meaningless; they need first-run setup.
  if (!workspace) return <OnboardingClient mode="signup" />

  const { count: personaCount } = await supabase
    .from('personas')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace.id)

  const limits = planLimitsFor(workspace.plan_tier)

  // Already at the tier cap. Bounce rather than let them fill the whole wizard
  // and eat a 403 at submit — the same fail-late trap this page had before.
  // POST /api/personas re-checks server-side; this is only the friendly gate.
  if ((personaCount ?? 0) >= limits.max_personas) {
    redirect('/dashboard?voice_limit=1')
  }

  return <OnboardingClient mode="add-voice" workspaceId={workspace.id} />
}
