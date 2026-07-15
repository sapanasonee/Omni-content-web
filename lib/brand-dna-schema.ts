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
// Length ceilings for DNA content. Every field below is interpolated into
// every generation/critic/topics prompt, so unbounded fields here are a
// STANDING per-request token cost (unlike a one-off route input). Unlike the
// route-level caps in lib/input-limits.ts, the normalizer TRUNCATES rather
// than rejects: this function's contract is "always produce a well-formed
// file from whatever came in", and a null return already carries the specific
// meaning "identity incomplete" that both callers surface as a message about
// name/role/industry — overloading it for length would show users the wrong
// error. Ceilings are far above any legitimate value (a 90s spoken intro
// transcribes to ~1.5k chars vs the 8k transcript cap), so truncation only
// ever fires on abuse, never on real profiles.
const SHORT_FIELD_MAX = 300      // names, roles, labels, cadence
const LONG_FIELD_MAX = 4_000     // descriptions, style examples
const TRANSCRIPT_MAX = 8_000     // voice_sample_transcript (longest legit field)
const LIST_MAX_ITEMS = 20        // segments/tones/topics/avoid/formats
const LIST_ITEM_MAX = 200

export function normalizeSections(raw: unknown): OnboardingData | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, Record<string, unknown>> & { topics?: unknown; avoid?: unknown }

  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.trim().slice(0, max) : ''
  const strArray = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          .map(x => x.trim().slice(0, LIST_ITEM_MAX))
          .slice(0, LIST_MAX_ITEMS)
      : []
  const scale = (v: unknown) => {
    const n = typeof v === 'number' ? Math.round(v) : 3
    return Math.min(5, Math.max(1, n))
  }

  const sections: OnboardingData = {
    identity: {
      full_name: str(s.identity?.full_name, SHORT_FIELD_MAX),
      role: str(s.identity?.role, SHORT_FIELD_MAX),
      industry: str(s.identity?.industry, SHORT_FIELD_MAX),
    },
    audience: {
      description: str(s.audience?.description, LONG_FIELD_MAX),
      segments: strArray(s.audience?.segments),
    },
    voice: {
      description: str(s.voice?.description, LONG_FIELD_MAX),
      tones: strArray(s.voice?.tones),
      formality: scale(s.voice?.formality),
      pace: scale(s.voice?.pace),
    },
    examples: {
      good: str(s.examples?.good, LONG_FIELD_MAX),
      bad: str(s.examples?.bad, LONG_FIELD_MAX),
    },
    topics: strArray(s.topics),
    voice_sample_transcript: str((s as Record<string, unknown>).voice_sample_transcript, TRANSCRIPT_MAX),
    avoid: strArray(s.avoid),
    formats: {
      preferred: strArray(s.formats?.preferred),
      cadence: str(s.formats?.cadence, SHORT_FIELD_MAX),
    },
  }

  if (!sections.identity.full_name || !sections.identity.role || !sections.identity.industry) {
    return null
  }
  return sections
}
