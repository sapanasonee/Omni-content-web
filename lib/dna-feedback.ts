import { VertexAI } from '@google-cloud/vertexai'

// The note→DNA layer: when a rejection carries a free-text note, ONE cheap-model
// call distills it into durable brand guidance — an avoid rule (→ the Brand DNA
// avoid list, enforced by both the generation prompt's hard stops AND the LLM
// critic) and/or a stated preference (→ a standing-preference rule). Neither is
// applied automatically: both come back as suggestions the user confirms, same
// convention as the edit-rulebook. The note itself stays piece-specific and
// conversational; only the distilled, generalizable form is ever proposed for
// permanent storage.

export interface NoteDistillation {
  // A short imperative avoid rule, or null when the complaint doesn't
  // generalize beyond this one piece or is already covered.
  avoid_rule: string | null
  // What the user said they'd rather have, as a short imperative do-this
  // instruction, or null when the note doesn't state one.
  preference: string | null
}

// Avoid-list items are normalized to 200 chars by normalizeSections
// (LIST_ITEM_MAX) — cap at the same bound so an accepted rule survives the
// PUT round-trip intact instead of being silently truncated.
const AVOID_RULE_MAX = 200
const PREFERENCE_MAX = 300

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

export async function distillRejectionNote(
  note: string,
  reasonLabels: string[],
  existingAvoid: string[],
  existingRules: string[],
): Promise<NoteDistillation | null> {
  try {
    const avoidBlock = existingAvoid.length > 0
      ? existingAvoid.map(a => `- ${a}`).join('\n')
      : '(none)'
    const rulesBlock = existingRules.length > 0
      ? existingRules.map(r => `- ${r}`).join('\n')
      : '(none)'

    const prompt = `A founder rejected an AI-written draft of their own content and explained why in their own words. Distill their explanation into durable brand guidance.

WHAT THEY SAID (verbatim):
${note}
${reasonLabels.length > 0 ? `\nSTRUCTURED REASONS THEY ALSO TICKED (already handled elsewhere — do not restate these):\n${reasonLabels.map(l => `- ${l}`).join('\n')}` : ''}

THEIR EXISTING AVOID LIST (do not propose anything these already cover):
${avoidBlock}

THEIR EXISTING STANDING RULES (do not propose anything these already cover):
${rulesBlock}

TASK 1 — avoid_rule: if the complaint reveals something that would be wrong in ANY future piece regardless of topic (a phrase type, a tone, a structural habit), write ONE short imperative avoid rule (e.g. "Never open with a rhetorical question", "No corporate-enthusiasm phrases like 'thrilled to share'"). Quote their specific words where it sharpens the rule. If the complaint is about this piece's topic or facts (not transferable), or is already covered above, use null.

TASK 2 — preference: ONLY if they explicitly said what they'd rather have instead (e.g. "should be shorter", "I'd start with the story"), write it as ONE short imperative do-this instruction. If they only said what they disliked, use null — never invent the inverse.

Both outputs must be structural and topic-free: they will steer every future piece on every subject. When in doubt, null.

Respond with ONLY this JSON, no prose:
{"avoid_rule": null, "preference": null}`

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

    const str = (v: unknown, max: number) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

    return {
      avoid_rule: str(parsed.avoid_rule, AVOID_RULE_MAX),
      preference: str(parsed.preference, PREFERENCE_MAX),
    }
  } catch (err) {
    console.error('Note distillation failed (non-fatal):', err)
    return null
  }
}
