'use client'

import { useEffect, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface Account {
  workspace_id: string
  name: string
  email: string | null
  plan_tier: string
  generations_used: number
  voices_used: number
  max_voices: number | null
  created_at: string
}

const TIER_LABEL: Record<string, string> = {
  solo: 'Founding member',
  studio: 'Studio',
  agency: 'Agency',
}

export default function AdminClient({
  serviceRoleConfigured,
}: {
  serviceRoleConfigured: boolean
}) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [validTiers, setValidTiers] = useState<string[]>(['solo', 'studio', 'agency'])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/plan-tier')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to load accounts')
      setAccounts(body.accounts || [])
      if (body.valid_tiers?.length) setValidTiers(body.valid_tiers)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function setTier(workspace_id: string, tier: string) {
    setSavingId(workspace_id)
    setError(null)
    try {
      const res = await fetch('/api/admin/plan-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id, tier }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to update plan tier')

      // Re-read rather than patching locally: max_voices is derived from the
      // tier server-side, so a local edit would show a stale voice allowance.
      await load()
      setSavedId(workspace_id)
      setTimeout(() => setSavedId(null), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update plan tier')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Grant plan tiers manually. There is no billing yet — every tier here is a
            comped early-access grant.
          </p>
        </div>

        {!serviceRoleConfigured && (
          <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
            <p className="text-sm font-medium text-amber-900">
              SUPABASE_SERVICE_ROLE_KEY is not set on this deployment.
            </p>
            <p className="text-xs text-amber-700">
              Changing another account&apos;s tier writes across the RLS boundary and needs
              the service role key. Add it to the Cloud Run service and redeploy.
            </p>
          </div>
        )}

        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">No accounts yet.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map(a => (
              <div
                key={a.workspace_id}
                className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {a.email || a.name}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {a.email ? `${a.name} · ` : ''}
                    {a.voices_used}/{a.max_voices ?? '∞'} voices · {a.generations_used} generations
                  </p>
                </div>

                {savedId === a.workspace_id && (
                  <span className="text-xs text-green-600 font-medium flex-shrink-0">Saved</span>
                )}

                <select
                  value={a.plan_tier}
                  disabled={savingId !== null || !serviceRoleConfigured}
                  onChange={e => setTier(a.workspace_id, e.target.value)}
                  className={cn(
                    'text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white flex-shrink-0',
                    'focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]',
                    'disabled:opacity-50',
                  )}
                >
                  {validTiers.map(t => (
                    <option key={t} value={t}>{TIER_LABEL[t] || t}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400">
          Downgrading never deletes anything: voices over the new limit keep working, but no
          new ones can be added until the count is back under the cap.
        </p>
      </div>
    </div>
  )
}
