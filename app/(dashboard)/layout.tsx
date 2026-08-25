import { createClient } from '@/lib/supabase/server'
import { resolveWorkspaces } from '@/lib/active-workspace'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // The active workspace (respecting the switcher's cookie, falling back to
  // most-recently-created — see lib/active-workspace.ts) plus every voice on
  // the account, for the Sidebar switcher.
  const { active, voices } = await resolveWorkspaces(supabase, user.id)
  if (!active) redirect('/onboarding')

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        activeWorkspaceId={active.id}
        generationsUsed={active.generations_used}
        voices={voices}
        userEmail={user.email || ''}
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}