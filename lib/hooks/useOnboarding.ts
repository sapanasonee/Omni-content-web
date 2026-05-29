import { useState } from 'react'
import type { OnboardingData } from '@/lib/types'

const INITIAL_DATA: OnboardingData = {
  identity: { full_name: '', role: '', industry: '' },
  audience: { description: '', segments: [] },
  voice: { description: '', tones: [], formality: 3, pace: 3 },
  examples: { good: '', bad: '' },
  avoid: [],
  formats: { preferred: [], cadence: '' },
}

const TOTAL_STEPS = 6

export function useOnboarding() {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<OnboardingData>(INITIAL_DATA)

  function updateSection<K extends keyof OnboardingData>(
    key: K,
    value: OnboardingData[K] | Partial<OnboardingData[K]>
  ) {
    setData(prev => ({
      ...prev,
      [key]: Array.isArray(prev[key])
        ? value
        : { ...(prev[key] as object), ...(value as object) },
    }))
  }

  function canContinue(): boolean {
    switch (step) {
      case 1: return (
        data.identity.full_name.trim() !== '' &&
        data.identity.role.trim() !== '' &&
        data.identity.industry.trim() !== ''
      )
      case 2: return data.audience.description.trim() !== ''
      case 3: return data.voice.description.trim() !== ''
      case 4: return data.examples.good.trim() !== ''
      case 5: return data.avoid.length > 0
      case 6: return data.formats.preferred.length > 0 && data.formats.cadence !== ''
      default: return false
    }
  }

  function next() { if (step < TOTAL_STEPS) setStep(s => s + 1) }
  function back() { if (step > 1) setStep(s => s - 1) }

  return {
    step,
    data,
    updateSection,
    canContinue,
    next,
    back,
    progress: (step / TOTAL_STEPS) * 100,
    totalSteps: TOTAL_STEPS,
  }
}