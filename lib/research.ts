import { VertexAI, type Tool } from '@google-cloud/vertexai'

// ─── Real-source research ────────────────────────────────────────────────────
//
// Why this exists: when a brief asked generate/route.ts to "find a supporting
// link", the writer model had no web access and typed a URL from memory —
// plausible-looking, often 404. Every LLM does this when it answers without
// actually searching; the fix (the way Perplexity avoids it) is to search
// FIRST and only ever hand back links the search actually returned, never
// ones the model invented.
//
// This module is that search step. It is deliberately separate from
// generate/route.ts's writer model: the writer never touches the network, so
// it can never originate a URL. Every source here comes straight off
// Gemini's grounding metadata, which only lists pages its Google Search call
// actually found — never a hallucinated one.
//
// The caller (generate/route.ts) treats these URLs as the ONLY ones the
// writer may cite, and strips anything else that shows up in a draft
// (see stripFabricatedLinks in that file).

export interface ResearchSource {
  title: string
  url: string
}

export interface ResearchResult {
  summary: string
  sources: ResearchSource[]
}

function getGroundedModel() {
  const vertexAI = new VertexAI({
    project: process.env.GCP_PROJECT_ID!,
    location: 'us-central1',
  })
  return vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    // Same googleSearch-tool cast as topics/route.ts — the installed SDK
    // (1.12) only types the legacy 1.5-era googleSearchRetrieval, which 2.x
    // models reject. The REST layer accepts the untyped field.
    tools: [{ googleSearch: {} } as unknown as Tool],
  })
}

const MAX_SOURCES = 5

// One grounded call: ask for a short, factual summary of `query`, and read
// back only the sources Google Search actually surfaced. Never throws — a
// research failure should degrade to "no sources found", not break the
// generate flow that's waiting on it.
export async function runResearch(query: string): Promise<ResearchResult> {
  try {
    const prompt = `Use Google Search to find current, reliable information on this topic, for someone about to write a post about it:

"${query}"

Respond with 2-4 short factual sentences a writer could reference — concrete numbers, dates, or findings, not generic commentary. No preamble, no links (sources are tracked separately), just the facts.`

    const result = await getGroundedModel().generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    const candidate = result.response.candidates?.[0]
    const summary = (candidate?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim()

    // The ONLY source of URLs: grounding chunks the search tool itself
    // returned. Nothing from the model's own generated text is ever used as
    // a link — that's precisely the path that produces invented URLs.
    const chunks = candidate?.groundingMetadata?.groundingChunks || []
    const seen = new Set<string>()
    const sources: ResearchSource[] = []
    for (const chunk of chunks) {
      const uri = chunk.web?.uri
      const title = chunk.web?.title
      if (!uri || seen.has(uri)) continue
      seen.add(uri)
      sources.push({ title: title || uri, url: uri })
      if (sources.length >= MAX_SOURCES) break
    }

    return { summary, sources }
  } catch (err) {
    console.error('Research failed (non-fatal):', err)
    return { summary: '', sources: [] }
  }
}
