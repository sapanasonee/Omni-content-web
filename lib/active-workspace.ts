import { cookies } from 'next/headers'
import type { createClient } from '@/lib/supabase/server'

// ─── Why this module exists ──────────────────────────────────────────────────
//
// An account can own multiple workspaces (each = one voice; see
// app/api/onboarding/route.ts, capped at MAX_WORKSPACES_PER_USER). Before this
// module, every reader (app/api/me, app/(dashboard)/layout.tsx) independently
// picked "the most recently created workspace" with no way for a user to
// choose otherwise. This centralizes that resolution so there is exactly one
// place that decides which workspace is "active" — and one place a future
// caller must use instead of re-deriving the logic.
//
// The active-workspace cookie is a CONVENIENCE, never a trust boundary: it is
// re-validated against owner_id on every read here, exactly like every other
// client-supplied ID in this app (see lib/auth-guard.ts). A missing, stale,
// or tampered cookie just falls back to the most-recently-created workspace —
// the only behavior that existed before this feature. Nothing about adding a
// switcher weakens per-tenant isolation: every route that actually touches
// persona-scoped data still runs requireWorkspaceOwnership /
// requirePersonaInWorkspace independently before returning anything, so a
// resolved-but-wrong workspace_id here would 404, never leak.
// ─────────────────────────────────────────────────────────────────────────────

export const ACTIVE_WORKSPACE_COOKIE = 'vowwl_active_workspace'

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

export interface WorkspaceVoice {
  id: string
  name: string
  plan_tier: string
  generations_used: number
  created_at: string
  persona_id: string | null
  persona_display_name: string | null
  voice_label: string | null
}

export interface ResolvedWorkspaces {
  active: WorkspaceVoice | null
  voices: WorkspaceVoice[]
}

// Every workspace the user owns, each paired with its one persona (onboarding
// creates exactly one persona per workspace — see app/api/onboarding/route.ts
// step 6 — so this join is 1:1 in practice, not a real multi-persona-per-
// workspace lookup). Newest first, EXCEPT the one the active-workspace cookie
// names, which is treated as active regardless of recency.
export async function resolveWorkspaces(
  supabase: ServerSupabase,
  userId: string,
): Promise<ResolvedWorkspaces> {
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, plan_tier, generations_used, created_at')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })

  const list = workspaces ?? []
  if (list.length === 0) return { active: null, voices: [] }

  const { data: personas } = await supabase
    .from('personas')
    .select('id, workspace_id, display_name, voice_label')
    .in('workspace_id', list.map(w => w.id))

  const personaByWorkspace = new Map((personas ?? []).map(p => [p.workspace_id, p]))

  const voices: WorkspaceVoice[] = list.map(w => {
    const persona = personaByWorkspace.get(w.id)
    return {
      ...w,
      persona_id: persona?.id ?? null,
      persona_display_name: persona?.display_name ?? null,
      voice_label: persona?.voice_label ?? null,
    }
  })

  const cookieStore = await cookies()
  const requested = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value
  const active = voices.find(w => w.id === requested) ?? voices[0]

  return { active, voices }
}
