# Content generation pipeline — execution trace

Traced against `hardening-pass` HEAD (`2256149`, "Tell the revise pass to fix
the cause, not the regex match") by reading the actual code, not the
comments describing it. File:line references are to that commit.

Every trace below is "what happens," not "what should happen." Deviations
from what the surrounding comments/CLAUDE.md claim are called out inline
with **⚠ FLAG**.

---

## 1. Generate

### 1.1 Click "Generate" — UI

`app/(dashboard)/generate/page.tsx` `handleGenerate(correction?, rejectedDraft?)` (line 202)

- Resets a dozen pieces of UI state (output, approve/reject state, voice-check
  state). If this is a *fresh* generate (no `correction`), it also clears any
  pending rule/DNA suggestion cards — a rejection-retry deliberately keeps
  them.
- `GET /api/me` → `{ workspace_id, persona_id }`.
- `POST /api/generate` with body:
  ```json
  {
    "workspace_id", "persona_id", "format", "mode",
    "generation_mode": "standard",
    "topic": "<input>",          // only if mode === 'brief'
    "raw_input": "<input>",      // only if mode === 'raw'
    "description": "<input>",    // only if mode === 'describe'
    "campaign_context_id": "<uuid or undefined>",
    "one_time_context": "<text or undefined>",
    "correction": "<text or undefined>",
    "rejected_draft": "<text or undefined>"
  }
  ```
- Reads the response body as a raw `ReadableStream`, decodes chunks, and
  splits on the literal marker string `__META__`: everything before it is
  live-rendered as the streaming draft; everything after it is JSON-parsed
  for `content_piece_id`, `voice_check`, and optionally `revised_body`.
- If `revised_body` is present (the post-stream voice check corrected the
  draft), the UI **replaces** the streamed text the user just watched appear
  with the revised text — the user never sees the pre-revision version render
  at all except mid-stream.
- **⚠ FLAG**: immediately after, it does one more fetch:
  `GET /api/content?workspace_id=...&persona_id=...&status=draft&limit=1`
  (`page.tsx:285`) to re-derive `content_piece_id`. **No `app/api/content`
  route exists anywhere in this repo** (`find app/api -type d` confirms it).
  This call 404s on every single generation. The failure is silently
  swallowed (`if (latestRes.ok) {...}`, no else/catch surfacing it), so it's
  harmless — `content_piece_id` was already set from the `__META__` chunk a
  few lines earlier — but it's a dead network call on the hot path of every
  generation. Worth deleting or wiring to a real endpoint.

### 1.2 `POST /api/generate` — `app/api/generate/route.ts` `POST` (line 113)

Step numbers below match the route's own inline comments.

1. **Auth** — `supabase.auth.getUser()`. 401 if absent.
2. **Parse** the JSON body (fields listed above).
3. **Validation**: `format` must be a key of `FORMAT_INSTRUCTIONS` (400
   otherwise — this used to silently interpolate `"FORMAT: undefined"` into
   the prompt and persist the bogus format, poisoning RAG's same-format
   ranking forever; now rejected up front). `generation_mode` must be
   `'standard' | 'one_time'`. Every free-text field is length-capped via
   `rejectOversized` (`lib/input-limits.ts`) — topic 500 chars, raw_input
   20k, one_time_context 4k, correction 2k, rejected_draft 30k, etc.
   Oversized → 400, not truncation (truncation is reserved for the DNA
   normalizer, deliberately, per that file's own comment).
4. **Ownership guards** (`lib/auth-guard.ts`): `requireWorkspaceOwnership`
   (pins `owner_id = user.id` in the SQL predicate, not just RLS visibility),
   then `requirePersonaInWorkspace`. Both 404 (never 403) on failure so a
   foreign ID doesn't confirm its own existence.
5. **Quota pre-check**: solo tier + `generations_used >= 30` → 402. This is a
   cheap fast-fail; the real enforcement is the atomic RPC in step 7.
6. **Brand DNA fetch** — `bucket.file('workspaces/{workspace_id}/personas/{persona_id}/brand_dna.json').download()`,
   `JSON.parse`d into `BrandDNA`. **This is the only place Brand DNA is
   fetched for generation** — a direct GCS read, not a Supabase query, not a
   call to `/api/brand-dna`. 404 if the file is missing/unparseable ("Please
   complete onboarding first").
   - **Fields actually read from `dna = brandDNA.sections`** (see §1.4 for
     where each lands in the prompt): `identity.full_name`, `identity.role`,
     `identity.industry`, `topics` (optional array), `audience.description`,
     `audience.segments` (array, joined), `voice.description`, `voice.tones`
     (array, joined), `voice.formality` (1-5 int), `voice.pace` (1-5 int),
     `examples.good`/`examples.good_samples` (via `readGoodSamples`),
     `examples.bad`, `avoid` (array).
   - **Fields fetched but NOT used in the generate prompt**: `formats.preferred`,
     `formats.cadence`, `voice_sample_transcript`. These are real fields on
     `OnboardingData` and get loaded into memory as part of `brandDNA.sections`,
     but the generate route's prompt-builder never touches
     `dna.formats.*` or `dna.voice_sample_transcript` at all. (They're not
     dead in the app overall — `formats.preferred` picks the 3 formats used
     for onboarding's activation drafts, `formats.cadence` drives the
     dashboard streak nudge, `voice_sample_transcript` seeds the activation
     drafts' raw input — just not read here.)
   - **No summarization/truncation of the DNA fields at generation time.**
     Truncation already happened once, at write time, inside
     `normalizeSections` (`lib/brand-dna-schema.ts`): `identity.*` capped at
     300 chars, `voice.description`/`audience.description`/`examples.*`
     capped at 4,000 chars each, list items at 200 chars/20 items. The
     generate route interpolates whatever GCS already holds verbatim — no
     further reformatting, no LLM summarization pass over the DNA itself.
7. **Observed Voice profile** — `loadVoiceProfile(workspace_id, persona_id)`
   → `observedVoiceBlock(...)` (`lib/voice-profile.ts`). Reads
   `workspaces/{ws}/personas/{persona}/voice_profile.json` from GCS (separate
   file from `brand_dna.json`). Only the `.active` snapshot is used (never
   `.proposed` — that's pending-review only, surfaced solely via `/dna`).
   Renders `style_observations` and `stances` as a soft-texture block if
   present; `''` otherwise. Degrades to `''` on any read failure — never
   fatal.
8. **Context resolution** — three Supabase reads against the `contexts`
   table, scoped to `persona_id`:
   - permanent contexts (`scope='permanent', status='active'`), split into
     `hardRules` (`tier='hard_rule'`) and `defaults` (everything else).
   - if `campaign_context_id` given: one row (`scope='campaign',
     status='active'`, matched to `workspace_id`). Non-UUID `campaign_context_id`
     is rejected with 400 rather than silently nulled (a malformed-uuid cast
     inside PostgREST would otherwise null the campaign out and the piece
     would be saved/RAG-ranked as standalone).
   - `one_time_context` comes straight from the request body — not stored
     anywhere queryable before this point.
   These four are concatenated (hard rules → defaults → campaign → one-time)
   into `contextSections`, each with its own explanatory header line (see
   the literal template in §1.4).
9. **RAG retrieval** — `loadApprovedExamples()` (line 65), skipped entirely
   when `generation_mode === 'one_time'`. Queries
   `content_pieces` where `workspace_id`, `persona_id`, `status='approved'`,
   `rag_excluded=false`, `generation_mode='standard'`, ordered by
   `approved_at desc`, limited to 20 rows, selecting only `body,
   original_body, format, approved_at`. This is a **direct Supabase read**,
   not Vertex AI Search — the write-only index is populated on approve (see
   §2) but nothing ever queries it back, because it's imported as
   unstructured content with no persona-filterable metadata.
   - **Ranking/transformation**: re-sorted client-side (stable sort) —
     same-`format` pieces first, then "gold" pieces (rows where
     `original_body != null && body !== original_body`, i.e. the user edited
     before approving) first within that, then the existing `approved_at
     desc` order for recency. Top 3 (`RAG_EXAMPLE_COUNT`) are kept.
   - **Transformation**: each kept example's `body` is trimmed and truncated
     to 1,200 chars (`RAG_EXAMPLE_MAX_CHARS`) with a trailing `…` if cut.
     This is the only place raw content gets truncated in the generate path
     (character-slice, not LLM-summarized).
10. **Rejection-retry corrective** (only present on a "Regenerate, fixing
    this" retry — see §3): `correction` and `rejected_draft` from the
    request are trimmed and, if both present, built into a REVISION block
    naming the rejected draft verbatim and instructing the model to fix only
    what's named. If only `correction` is present (no draft — shouldn't
    normally happen from this UI, but the route tolerates it), a shorter
    "fix this before anything else" block is used instead. Neither is
    persisted anywhere; it's per-request only.
11. **Good-samples block** — `readGoodSamples(dna.examples)` (up to 3,
    `lib/brand-dna-schema.ts`), rendered as one or more `--- Sample N ---`
    blocks.

### 1.3 Prompt assembly (line 336 onward)

`systemPrompt` and `userPrompt` are plain template-literal string
concatenation — no separate "build a prompt object" step, no LLM call
involved in assembling it.

**System prompt** (exact literal template, `${}` = interpolated value, blocks
that can be empty collapse to `''`):

```
You are a content writer for ${dna.identity.full_name}.

BRAND IDENTITY:
Role: ${dna.identity.role}
Industry: ${dna.identity.industry}
Core topics: ${dna.topics.join(', ')}                [only if dna.topics.length]

AUDIENCE:
${dna.audience.description}
Segments: ${dna.audience.segments.join(', ')}

VOICE:
${dna.voice.description}
Tones: ${dna.voice.tones.join(', ')}
Formality: ${dna.voice.formality}/5
Pace: ${dna.voice.pace}/5
${observedBlock}                                       [OBSERVED VOICE block, or '']
${goodBlock}                                            [GOOD EXAMPLE(S) block, or '']

AVOID THIS STYLE:
${dna.examples.bad}                                     [only if non-empty]

${ragBlock}                                             [PREVIOUSLY APPROVED WORK block, or '']
AVOID RULES (hard stops):
${dna.avoid.join('\n')}

${contextSections}                                      [STANDING RULES / PREFERENCES / CAMPAIGN / FOR THIS PIECE ONLY, or '']

<UNIVERSAL_QUALITY_GUARDRAILS — fixed 15-line constant, see below>

FORMAT: ${FORMAT_INSTRUCTIONS[format]}

TONE OVERRIDE FOR THIS PIECE: ${tone_override}          [only if provided]
${correctionBlock}                                      [rejection-retry block, or '']
Write content that sounds exactly like ${dna.identity.full_name}. Not like AI. Not like a template. Like them.
Output only the final content — no preamble, no labels, just the content itself.
```

`FORMAT_INSTRUCTIONS` per format (fixed constants, `route.ts:12`):
LinkedIn (≤1300 chars, ≤4 hashtags), Twitter/X (≤280 chars, no hashtags),
Newsletter (300-600 words), Blog (600-1000 words, H2s), Executive brief
(200-400 words, Context/Key Points/Recommendation).

`UNIVERSAL_QUALITY_GUARDRAILS` is a fixed constant (not DNA-dependent):
bans scene-setting openers, parallel-contrast construction ("it's not X,
it's Y" in any dress), dramatic-reveal colons, announced vulnerability,
corporate jargon (leverage/synergy/utilize/impactful/paramount/seamless/
cutting-edge/game-changer/unparalleled/delve/myriad/tapestry/"a testament
to"/"unlock the potential"/"harness the power"/"elevate your"), stock
metaphors, >1 dramatic colon, paired-dash asides, uniform paragraph shape,
overuse of three-item lists, passive voice, meta-commentary, and preamble.

**User prompt** — one of exactly three forms, mutually exclusive by `mode`:

```
Topic: ${topic}                                                    // mode='brief'
Transform this raw input into polished content in my voice:

${raw_input}                                                       // mode='raw'
Description: ${description}                                        // mode='describe'
```

Anything else (e.g. `mode='brief'` with no `topic`) → 400 "Invalid input
mode".

Sent to Vertex AI as `systemInstruction.parts[0].text` + a single
`contents[0]` user turn — no chat history, no few-shot turns; the RAG
exemplars and good-samples live *inside* the system prompt as text, not as
separate conversation turns.

### 1.4 Quota reservation (line 407)

`isActivation = activation === true && generations_used < 3` — the
client-sent `activation` flag is **not trusted alone**; it's re-derived
server-side from the live counter so it can't be replayed for free
generations after the first 3. If not activation, calls the
`increment_generation_count` RPC and awaits it (reserve-then-spend, not
spend-then-count) — a race across concurrent requests is closed by the RPC's
row-level atomicity, not by the pre-check. RPC transport failure fails open
(logs, proceeds) since the pre-check already passed.

### 1.5 Model call + streaming (line 439)

`vertexAI.getGenerativeModel({ model: 'gemini-2.5-flash' }).generateContentStream(...)`.
Chunks are piped straight to the client as raw UTF-8 text via a
`ReadableStream` (`Content-Type: text/plain`, `Transfer-Encoding: chunked`)
— no SSE framing, no JSON-per-chunk; the client just concatenates.

### 1.6 Post-stream voice check (line 457) — see §4 for the shared detail

Runs only after the full stream is collected into `body`. Non-fatal (wrapped
in try/catch; on any failure the raw streamed draft stands unchanged).

### 1.7 Persist + respond (line 484)

Inserts one `content_pieces` row: `body` and `original_body` are set to the
**same** value — `finalBody` (post-revision if revision ran, otherwise the
raw draft). This is deliberate (per the file's own comment and CLAUDE.md
convention): a machine revision must never look like a user edit, since
`original_body !== body` is exactly the "gold" signal RAG ranking and the
rulebook key off. `status='draft'`, `topic` falls back through
`topic || description || 'Untitled'`, `rag_excluded = (generation_mode ===
'one_time')`, and `resolved_context` is populated with the resolved
hard_rules/defaults/campaign/one_time/tone_override plus a `voice_check`
sub-object (ran/passed/revised/flags) — **written here for eval
instrumentation only; nothing in the app reads `resolved_context.voice_check`
back** (see §6 write-never-read list).

A final `\n__META__{...}` chunk is appended to the stream carrying
`content_piece_id`, the same `voice_check` object, and `revised_body` (only
present when a revision ran). The client parses this to populate
`contentPieceId`/`voiceCheck` state and — if `revised_body` exists — swaps
the rendered output for it.

---

## 2. Click "Approve"

### 2.1 UI — `handleApprove(confirmed=false)` (`page.tsx:332`)

- `saveEdit()` first (PATCHes `/api/draft` with the current textarea content
  if `isDirty`) — approve always operates on whatever is currently saved.
- `POST /api/approve` with `{content_piece_id, workspace_id, persona_id,
  confirmed}`.
- If the response has `requires_confirmation: true`, shows a "Quality issues
  found" modal listing `violations` and re-calls with `confirmed=true` only
  if the user clicks "Approve anyway" — the linter gate is a soft block, not
  a hard one.
- On success: sets `approved`, shows the active RAG count, and surfaces
  `rule_suggestion` / `voice_profile_proposed` if present (both from the
  response body).

### 2.2 `POST /api/approve` — `app/api/approve/route.ts` (line 23)

1. Auth, then ownership guards (workspace, then persona — persona projection
   includes `active_rag_count` here since it's needed downstream).
2. Loads the `content_pieces` row by id+workspace. Validates
   `piece.persona_id === persona_id` (cross-persona approval would corrupt
   the wrong persona's GCS path/RAG count/rulebook history) and that it
   isn't already approved.
3. **Final linter gate** — `runLinter(piece.body)` (the same deterministic
   regex pass from generation time, re-run because the body may have been
   hand-edited since). If violations exist and `confirmed` isn't true, 200s
   back `{requires_confirmation: true, violations}` without writing anything.
4. **Solo-tier RAG cap**: if solo and the piece counts toward RAG
   (`!rag_excluded && generation_mode==='standard'`) and
   `persona.active_rag_count >= 10`, the single oldest approved+active piece
   for this persona is found and flipped to `rag_excluded=true` (archived
   from the RAG pool, not deleted) to make room.
5. **GCS write + Vertex AI Search index** (only for standard, non-excluded
   pieces): writes the approved body as plain text to
   `workspaces/{ws}/personas/{persona}/approved_content/approved_{format}_{timestamp}.txt`,
   then calls `indexIntoVertexSearch()` — a `DocumentServiceClient.importDocuments`
   call against a hardcoded Discovery Engine datastore
   (`omni-content-agent-v2_1780394823768`). **This index is write-only** —
   confirmed no code path anywhere queries Discovery Engine back; §1.2 step 9
   is the actual retrieval path, straight from Supabase.
6. Updates the `content_pieces` row: `status='approved'`, `approved_at`,
   `quality_score` (3 if 0 violations, 2 if ≤2, else 1), `critique_passed`,
   `violations`. These four ARE read back — `app/(dashboard)/library/page.tsx`
   displays `quality_score`/`critique_passed`.
7. Bumps `personas.active_rag_count` (capped at 10).
8. **Diff→rulebook** (only if `body !== original_body`, i.e. the user
   actually edited before approving): loads the persona's last 10
   `content_edits.deltas` plus every existing rule content (active +
   suggested + closed, so a dismissed suggestion is never re-proposed), then
   `analyzeEdit()` (`lib/rulebook.ts`) — one `gemini-2.5-flash-lite` call
   that (a) categorizes this edit's deltas (max 4, from a fixed 8-value
   enum) and (b) proposes ONE standing rule if some category has now
   recurred 3+ times uncovered by an existing rule. The delta categorization
   is inserted into `content_edits`; a proposed rule is inserted into
   `contexts` with `status='suggested'` — **inert until a human accepts it**;
   generation (§1.2 step 8) only ever reads `status='active'`.
9. **Observed Voice distillation trigger** —
   `maybeDistillVoiceProfile()` (`lib/voice-profile.ts`): counts total
   approved pieces for the persona, compares against
   `last_distill_approved_count` in `voice_profile.json`; if the delta is
   ≥5 (`DISTILL_EVERY_APPROVALS`) AND there's no already-pending `proposed`
   snapshot, runs one `gemini-2.5-flash` call over the last 10 approved
   pieces (gold-weighted), last 10 edit-delta sets, and last 15 rejections,
   producing `style_observations`/`stances`/`evolution_notes`. Saved as
   `voice_profile.json.proposed` — **does not affect any generation until
   the user applies it** via `PATCH /api/voice-profile {action:'accept'}`
   from `/dna`, which is the only code path that ever sets `.active`.
10. Responds with `{success, quality_score, violations, critique_passed,
    rag_indexed, active_rag_count, archived_id, rule_suggestion,
    voice_profile_proposed}`.

---

## 3. Click "I don't like this one"

### 3.1 UI (`page.tsx:416` `submitReject`)

Opens a panel of fixed-enum reason chips (`REJECTION_REASONS`) + a free-text
note (max 1000 chars client-side via `maxLength`). Two buttons:
- **"Just send feedback"** → `submitReject(false)`.
- **"Regenerate, fixing this"** → `submitReject(true)`, which additionally
  snapshots `output` (the currently-displayed draft, including any unsaved
  edits — deliberately the in-memory text, not the DB row) as
  `draftUnderReview`, and builds `correction = buildRetryCorrection(reasons,
  note)` **before** calling `POST /api/feedback` (since that call clears
  state that the correction needs).

Both paths always `POST /api/feedback` first with `{content_piece_id,
workspace_id, persona_id, reasons, note}`. Only the "regenerate" path then
immediately calls `handleGenerate(correction, draftUnderReview)` — which
(§1.2 step 10) turns into a **targeted revision** of the rejected draft, not
a fresh roll.

### 3.2 `POST /api/feedback` — `app/api/feedback/route.ts` (line 56)

1. Auth, reason/note validation (`reasons` must be a subset of the fixed enum
   — any unrecognized value in a non-empty array is a 400, not a silent
   drop; `note` capped at 1,000 chars server-side too), ownership guards.
2. Loads the piece; must belong to the named persona and be `status='draft'`
   — already-approved pieces can't be rejected through this route.
3. **Archives it**: merges `{reasons, note, at}` into the existing
   `resolved_context.rejection` (no new column — this schema is untracked,
   per CLAUDE.md convention) and sets `status='archived'`. Archived status
   excludes the piece from every read path keyed on `status='approved'` —
   it never reaches RAG retrieval (§1.2 step 9 filters `status='approved'`)
   or the rulebook.
4. **Recurrence check**: loads the persona's last 15 archived pieces'
   `resolved_context.rejection`, counts each reason across them
   (`recurringReasons`), and — for the strongest recurring reason not
   already covered by any rule in any state (active/suggested/closed) —
   inserts a `status='suggested'` context row and returns it as
   `rule_suggestion` with a dynamic heading ("You've rejected N drafts for
   X — make it a standing rule?"). **⚠ FLAG (doc/code mismatch)**: the file
   header comment (`lib/rejection-feedback.ts:11-14`) describes this as
   "Recurrence auto-steer... returns a standing corrective **the generate
   route injects into EVERY future prompt** for that persona" via a function
   it calls `recurringCorrectives()`. Neither is accurate: the exported
   function is `recurringReasons`, and nothing is auto-injected — it only
   creates a `suggested` context row that requires an explicit user
   accept-click (`respondToRuleSuggestion(true)` → `PATCH /api/contexts`) to
   become `active` and thus actually reach a future prompt via §1.2 step 8.
   The mechanism is correct; the comment overstates it as automatic.
5. **Note→DNA distillation** (only if `note` is non-empty): re-fetches the
   live Brand DNA from GCS (best-effort, for dedup context) and the active
   standing rules, then `distillRejectionNote()` (`lib/dna-feedback.ts`) —
   one `gemini-2.5-flash-lite` call producing an optional `avoid_rule`
   (proposed for the Brand DNA avoid list) and/or `preference` (proposed as
   another `suggested` context row, same suggested→active/closed lifecycle
   as step 4). Neither writes anything automatically:
   - the `preference`, if any, is inserted as `status='suggested'`
     immediately (so it has an id the UI can PATCH).
   - the `avoid_rule`, if any, is returned as a **plain string, not
     persisted anywhere** — the client's `addAvoidRule()` does a
     GET→modify→PUT round-trip against `/api/brand-dna` itself on accept.
     If the user never clicks "Add to avoid list", the distilled rule simply
     evaporates — it was never written to any table or file.
6. Responds `{success, rule_suggestion, dna_suggestion}`.

---

## 4. Voice check (the two-layer critic)

This isn't a separate user action — it runs automatically after every
generation-time stream completes (`app/api/generate/route.ts:466`, inside
the `ReadableStream`'s `start()`, after the `for await` loop). Traced
separately here because it's asked for explicitly.

`lib/critic.ts`:

1. **`runLinter(body)`** — deterministic, free, synchronous. Iterates
   `AI_TELLS` (`lib/ai-tells.ts`, 27 entries as of this commit: opener
   clichés, 5 variants of the "parallel contrast" construction matched as
   regex on the *construction* not exact phrasing, paired-em-dash asides,
   corporate jargon, LLM vocabulary tells like "delve"/"myriad"/"tapestry",
   stock metaphors). Plain-phrase entries are auto-escaped into a literal
   regex; `isRegex: true` entries run as authored. Also flags >3 colons in
   the body and bodies <50 chars. Returns a `string[]` of human-readable
   violation messages (each with the matched text + the tell's `note`).
2. **`runLLMCritic(dna, userPrompt, body)`** — one `gemini-2.5-flash-lite`
   call. Prompt is a fixed template:
   ```
   You are a strict brand-voice critic. Judge the DRAFT against this
   founder's Brand DNA and the input they gave. Apply ONLY the three
   checks below...

   BRAND DNA:
   Voice: ${dna.voice.description}
   Tones: ${dna.voice.tones.join(', ')}
   Formality: ${dna.voice.formality}/5, Pace: ${dna.voice.pace}/5
   Avoid rules (hard stops):
   ${dna.avoid.map(a => `- ${a}`).join('\n')}
   Style they hate:
   ${dna.examples.bad}                          [only if non-empty]

   USER INPUT (the only source of facts):
   ${userInput}

   DRAFT:
   ${draft}

   CHECKS: 1. voice_issues (max 3)  2. ungrounded_claims (max 5)
   3. avoid_violations (max 5)

   Respond with ONLY this JSON...
   ```
   Note this is a **narrower slice of the DNA** than the generation prompt —
   no identity/audience/topics/good-samples/RAG/context sections, just
   voice + avoid + the bad-style example. Response is JSON-extracted
   (`extractJSON` finds the outermost `{...}`, tolerant of stray prose
   around it) and each array is filtered to strings and capped. Returns
   `null` (not throwing) on any parse/call failure — treated as "no
   critique available," never as "passed."
3. **Gate**: `hasIssues = linterFlags.length > 0 || (critique !== null &&
   !critique.passed)`.
4. **`reviseDraft()`** — only if `hasIssues`. ONE more `gemini-2.5-flash`
   call (hard stop — no loop, no re-critique of the revision). Prompt names
   every issue explicitly (linter flags verbatim, critic's voice/ungrounded/
   avoid issues each reframed with an instruction — e.g. "Ungrounded claim
   (remove or soften to opinion): ..."), and explicitly forbids trading the
   flagged construction for a differently-worded version of the same move.
   If the model's output is <50 chars, the revision is discarded (`null`)
   and the original draft stands — a collapsed revision is treated as worse
   than a flagged draft.
5. The generate route persists `finalBody` (revised if revision ran,
   original otherwise) as **both** `body` and `original_body` — see §1.7 for
   why that specific invariant matters.
6. On approve (§2.2 step 3), `runLinter` alone runs again — the LLM critic
   does **not** re-run at approve time, only the free deterministic pass,
   since the LLM pass already ran once at generation and re-running it on
   every edited-and-re-checked approval would double the per-approval LLM
   cost for marginal benefit.

---

## 5. Generate a comment

### 5.1 UI — `app/(dashboard)/comments/page.tsx`

Separate page/flow from post generation — no shared component with
`/generate`. User pastes `postText`, picks one `goal` chip (from
`COMMENT_GOALS`, `lib/comment-goals.ts`: insight / experience / question /
disagree / support), optional `angle` free text (≤500 chars, client-enforced
via `maxLength`). `POST /api/comment` with `{workspace_id, persona_id,
post_text, goal, angle}`. Response is `{options: [{text, flags}, ...]}` (up
to 3) — rendered as three cards with independent copy buttons and inline
flag warnings; **nothing is auto-selected or persisted** — the whole
interaction is stateless past the response.

### 5.2 `POST /api/comment` — `app/api/comment/route.ts` (line 48)

1. Auth, field validation (`goal` must be one of the fixed
   `COMMENT_GOAL_VALUES`), length caps (`comment_post`: 6,000 chars,
   `comment_angle`: 500), ownership guards.
2. **Quota**: same pre-check + atomic `increment_generation_count` RPC as
   `/api/generate` — **counts as a full generation**, and unlike
   activation-draft generations there is no exemption path here at all.
3. **Brand DNA fetch** — same GCS path, same direct read as §1.2 step 6.
   404 "Brand DNA not found" if missing.
4. **Observed Voice** — `loadVoiceProfile()`, but only `.active.stances` and
   `.active.style_observations` are used (rendered as `stancesBlock` /
   `styleBlock`); this is explicitly called out in the file's own comment as
   "the first consumer of... `stances`" — a comment is framed as "mostly
   take," so stances get more weight here than in long-form generation.
5. **Standing rules** — one Supabase read of `contexts` (`scope='permanent',
   status='active'`), rendered as a flat bullet list. **No hard-rule/default
   tier distinction here** (unlike §1.2 step 8, which separates
   `STANDING RULES — NON-NEGOTIABLE` from `STANDING PREFERENCES`) — comment
   generation treats every active permanent context the same, as one
   `STANDING RULES` block. **No campaign context, no one-time context** —
   those concepts don't exist for comments at all.
6. **Prompt** (exact literal template):
   ```
   You write LinkedIn comments for ${dna.identity.full_name}
   (${dna.identity.role}, ${dna.identity.industry}). They just read the post
   below and want to comment. Write 3 DIFFERENT comment options in their voice.

   THEIR VOICE:
   ${dna.voice.description}
   Tones: ${dna.voice.tones.join(', ')}
   Formality: ${dna.voice.formality}/5, Pace: ${dna.voice.pace}/5
   ${stancesBlock}${styleBlock}

   AVOID RULES (hard stops):
   ${dna.avoid.map(a => `- ${a}`).join('\n')}
   ${rulesBlock}

   THE POST THEY'RE COMMENTING ON:
   """
   ${post_text.trim()}
   """

   WHY THEY'RE COMMENTING: ${goalDef.instruction}
   THEIR ANGLE (work this in): ${angle.trim()}          [only if provided]

   COMMENT RULES — non-negotiable:
   - 1 to 4 sentences...
   [fixed list — reference something specific, add something new, never
   summarize, no empty praise, no "As a [role]", no sycophancy/self-promo/
   links, 3 genuinely different angles, sound like a person not an essayist]

   Respond with ONLY this JSON, no prose:
   {"comments": ["...", "...", "..."]}
   ```
   Single `gemini-2.5-flash` call, non-streaming (`generateContent`, not
   `generateContentStream` — comments return all at once, no token-by-token
   UI).
7. Response JSON-extracted, filtered to non-empty strings, capped at 3.
   Empty result → 502 "Comment generation failed."
8. **Linting, not critiquing**: `runLinter()` runs over each of the 3
   options (same universal AI-tells pass as posts) — but the <50-char
   minimum-length check is explicitly filtered out of the results
   (`.filter(f => !f.startsWith('Content too short'))`), since short is
   correct for a comment. **No `runLLMCritic` call for comments at all** —
   only the free deterministic linter, no voice-drift/ungrounded-claim/
   avoid-rule LLM pass, and consequently **no revise pass either**. A
   comment that fails the linter is still returned to the user with
   `flags` populated; nothing auto-corrects it the way generation does.
9. **Nothing is persisted.** No `content_pieces` row, no GCS write, no RAG
   index, no `content_edits`, no quota-adjacent side effect beyond the
   quota RPC itself. This is deliberate per the route's own header comment
   (comments must never become long-form RAG exemplars — wrong register) —
   but it also means a comment can never become a "gold" edit signal, never
   feeds the rulebook, and there is currently no way to give comment-level
   feedback (no reject/approve equivalent for comments).

---

## 6. Data written but never read back (grep-verified against the whole repo)

- **`content_pieces.resolved_context.activation_feedback`** — written by
  `app/api/activation-feedback/route.ts` (the 👍/👎 "Sound like you?" on
  onboarding's activation drafts). The only other reference to
  `activation_feedback` in the entire repo is the CLAUDE.md paragraph
  describing it as a metric to be queried manually via SQL
  (`resolved_context->'activation_feedback'->>'sounds_like_me'`) — "no
  aggregation dashboard yet." No app code reads it back.
- **`content_pieces.resolved_context.voice_check`** — written by every
  generation (§1.7) for eval instrumentation. No app route or page queries
  it; it exists to be pulled by hand / by `scripts/eval-golden-set.ts`-style
  tooling, per CLAUDE.md item 12 ("queryable per piece from day one"). Not a
  bug — explicitly built as analytics-only — but worth knowing it's inert at
  runtime.
- **Vertex AI Search / Discovery Engine index** (`indexIntoVertexSearch`,
  §2.2 step 5) — every approved standard piece is imported into a Discovery
  Engine datastore. Confirmed by grep: nothing in the repo ever calls a
  search/query method against that datastore. Entirely write-only, as
  CLAUDE.md already documents; §1.2 step 9 is doing the real retrieval job
  via a direct Supabase query instead.
- **`OnboardingData.formats.{preferred,cadence}` and
  `voice_sample_transcript`, as inputs to the *generation* prompt
  specifically** — not globally unread (see §1.2 step 6 caveat above for
  where each IS actually consumed), but worth restating here since it's easy
  to assume "it's in Brand DNA, so generation must use it."
- **`content_pieces.archived_id`** in the `/api/approve` response
  (§2.2 step 10, the id of the piece bumped out of the RAG pool when the
  solo cap is hit) — returned to the client but the generate page never
  reads `data.archived_id` from the approve response (only
  `active_rag_count`, `rule_suggestion`, `voice_profile_proposed` are
  consumed in `handleApprove`). Minor — informational field with no
  consumer yet.

---

## 7. Summary of flags

| # | Location | What's off |
|---|----------|------------|
| 1 | `app/(dashboard)/generate/page.tsx:285` | Fetches `GET /api/content`, a route that does not exist anywhere in the repo. 404s silently on every generation; harmless (result unused) but dead weight on the hot path. |
| 2 | `lib/rejection-feedback.ts:11-14` (header comment) | Describes recurrence detection as auto-injecting a "standing corrective" into every future prompt via a function named `recurringCorrectives()`. The real function is `recurringReasons`, and the mechanism requires an explicit user accept-click before it ever reaches a prompt (via the `contexts` table's suggested→active flow). Comment overstates automaticity. |
| 3 | `app/api/approve/route.ts` step 8/9 | Both the diff→rulebook LLM call and the Observed Voice distillation trigger fire synchronously inside the approve request (awaited, not fire-and-forget), so approve latency includes up to two extra LLM calls when their conditions are met (edited-before-approve; every-5th-approval). Not incorrect, but worth knowing approve is not a fixed-latency operation. |
| 4 | `app/api/comment/route.ts` | No LLM critic pass and no revise pass for comments — only the deterministic linter, and even that has the length check stripped out. A comment can go out with a flagged AI-tell and nothing auto-fixes it, unlike posts. Consistent with the "comments are v1/stateless" framing in the file's own comment, just worth being explicit that voice-check parity with posts does not exist here. |
