import { createClient } from '@/lib/supabase/server'
import { VertexAI } from '@google-cloud/vertexai'
import { NextResponse } from 'next/server'
import { evaluateSignupEmail, isExemptExistingAccount } from '@/lib/signup-policy'

// Derives voice.description / tones / formality / pace from the writing
// samples the user pastes in onboarding, instead of asking them to
// self-report a description and drag two sliders. Mirrors /api/voice-extract
// exactly, just from pasted text instead of spoken audio — same model tier
// (this is a judgment call, not a cheap classification, so it stays off
// flash-lite), same non-fatal contract: any failure here must leave the
// wizard's manual voice fields empty and usable, never blocked.
//
// Deliberately reads the SAMPLES, never the spoken-intro transcript
// (voice_sample_transcript): that transcript is explicitly excluded from
// RAG/exemplar use elsewhere in this codebase because spoken register isn't
// written register, and the same reasoning applies here — deriving written
// voice guidance from speech patterns would be the same category error.

const TONE_OPTIONS = ['Direct', 'Warm', 'Witty', 'Formal', 'Casual', 'Empathetic', 'Bold', 'Thoughtful']

// Matches the LONG_FIELD_MAX ceiling normalizeSections already enforces on
// each sample, so nothing rejected here would have been truncated anyway.
const MAX_SAMPLE_CHARS = 4_000
const MAX_SAMPLES = 3

function clampScale(v: unknown): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, Math.round(n)))
}

export async function POST(request: Request) {
  try {
    // Auth only — this can run before any workspace exists (first-run
    // onboarding), same as voice-extract.
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Same signup-policy gate as voice-extract, for the same reason: this
    // spends a real Gemini call before /api/onboarding's gate would ever run.
    if (!isExemptExistingAccount(user.created_at)) {
      const verdict = evaluateSignupEmail(user.email || '')
      if (!verdict.allowed) {
        return NextResponse.json({ error: verdict.reason }, { status: 403 })
      }
    }

    const { good_samples, bad, role, industry } = await request.json()

    const samples = (Array.isArray(good_samples) ? good_samples : [])
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .slice(0, MAX_SAMPLES)
      .map(s => s.trim().slice(0, MAX_SAMPLE_CHARS))

    if (samples.length === 0) {
      return NextResponse.json({ error: 'No writing samples to learn from' }, { status: 400 })
    }

    const badText = typeof bad === 'string' ? bad.trim().slice(0, MAX_SAMPLE_CHARS) : ''
    const roleText = typeof role === 'string' ? role.trim().slice(0, 300) : ''
    const industryText = typeof industry === 'string' ? industry.trim().slice(0, 300) : ''

    const prompt = `Below are one or more writing samples a person considers their best work (or work they admire and want to sound like). Analyze the WRITING STYLE evidenced in them — sentence rhythm, directness, word choice, structure, how they open and close — not the topic or subject matter.
${roleText || industryText ? `\nContext: they work as ${roleText || 'a professional'}${industryText ? ` in ${industryText}` : ''}.` : ''}

${samples.map((s, i) => `--- Sample ${i + 1} ---\n${s}`).join('\n\n')}
${badText ? `\n--- They explicitly want to AVOID writing like this ---\n${badText}` : ''}

Respond with ONLY this JSON, no prose:
{
  "voice_description": "2-3 sentences of WRITING-voice guidance a content generator could follow to sound like these samples — describe the pattern, not the topic",
  "tones": ["up to 3, chosen ONLY from: ${TONE_OPTIONS.join(', ')}"],
  "formality": "integer 1-5, where 1 is very casual and 5 is very formal, judged from the samples",
  "pace": "integer 1-5, where 1 is slow/deliberate and 5 is fast/punchy, judged from sentence and paragraph rhythm"
}`

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

    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) {
      return NextResponse.json({ error: 'Could not read your samples. Try again or fill this in yourself.' }, { status: 502 })
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      return NextResponse.json({ error: 'Could not read your samples. Try again or fill this in yourself.' }, { status: 502 })
    }

    const description = typeof parsed.voice_description === 'string' ? parsed.voice_description.trim() : ''
    if (!description) {
      return NextResponse.json({ error: 'Could not derive a voice from your samples. Fill this in yourself.' }, { status: 502 })
    }

    const tones = Array.isArray(parsed.tones)
      ? parsed.tones.filter((t): t is string => typeof t === 'string' && TONE_OPTIONS.includes(t)).slice(0, 3)
      : []

    return NextResponse.json({
      voice: {
        description,
        tones,
        formality: clampScale(parsed.formality),
        pace: clampScale(parsed.pace),
      },
    })
  } catch (error) {
    console.error('Voice-from-examples error:', error)
    return NextResponse.json({ error: 'Voice derivation failed. Fill this in yourself.' }, { status: 500 })
  }
}
