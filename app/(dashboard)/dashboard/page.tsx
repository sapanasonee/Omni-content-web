import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { computeNudge } from '@/lib/streak'
import type { BrandDNA } from '@/lib/types'

async function loadCadence(workspace_id: string, persona_id: string): Promise<string | undefined> {
  try {
    const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME!)
    const [content] = await bucket
      .file(`workspaces/${workspace_id}/personas/${persona_id}/brand_dna.json`)
      .download()
    const dna: BrandDNA = JSON.parse(content.toString())
    return dna.sections.formats?.cadence || undefined
  } catch {
    return undefined
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { voice_limit?: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_id', user!.id)
    .single()

  // Cadence is a property of a specific voice's Brand DNA, so read it from the
  // ACTIVE persona rather than the oldest one — otherwise someone managing
  // several clients would get nudged on the wrong client's posting rhythm.
  const { data: personas } = await supabase
    .from('personas')
    .select('id')
    .eq('workspace_id', workspace?.id)
    .order('created_at', { ascending: true })

  const persona =
    (workspace?.active_persona_id &&
      personas?.find(p => p.id === workspace.active_persona_id)) ||
    personas?.[0]

  const [{ data: recentContent }, { data: approvals }] = await Promise.all([
    supabase
      .from('content_pieces')
      .select('*')
      .eq('workspace_id', workspace?.id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('content_pieces')
      .select('approved_at')
      .eq('workspace_id', workspace?.id)
      .eq('status', 'approved')
      .not('approved_at', 'is', null)
      .order('approved_at', { ascending: false })
      .limit(200),
  ])

  const cadence = workspace && persona
    ? await loadCadence(workspace.id, persona.id)
    : undefined

  const nudgeState = computeNudge(
    (approvals || []).map(a => new Date(a.approved_at as string)),
    cadence,
  )

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Good to see you back.</h1>
          <p className="text-sm text-gray-500 mt-1">
            {workspace?.plan_tier === 'solo' && `${workspace.generations_used}/30 generations used this month`}
          </p>
        </div>
        {nudgeState.streakWeeks > 0 && (
          <div className="px-3 py-1.5 bg-orange-50 border border-orange-100 rounded-full text-xs font-medium text-orange-600">
            🔥 {nudgeState.streakWeeks}-week streak
          </div>
        )}
      </div>

      {searchParams.voice_limit && (
        <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm text-amber-800">
            You&apos;ve used every brand voice your plan includes.{' '}
            <Link href="/pricing" className="font-medium underline underline-offset-2">
              See plans →
            </Link>
          </p>
        </div>
      )}

      {nudgeState.nudge && nudgeState.message && (
        <Link
          href="/generate"
          className="block mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl hover:border-amber-300 transition-colors"
        >
          <p className="text-sm text-amber-800">
            {nudgeState.message}
            <span className="ml-1.5 font-medium underline underline-offset-2">Write something →</span>
          </p>
        </Link>
      )}

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
