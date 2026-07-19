// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL AI TELLS — the linter's pattern library.
//
// This file is the editable home for every "sounds like AI, not a human"
// pattern. These are universal: wrong for EVERY founder, so they live in code
// (free, instant, deterministic) rather than in a per-user Brand DNA.
// Per-user style rules belong in the Brand DNA avoid list or standing rules —
// the LLM critic enforces those.
//
// HOW TO ADD A PATTERN (no regex needed):
//   { id: 'my-pattern', match: 'game-changer', note: 'hollow hype word' },
// `match` is a plain phrase, found case-insensitively anywhere in the text.
//
// ADVANCED (regex, for patterns with variations):
//   { id: 'not-x-but-y', match: "it'?s not .+, it'?s", isRegex: true, note: '…' },
// Set isRegex: true and write a JavaScript regex (it runs case-insensitive).
//
// `note` is shown to the user when the pattern fires, so write it as the
// reason the pattern is banned, not a description of the regex.
// ─────────────────────────────────────────────────────────────────────────────

export interface AITell {
  id: string
  match: string
  isRegex?: boolean
  note?: string
}

export const AI_TELLS: AITell[] = [
  // ── Openers ──────────────────────────────────────────────────────────────
  {
    id: 'fast-paced-world',
    match: "in today'?s fast.?paced world",
    isRegex: true,
    note: 'classic AI opener',
  },
  {
    id: 'as-we-navigate',
    match: 'as we navigate',
    note: 'AI throat-clearing',
  },
  {
    id: 'ever-evolving',
    match: 'in the ever.?evolving',
    isRegex: true,
    note: 'AI landscape-speak',
  },

  // ── Parallel contrast ────────────────────────────────────────────────────
  {
    id: 'not-x-its-y',
    match: "it'?s not .+, it'?s",
    isRegex: true,
    note: 'parallel contrast is the strongest AI tell',
  },
  {
    id: 'isnt-x-this-is',
    match: "this isn'?t .+, this is",
    isRegex: true,
    note: 'parallel contrast is the strongest AI tell',
  },

  // ── Announced vulnerability / dramatic reveals ───────────────────────────
  {
    id: 'ill-be-honest',
    match: "i'?ll be honest",
    isRegex: true,
    note: 'announcing vulnerability instead of showing it',
  },
  {
    id: 'if-im-being-honest',
    match: "if i'?m being honest",
    isRegex: true,
    note: 'announcing vulnerability instead of showing it',
  },
  {
    id: 'heres-the-truth',
    match: "here'?s the truth:",
    isRegex: true,
    note: 'dramatic reveal colon',
  },
  {
    id: 'when-it-hit-me',
    match: "that'?s when it hit me:",
    isRegex: true,
    note: 'dramatic reveal colon',
  },

  // ── Corporate jargon ─────────────────────────────────────────────────────
  {
    id: 'leverage',
    match: '\\bleverag(e|es|ed|ing)\\b',
    isRegex: true,
    note: "corporate jargon — humans say 'use'",
  },
  {
    id: 'synergy',
    match: '\\bsynerg(y|ies|istic)\\b',
    isRegex: true,
    note: 'corporate jargon with no concrete meaning',
  },

  // ── Add your own below (from real content-review experience) ─────────────
  // { id: 'delve', match: 'delve', note: 'nobody says delve' },
]
