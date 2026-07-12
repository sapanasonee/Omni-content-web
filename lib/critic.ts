import { VertexAI } from '@google-cloud/vertexai'
import type { OnboardingData } from './types'

// Two-layer quality gate:
//  1. runLinter    — deterministic regex for universal AI tells. Free, instant,
//                    never adapts because it never needs to (wrong for everyone).
//  2. runLLMCritic — one cheap-model pass judging the draft against the LIVE
//                    Brand DNA: voice drift, ungrounded claims, avoid-rule hits.
//                    Adaptive by construction — edit your DNA, the critic
//                    enforces the new version on the next generation.
// When either layer flags issues, reviseDraft makes ONE corrective call and
// stops. Repeated critique passes flatten voice and burn output tokens.

export interface CritiqueResult {
  passed: boolean
  voice_issues: string[]
  ungrounded_claims: string[]
  avoid_violations: string[]
}

// ─── Layer 1: deterministic linter ───────────────────────────────────────────

export function runLinter(body: string): string[] {
  const violations: string[] = []

  const aiPatterns = [
    /in today'?s fast.?paced world/i,
    /as we navigate/i,
    /in the ever.?evolving/i,
    /it'?s not .+, it'?s/i,
    /this isn'?t .+, this is/i,
    /i'?ll be honest/i,
    /if i'?m being honest/i,
    /here'?s the truth:/i,
    /that'?s when it hit me:/i,
  ]

  for (const pattern of aiPatterns) {
    if (pattern.test(body)) {
      violations.push(`Contains AI pattern: "${body.match(pattern)?.[0]}"`)
    }
  }

  const colonCount = (body.match(/:/g) || []).length
  if (colonCount > 3) {
    violations.push(`Too many colons (${colonCount}) — max 3 recommended`)
  }

  if (body.length < 50) {
    violations.push('Content too short — minimum 50 characters')
  }

  return violations
}

// ─── Shared model access ─────────────────────────────────────────────────────

function getModel(model: string) {
  const vertexAI = new VertexAI({
    project: process.env.GCP_PROJECT_ID!,
    location: 'us-central1',
  })
  return vertexAI.getGenerativeModel({ model })
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

function strArray(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max)
    : []
}

// ─── Layer 2: one LLM critique pass (cheap model, checkable rubric only) ─────

export async function runLLMCritic(
  dna: OnboardingData,
  userInput: string,
  draft: string,
): Promise<CritiqueResult | null> {
  try {
    const prompt = `You are a strict brand-voice critic. Judge the DRAFT against this founder's Brand DNA and the input they gave. Apply ONLY the three checks below — do not invent other criteria, do not suggest rewrites.

BRAND DNA:
Voice: ${dna.voice.description}
Tones: ${dna.voice.tones.join(', ')}
Formality: ${dna.voice.formality}/5, Pace: ${dna.voice.pace}/5
Avoid rules (hard stops):
${dna.avoid.map(a => `- ${a}`).join('\n')}
${dna.examples.bad ? `Style they hate:\n${dna.examples.bad}` : ''}

USER INPUT (the only source of facts):
${userInput}

DRAFT:
${draft}

CHECKS:
1. voice_issues — ways the draft drifts from the voice description and tones above (max 3, one specific sentence each; empty array if none)
2. ungrounded_claims — statistics, named facts, or events stated in the draft that are NOT traceable to the user input (quote each; empty array if none)
3. avoid_violations — any avoid rule broken (quote the offending phrase; empty array if none)

Respond with ONLY this JSON, no prose:
{"voice_issues": [], "ungrounded_claims": [], "avoid_violations": []}`

    const result = await getModel('gemini-2.5-flash-lite').generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    const raw = (result.response.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')

    const parsed = extractJSON(raw) as Record<string, unknown> | null
    if (!parsed) return null

    const voice_issues = strArray(parsed.voice_issues, 3)
    const ungrounded_claims = strArray(parsed.ungrounded_claims, 5)
    const avoid_violations = strArray(parsed.avoid_violations, 5)

    return {
      passed: voice_issues.length === 0 && ungrounded_claims.length === 0 && avoid_violations.length === 0,
      voice_issues,
      ungrounded_claims,
      avoid_violations,
    }
  } catch (err) {
    console.error('LLM critic failed (non-fatal):', err)
    return null
  }
}

// ─── Single revise call — one pass, hard stop ────────────────────────────────

export async function reviseDraft(
  dna: OnboardingData,
  draft: string,
  linterFlags: string[],
  critique: CritiqueResult | null,
): Promise<string | null> {
  try {
    const issues = [
      ...linterFlags,
      ...(critique?.voice_issues || []).map(i => `Voice drift: ${i}`),
      ...(critique?.ungrounded_claims || []).map(c => `Ungrounded claim (remove or soften to opinion): ${c}`),
      ...(critique?.avoid_violations || []).map(v => `Breaks an avoid rule: ${v}`),
    ]
    if (issues.length === 0) return null

    const prompt = `You wrote the DRAFT below for ${dna.identity.full_name}. A review found specific issues. Fix ONLY the listed issues. Preserve everything else — the structure, the length, the ideas, and the voice (${dna.voice.description}). Do not polish, do not homogenize, do not add anything new.

DRAFT:
${draft}

ISSUES TO FIX:
${issues.map(i => `- ${i}`).join('\n')}

Output ONLY the corrected content — no preamble, no labels, no commentary.`

    const result = await getModel('gemini-2.5-flash').generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    const revised = (result.response.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')
      .trim()

    // A revision that vanished or collapsed is worse than the flagged draft.
    return revised.length >= 50 ? revised : null
  } catch (err) {
    console.error('Revise call failed (non-fatal):', err)
    return null
  }
}
