import { VertexAI } from '@google-cloud/vertexai'

// The diff→rulebook layer: when a user edits a draft before approving, ONE
// cheap-model call both categorizes what they changed and — against the
// persona's recent edit history — decides whether the edit completes a
// repeated pattern worth proposing as a standing rule. Accepted rules live in
// the contexts table (scope=permanent), which every generation already
// injects, so "the system learns from your edits" costs one status flip.

export interface EditDelta {
  category:
    | 'phrase_killed'
    | 'shortened'
    | 'opener_changed'
    | 'claim_softened'
    | 'detail_added'
    | 'tone_shifted'
    | 'restructured'
    | 'other'
  detail: string
}

export interface EditAnalysis {
  deltas: EditDelta[]
  suggested_rule: string | null
}

const CATEGORIES = [
  'phrase_killed', 'shortened', 'opener_changed',
  'claim_softened', 'detail_added', 'tone_shifted',
  'restructured', 'other',
] as const

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

export async function analyzeEdit(
  original: string,
  edited: string,
  recentEditHistory: EditDelta[][],
  existingRules: string[],
): Promise<EditAnalysis | null> {
  try {
    const historyBlock = recentEditHistory.length > 0
      ? recentEditHistory
          .map((deltas, i) => `Edit ${i + 1}: ${deltas.map(d => `[${d.category}] ${d.detail}`).join('; ')}`)
          .join('\n')
      : '(no prior edits)'

    const rulesBlock = existingRules.length > 0
      ? existingRules.map(r => `- ${r}`).join('\n')
      : '(none)'

    const prompt = `A founder edited an AI-generated draft before approving it. Analyze what they changed and whether their edits reveal a repeating preference.

GENERATED DRAFT:
${original}

WHAT THEY APPROVED (after their edits):
${edited}

THEIR RECENT EDIT HISTORY (most recent first):
${historyBlock}

THEIR EXISTING STANDING RULES (do not re-suggest anything these already cover):
${rulesBlock}

TASK 1 — categorize this edit's meaningful changes (max 4). Categories:
- phrase_killed: they deleted a specific word/phrase (quote it)
- shortened: they cut length without changing meaning
- opener_changed: they rewrote how the piece starts
- claim_softened: they weakened or removed a bold/unsourced claim
- detail_added: they added a concrete detail, name, or example
- tone_shifted: they changed register (quote before→after briefly)
- restructured: they changed the FORM — prose into bullet points (or the reverse), added/removed subheadings, split or merged paragraphs, reordered sections
- other: anything else meaningful

Patterns live in HOW they edit, never in the topic — the same structural preference across posts about completely different subjects (e.g. always converting lists to bullets, always opening with a specific pain) is exactly what Task 2 should catch.
Ignore trivial changes (typos, whitespace, punctuation-only).

TASK 2 — pattern check: counting THIS edit plus the history, does any preference now appear 3 or more times AND is not covered by an existing rule? If yes, write ONE standing rule as a short imperative instruction a writer could follow (e.g. "Never use the phrase 'game-changer'", "Open with a specific moment, not a summary"). If no clear repeated pattern, null.

Respond with ONLY this JSON, no prose:
{"deltas": [{"category": "...", "detail": "one short specific sentence"}], "suggested_rule": null}`

    const vertexAI = new VertexAI({
      project: process.env.GCP_PROJECT_ID!,
      location: 'us-central1',
    })
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    const raw = (result.response.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')

    const parsed = extractJSON(raw) as Record<string, unknown> | null
    if (!parsed) return null

    const deltas: EditDelta[] = (Array.isArray(parsed.deltas) ? parsed.deltas : [])
      .filter((d): d is { category: string; detail: string } =>
        !!d && typeof d.category === 'string' && typeof d.detail === 'string' && d.detail.trim() !== '')
      .map(d => ({
        category: (CATEGORIES as readonly string[]).includes(d.category)
          ? (d.category as EditDelta['category'])
          : 'other',
        detail: d.detail.trim().slice(0, 300),
      }))
      .slice(0, 4)

    const suggested_rule =
      typeof parsed.suggested_rule === 'string' && parsed.suggested_rule.trim()
        ? parsed.suggested_rule.trim().slice(0, 300)
        : null

    return { deltas, suggested_rule }
  } catch (err) {
    console.error('Edit analysis failed (non-fatal):', err)
    return null
  }
}
