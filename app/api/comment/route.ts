import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { VertexAI } from '@google-cloud/vertexai'
import { NextResponse } from 'next/server'
import type { BrandDNA } from '@/lib/types'
import { runLinter } from '@/lib/critic'
import { requireWorkspaceOwnership, requirePersonaInWorkspace } from '@/lib/auth-guard'
import { INPUT_LIMITS, rejectOversized } from '@/lib/input-limits'
import { COMMENT_GOALS, COMMENT_GOAL_VALUES } from '@/lib/comment-goals'
import { loadVoiceProfile } from '@/lib/voice-profile'

// ─── Comment generation ──────────────────────────────────────────────────────
//
// The user pastes a post they've seen, picks WHY they want to comment (goal),
// and gets three comment options in their voice. This is the first consumer of
// the Observed Voice profile's `stances` — a comment is 90% take and 10%
// format, so recurring positions matter more here than in long-form.
//
// Deliberately STATELESS in v1: options are returned, the user copies the one
// they like, nothing is stored. That keeps comments out of content_pieces
// (no format-enum/schema risk on the untracked live DB, and comments must
// never become long-form RAG exemplars — wrong register). When comments earn
// their own memory loop, that's a deliberate follow-up, not a side effect.
//
// Quota: counts as a generation (it's a full model call), reserved atomically
// via the same RPC as /api/generate. No activation exemption — comments are a
// post-onboarding surface.
// ─────────────────────────────────────────────────────────────────────────────

const COMMENT_COUNT = 3

function getBucket() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
  return storage.bucket(process.env.GCS_BUCKET_NAME!)
}

function extractJSON(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    // 1. Auth
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse + validate. Cheapest checks first, before any DB access.
    const { workspace_id, persona_id, post_text, goal, angle } = await request.json()
    if (!workspace_id || !persona_id || typeof post_text !== 'string' || !post_text.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!COMMENT_GOAL_VALUES.includes(goal)) {
      return NextResponse.json({ error: 'Invalid goal' }, { status: 400 })
    }
    const oversized = rejectOversized([
      ['post_text', post_text, INPUT_LIMITS.comment_post],
      ['angle', angle, INPUT_LIMITS.comment_angle],
    ])
    if (oversized) return oversized

    // 3. Ownership guards — standard two-step.
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    const workspace = wsGuard.workspace
    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure

    // 4. Quota pre-check + atomic reservation (same posture as /api/generate:
    //    reserve-then-spend; RPC transport failure fails open after the
    //    pre-check passed).
    if (workspace.plan_tier === 'solo' && (workspace.generations_used ?? 0) >= 30) {
      return NextResponse.json({
        error: 'Monthly generation limit reached. Upgrade to Studio for more.'
      }, { status: 402 })
    }
    const { data: quota, error: quotaError } = await supabase
      .rpc('increment_generation_count', { p_workspace_id: workspace_id })
    if (quota && quota.success === false && quota.reason === 'limit_reached') {
      return NextResponse.json({
        error: 'Monthly generation limit reached. Upgrade to Studio for more.'
      }, { status: 402 })
    }
    if (quotaError) {
      console.error('Quota increment failed (failing open, pre-check passed):', quotaError)
    }

    // 5. Load the voice sources: Brand DNA (required), Observed Voice + active
    //    standing rules (both best-effort).
    let dna: BrandDNA['sections']
    try {
      const [content] = await getBucket()
        .file(`workspaces/${workspace_id}/personas/${persona_id}/brand_dna.json`)
        .download()
      dna = (JSON.parse(content.toString()) as BrandDNA).sections
    } catch {
      return NextResponse.json({
        error: 'Brand DNA not found. Please complete onboarding first.'
      }, { status: 404 })
    }

    const profile = await loadVoiceProfile(workspace_id, persona_id)
    const stancesBlock = profile.active?.stances?.length
      ? `\nPOSITIONS THEY KEEP EXPRESSING (their observed takes — draw on these where relevant, a comment is mostly take):\n${profile.active.stances.map(s => `- ${s}`).join('\n')}`
      : ''
    const styleBlock = profile.active?.style_observations?.length
      ? `\nHOW THEY ACTUALLY WRITE LATELY (observed texture, not rules):\n${profile.active.style_observations.map(s => `- ${s}`).join('\n')}`
      : ''

    const { data: permanentContexts } = await supabase
      .from('contexts')
      .select('content, tier')
      .eq('persona_id', persona_id)
      .eq('scope', 'permanent')
      .eq('status', 'active')
    const rulesBlock = (permanentContexts || []).length
      ? `\nSTANDING RULES (apply to comments too):\n${(permanentContexts || []).map(c => `- ${c.content}`).join('\n')}`
      : ''

    const goalDef = COMMENT_GOALS.find(g => g.value === goal)!

    // 6. One model call → three differently-angled options as JSON.
    const prompt = `You write LinkedIn comments for ${dna.identity.full_name} (${dna.identity.role}, ${dna.identity.industry}). They just read the post below and want to comment. Write ${COMMENT_COUNT} DIFFERENT comment options in their voice.

THEIR VOICE:
${dna.voice.description}
Tones: ${dna.voice.tones.join(', ')}
Formality: ${dna.voice.formality}/5, Pace: ${dna.voice.pace}/5
${stancesBlock}${styleBlock}

AVOID RULES (hard stops):
${dna.avoid.map(a => `- ${a}`).join('\n')}
${rulesBlock}

THE POST THEY'RE COMMENTING ON:
"""
${post_text.trim()}
"""

WHY THEY'RE COMMENTING: ${goalDef.instruction}
${angle?.trim() ? `\nTHEIR ANGLE (work this in): ${angle.trim()}` : ''}

COMMENT RULES — non-negotiable:
- 1 to 4 sentences. A comment, not a post. No headings, no bullet lists, no hashtags.
- Reference something SPECIFIC from the post — never a comment that could sit under any post.
- Add something new. Never summarize or restate the post back at the author.
- Never open with empty praise ("Great post!", "Love this", "So true") or with "As a [role]".
- No sycophancy, no self-promotion, no links.
- Each of the ${COMMENT_COUNT} options must take a genuinely different angle or moment from the post — not three phrasings of one idea.
- Sound like a sharp person typing in the comments section, not an essayist.

Respond with ONLY this JSON, no prose:
{"comments": ["...", "...", "..."]}`

    const vertexAI = new VertexAI({
      project: process.env.GCP_PROJECT_ID!,
      location: 'us-central1',
    })
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })
    const raw = (result.response.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')

    const parsed = extractJSON(raw) as { comments?: unknown } | null
    const texts = (Array.isArray(parsed?.comments) ? parsed!.comments : [])
      .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
      .map(c => c.trim())
      .slice(0, COMMENT_COUNT)

    if (texts.length === 0) {
      return NextResponse.json({ error: 'Comment generation failed. Try again.' }, { status: 502 })
    }

    // 7. Linter over each option — same universal AI-tell net as posts. The
    //    50-char minimum doesn't apply to comments (short is correct here), so
    //    filter that specific heuristic out.
    const options = texts.map(text => ({
      text,
      flags: runLinter(text).filter(f => !f.startsWith('Content too short')),
    }))

    return NextResponse.json({ options })
  } catch (error) {
    console.error('Comment generation error:', error)
    return NextResponse.json({ error: 'Comment generation failed' }, { status: 500 })
  }
}
