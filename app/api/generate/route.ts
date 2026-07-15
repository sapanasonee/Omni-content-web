 import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { VertexAI, type GenerateContentRequest } from '@google-cloud/vertexai'
import { NextResponse } from 'next/server'
import type { BrandDNA, ContentFormat } from '@/lib/types'
import { runLinter, runLLMCritic, reviseDraft } from '@/lib/critic'
import { requireWorkspaceOwnership, requirePersonaInWorkspace, isUuid } from '@/lib/auth-guard'

const FORMAT_INSTRUCTIONS: Record<ContentFormat, string> = {
  linkedin: 'LinkedIn post. Max 1300 characters. Short paragraphs. Max 4 hashtags at the end only. Start with a hook. End with insight or question.',
  twitter: 'Twitter/X post. Max 280 characters. One idea. Punchy and direct. No hashtags.',
  newsletter: 'Newsletter section. 300-600 words. Warm and conversational. Clear sections. End with a takeaway.',
  blog: 'Blog post. 600-1000 words. Clear H2 headings. Practical takeaways. Skimmable.',
  exec_brief: 'Executive brief. 200-400 words. Formal. Bullet points. Structure: Context, Key Points, Recommendation.',
}

const UNIVERSAL_GUARDRAILS = `
UNIVERSAL QUALITY GUARDRAILS — apply to every generation without exception:
- Never open with AI-pattern phrases: "In today's fast-paced world", "As we navigate", "In the ever-evolving"
- Never use parallel contrast: "It's not X, it's Y" or "This isn't X, this is Y"
- Never use dramatic reveal colons: "That's when it hit me:", "Here's the truth:"
- Never announce vulnerability before showing it: "I'll be honest", "If I'm being honest"
- Maximum one colon used for dramatic effect per piece
- Active voice always. Passive voice is an AI tell.
- Never add meta-commentary — output only the content itself
- No preamble. Start directly with the content.
`

function getBucket() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
  return storage.bucket(process.env.GCS_BUCKET_NAME!)
}

function getModel() {
  const vertexAI = new VertexAI({
    project: process.env.GCP_PROJECT_ID!,
    location: 'us-central1',
  })
  return vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
}

// How many approved pieces to inject as voice exemplars, and how much of each.
// Kept small so a few long blog posts can't blow out the context window.
const RAG_EXAMPLE_COUNT = 3
const RAG_EXAMPLE_MAX_CHARS = 1200

// Persona-scoped retrieval for generation-time grounding. Reads the active RAG
// set straight from Supabase (the authoritative copy) rather than querying Vertex
// AI Search: the search index is imported as unstructured `content`, so it carries
// no persona metadata to filter on and lags approval by minutes. Session RLS plus
// the workspace/persona checks in the handler keep this scoped to the logged-in
// owner.
//
// Ranking follows the build plan — retrieve for voice, not topic: prefer the same
// platform/format, then the "gold" signal (pieces the user edited before approving
// are the strongest voice data), then recency.
async function loadApprovedExamples(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspace_id: string,
  persona_id: string,
  format: ContentFormat,
): Promise<string[]> {
  try {
    const { data } = await supabase
      .from('content_pieces')
      .select('body, original_body, format, approved_at')
      .eq('workspace_id', workspace_id)
      .eq('persona_id', persona_id)
      .eq('status', 'approved')
      .eq('rag_excluded', false)
      .eq('generation_mode', 'standard')
      .order('approved_at', { ascending: false })
      .limit(20)

    if (!data || data.length === 0) return []

    // Same format first (the plan frames retrieval "in the same platform/format"),
    // then edited-then-approved gold pieces, then recency — preserved from the query
    // order by V8's stable sort. original_body is null for pre-inline-edit rows, so
    // those safely default to non-gold.
    const sorted = [...data].sort((a, b) => {
      const aFmt = a.format === format ? 0 : 1
      const bFmt = b.format === format ? 0 : 1
      if (aFmt !== bFmt) return aFmt - bFmt
      const aGold = a.original_body != null && a.body !== a.original_body ? 0 : 1
      const bGold = b.original_body != null && b.body !== b.original_body ? 0 : 1
      return aGold - bGold
    })

    return sorted
      .slice(0, RAG_EXAMPLE_COUNT)
      .map((p) => {
        const text = (p.body || '').trim()
        return text.length > RAG_EXAMPLE_MAX_CHARS
          ? `${text.slice(0, RAG_EXAMPLE_MAX_CHARS)}…`
          : text
      })
      .filter(Boolean)
  } catch (err) {
    console.error('RAG example load error (non-fatal):', err)
    return []
  }
}

