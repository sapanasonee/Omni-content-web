import { createClient } from '@/lib/supabase/server'
import { VertexAI } from '@google-cloud/vertexai'
import { NextResponse } from 'next/server'
import { evaluateSignupEmail, isExemptExistingAccount } from '@/lib/signup-policy'

// Turns a spoken onboarding answer into Brand DNA field values.
// Speech tells the system ABOUT the founder (identity, beliefs, topics) —
// it is never stored as a writing exemplar, because spoken register would
// teach the model to write like talk.

// ~2 min of opus audio is well under this; the ceiling just bounds abuse.
const MAX_AUDIO_BYTES = 15 * 1024 * 1024

const ALLOWED_MIME = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
]

const TONE_OPTIONS = ['Direct', 'Warm', 'Witty', 'Formal', 'Casual', 'Empathetic', 'Bold', 'Thoughtful']

interface Extraction {
  transcript: string
  full_name: string
  role: string
  industry: string
  audience_description: string
  audience_segments: string[]
  voice_description: string
  tones: string[]
  topics: string[]
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strArray(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()).slice(0, max)
    : []
}

export async function POST(request: Request) {
  try {
    // Auth only — onboarding runs before any workspace exists.
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Signup email policy gate. Voice extraction runs BEFORE any workspace
    // exists and costs a real Gemini audio call per request, which makes it
    // the one endpoint a gated signup could still use to burn spend if we
    // only enforced at /api/onboarding. Same policy, same exemption for
    // pre-cutoff accounts — see lib/signup-policy.ts.
    if (!isExemptExistingAccount(user.created_at)) {
      const verdict = evaluateSignupEmail(user.email || '')
      if (!verdict.allowed) {
        return NextResponse.json({ error: verdict.reason }, { status: 403 })
      }
    }

    const { audio, mime_type } = await request.json()
    if (typeof audio !== 'string' || !audio) {
      return NextResponse.json({ error: 'Missing audio' }, { status: 400 })
    }

    const baseMime = String(mime_type || '').split(';')[0].trim().toLowerCase()
    if (!ALLOWED_MIME.includes(baseMime)) {
      return NextResponse.json({ error: `Unsupported audio type: ${baseMime}` }, { status: 400 })
    }

    // base64 is ~4/3 of raw size
    if (audio.length > (MAX_AUDIO_BYTES * 4) / 3) {
      return NextResponse.json({ error: 'Recording too large' }, { status: 413 })
    }

    const prompt = `Listen to this recording of a founder talking about themselves — who they are, what they believe, who they write for, and what most people in their space get wrong.

Extract the following. Where the recording doesn't cover a field, return an empty string or empty array — never invent.

LANGUAGE RULE: report the primary spoken language. Mostly-English speech with occasional words from another language counts as English ("en"). All extracted fields must always be written in English.

Respond with ONLY this JSON, no prose:
{
  "language": "primary language as a lowercase ISO 639-1 code, e.g. en, hi, es",
  "transcript": "faithful transcript of what they said, cleaned of filler words",
  "full_name": "their name if they said it, else empty",
  "role": "what they actually do, in their own framing (1 sentence)",
  "industry": "their industry or niche (a few words)",
  "audience_description": "who they write/create for, as a vivid one-to-two sentence description",
  "audience_segments": ["up to 4 short audience labels"],
  "voice_description": "2-3 sentences of WRITING-voice guidance derived from how they think and what they emphasize — their convictions and perspective, NOT their speaking mannerisms",
  "tones": ["up to 3, chosen ONLY from: ${TONE_OPTIONS.join(', ')}"],
  "topics": ["up to 6 short topic labels they clearly care about"]
}`

    const vertexAI = new VertexAI({
      project: process.env.GCP_PROJECT_ID!,
      location: 'us-central1',
    })
    const model = vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: baseMime, data: audio } },
          { text: prompt },
        ],
      }],
    })

    const raw = (result.response.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || '')
      .join('')

    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) {
      return NextResponse.json({ error: 'Could not understand the recording. Try again or type instead.' }, { status: 502 })
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      return NextResponse.json({ error: 'Could not understand the recording. Try again or type instead.' }, { status: 502 })
    }

    // English-only for now: a non-English profile would pollute the Brand DNA
    // that every generation and critique prompt interpolates.
    const language = str(parsed.language).toLowerCase()
    if (language && language !== 'en') {
      return NextResponse.json({
        error: 'It sounds like you were speaking in another language. Vowwl works in English for now — please re-record in English, or type instead.',
        language,
      }, { status: 422 })
    }

    const extraction: Extraction = {
      transcript: str(parsed.transcript),
      full_name: str(parsed.full_name),
      role: str(parsed.role),
      industry: str(parsed.industry),
      audience_description: str(parsed.audience_description),
      audience_segments: strArray(parsed.audience_segments, 4),
      voice_description: str(parsed.voice_description),
      tones: strArray(parsed.tones, 3).filter(t => TONE_OPTIONS.includes(t)),
      topics: strArray(parsed.topics, 6),
    }

    if (!extraction.transcript) {
      return NextResponse.json({ error: 'Could not hear anything in the recording. Try again or type instead.' }, { status: 502 })
    }

    return NextResponse.json({ extraction })

  } catch (error) {
    console.error('Voice extract error:', error)
    return NextResponse.json({ error: 'Voice processing failed. Try again or type instead.' }, { status: 500 })
  }
}
