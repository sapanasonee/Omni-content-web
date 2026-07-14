import { createClient } from '@/lib/supabase/server'
import { Storage } from '@google-cloud/storage'
import { VertexAI, type Tool } from '@google-cloud/vertexai'
import { NextResponse } from 'next/server'
import type { BrandDNA, TrendingTopic } from '@/lib/types'

// Topics go stale slowly; grounded calls are the most expensive call type in the
// app. One generation per persona per day, everything else served from cache.
const CACHE_TTL_HOURS = 24
const TOPIC_COUNT = 5

function getBucket() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
  return storage.bucket(process.env.GCS_BUCKET_NAME!)
}

function getGroundedModel() {
  const vertexAI = new VertexAI({
    project: process.env.GCP_PROJECT_ID!,
    location: 'us-central1',
  })
  return vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    // Gemini 2.x uses the `googleSearch` tool for live grounding. The installed
    // SDK (1.12) only types the legacy 1.5-era `googleSearchRetrieval`, which
    // 2.x models reject — the REST layer accepts the untyped field, hence the cast.
    tools: [{ googleSearch: {} } as unknown as Tool],
  })
}

// Catches the classic AI-listicle title shape ("Phrase: explanation") that
// the prompt asks the model to avoid — backstop for when it slips through anyway.
const COLON_TITLE_PATTERN = /^[^:?!]{3,60}:\s+\S/

// Strips a leading "Phrase: " clause from a colon-split title, keeping
// whichever side reads better as a standalone headline.
function stripColonTitle(title: string): string {
  const idx = title.indexOf(':')
  if (idx === -1) return title
  const before = title.slice(0, idx).trim()
  const after = title.slice(idx + 1).trim()
  return after.length >= before.length ? after : before
}

// Grounded responses often wrap JSON in prose or code fences — extract the
// first top-level array rather than trusting the raw text to parse.
function parseTopics(raw: string): TrendingTopic[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t) => t && typeof t.title === 'string' && t.title.trim())
      .slice(0, TOPIC_COUNT)
      .map((t) => {
        const title = String(t.title).trim()
        return {
          title: COLON_TITLE_PATTERN.test(title) ? stripColonTitle(title) : title,
          why_it_matters: String(t.why_it_matters || '').trim(),
          content_angle: String(t.content_angle || '').trim(),
        }
      })
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  try {
    // 1. Auth
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Params
    const { searchParams } = new URL(request.url)
    const workspace_id = searchParams.get('workspace_id')
    const persona_id = searchParams.get('persona_id')
    const refresh = searchParams.get('refresh') === '1'

    if (!workspace_id || !persona_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 3. Ownership checks — same pattern as generate: workspace via RLS,
    //    then persona-belongs-to-workspace.
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', workspace_id)
      .single()

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const { data: persona } = await supabase
      .from('personas')
      .select('id')
      .eq('id', persona_id)
      .eq('workspace_id', workspace_id)
      .single()

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found in this workspace' }, { status: 404 })
    }

    // 4. Serve from cache when fresh. Cache failures are never fatal — the
    //    feature degrades to a live call, not an error.
    if (!refresh) {
      try {
        const { data: cached } = await supabase
          .from('trending_cache')
          .select('topics, generated_at')
          .eq('persona_id', persona_id)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (cached?.topics && cached.generated_at) {
          const ageMs = Date.now() - new Date(cached.generated_at).getTime()
          if (ageMs < CACHE_TTL_HOURS * 3600_000) {
            return NextResponse.json({
              topics: cached.topics,
              generated_at: cached.generated_at,
              cached: true,
            })
          }
        }
      } catch (err) {
        console.error('Trending cache read failed (non-fatal):', err)
      }
    }

    // 5. Load Brand DNA — the niche/audience that scopes the search.
    const gcsPath = `workspaces/${workspace_id}/personas/${persona_id}/brand_dna.json`
    let brandDNA: BrandDNA | null = null
    try {
      const [content] = await getBucket().file(gcsPath).download()
      brandDNA = JSON.parse(content.toString())
    } catch {
      return NextResponse.json({
        error: 'Brand DNA not found. Please complete onboarding first.'
      }, { status: 404 })
    }

    const dna = brandDNA!.sections
    const today = new Date().toISOString().slice(0, 10)

    // 6. One grounded call. The prompt pushes hard on "current + specific to
    //    this founder" because ungrounded/generic trends are the failure mode.
    const prompt = `Today is ${today}. Use Google Search to find what is trending RIGHT NOW that this specific founder should write about.

THE FOUNDER:
Role: ${dna.identity.role}
Industry/niche: ${dna.identity.industry}
Audience: ${dna.audience.description}
Audience segments: ${dna.audience.segments.join(', ')}
${dna.topics?.length ? `Topics they write about: ${dna.topics.join(', ')}` : ''}

TASK: Find exactly ${TOPIC_COUNT} trending topics — current events, launches, debates, or shifts from the last few days — that intersect their niche AND their audience's interests.${dna.topics?.length ? ' Weight heavily toward their declared topics — those are the subjects they want to be known for.' : ''}

RULES:
- Every topic must be genuinely current (searchable, recent), never evergreen filler.
- Never generic news. Each topic must give THIS founder something to hang an opinion or experience on.
- No topics that require expertise the founder doesn't claim.

TITLE STYLE: Write "title" as a plain statement or question, specific enough to search. Never use "Phrase: explanation" colon-split framing.
Bad: "The Funding Reset: Why Seed Rounds Are Shrinking"
Good: "Seed rounds are shrinking again"
Bad: "AI Hiring: What Founders Get Wrong"
Good: "Founders are hiring AI engineers for the wrong reasons"

Respond with ONLY a JSON array, no prose, no markdown fences:
[
  {
    "title": "short topic title, specific enough to search, no colon framing",
    "why_it_matters": "one sentence connecting it to this founder's niche and audience",
    "content_angle": "one sentence: the opinion/experience angle they could take in their voice"
  }
]`

    const result = await getGroundedModel().generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    const rawText = (result.response.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')

    const topics = parseTopics(rawText)
    if (topics.length === 0) {
      console.error('Topic parse failed. Raw model output:', rawText.slice(0, 500))
      return NextResponse.json({
        error: 'Could not generate topics right now. Try again in a moment.'
      }, { status: 502 })
    }

    // 7. Cache best-effort — a schema mismatch must not break the feature.
    const generated_at = new Date().toISOString()
    try {
      const { error: cacheError } = await supabase
        .from('trending_cache')
        .insert({ workspace_id, persona_id, topics, generated_at })
      if (cacheError) console.error('Trending cache write failed (non-fatal):', cacheError)
    } catch (err) {
      console.error('Trending cache write failed (non-fatal):', err)
    }

    return NextResponse.json({ topics, generated_at, cached: false })

  } catch (error) {
    console.error('Topics error:', error)
    return NextResponse.json({ error: 'Failed to load topics' }, { status: 500 })
  }
}
