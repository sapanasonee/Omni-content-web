'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useOnboarding } from '@/lib/hooks/useOnboarding'
import { cn } from '@/lib/utils'

interface VoiceExtraction {
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

// ─── Sub-components ───────────────────────────────────────────────────────────

const ACTIVATION_FORMAT_MAP: Record<string, { value: string; label: string }> = {
  'LinkedIn': { value: 'linkedin', label: 'LinkedIn' },
  'Twitter': { value: 'twitter', label: 'Twitter' },
  'Newsletter': { value: 'newsletter', label: 'Newsletter' },
  'Blog': { value: 'blog', label: 'Blog' },
  'Executive Brief': { value: 'exec_brief', label: 'Exec Brief' },
}

const ACTIVATION_DEFAULTS = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'newsletter', label: 'Newsletter' },
]

interface ActivationDraft {
  format: string
  label: string
  text: string
  status: 'streaming' | 'done' | 'error'
  pieceId: string | null
  approving: boolean
  approved: boolean
  violations: string[] | null
  // "Does this sound like you?" — the activation validation signal.
  feedback: 'yes' | 'no' | null
  feedbackBusy: boolean
}

function ActivationDrafts({
  workspaceId, personaId, transcript, preferredFormats, onDone,
}: {
  workspaceId: string
  personaId: string
  transcript: string
  preferredFormats: string[]
  onDone: () => void
}) {
  const [drafts, setDrafts] = useState<ActivationDraft[]>([])
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    // Top 3 preferred platforms, topped up with defaults if they picked fewer.
    const picked = preferredFormats
      .map(p => ACTIVATION_FORMAT_MAP[p])
      .filter(Boolean)
    for (const d of ACTIVATION_DEFAULTS) {
      if (picked.length >= 3) break
      if (!picked.some(p => p.value === d.value)) picked.push(d)
    }
    const targets = picked.slice(0, 3)

    setDrafts(targets.map(t => ({
      format: t.value,
      label: t.label,
      text: '',
      status: 'streaming' as const,
      pieceId: null,
      approving: false,
      approved: false,
      violations: null,
      feedback: null,
      feedbackBusy: false,
    })))

    targets.forEach((t, idx) => runGeneration(idx, t.value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patchDraft(idx: number, updates: Partial<ActivationDraft>) {
    setDrafts(prev => prev.map((d, i) => (i === idx ? { ...d, ...updates } : d)))
  }

  async function runGeneration(idx: number, format: string) {
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          persona_id: personaId,
          format,
          mode: 'raw',
          raw_input: transcript,
          generation_mode: 'standard',
          activation: true,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let raw = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        raw += decoder.decode(value, { stream: true })
        const metaIdx = raw.indexOf('__META__')
        patchDraft(idx, { text: metaIdx === -1 ? raw : raw.slice(0, metaIdx) })
      }

      const metaIdx = raw.indexOf('__META__')
      let finalText = metaIdx === -1 ? raw : raw.slice(0, metaIdx)
      let pieceId: string | null = null
      if (metaIdx !== -1) {
        try {
          const meta = JSON.parse(raw.slice(metaIdx + '__META__'.length))
          if (meta?.content_piece_id) pieceId = meta.content_piece_id
          if (typeof meta?.revised_body === 'string' && meta.revised_body) {
            finalText = meta.revised_body
          }
        } catch {}
      }

      patchDraft(idx, { text: finalText, status: 'done', pieceId })
    } catch {
      patchDraft(idx, { status: 'error' })
    }
  }

  async function approveDraft(idx: number, confirmed = false) {
    const draft = drafts[idx]
    if (!draft?.pieceId || draft.approving || draft.approved) return
    patchDraft(idx, { approving: true })
    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_piece_id: draft.pieceId,
          workspace_id: workspaceId,
          persona_id: personaId,
          confirmed,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Approval failed')
      if (data.requires_confirmation) {
        patchDraft(idx, { approving: false, violations: data.violations || [] })
        return
      }
      patchDraft(idx, { approving: false, approved: true, violations: null })
    } catch {
      patchDraft(idx, { approving: false })
    }
  }

  // "Does this sound like you?" — the direct measurement for the product's
  // core validation metric (% of new users who hit "sounds like me" on their
  // first drafts). Lightweight reaction, independent of Approve; a failed
  // save just resets the buttons — never blocks the activation flow.
  async function sendSoundsFeedback(idx: number, soundsLikeMe: boolean) {
    const draft = drafts[idx]
    if (!draft?.pieceId || draft.feedbackBusy) return
    patchDraft(idx, { feedbackBusy: true })
    try {
      const res = await fetch('/api/activation-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_piece_id: draft.pieceId,
          workspace_id: workspaceId,
          persona_id: personaId,
          sounds_like_me: soundsLikeMe,
        }),
      })
      if (!res.ok) throw new Error()
      patchDraft(idx, { feedbackBusy: false, feedback: soundsLikeMe ? 'yes' : 'no' })
    } catch {
      patchDraft(idx, { feedbackBusy: false })
    }
  }

  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-1">
          <div className="w-8 h-8 bg-[#534AB7] rounded-lg mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900">Your first three drafts</h1>
          <p className="text-sm text-gray-500">
            Written from what you just said — in your voice. Approve the ones that sound like you; they become your brand memory.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {drafts.map((draft, idx) => (
            <div key={draft.format} className="border border-gray-100 rounded-xl flex flex-col overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">{draft.label}</p>
                {draft.status === 'streaming' && (
                  <span className="w-3.5 h-3.5 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              <div className="flex-1 p-4 max-h-72 overflow-auto">
                {draft.status === 'error' ? (
                  <p className="text-xs text-red-600">Couldn&apos;t generate this one. You can create it later from the Generate page.</p>
                ) : (
                  <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                    {draft.text}
                    {draft.status === 'streaming' && (
                      <span className="inline-block w-1 h-3 bg-[#534AB7] animate-pulse ml-0.5 align-middle" />
                    )}
                  </p>
                )}
              </div>
              {draft.status === 'done' && (
                <div className="px-4 py-3 border-t border-gray-100">
                  {/* Sounds-like-you reaction — the activation validation signal */}
                  {draft.feedback === null ? (
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs text-gray-500">Sound like you?</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => sendSoundsFeedback(idx, true)}
                          disabled={draft.feedbackBusy || !draft.pieceId}
                          className="px-2.5 py-1 rounded-lg text-sm border border-gray-200 hover:border-[#534AB7] hover:bg-[#FAFAFF] transition-colors disabled:opacity-40"
                          aria-label="Yes, this sounds like me"
                        >
                          👍
                        </button>
                        <button
                          onClick={() => sendSoundsFeedback(idx, false)}
                          disabled={draft.feedbackBusy || !draft.pieceId}
                          className="px-2.5 py-1 rounded-lg text-sm border border-gray-200 hover:border-gray-400 transition-colors disabled:opacity-40"
                          aria-label="No, this doesn't sound like me"
                        >
                          👎
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mb-2 text-xs text-gray-500">
                      {draft.feedback === 'yes'
                        ? '👍 Great — approve it and it becomes brand memory.'
                        : '👎 Noted — skip approving this one; your voice sharpens as you use Vowwl.'}
                    </p>
                  )}
                  {draft.violations && !draft.approved && (
                    <div className="mb-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                      Quality flags: {draft.violations.slice(0, 2).join('; ')}
                    </div>
                  )}
                  <button
                    onClick={() => approveDraft(idx, draft.violations !== null)}
                    disabled={draft.approving || draft.approved || !draft.pieceId}
                    className={cn(
                      'w-full py-2 rounded-lg text-xs font-medium transition-all',
                      draft.approved
                        ? 'bg-green-500 text-white cursor-default'
                        : 'bg-[#534AB7] text-white hover:opacity-90 disabled:opacity-40'
                    )}
                  >
                    {draft.approved ? '✓ Approved' : draft.approving ? 'Approving…' : draft.violations ? 'Approve anyway' : 'Approve'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="text-center">
          <button
            onClick={onDone}
            className="px-6 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Continue to dashboard →
          </button>
          <p className="text-xs text-gray-400 mt-2">These drafts are saved — you can edit or approve them anytime from your Library.</p>
        </div>
      </div>
    </div>
  )
}

function TagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const [value, setValue] = useState('')

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && value.trim()) {
      e.preventDefault()
      onAdd(value.trim())
      setValue('')
    }
  }

  return (
    <input
      type="text"
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Type and press Enter to add (e.g. AI builders, PM leaders)"
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
    />
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEPS = [
  { number: 1, name: 'Identity' },
  { number: 2, name: 'Audience' },
  { number: 3, name: 'Voice' },
  { number: 4, name: 'Examples' },
  { number: 5, name: 'Avoid' },
  { number: 6, name: 'Formats' },
]

const AUDIENCE_SUGGESTIONS = [
  'Aspiring PMs', 'Hiring managers', 'Founders', 'CTOs',
  'AI builders', 'PM leaders', 'Freelancers', 'Team leads',
  'Students', 'Solopreneurs', 'Investors', 'Developers',
]

const TONES = [
  'Direct', 'Warm', 'Witty', 'Formal',
  'Casual', 'Empathetic', 'Bold', 'Thoughtful',
]

const TOPIC_SUGGESTIONS = [
  'Product thinking', 'AI for creators', 'Building in public',
  'Content strategy', 'Founder life', 'Career transitions',
  'Leadership', 'Marketing', 'Fundraising', 'Hiring',
]

const FORMATS = ['LinkedIn', 'Twitter', 'Newsletter', 'Blog', 'Executive Brief']

const CADENCES = ['Daily', '3-5x per week', '2x per week', 'Weekly', 'Bi-weekly']

const AVOID_OPTIONS = [
  "AI-pattern openers ('In today's fast-paced world...')",
  'Hollow motivational content',
  'Corporate jargon',
  "Parallel contrast ('It's not X, it's Y')",
  'Lecturing or preachy tone',
  'Bold claims without sources',
  'Excessive hashtags',
  'Third-person analysis',
  'Generic motivational quotes',
  'Overly promotional language',
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const {
    step, data, updateSection,
    canContinue, next, back,
    totalSteps,
  } = useOnboarding()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activationIds, setActivationIds] = useState<{ workspace_id: string; persona_id: string } | null>(null)

  // ─── Voice intro state ────────────────────────────────────────
  const MAX_RECORD_SECONDS = 120
  const [showVoiceIntro, setShowVoiceIntro] = useState(true)
  const [voiceStage, setVoiceStage] = useState<'intro' | 'recording' | 'processing' | 'done' | 'error'>('intro')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [extracted, setExtracted] = useState<VoiceExtraction | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      recorderRef.current?.stream.getTracks().forEach(t => t.stop())
    }
  }, [])

  async function startRecording() {
    setVoiceError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        if (timerRef.current) clearInterval(timerRef.current)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        processRecording(blob)
      }

      recorder.start()
      setRecordSeconds(0)
      setVoiceStage('recording')
      timerRef.current = setInterval(() => {
        setRecordSeconds(s => {
          if (s + 1 >= MAX_RECORD_SECONDS && recorderRef.current?.state === 'recording') {
            recorderRef.current.stop()
          }
          return s + 1
        })
      }, 1000)
    } catch {
      setVoiceError("Couldn't access your microphone. You can type instead — it works just as well.")
      setVoiceStage('error')
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }
  }

  async function processRecording(blob: Blob) {
    setVoiceStage('processing')
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      const res = await fetch('/api/voice-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, mime_type: blob.type }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Voice processing failed')

      const e: VoiceExtraction = data.extraction
      setExtracted(e)

      // Prefill the wizard — only overwrite with non-empty values.
      const identity: Record<string, string> = {}
      if (e.full_name) identity.full_name = e.full_name
      if (e.role) identity.role = e.role
      if (e.industry) identity.industry = e.industry
      if (Object.keys(identity).length) updateSection('identity', identity)

      const audience: Record<string, unknown> = {}
      if (e.audience_description) audience.description = e.audience_description
      if (e.audience_segments.length) audience.segments = e.audience_segments
      if (Object.keys(audience).length) updateSection('audience', audience)

      const voice: Record<string, unknown> = {}
      if (e.voice_description) voice.description = e.voice_description
      if (e.tones.length) voice.tones = e.tones
      if (Object.keys(voice).length) updateSection('voice', voice)

      if (e.topics.length) updateSection('topics', e.topics)
      if (e.transcript) updateSection('voice_sample_transcript', e.transcript)

      setVoiceStage('done')
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Voice processing failed')
      setVoiceStage('error')
    }
  }

  async function handleFinish() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Something went wrong')
      }
      const result = await res.json()
      // Activation moment: with a voice transcript we can produce first drafts
      // immediately. Without one, land on Generate where trending topics kill
      // the blank page instead.
      if (data.voice_sample_transcript?.trim() && result.workspace_id && result.persona_id) {
        setActivationIds({ workspace_id: result.workspace_id, persona_id: result.persona_id })
        setSaving(false)
      } else {
        router.push('/generate')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  function addSegment(seg: string) {
    if (!data.audience.segments.includes(seg)) {
      updateSection('audience', { segments: [...data.audience.segments, seg] })
    }
  }

  function removeSegment(seg: string) {
    updateSection('audience', {
      segments: data.audience.segments.filter((s: string) => s !== seg),
    })
  }

  // ─── Best-content samples (step 4) ────────────────────────────
  // The wizard lets a user paste up to 3 samples so we learn the variety they
  // like. updateSection merges the partial into examples, preserving `bad`.
  function goodSamples(): string[] {
    const s = data.examples.good_samples
    return s && s.length ? s : ['']
  }

  function updateSample(index: number, value: string) {
    const samples = [...goodSamples()]
    samples[index] = value
    updateSection('examples', { good_samples: samples })
  }

  function addSample() {
    const samples = goodSamples()
    if (samples.length < 3) {
      updateSection('examples', { good_samples: [...samples, ''] })
    }
  }

  function removeSample(index: number) {
    const samples = goodSamples().filter((_, i) => i !== index)
    updateSection('examples', { good_samples: samples.length ? samples : [''] })
  }

  function addTopic(topic: string) {
    const topics = data.topics || []
    if (!topics.includes(topic)) {
      updateSection('topics', [...topics, topic])
    }
  }

  function removeTopic(topic: string) {
    updateSection('topics', (data.topics || []).filter((t: string) => t !== topic))
  }

  // ─── Saving state ─────────────────────────────────────────────────────────

  if (saving) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Setting up your workspace...</p>
        </div>
      </div>
    )
  }

  // ─── Activation: first three drafts ───────────────────────────

  if (activationIds) {
    return (
      <ActivationDrafts
        workspaceId={activationIds.workspace_id}
        personaId={activationIds.persona_id}
        transcript={data.voice_sample_transcript || ''}
        preferredFormats={data.formats.preferred}
        onDone={() => router.push('/dashboard')}
      />
    )
  }

  // ─── Voice intro screen ───────────────────────────────────────

  if (showVoiceIntro) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-8 h-8 bg-[#534AB7] rounded-lg mx-auto" />
          <div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Start with your voice</h1>
            <p className="text-sm text-gray-500">
              Talk for up to 2 minutes. Who are you? Who do you write for?
              And — <span className="text-gray-700 font-medium">what do most people in your space get wrong, and what do you love talking about?</span>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              We&apos;ll listen and fill in your brand profile — you review and adjust everything after.
            </p>
          </div>

          {voiceStage === 'intro' && (
            <div className="space-y-4">
              <button
                onClick={startRecording}
                className="w-20 h-20 bg-[#534AB7] rounded-full mx-auto flex items-center justify-center hover:opacity-90 transition-opacity shadow-lg"
              >
                <span className="w-6 h-6 bg-white rounded-full" />
              </button>
              <p className="text-xs text-gray-400">Tap to record</p>
            </div>
          )}

          {voiceStage === 'recording' && (
            <div className="space-y-4">
              <button
                onClick={stopRecording}
                className="w-20 h-20 bg-red-500 rounded-full mx-auto flex items-center justify-center hover:opacity-90 transition-opacity shadow-lg animate-pulse"
              >
                <span className="w-5 h-5 bg-white rounded-sm" />
              </button>
              <p className="text-sm font-medium text-gray-700">
                {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')} / {Math.floor(MAX_RECORD_SECONDS / 60)}:{String(MAX_RECORD_SECONDS % 60).padStart(2, '0')}
              </p>
              <p className="text-xs text-gray-400">Tap to stop when you&apos;re done</p>
            </div>
          )}

          {voiceStage === 'processing' && (
            <div className="space-y-4 py-4">
              <div className="w-8 h-8 border-2 border-[#534AB7] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-gray-500">Listening to what you said…</p>
            </div>
          )}

          {voiceStage === 'done' && extracted && (
            <div className="space-y-4">
              <div className="text-left border border-gray-100 rounded-xl p-4 space-y-3">
                <p className="text-xs font-medium text-gray-400">Here&apos;s what we caught:</p>
                {extracted.role && (
                  <p className="text-sm text-gray-700">{extracted.role}</p>
                )}
                {extracted.topics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {extracted.topics.map(t => (
                      <span key={t} className="px-2.5 py-1 bg-[#EEEDFE] rounded-full text-xs font-medium text-[#534AB7]">{t}</span>
                    ))}
                  </div>
                )}
                {extracted.tones.length > 0 && (
                  <p className="text-xs text-gray-500">Tone: {extracted.tones.join(' · ')}</p>
                )}
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => { setExtracted(null); setVoiceStage('intro') }}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Re-record
                </button>
                <button
                  onClick={() => setShowVoiceIntro(false)}
                  className="px-6 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Review &amp; continue
                </button>
              </div>
            </div>
          )}

          {voiceStage === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-red-600">{voiceError}</p>
              <button
                onClick={() => { setVoiceError(null); setVoiceStage('intro') }}
                className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:border-gray-300 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {voiceStage !== 'done' && (
            <button
              onClick={() => setShowVoiceIntro(false)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2"
            >
              I&apos;d rather type it out
            </button>
          )}
        </div>
      </div>
    )
  }

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-xl mx-auto space-y-8">

        {/* Header */}
        <div className="text-center space-y-1">
          <div className="w-8 h-8 bg-[#534AB7] rounded-lg mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900">Set up your brand voice</h1>
          <p className="text-sm text-gray-500">
            Step {step} of {totalSteps} — {STEPS[step - 1].name}
          </p>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5 justify-center">
          {STEPS.map(s => (
            <div
              key={s.number}
              className={cn(
                'h-1.5 w-8 rounded-full transition-all duration-300',
                s.number <= step ? 'bg-[#534AB7]' : 'bg-gray-200'
              )}
            />
          ))}
        </div>

        {/* Step card */}
        <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm space-y-5">

          {/* Step 1 — Identity */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your full name</label>
                <input
                  type="text"
                  value={data.identity.full_name}
                  onChange={e => updateSection('identity', { full_name: e.target.value })}
                  placeholder="Sapana Sonee"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your role</label>
                <input
                  type="text"
                  value={data.identity.role}
                  onChange={e => updateSection('identity', { role: e.target.value })}
                  placeholder="Transitioning PM, previously content writer"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Not your job title — what you actually do and where you are in your journey
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Industry or niche</label>
                <input
                  type="text"
                  value={data.identity.industry}
                  onChange={e => updateSection('identity', { industry: e.target.value })}
                  placeholder="Product Management, SaaS, AI"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7]"
                />
              </div>
            </div>
          )}

          {/* Step 2 — Audience */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Who reads your content?
                </label>
                <textarea
                  value={data.audience.description}
                  onChange={e => updateSection('audience', { description: e.target.value })}
                  placeholder="Describe your ideal reader like a real person. What do they care about? What keeps them up at night?"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Audience segments
                </label>
                {data.audience.segments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {data.audience.segments.map(seg => (
                      <span
                        key={seg}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#534AB7] text-white rounded-full text-xs font-medium"
                      >
                        {seg}
                        <button
                          type="button"
                          onClick={() => removeSegment(seg)}
                          className="hover:opacity-70 ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <TagInput onAdd={addSegment} />
                <p className="text-xs text-gray-400 mt-2 mb-1.5">Suggestions:</p>
                <div className="flex flex-wrap gap-2">
                  {AUDIENCE_SUGGESTIONS
                    .filter((s: string) => !data.audience.segments.includes(s))
                    .map(seg => (
                      <button
                        key={seg}
                        type="button"
                        onClick={() => addSegment(seg)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
                      >
                        + {seg}
                      </button>
                    ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Topics you write about
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  Used to find trending topics in your niche — the more specific, the sharper the suggestions.
                </p>
                {(data.topics || []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(data.topics || []).map(topic => (
                      <span
                        key={topic}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#534AB7] text-white rounded-full text-xs font-medium"
                      >
                        {topic}
                        <button
                          type="button"
                          onClick={() => removeTopic(topic)}
                          className="hover:opacity-70 ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <TagInput onAdd={addTopic} />
                <p className="text-xs text-gray-400 mt-2 mb-1.5">Suggestions:</p>
                <div className="flex flex-wrap gap-2">
                  {TOPIC_SUGGESTIONS
                    .filter((t: string) => !(data.topics || []).includes(t))
                    .map(topic => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => addTopic(topic)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
                      >
                        + {topic}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Voice */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Describe your voice
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  How do you naturally write? What makes your content feel like you?
                </p>
                <textarea
                  value={data.voice.description}
                  onChange={e => updateSection('voice', { description: e.target.value })}
                  placeholder="e.g. Direct and warm. I open with a specific moment, not a broad statement. I never lecture — I share what I learned and invite the reader to think."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none"
                />
                {data.voice.description === '' && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-xs text-gray-400">Need inspiration? Click one to start:</p>
                    {[
                      "Direct and warm. I open with a specific moment, not a broad statement. I never lecture — I share what I learned and invite the reader to think.",
                      "Concise and precise. I cut every word that doesn't earn its place. I write for builders who don't have time for fluff.",
                      "Conversational and honest. I write like I'm talking to one person over coffee. I share the uncomfortable truth, not the comfortable version.",
                    ].map((example, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => updateSection('voice', { description: example })}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs text-gray-500 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-all"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tones that fit you
                </label>
                <div className="flex flex-wrap gap-2">
                  {TONES.map(tone => (
                    <button
                      key={tone}
                      type="button"
                      onClick={() => {
                        const current = data.voice.tones
                        updateSection('voice', {
                          tones: current.includes(tone)
                            ? current.filter((t: string) => t !== tone)
                            : [...current, tone],
                        })
                      }}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                        data.voice.tones.includes(tone)
                          ? 'bg-[#534AB7] text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      )}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2">
                    Formality: {['Very casual', 'Casual', 'Balanced', 'Formal', 'Very formal'][data.voice.formality - 1]}
                  </label>
                  <input
                    type="range" min={1} max={5}
                    value={data.voice.formality}
                    onChange={e => updateSection('voice', { formality: parseInt(e.target.value) })}
                    className="w-full accent-[#534AB7]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2">
                    Pace: {['Very slow', 'Slow', 'Moderate', 'Fast', 'Very fast'][data.voice.pace - 1]}
                  </label>
                  <input
                    type="range" min={1} max={5}
                    value={data.voice.pace}
                    onChange={e => updateSection('voice', { pace: parseInt(e.target.value) })}
                    className="w-full accent-[#534AB7]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4 — Examples */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Paste the best piece of content you&apos;ve created
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  A LinkedIn post, email, or any writing that felt most like you.
                  Haven&apos;t found your best voice yet? Paste one you admire instead.
                  Add up to 3 — the variety helps us learn the range you like, not
                  just one format.
                </p>
                <div className="space-y-3">
                  {goodSamples().map((sample, i) => (
                    <div key={i} className="relative">
                      {goodSamples().length > 1 && (
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-500">
                            Sample {i + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeSample(i)}
                            className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                      <textarea
                        value={sample}
                        onChange={e => updateSample(i, e.target.value)}
                        placeholder={i === 0 ? 'Paste your content here...' : 'Paste another piece you like...'}
                        rows={i === 0 ? 8 : 5}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none font-mono"
                      />
                    </div>
                  ))}
                </div>
                {goodSamples().length < 3 && (
                  <button
                    type="button"
                    onClick={addSample}
                    className="mt-2 text-xs font-medium text-[#534AB7] hover:opacity-80 transition-opacity"
                  >
                    + Add another piece ({goodSamples().length}/3)
                  </button>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Example of content you dislike (optional)
                </label>
                <textarea
                  value={data.examples.bad}
                  onChange={e => updateSection('examples', { bad: e.target.value })}
                  placeholder="Paste an example of writing that makes you cringe — or describe what it sounds like..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 5 — Avoid */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  What should your content never sound like?
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  Describe the type of writer or tone that makes you cringe. Be specific - sounds like a LinkedIn ghostwriter is more useful than unprofessional.
                </p>
                <textarea
                  value={data.avoid.join('\n')}
                  onChange={e => updateSection('avoid', e.target.value.split('\n').filter((a: string) => a.trim() !== ''))}
                  placeholder="e.g. Sounds like a LinkedIn ghostwriter template. Uses hollow phrases like game-changer or synergy. Opens with a rhetorical question. Ends with 5 hashtags."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none"
                />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-2">Common avoids — click to add:</p>
                <div className="flex flex-wrap gap-2">
                  {AVOID_OPTIONS
                    .filter((item: string) => !data.avoid.includes(item))
                    .map((item: string) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => updateSection('avoid', [...data.avoid, item])}
                        className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all"
                      >
                        + {item}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 6 — Formats */}
          {step === 6 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Which platforms do you write for?
                </label>
                <div className="flex flex-wrap gap-2">
                  {FORMATS.map(format => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => {
                        const current = data.formats.preferred
                        updateSection('formats', {
                          preferred: current.includes(format)
                            ? current.filter((f: string) => f !== format)
                            : [...current, format],
                        })
                      }}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-medium transition-all border',
                        data.formats.preferred.includes(format)
                          ? 'bg-[#534AB7] text-white border-[#534AB7]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      )}
                    >
                      {format}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  How often do you want to publish?
                </label>
                <div className="flex flex-wrap gap-2">
                  {CADENCES.map(cadence => (
                    <button
                      key={cadence}
                      type="button"
                      onClick={() => updateSection('formats', { cadence })}
                      className={cn(
                        'px-4 py-2 rounded-lg text-sm font-medium transition-all border',
                        data.formats.cadence === cadence
                          ? 'bg-[#534AB7] text-white border-[#534AB7]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      )}
                    >
                      {cadence}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Error message */}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={step === 1}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-0"
          >
            Back
          </button>
          {step < totalSteps ? (
            <button
              type="button"
              onClick={next}
              disabled={!canContinue()}
              className="px-6 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={!canContinue()}
              className="px-6 py-2 bg-[#534AB7] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Finish setup
            </button>
          )}
        </div>

      </div>
    </div>
  )
}



