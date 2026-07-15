import type { OnboardingData } from '@/lib/types'

// ─── Why this module exists ──────────────────────────────────────────────────
//
// brand_dna.json is the single most trusted artifact in the system: generation,
// the LLM critic, and trending topics all interpolate its fields directly into
// prompts, and the generate route dereferences nested paths
// (dna.audience.segments.join, dna.voice.tones.join, ...) without defensive
// checks. That trust is only safe if EVERY write path guarantees the shape.
//
// Originally this normalizer lived inside app/api/brand-dna/route.ts (the PUT
// editing surface) — but /api/onboarding, the PRIMARY write path that creates
// the file in the first place, saved `await request.json()` to GCS verbatim.
// Any client bypassing the wizard UI could persist arbitrary JSON:
//   - missing/renamed nested fields → every subsequent generation 500s on the
//     dereference (a self-inflicted but unrecoverable-without-support outage,
//     since /dna can't load a malformed file to fix it), and
//   - arbitrary structure/content riding into every prompt unmodified.
//
// Hoisting the normalizer here and calling it from BOTH write paths makes the
// invariant structural: there is no code path that writes sections to GCS
// without passing through this function. If a third write path is ever added,
// it must call normalizeSections too — that is the contract.
//
// (It lives in its own module rather than being exported from the brand-dna
// route because Next.js App Router route files may only export HTTP handlers
// and segment config — extra exports break the build.)
// ─────────────────────────────────────────────────────────────────────────────

// Coerce client-sent sections into a clean OnboardingData shape so a buggy or
// malicious client can't write arbitrary structure into the DNA file the
// generation prompts interpolate from. Unknown keys are dropped (we rebuild
// the object rather than sanitizing in place — allowlist, not blocklist),
// wrong-typed values degrade to empty string/array, and the 1-5 slider values
// are clamped server-side because the UI's range inputs are trivially
// bypassed.
export function normalizeSections(raw: unknown): OnboardingData | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, Record<string, unknown>> & { topics?: unknown; avoid?: unknown }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const strArray = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : []
  const scale = (v: unknown) => {
    const n = typeof v === 'number' ? Math.round(v) : 3
    return Math.min(5, Math.max(1, n))
  }

  const sections: OnboardingData = {
    identity: {
      full_name: str(s.identity?.full_name),
      role: str(s.identity?.role),
      industry: str(s.identity?.industry),
    },
    audience: {
      description: str(s.audience?.description),
      segments: strArray(s.audience?.segments),
    },
    voice: {
      description: str(s.voice?.description),
      tones: strArray(s.voice?.tones),
      formality: scale(s.voice?.formality),
      pace: scale(s.voice?.pace),
    },
    examples: {
      good: str(s.examples?.good),
      bad: str(s.examples?.bad),
    },
    topics: strArray(s.topics),
    voice_sample_transcript: str((s as Record<string, unknown>).voice_sample_transcript),
    avoid: strArray(s.avoid),
    formats: {
      preferred: strArray(s.formats?.preferred),
      cadence: str(s.formats?.cadence),
    },
  }

  if (!sections.identity.full_name || !sections.identity.role || !sections.identity.industry) {
    return null
  }
  return sections
}
