import { Storage } from '@google-cloud/storage'
import { VertexAI } from '@google-cloud/vertexai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandDNA } from './types'
import { REJECTION_REASONS, type StoredRejection } from './rejection-feedback'

// ─── Observed Voice profile ──────────────────────────────────────────────────
//
// The DECLARED voice (brand_dna.json) is what the user said about themselves at
// onboarding — a snapshot, frozen the day they signed up. This module maintains
// the OBSERVED voice: what they actually do, distilled periodically from the
// pieces they approve (gold-weighted — human-edited text is the truest signal),
// the edits they make, and the drafts they reject. Voice evolves as people
// write; this captures that evolution without asking them to re-onboard.
//
// Design rules (agreed, do not quietly change):
//   - DESCRIPTIVE, never restrictive: observations are injected into generation
//     as soft texture; declared DNA, avoid rules, and standing rules always win.
//   - CONFIRM-FIRST: a fresh distillation lands as `proposed` and steers
//     nothing until the user applies it ("Your voice has evolved" review).
//   - SHARED ASSET: voice_profile.json lives beside brand_dna.json in GCS and
//     is deliberately surface-agnostic — the future comment-generation feature
//     reads the same file (stances/takes are its main fuel).
//   - NON-FATAL everywhere: distillation failures degrade to "no proposal",
//     never a broken approve or generate.
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceProfileSnapshot {
  distilled_at: string
  // Provenance shown to the user so the profile never feels like a black box.
  based_on: {
    approved_pieces: number
    gold_pieces: number
    edits: number
    rejections: number
  }
  // How they actually write lately: rhythm, openers/closers, vocabulary habits.
  style_observations: string[]
  // Recurring positions/opinions across topics — the thought-leadership layer,
  // and the primary input for the future comments feature.
  stances: string[]
  // Where observed behavior has drifted from the declared DNA.
  evolution_notes: string[]
}

export interface VoiceProfileFile {
  schema_version: '1.0'
  workspace_id: string
  persona_id: string
  active: VoiceProfileSnapshot | null
  proposed: VoiceProfileSnapshot | null
  // Approved-piece count at the last distillation — the re-distill trigger
  // compares against the live count so the cadence is "every N approvals",
  // not "every N minutes".
  last_distill_approved_count: number
}

// Distill after this many new approvals since the last snapshot. Below this
// there isn't enough fresh signal to say anything new about the voice.
export const DISTILL_EVERY_APPROVALS = 5
// How many recent approved pieces feed one distillation.
const PIECES_WINDOW = 10
const EDITS_WINDOW = 10
const REJECTIONS_WINDOW = 15
// Output caps — the profile is injected into prompts, so it must stay compact.
const MAX_STYLE = 6
const MAX_STANCES = 6
const MAX_EVOLUTION = 3
const ITEM_MAX_CHARS = 300

function getBucket() {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID })
  return storage.bucket(process.env.GCS_BUCKET_NAME!)
}

function profilePath(workspaceId: string, personaId: string) {
  return `workspaces/${workspaceId}/personas/${personaId}/voice_profile.json`
}

function emptyProfile(workspaceId: string, personaId: string): VoiceProfileFile {
  return {
    schema_version: '1.0',
    workspace_id: workspaceId,
    persona_id: personaId,
    active: null,
    proposed: null,
    last_distill_approved_count: 0,
  }
}

export async function loadVoiceProfile(
  workspaceId: string,
  personaId: string,
): Promise<VoiceProfileFile> {
  try {
    const [content] = await getBucket().file(profilePath(workspaceId, personaId)).download()
    const parsed = JSON.parse(content.toString()) as VoiceProfileFile
    // Minimal shape guard — a malformed file degrades to empty, never throws
    // into a caller.
    if (!parsed || typeof parsed !== 'object') return emptyProfile(workspaceId, personaId)
    return {
      schema_version: '1.0',
      workspace_id: workspaceId,
      persona_id: personaId,
      active: parsed.active ?? null,
      proposed: parsed.proposed ?? null,
      last_distill_approved_count:
        typeof parsed.last_distill_approved_count === 'number'
          ? parsed.last_distill_approved_count
          : 0,
    }
  } catch {
    return emptyProfile(workspaceId, personaId)
  }
}

export async function saveVoiceProfile(profile: VoiceProfileFile): Promise<void> {
  await getBucket()
    .file(profilePath(profile.workspace_id, profile.persona_id))
    .save(JSON.stringify(profile, null, 2), { contentType: 'application/json' })
}

