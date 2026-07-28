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
  // These match the CONSTRUCTION, not one phrasing of it. The model will
  // happily swap the comma for a semicolon or "it's not" for "isn't just"
  // and produce the identical tell, so the separator and the negation are
  // both matched as alternations. The gap is bounded and sentence-final
  // punctuation is excluded so the two clauses must belong to one sentence.
  {
    id: 'not-x-its-y',
    match: "it('?s| is) not\\b[^.!?]{1,120}[,;—–]\\s*it'?s\\b",
    isRegex: true,
    note: 'parallel contrast is the strongest AI tell',
  },
  {
    id: 'isnt-x-this-is',
    match: "this is\\s?n(o|')?t\\b[^.!?]{1,120}[,;—–]\\s*this is\\b",
    isRegex: true,
    note: 'parallel contrast is the strongest AI tell',
  },
  {
    id: 'subject-isnt-its',
    match: "\\b\\w+ is\\s?n(o|')?t\\b[^.!?]{1,120}[,;—–]\\s*it'?s\\b",
    isRegex: true,
    note: 'parallel contrast with a named subject — same tell, different dress',
  },

  // ── Buzzword landscape-speak ─────────────────────────────────────────────
  {
    id: 'buzzword-powered-world',
    match: 'in (this|the|today\'?s) [\\w-]*(powered|accelerated|driven|enabled|first) (world|era|landscape|age|economy)',
    isRegex: true,
    note: 'sibling of "in today\'s fast-paced world" — same empty scene-setting',
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
  {
    id: 'utilize',
    match: '\\butiliz(e|es|ed|ing|ation)\\b',
    isRegex: true,
    note: "corporate jargon — humans say 'use'",
  },
  {
    id: 'impactful',
    match: '\\bimpactful\\b',
    isRegex: true,
    note: 'says nothing — name the actual impact',
  },
  {
    id: 'paramount',
    match: '\\bparamount\\b',
    isRegex: true,
    note: "nobody says paramount out loud — 'matters most' does the job",
  },
  {
    id: 'unlock-potential',
    match: '\\bunlock(s|ed|ing)? (the |your |its |new |real )?(potential|power|value|growth)\\b',
    isRegex: true,
    note: 'hollow growth-speak',
  },
  {
    id: 'elevate-your',
    match: '\\belevat(e|es|ed|ing) your\\b',
    isRegex: true,
    note: 'marketing-brochure verb',
  },
  {
    id: 'harness-the-power',
    match: '\\bharness(es|ed|ing)? the (power|potential)\\b',
    isRegex: true,
    note: 'stock phrase, zero information',
  },
  {
    id: 'cutting-edge',
    match: 'cutting.?edge',
    isRegex: true,
    note: 'hype adjective that dates instantly',
  },
  {
    id: 'game-changer',
    match: 'game.?chang(er|ers|ing)',
    isRegex: true,
    note: 'hollow hype word',
  },
  {
    id: 'unparalleled',
    match: '\\bunparalleled\\b',
    isRegex: true,
    note: 'brochure superlative nobody says in conversation',
  },
  {
    id: 'seamless',
    match: '\\bseamless(ly)?\\b',
    isRegex: true,
    note: 'product-marketing filler',
  },

  // ── LLM vocabulary tells ─────────────────────────────────────────────────
  // Words that are far more common in model output than in human writing.
  {
    id: 'delve',
    match: '\\bdelv(e|es|ed|ing)\\b',
    isRegex: true,
    note: 'nobody says delve',
  },
  {
    id: 'myriad',
    match: '\\bmyriad\\b',
    isRegex: true,
    note: 'LLM vocabulary — say "a lot of"',
  },
  {
    id: 'tapestry',
    match: '\\btapestry\\b',
    isRegex: true,
    note: 'LLM metaphor nobody reaches for unprompted',
  },
  {
    id: 'testament-to',
    match: '\\ba testament to\\b',
    isRegex: true,
    note: 'stock LLM praise construction',
  },

  // ── Stock metaphors ──────────────────────────────────────────────────────
  {
    id: 'journey-not-destination',
    match: 'journey,? not (just )?the destination',
    isRegex: true,
    note: 'greeting-card cliché',
  },
  {
    id: 'co-pilot-metaphor',
    match: 'as your (co.?pilot|copilot)',
    isRegex: true,
    note: 'exhausted AI-era metaphor',
  },
  {
    id: 'double-edged-sword',
    match: 'double.?edged sword',
    isRegex: true,
    note: 'stock metaphor — say what the tradeoff actually is',
  },

  // ── Add your own below (from real content-review experience) ─────────────
]
