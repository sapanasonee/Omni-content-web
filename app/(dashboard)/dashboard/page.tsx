import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_id', user!.id)
    .single()

  const { data: recentContent } = await supabase
    .from('content_pieces')
    .select('*')
    .eq('workspace_id', workspace?.id)
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Good to see you back.</h1>
        <p className="text-sm text-gray-500 mt-1">
          {workspace?.plan_tier === 'solo' && `${workspace.generations_used}/30 generations used this month`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <Link
          href="/generate"
          className="p-5 bg-[#534AB7] rounded-xl text-white hover:opacity-90 transition-opacity"
        >
          <div className="text-lg font-semibold mb-1">Generate content</div>
          <div className="text-sm opacity-75">Write a new post or piece</div>
        </Link>
        <Link
          href="/dna"
          className="p-5 bg-white border border-gray-200 rounded-xl hover:border-[#534AB7] transition-colors"
        >
          <div className="text-lg font-semibold text-gray-900 mb-1">Edit brand DNA</div>
          <div className="text-sm text-gray-500">Update your voice profile</div>
        </Link>
      </div>

      {recentContent && recentContent.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-3">Recent content</h2>
          <div className="space-y-2">
            {recentContent.map(piece => (
              <div key={piece.id} className="p-4 bg-white border border-gray-100 rounded-xl">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-[#534AB7] uppercase tracking-wide">
                    {piece.format}
                  </span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    piece.status === 'approved'
                      ? 'bg-green-50 text-green-600'
                      : 'bg-gray-100 text-gray-500'
                  )}>
                    {piece.status}
                  </span>
                </div>
                <p className="text-sm text-gray-700 line-clamp-2">{piece.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">No content yet. Generate your first piece.</p>
        </div>
      )}
    </div>
  )
}