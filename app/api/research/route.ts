import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { runResearch } from '@/lib/research'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'
import { INPUT_LIMITS, rejectOversized } from '@/lib/input-limits'

// POST /api/research  { workspace_id, persona_id, query }
//   → { summary: string, sources: { title, url }[] }
//
// One grounded Gemini call (same cost class as /api/topics). Returns only
// real links straight from Google Search's own results — see lib/research.ts
// for why that matters. The generate page lets the user pick which of these
// to hand to the writer as allowed_sources.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workspace_id, persona_id, query } = await request.json()
    if (!workspace_id || !persona_id || !query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const oversized = rejectOversized([['query', query, INPUT_LIMITS.topic]])
    if (oversized) return oversized

    // Same ownership guard as generate/topics — this spends a grounded call
    // and the result flows straight into a later generate request.
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    const { summary, sources } = await runResearch(query)
    return NextResponse.json({ summary, sources })

  } catch (error) {
    console.error('Research error:', error)
    return NextResponse.json({ error: 'Research failed' }, { status: 500 })
  }
}
