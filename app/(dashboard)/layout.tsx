import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import { planLimitsFor } from '@/lib/types'
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Get workspace and personas
  const { data: workspace } = await supabase
  .from('workspaces')
  .select('*')
  .eq('owner_id', user.id)
  .order('created_at', { ascending: false })
  .limit(1)
  .single()
  // If no workspace, redirect to onboarding
  if (!workspace) redirect('/onboarding')

  const { data: personas } = await supabase
    .from('personas')
    .select('*')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: true })

  // Same resolution rule as /api/me — active voice, else oldest. Kept
  // consistent so the sidebar can never highlight a different voice than the
  // one generation will actually use.
  const list = personas || []
  const activePersonaId =
    (workspace.active_persona_id && list.some(p => p.id === workspace.active_persona_id)
      ? workspace.active_persona_id
      : list[0]?.id) ?? null

  const maxVoices = planLimitsFor(workspace.plan_tier).max_personas

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        workspace={workspace}
        personas={list}
        activePersonaId={activePersonaId}
        canAddVoice={list.length < maxVoices}
        userEmail={user.email || ''}
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}