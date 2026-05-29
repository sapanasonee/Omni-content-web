import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'

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

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        workspace={workspace}
        personas={personas || []}
        userEmail={user.email || ''}
      />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}