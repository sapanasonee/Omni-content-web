import { NextResponse } from 'next/server'

// ─── Why this module exists ──────────────────────────────────────────────────
//
// Every free-text field the API accepts ends up in one (usually both) of two
// expensive places: interpolated into a Gemini prompt, or persisted to
// Postgres/GCS. None of them had a length bound, so a single request could
// carry megabytes of "topic" or "one_time_context" straight into the model
// call — token-cost abuse with a linear price tag per request, plus bloated
// rows that every later RAG retrieval and rulebook pass re-reads.
//
// Caps are centralized here (not scattered as magic numbers per route) so the
// ceiling for a given concept is set once, next to the reasoning for it, and
// every route that accepts that concept inherits the same bound.
//
// Philosophy: REJECT oversized route inputs with a 400 rather than silently
// truncating — truncation changes the meaning of what the user asked for and
// they'd discover it only by reading a wrong draft. (The Brand DNA normalizer
// is the exception and truncates instead; see brand-dna-schema.ts for why.)
// ─────────────────────────────────────────────────────────────────────────────

export const INPUT_LIMITS = {
  // Brief-mode topic: the brief field invites context ("the more context you
  // give, the better the output"), so it's not just a headline — 3k chars is
  // ~500 words, room for a detailed brief while still bounding token cost.
  topic: 3_000,
  // Describe-mode input: a paragraph or two describing the piece.
  description: 2_000,
  // Raw-mode input: the largest legitimate payload — voice-note transcripts
  // and braindumps. A 2-min spoken intro is ~2k chars; 20k covers even a
  // long dictation several times over while capping the token blast radius.
  raw_input: 20_000,
  // A tone override is a phrase ("more playful, less formal"), not an essay.
  tone_override: 300,
  // One-time and stored context blocks are instructions, not documents. 4k
  // matches roughly a page of guidance; every ACTIVE context is interpolated
  // into EVERY subsequent generation, so this cap also bounds the permanent
  // per-request token overhead a user can accumulate for themselves.
  context_content: 4_000,
  context_name: 200,
  // Draft body edits: generous ceiling above the longest legit format
  // (blog, ~1000 words ≈ 7k chars) — bounds what approve later lints,
  // stores, ships to GCS, and injects into RAG exemplars.
  draft_body: 30_000,
  // "I don't like this one" free-text note. A sentence or two on what felt off,
  // stored (not prompted) on the rejected piece — a paragraph is plenty.
  feedback_note: 1_000,
  // The one-shot retry corrective built from a rejection (structural
  // directives + the capped note). Bounds the reasons block plus the note plus
  // phrasing; injected into a single regenerate request only, never persisted.
  correction: 2_000,
  // The post being commented on (pasted from LinkedIn etc.). LinkedIn posts
  // cap at 3k chars; 6k tolerates pasted-in reposts/quote chains while
  // bounding the prompt cost of a comment call.
  comment_post: 6_000,
  // The user's optional angle for the comment — a steer, not an essay.
  comment_angle: 500,
} as const

// Uniform 400 for an oversized field. Field name and ceiling are included so
// a legitimate user who hits the cap (e.g. pasting a huge transcript) gets an
// actionable message instead of a mystery failure.
export function rejectOversized(
  fields: Array<[name: string, value: unknown, max: number]>,
): NextResponse | null {
  for (const [name, value, max] of fields) {
    if (typeof value === 'string' && value.length > max) {
      return NextResponse.json(
        { error: `${name} is too long (max ${max.toLocaleString()} characters)` },
        { status: 400 },
      )
    }
  }
  return null
}