// ─── Distillation ────────────────────────────────────────────────────────────

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

function capList(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .map(x => x.trim().slice(0, ITEM_MAX_CHARS))
        .slice(0, max)
    : []
}

// Check whether enough new approvals have accumulated and, if so, distill a
// proposed Observed Voice snapshot from the persona's recent behavior. Returns
// the new proposal, or null when nothing was (or could be) distilled. Never
// throws. Called from the approve route after a successful approval.
export async function maybeDistillVoiceProfile(
  supabase: SupabaseClient,
  workspaceId: string,
  personaId: string,
): Promise<VoiceProfileSnapshot | null> {
  try {
    const { count } = await supabase
      .from('content_pieces')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('persona_id', personaId)
      .eq('status', 'approved')
    const approvedCount = count ?? 0

    const profile = await loadVoiceProfile(workspaceId, personaId)
    // An unreviewed proposal stays put — re-distilling over it would churn the
    // review card (and burn a model call) before the user ever saw it.
    if (profile.proposed) return null
    if (approvedCount - profile.last_distill_approved_count < DISTILL_EVERY_APPROVALS) {
      return null
    }

    // ── Gather the behavioral record ─────────────────────────────────────
    const [{ data: pieces }, { data: edits }, { data: rejRows }] = await Promise.all([
      supabase
        .from('content_pieces')
        .select('body, original_body, format')
        .eq('workspace_id', workspaceId)
        .eq('persona_id', personaId)
        .eq('status', 'approved')
        .order('approved_at', { ascending: false })
        .limit(PIECES_WINDOW),
      supabase
        .from('content_edits')
        .select('deltas')
        .eq('persona_id', personaId)
        .order('created_at', { ascending: false })
        .limit(EDITS_WINDOW),
      supabase
        .from('content_pieces')
        .select('resolved_context')
        .eq('workspace_id', workspaceId)
        .eq('persona_id', personaId)
        .eq('status', 'archived')
        .order('created_at', { ascending: false })
        .limit(REJECTIONS_WINDOW),
    ])

    if (!pieces || pieces.length === 0) return null

    // Declared DNA for the evolution comparison (best-effort).
    let declaredVoice = ''
    try {
      const [content] = await getBucket()
        .file(`workspaces/${workspaceId}/personas/${personaId}/brand_dna.json`)
        .download()
      const dna: BrandDNA = JSON.parse(content.toString())
      declaredVoice = [
        dna.sections?.voice?.description || '',
        dna.sections?.voice?.tones?.length ? `Tones: ${dna.sections.voice.tones.join(', ')}` : '',
      ].filter(Boolean).join('\n')
    } catch {
      // No DNA file — distill without the comparison.
    }

    const goldCount = pieces.filter(
      p => p.original_body != null && p.body !== p.original_body,
    ).length

    // Gold pieces (human-edited before approval) carry the strongest voice
    // signal — label them so the model weights them accordingly.
    const piecesBlock = pieces
      .map((p, i) => {
        const gold = p.original_body != null && p.body !== p.original_body
        return `--- Piece ${i + 1} (${p.format}${gold ? ', EDITED BY THE AUTHOR before approving — weight this heaviest' : ''}) ---\n${String(p.body).slice(0, 2000)}`
      })
      .join('\n\n')

    const editLines = (edits || [])
      .flatMap(e => (Array.isArray(e.deltas) ? e.deltas : []))
      .filter((d): d is { category: string; detail: string } =>
        !!d && typeof d.category === 'string' && typeof d.detail === 'string')
      .slice(0, 20)
      .map(d => `- [${d.category}] ${d.detail}`)

    const rejections = (rejRows || [])
      .map(r => (r.resolved_context as { rejection?: StoredRejection } | null)?.rejection)
      .filter((x): x is StoredRejection => !!x && typeof x === 'object')
    const rejectionLines = rejections
      .map(r => {
        const reasons = (Array.isArray(r.reasons) ? r.reasons : [])
          .map(v => REJECTION_REASONS.find(d => d.value === v)?.label)
          .filter(Boolean)
          .join(', ')
        const note = typeof r.note === 'string' && r.note.trim() ? ` — "${r.note.trim().slice(0, 200)}"` : ''
        return reasons || note ? `- ${reasons || 'no reason given'}${note}` : null
      })
      .filter((x): x is string => x !== null)
      .slice(0, 10)

    const previousBlock = profile.active
      ? `THEIR PREVIOUS OBSERVED PROFILE (evolve it — keep what still holds, drop what doesn't, note what changed):
Style: ${profile.active.style_observations.join(' | ')}
Stances: ${profile.active.stances.join(' | ')}`
      : '(no previous observed profile — this is the first)'

    const prompt = `You are a voice analyst. Study how this founder ACTUALLY writes — from content they approved, how they edited drafts, and what they rejected — and produce a compact observed-voice profile. Describe, never prescribe: output observations about their real behavior, not rules or advice.

APPROVED PIECES (most recent first; author-edited ones are the strongest signal):
${piecesBlock}

HOW THEY EDIT DRAFTS BEFORE APPROVING:
${editLines.length ? editLines.join('\n') : '(no recorded edits)'}

WHAT THEY REJECT AND WHY:
${rejectionLines.length ? rejectionLines.join('\n') : '(no recorded rejections)'}

WHAT THEY DECLARED ABOUT THEIR VOICE AT SIGNUP:
${declaredVoice || '(not available)'}

${previousBlock}

Produce:
1. style_observations (max ${MAX_STYLE}) — concrete, specific habits of HOW they write: sentence rhythm, how they open and close, vocabulary tendencies, formatting habits. Each one sentence, evidenced by the pieces above. Structural only — never about any specific topic.
2. stances (max ${MAX_STANCES}) — recurring positions/opinions/beliefs they keep expressing ACROSS different pieces (e.g. "believes speed of iteration beats polish"). Only include a stance visible in 2+ pieces. These power future features, so make them substantive.
3. evolution_notes (max ${MAX_EVOLUTION}) — where their observed writing differs from what they declared at signup, or from the previous profile. Neutral wording ("declared formal, consistently approves casual"). Empty array if nothing notable.

Ground every item in the evidence above. Never invent. Fewer, sharper items beat filler.

Respond with ONLY this JSON, no prose:
{"style_observations": [], "stances": [], "evolution_notes": []}`

    const vertexAI = new VertexAI({
      project: process.env.GCP_PROJECT_ID!,
      location: 'us-central1',
    })
    // Full Flash (not Lite): this synthesis across ~10 pieces is the highest-
    // judgment cheap call in the system, and it runs only every ~5 approvals.
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })
    const raw = (result.response.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')

    const parsed = extractJSON(raw) as Record<string, unknown> | null
    if (!parsed) return null

    const snapshot: VoiceProfileSnapshot = {
      distilled_at: new Date().toISOString(),
      based_on: {
        approved_pieces: pieces.length,
        gold_pieces: goldCount,
        edits: editLines.length,
        rejections: rejectionLines.length,
      },
      style_observations: capList(parsed.style_observations, MAX_STYLE),
      stances: capList(parsed.stances, MAX_STANCES),
      evolution_notes: capList(parsed.evolution_notes, MAX_EVOLUTION),
    }
    // A snapshot that observed nothing isn't worth a review card.
    if (snapshot.style_observations.length === 0 && snapshot.stances.length === 0) {
      return null
    }

    await saveVoiceProfile({
      ...profile,
      proposed: snapshot,
      last_distill_approved_count: approvedCount,
    })
    return snapshot
  } catch (err) {
    console.error('Voice-profile distillation failed (non-fatal):', err)
    return null
  }
}

// ─── Prompt injection ────────────────────────────────────────────────────────

// Render the ACTIVE profile as the soft-texture block generation injects.
// Returns '' when there's no applied profile. Deliberately framed as
// descriptive context with an explicit precedence note — this must never read
// as a second rule system.
export function observedVoiceBlock(profile: VoiceProfileFile | null): string {
  const active = profile?.active
  if (!active) return ''
  const lines: string[] = []
  if (active.style_observations.length > 0) {
    lines.push('How they actually write lately:', ...active.style_observations.map(s => `- ${s}`))
  }
  if (active.stances.length > 0) {
    lines.push('Positions they keep expressing:', ...active.stances.map(s => `- ${s}`))
  }
  if (lines.length === 0) return ''
  return `\nOBSERVED VOICE (distilled from their recent approved writing — texture to inhabit, not rules; the VOICE section and AVOID RULES above always win on any conflict):
${lines.join('\n')}
`
}
