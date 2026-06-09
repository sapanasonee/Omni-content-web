'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOnboarding } from '@/lib/hooks/useOnboarding'
import { cn } from '@/lib/utils'

// â”€â”€â”€ Sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function OnboardingPage() {
  const router = useRouter()
  const {
    step, data, updateSection,
    canContinue, next, back,
    totalSteps,
  } = useOnboarding()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      router.push('/dashboard')
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

  // â”€â”€â”€ Saving state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€â”€ Main render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="min-h-screen bg-white py-12 px-4">
      <div className="max-w-xl mx-auto space-y-8">

        {/* Header */}
        <div className="text-center space-y-1">
          <div className="w-8 h-8 bg-[#534AB7] rounded-lg mx-auto mb-3" />
          <h1 className="text-xl font-bold text-gray-900">Set up your brand voice</h1>
          <p className="text-sm text-gray-500">
            Step {step} of {totalSteps} â€” {STEPS[step - 1].name}
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

          {/* Step 1 â€” Identity */}
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
                  Not your job title â€” what you actually do and where you are in your journey
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

          {/* Step 2 â€” Audience */}
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
                          Ã—
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
            </div>
          )}

          {/* Step 3 â€” Voice */}
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
                  placeholder="e.g. Direct and warm. I open with a specific moment, not a broad statement. I never lecture â€” I share what I learned and invite the reader to think."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none"
                />
                {data.voice.description === '' && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-xs text-gray-400">Need inspiration? Click one to start:</p>
                    {[
                      "Direct and warm. I open with a specific moment, not a broad statement. I never lecture â€” I share what I learned and invite the reader to think.",
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

          {/* Step 4 â€” Examples */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Paste your best piece of content
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  A LinkedIn post, email, or any writing that felt most like you.
                  This single input transforms your output more than anything else.
                </p>
                <textarea
                  value={data.examples.good}
                  onChange={e => updateSection('examples', { good: e.target.value })}
                  placeholder="Paste your content here..."
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Example of content you dislike (optional)
                </label>
                <textarea
                  value={data.examples.bad}
                  onChange={e => updateSection('examples', { bad: e.target.value })}
                  placeholder="Paste an example of writing that makes you cringe â€” or describe what it sounds like..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#534AB7]/30 focus:border-[#534AB7] resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 5 â€” Avoid */}
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
                <p className="text-xs text-gray-400 mb-2">Common avoids â€” click to add:</p>
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

          {/* Step 6 â€” Formats */}
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



