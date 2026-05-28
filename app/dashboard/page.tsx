import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function Dashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-2">
        <div className="w-10 h-10 bg-[#534AB7] rounded-xl mx-auto" />
        <h1 className="text-xl font-bold text-gray-900">Welcome to Omni</h1>
        <p className="text-sm text-gray-500">{user.email}</p>
      </div>
    </div>
  )
}