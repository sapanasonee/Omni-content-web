// Core identity types
export interface Workspace {
  id: string
  owner_id: string
  name: string
  plan_tier: 'solo' | 'studio' | 'agency'
  generations_used: number
  generations_reset_at: string
  created_at: string
}

export interface Persona {
  id: string
  workspace_id: string
  name: string
  display_name: string
  active_rag_count: number
  created_at: string
}

// Onboarding types
export interface OnboardingData {
  identity: {
    full_name: string
    role: string
    industry: string
  }
  audience: {
    description: string
    segments: string[]
  }
  voice: {
    description: string
    tones: string[]
    formality: number
    pace: number
  }
  examples: {
    // Legacy single-sample field. Still populated (= good_samples[0]) so any
    // reader written before multi-sample support keeps working; new writes and
    // readers use good_samples.
    good: string
    // Up to 3 "best content" samples captured in onboarding. Optional because
    // brand_dna.json files written before this field existed only have `good` —
    // readers must fall back via readGoodSamples() in lib/brand-dna-schema.
    good_samples?: string[]
    bad: string
  }
  // Optional because brand_dna.json files written before this field existed
  // don't have it — readers must guard with `?.`
  topics?: string[]
  // Transcript of the spoken onboarding answer. Kept as profile source material
  // (and future activation-draft input) — NEVER indexed as a writing exemplar,
  // because spoken register is not written register.
  voice_sample_transcript?: string
  avoid: string[]
  formats: {
    preferred: string[]
    cadence: string
  }
}

// Brand DNA — what gets saved to GCS
export interface BrandDNA {
  schema_version: string
  workspace_id: string
  persona_id: string
  updated_at: string
  sections: OnboardingData
}

// Content types
export type ContentFormat = 'linkedin' | 'twitter' | 'newsletter' | 'blog' | 'exec_brief'
export type ContentMode = 'standard' | 'one_time' | 'campaign'
export type ContentStatus = 'draft' | 'approved' | 'archived'

export interface ContentPiece {
  id: string
  workspace_id: string
  persona_id: string
  format: ContentFormat
  body: string
  status: ContentStatus
  quality_score?: 1 | 2 | 3
  topic?: string
  mode: ContentMode
  generation_mode: ContentMode
  rag_excluded: boolean
  critique_passed?: boolean
  violations?: string[]
  scheduled_date?: string
  created_at: string
  approved_at?: string
}

// Trending topics (research feature)
export interface TrendingTopic {
  title: string
  why_it_matters: string
  content_angle: string
}

// Plan limits — the single source of truth for what a tier is allowed to do.
//
// NOTE: only `max_personas` is enforced today (POST /api/personas). The
// generation caps below are NOT yet wired: /api/generate and /api/comment
// still hardcode `30` and gate on `plan_tier === 'solo'`, and the quota
// counter lives per-workspace rather than per-account. Read those numbers as
// the intended contract, not as current behavior, until the quota rework
// lands — and when it does, route every limit through planLimitsFor() rather
// than reintroducing literals.
export const PLAN_LIMITS = {
  solo: {
    max_personas: 1,
    generations_per_month: 30,
    max_active_rag_pieces: 10,
  },
  studio: {
    max_personas: 5,
    generations_per_month: 150,
    max_active_rag_pieces: Infinity,
  },
  agency: {
    max_personas: Infinity,
    generations_per_month: Infinity,
    max_active_rag_pieces: Infinity,
  },
} as const

export type PlanTier = keyof typeof PLAN_LIMITS
export type PlanLimits = (typeof PLAN_LIMITS)[PlanTier]

// Resolve a tier string from the database into its limits.
//
// `workspaces.plan_tier` is a free-text column with no CHECK constraint and is
// nullable, so an unrecognized or absent value is entirely possible (rows
// predating the tier system, a typo'd manual update in the SQL editor). This
// fails CLOSED to the most restrictive tier: an unknown tier must never be
// read as "unlimited", because these limits gate spend. Callers therefore
// never have to null-check or branch on tier validity.
export function planLimitsFor(tier: string | null | undefined): PlanLimits {
  if (tier && tier in PLAN_LIMITS) return PLAN_LIMITS[tier as PlanTier]
  return PLAN_LIMITS.solo
}