export async function POST(request: Request) {
  try {
    // 1. Auth check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse request
    const {
      workspace_id, persona_id, format, mode,
      topic, raw_input, description,
      tone_override, generation_mode,
      campaign_context_id, one_time_context,
      activation
    } = await request.json()

    if (!workspace_id || !persona_id || !format) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 3. Verify workspace ownership, then persona-belongs-to-workspace, via the
    //    shared guard. Previously this was a bare existence lookup that leaned
    //    entirely on RLS for isolation; the guard pins `owner_id = user.id` in
    //    the query itself so a dropped/permissive RLS policy can no longer
    //    expose a foreign workspace to this route. This is the route that spends
    //    Gemini tokens and writes content rows, so it gets the guard first.
    const wsGuard = await requireWorkspaceOwnership(supabase, user.id, workspace_id)
    if (wsGuard.failure) return wsGuard.failure
    const workspace = wsGuard.workspace

    const personaGuard = await requirePersonaInWorkspace(supabase, workspace_id, persona_id)
    if (personaGuard.failure) return personaGuard.failure
    // 4. Pre-check limit (RPC enforces strictly under concurrency).
    //    generations_used is typed nullable now that the guard returns a narrow
    //    projection — coalesce to 0 so a legacy row with a NULL counter fails
    //    open to "under the limit" rather than crashing the type check.
    if (workspace.plan_tier === 'solo' && (workspace.generations_used ?? 0) >= 30) {
      return NextResponse.json({
        error: 'Monthly generation limit reached. Upgrade to Studio for more.'
      }, { status: 402 })
    }

    // 5. Load brand DNA from GCS
    const gcsPath = `workspaces/${workspace_id}/personas/${persona_id}/brand_dna.json`
    let brandDNA: BrandDNA | null = null

    try {
      const bucket = getBucket()
      const file = bucket.file(gcsPath)
      const [content] = await file.download()
      brandDNA = JSON.parse(content.toString())
    } catch {
      return NextResponse.json({
        error: 'Brand DNA not found. Please complete onboarding first.'
      }, { status: 404 })
    }
    // ── A3.1: Context resolution ─────────────────────────────
    // Precedence: one_time > campaign > permanent defaults.
    // Hard rules are never overridden (conflict confirmation = A3.4).
    const { data: permanentContexts } = await supabase
      .from('contexts')
      .select('id, tier, content')
      .eq('persona_id', persona_id)
      .eq('scope', 'permanent')
      .eq('status', 'active')

    const hardRules = (permanentContexts || []).filter(c => c.tier === 'hard_rule')
    const defaults = (permanentContexts || []).filter(c => c.tier !== 'hard_rule')

    let campaignContext: { id: string; name: string | null; content: string } | null = null
    // Reject malformed campaign IDs loudly instead of letting the uuid-cast
    // error inside PostgREST silently null the campaign out — a user who
    // *meant* to generate inside a campaign should never get a silent
    // campaign-less generation (it would also be saved and RAG-ranked as if
    // standalone, corrupting later retrieval).
    if (campaign_context_id && !isUuid(campaign_context_id)) {
      return NextResponse.json({ error: 'Invalid campaign_context_id' }, { status: 400 })
    }
    if (campaign_context_id) {
      const { data: cc } = await supabase
        .from('contexts')
        .select('id, name, content')
        .eq('id', campaign_context_id)
        .eq('workspace_id', workspace_id)
        .eq('scope', 'campaign')
        .eq('status', 'active')
        .single()
      campaignContext = cc
    }

    const contextSections = [
      hardRules.length > 0 &&
        `STANDING RULES — NON-NEGOTIABLE. These can never be overridden by anything below:\n${hardRules.map(r => `- ${r.content}`).join('\n')}`,
      defaults.length > 0 &&
        `STANDING PREFERENCES. Follow these unless campaign or one-time guidance below overrides them:\n${defaults.map(d => `- ${d.content}`).join('\n')}`,
      campaignContext &&
        `ACTIVE CAMPAIGN${campaignContext.name ? ` "${campaignContext.name}"` : ''}. This piece is part of it:\n${campaignContext.content}`,
      one_time_context &&
        `FOR THIS PIECE ONLY — the following overrides any standing preferences and campaign guidance above (but never the non-negotiable rules):\n${one_time_context}`,
    ].filter(Boolean).join('\n\n')

    // 4c. Persona-scoped RAG retrieval — the user's own approved work as voice
    // exemplars. Skipped for one_time ("Fresh start") so a deliberate one-off
    // exception never gets treated as a false exemplar in future generations.
    const approvedExamples =
      generation_mode === 'one_time'
        ? []
        : await loadApprovedExamples(supabase, workspace_id, persona_id, format as ContentFormat)

    // 5. Build system prompt
    const dna = brandDNA!.sections

    const ragBlock =
      approvedExamples.length > 0
        ? `\nPREVIOUSLY APPROVED WORK — real pieces ${dna.identity.full_name} wrote and approved. Match this voice, quality, and register; study the patterns, never copy phrasing or reuse specifics:
${approvedExamples.map((ex, i) => `--- Example ${i + 1} ---\n${ex}`).join('\n\n')}
`
        : ''

    const systemPrompt = `You are a content writer for ${dna.identity.full_name}.

BRAND IDENTITY:
Role: ${dna.identity.role}
Industry: ${dna.identity.industry}
${dna.topics?.length ? `Core topics: ${dna.topics.join(', ')}` : ''}

AUDIENCE:
${dna.audience.description}
Segments: ${dna.audience.segments.join(', ')}

VOICE:
${dna.voice.description}
Tones: ${dna.voice.tones.join(', ')}
Formality: ${dna.voice.formality}/5
Pace: ${dna.voice.pace}/5

GOOD EXAMPLE (study the patterns, not the words — never lift specific references):
${dna.examples.good}

${dna.examples.bad ? `AVOID THIS STYLE:\n${dna.examples.bad}` : ''}
${ragBlock}
AVOID RULES (hard stops):
${dna.avoid.join('\n')}

${contextSections ? contextSections + '\n\n' : ''}${UNIVERSAL_GUARDRAILS}

FORMAT: ${FORMAT_INSTRUCTIONS[format as ContentFormat]}

${tone_override ? `TONE OVERRIDE FOR THIS PIECE: ${tone_override}` : ''}

Write content that sounds exactly like ${dna.identity.full_name}. Not like AI. Not like a template. Like them.
Output only the final content — no preamble, no labels, just the content itself.`

    // 6. Build user prompt
    let userPrompt = ''
    if (mode === 'brief' && topic) {
      userPrompt = `Topic: ${topic}`
    } else if (mode === 'raw' && raw_input) {
      userPrompt = `Transform this raw input into polished content in my voice:\n\n${raw_input}`
    } else if (mode === 'describe' && description) {
      userPrompt = `Description: ${description}`
    } else {
      return NextResponse.json({ error: 'Invalid input mode' }, { status: 400 })
    }

    // 7. Generate with Vertex AI streaming
    const requestBody: GenerateContentRequest = {
      systemInstruction: {
        role: 'system',
        parts: [{ text: systemPrompt }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: userPrompt }],
      }],
    }

    const model = getModel()
    const streamingResult = await model.generateContentStream(requestBody)

  // 8. Atomically increment generation count (RPC enforces limit under concurrency).
  // Activation drafts (onboarding's first three) are quota-exempt — but only
  // while the workspace is brand new, so the flag can't be abused later.
  const isActivation = activation === true && (workspace.generations_used || 0) < 3
  if (!isActivation) {
    supabase
      .rpc('increment_generation_count', { p_workspace_id: workspace_id })
      .then(({ data }) => {
        if (data && !data.success && data.reason === 'limit_reached') {
          console.warn(`Limit race detected for workspace ${workspace_id}`)
        }
      })
  }
  // 9. Stream response, save draft, return content_piece_id via meta chunk
    const fullText: string[] = []
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamingResult.stream) {
            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || ''
            if (text) {
              fullText.push(text)
              controller.enqueue(encoder.encode(text))
            }
          }

          // Voice check after streaming completes: deterministic linter + one
          // LLM critique pass against the live Brand DNA, then at most ONE
          // revise call. Never fatal — on any failure the draft stands.
          const body = fullText.join('')
          let finalBody = body
          let linterFlags: string[] = []
          let critique = null
          let revised = false

          if (body) {
            try {
              linterFlags = runLinter(body)
              critique = await runLLMCritic(dna, userPrompt, body)
              const hasIssues =
                linterFlags.length > 0 || (critique !== null && !critique.passed)
              if (hasIssues) {
                const revisedText = await reviseDraft(dna, body, linterFlags, critique)
                if (revisedText) {
                  finalBody = revisedText
                  revised = true
                }
              }
            } catch (err) {
              console.error('Voice check failed (non-fatal):', err)
            }
          }

          // Save draft after streaming completes
          if (finalBody) {
          const { data: savedPiece } = await supabase
              .from('content_pieces')
              .insert({
                workspace_id,
                persona_id,
                format,
                body: finalBody,
                original_body: finalBody,
                status: 'draft',
                topic: topic || description || 'Untitled',
                mode,
                generation_mode: generation_mode || 'standard',
                rag_excluded: generation_mode === 'one_time',
                campaign_context_id: campaign_context_id || null,
                one_time_context: one_time_context || null,
                resolved_context: {
                  hard_rules: hardRules.map(r => ({ id: r.id, content: r.content })),
                  defaults: defaults.map(d => ({ id: d.id, content: d.content })),
                  campaign: campaignContext,
                  one_time: one_time_context || null,
                  tone_override: tone_override || null,
                  // Persisted for evals: first-pass quality per generation.
                  voice_check: {
                    ran: critique !== null,
                    passed: linterFlags.length === 0 && (critique === null || critique.passed),
                    revised,
                    linter_flags: linterFlags,
                    voice_issues: critique?.voice_issues || [],
                    ungrounded_claims: critique?.ungrounded_claims || [],
                    avoid_violations: critique?.avoid_violations || [],
                  },
                },
              })
              .select('id')
              .single()

            // Send meta chunk: content_piece_id for Approve, plus the voice-check
            // outcome. revised_body is only present when the revise pass ran, so
            // the client can swap the streamed draft for the corrected version.
            if (savedPiece?.id) {
              const metaChunk = `\n__META__${JSON.stringify({
                content_piece_id: savedPiece.id,
                voice_check: {
                  ran: critique !== null,
                  passed: linterFlags.length === 0 && (critique === null || critique.passed),
                  revised,
                  linter_flags: linterFlags,
                  voice_issues: critique?.voice_issues || [],
                  ungrounded_claims: critique?.ungrounded_claims || [],
                  avoid_violations: critique?.avoid_violations || [],
                },
                revised_body: revised ? finalBody : undefined,
              })}`
              controller.enqueue(encoder.encode(metaChunk))
            }
          }
        } catch (err) {
          console.error('Streaming error:', err)
        } finally {
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    })

  } catch (error) {
    console.error('Generate error:', error)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}