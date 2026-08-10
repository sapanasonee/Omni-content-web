import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OnboardingClient from './OnboardingClient'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Without this, an unauthenticated visitor (e.g. a magic link that never
  // actually established a session) could fill out the entire multi-step
  // form and only discover they're signed out when POST /api/onboarding
  // returns 401 at the very end.
  if (!user) redirect('/login')

  return <OnboardingClient />
}
