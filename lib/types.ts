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
    good: string
    bad: string
  }
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

// Plan limits
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