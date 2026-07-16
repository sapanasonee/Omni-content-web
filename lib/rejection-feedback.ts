// ─── Rejection feedback: the negative-signal loop ────────────────────────────
//
// The counterpart to approval. When a user clicks "I don't like this one" they
// pick from a fixed set of STRUCTURAL reasons (bad hook, flat, weak closing, …)
// — the same kind of behavioral pattern the rulebook reasons about, recurring
// across topics rather than tied to one piece's subject. Two loops consume this:
//
//   1. Immediate retry — buildRetryCorrection() turns the reasons + free-text
//      note the user just gave into a one-shot directive that steers the very
//      next generation of the same piece.
//   2. Recurrence auto-steer — recurringCorrectives() aggregates the persona's
//      recent rejections and, for any reason that has recurred at/above the
//      threshold, returns a standing corrective the generate route injects into
//      EVERY future prompt for that persona. This is what makes the feature
//      "better aligned next time they generate anything" rather than write-only.
//
// Centralized here (not duplicated in the route + the page) so the reason keys,
// the human labels, and the corrective phrasing are defined exactly once and
// every consumer stays in lockstep.
// ─────────────────────────────────────────────────────────────────────────────

export interface RejectionReasonDef {
  // Canonical key persisted on the piece and validated server-side.
  value: string
  // What the user sees on the chip.
  label: string
  // Noun phrase for the recurrence prompt, e.g. "You've rejected 3 drafts for
  // <pattern>". Must read naturally after "for".
  pattern: string
  // The directive used to (a) steer an immediate retry and (b) become the
  // standing-rule content when a recurring suggestion is accepted. Written as an
  // instruction to the model, phrased structurally (never topic-specific) so it
  // holds across every future piece.
  correction: string
}

export const REJECTION_REASONS: readonly RejectionReasonDef[] = [
  {
    value: 'tone_mismatch',
    label: "Doesn't match my tone",
    pattern: 'tone mismatches',
    correction:
      "Match the founder's voice and tones exactly — reread the VOICE section and stay inside it, never drifting off their register.",
  },
  {
    value: 'too_flat',
    label: "It's too flat",
    pattern: 'flat writing',
    correction:
      'Add texture and specificity — cut flat, generic, lifeless lines. Every sentence should carry a concrete detail or a point of view, never filler.',
  },
  {
    value: 'weak_hook',
    label: "Didn't like the hook",
    pattern: 'weak hooks',
    correction:
      'Open with a strong, specific hook — a concrete moment or a sharp claim in the first line. Never a generic, throat-clearing, or rhetorical-question opener.',
  },
  {
    value: 'weak_structure',
    label: "Didn't like the structure",
    pattern: 'weak structure',
    correction:
      'Give the piece a deliberate structure with a clear through-line — not an undifferentiated wall of text. Let the shape carry the reader from hook to point.',
  },
  {
    value: 'weak_closing',
    label: "Didn't like the closing",
    pattern: 'weak closings',
    correction:
      'Land the closing — end on a line with weight (a takeaway, a turn, or an invitation). Never trail off, summarize limply, or tack on a hashtag dump.',
  },
] as const

export const REJECTION_REASON_VALUES: readonly string[] =
  REJECTION_REASONS.map(r => r.value)

// How many times a reason must recur before it steers generation. One or two
// rejections are noise (a single off draft); three is a systematic blind spot
// for this persona — this mirrors the rulebook's 3+ recurrence gate for edits.
export const RECURRENCE_THRESHOLD = 3

// How many recent rejections to weigh. A rolling window so an old complaint the
// system has since fixed eventually ages out and stops steering forever.
export const REJECTION_WINDOW = 15

// A stored rejection record, as persisted on content_pieces.resolved_context.
export interface StoredRejection {
  reasons?: unknown
  note?: unknown
  at?: unknown
}

export interface RecurringReason {
  reason: RejectionReasonDef
  count: number
}

// Aggregate reasons across recent rejections and return every reason at/above
// the recurrence threshold, with its count, in REJECTION_REASONS order (stable
// output). Pure — the caller supplies the records; order doesn't matter here.
// The feedback route turns these into "make it a standing rule?" suggestions.
export function recurringReasons(rejections: StoredRejection[]): RecurringReason[] {
  const counts = new Map<string, number>()
  for (const r of rejections) {
    const reasons = Array.isArray(r?.reasons) ? r.reasons : []
    // Count each distinct reason once per rejection, so a single rejection that
    // ticked three boxes doesn't three-count one of them toward the threshold.
    const distinct = Array.from(new Set(reasons))
    for (const reason of distinct) {
      if (typeof reason === 'string') {
        counts.set(reason, (counts.get(reason) || 0) + 1)
      }
    }
  }
  return REJECTION_REASONS
    .map(reason => ({ reason, count: counts.get(reason.value) || 0 }))
    .filter(x => x.count >= RECURRENCE_THRESHOLD)
}

// Build the one-shot corrective for an immediate retry from the reasons and
// free-text note the user just submitted. Uses the same corrective phrasing as
// the recurrence loop, plus the user's own words verbatim when they gave any.
// Returns '' when there's nothing to steer with (a plain regenerate).
export function buildRetryCorrection(reasonValues: string[], note: string): string {
  const parts = REJECTION_REASONS
    .filter(r => reasonValues.includes(r.value))
    .map(r => r.correction)
  const trimmed = (note || '').trim()
  if (trimmed) parts.push(`In their words: "${trimmed}"`)
  return parts.join(' ')
}
