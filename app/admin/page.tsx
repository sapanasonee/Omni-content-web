import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { isFounderEmail, hasServiceRole } from '@/lib/admin'
import AdminClient from './AdminClient'

export const dynamic = 'force-dynamic'

// Founder-only. Rendered outside the (dashboard) group so it doesn't inherit
// the workspace sidebar — this page is about OTHER people's accounts.
//
// notFound() rather than a redirect for non-founders: an admin surface should
// not advertise its own existence to anyone who happens to try the URL. The
// API route behind it repeats every check independently, so this gate is for
// the humans, not the security boundary.
export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !isFounderEmail(user.email)) notFound()

  return <AdminClient serviceRoleConfigured={hasServiceRole()} />
}
