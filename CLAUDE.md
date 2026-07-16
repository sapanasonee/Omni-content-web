# Vowwl (was "Omni Content Agent") — Project State

Read this before touching anything. It's the handoff from a long working
session — what the product actually is, what's built, what's deployed, and
what's next. Update it as things change; don't let it go stale.

## What this is

Vowwl (domain: vowwl.com) helps founders/creators write LinkedIn posts, tweets,
newsletters etc. that sound like *them*, not AI. Wedge: "Sound like you, not a
robot." Voice learned from a spoken onboarding intro, from writing samples, and
— critically — from what users edit before approving.

Originally built as **"Omni Content Agent"** for the Google for Startups AI
Challenge (June 2026). A sibling repo, `omni-content-agent`, is an ADK
multi-agent backend built specifically to satisfy the hackathon's ADK/Agent
Engine judging requirement. **It is not used in production and never has
been** — `NEXT_PUBLIC_ADK_URL` is defined but nothing ever fetches it. Don't
resurrect it without a deliberate reason; the real system is the one below.

## The real architecture

A single Next.js 14 (App Router) app. No separate backend service.

- **Auth + relational data**: Supabase Postgres (`workspaces`, `personas`,
  `content_pieces`, `contexts`, `content_edits`, `trending_cache`). Magic-link
  auth via `@supabase/ssr`.
- **Brand DNA (the authoritative profile)**: JSON file in GCS at
  `workspaces/{workspace_id}/personas/{persona_id}/brand_dna.json`. This is
  what generation, the critic, and topics all read — **not** any Supabase
  column. (`personas.brand_dna` exists in the schema but nothing writes it —
  dead column, ignore it.)
- **LLM**: Gemini via `@google-cloud/vertexai`, called directly from Next.js
  API routes. `gemini-2.5-flash` for generation/revision, `gemini-2.5-flash-lite`
  for the cheap critic/rulebook passes.
- **RAG**: retrieval reads the persona's own approved `content_pieces` rows
  directly from Supabase (NOT Vertex AI Search — see below for why).
- **Vertex AI Search / Discovery Engine**: write-only. Approved pieces get
  indexed there but nothing reads it back. It's imported as unstructured
  `content` with no persona-filterable metadata, so it can't safely be queried
  per-tenant without a re-index migration. Don't wire retrieval to it until
  that's fixed — Supabase is doing the real RAG job today.

## Branch state — IMPORTANT

**`hardening-pass` is the active branch. All work described below lives
there.** `master` is the stale pre-hackathon-cleanup state.
`claude/generation-architecture-summary-tx7jwt` was an earlier sibling branch,
fully superseded and should be treated as dead (delete it if it still exists).

Always `git checkout hardening-pass` and `git pull` before starting work.

## What's built this session (chronological, all on hardening-pass)

1. **RAG read path** (`app/api/generate/route.ts` — `loadApprovedExamples`):
   retrieves the persona's active approved pieces (`status=approved,
   rag_excluded=false, generation_mode=standard`), ranks same-format first,
   then "gold" (edited-before-approval pieces — strongest voice signal), then
   recency. Injects up to 3 as fenced exemplars in the system prompt. Skipped
   for `generation_mode='one_time'`.
2. **Trending topics** (`app/api/topics/route.ts`, `lib/types.ts`
   `TrendingTopic`): one Gemini call with Google Search grounding
   (`{ googleSearch: {} }` tool — note the installed `@google-cloud/vertexai`
   v1.12 SDK only *types* the legacy `googleSearchRetrieval` tool; the 2.x
   `googleSearch` tool is passed via an `as unknown as Tool` cast and works at
   the REST layer). Scoped by the persona's industry/audience/topics. Cached
   24h per persona in `trending_cache` (best-effort; cache failures degrade to
   a live call, never break the feature). UI: empty state on Generate page
   ("Show me what's trending") → 5 cards → "Write on this" prefills the brief.
3. **Brand DNA `topics` field**: added to `OnboardingData` (optional, for
   backward compat with pre-existing `brand_dna.json` files). Captured in
   onboarding step 2, fed into both the generate and topics prompts.
4. **`/dna` page unified with reality**: previously read the dead
   `personas.brand_dna` Supabase column (always null). `GET /api/brand-dna`
   now reads the real GCS file; a new `PUT` writes edits back (normalizes
   input server-side — don't trust client shape, this file gets interpolated
   into prompts). Page has full edit mode for every DNA section including
   topics. This is the editing surface — there is no other one.
5. **LLM critic** (`lib/critic.ts`): two-layer quality gate.
   - `runLinter` — deterministic regex, patterns live in `lib/ai-tells.ts`
     (see below), for universal AI-tells. Free, instant.
   - `runLLMCritic` — one Flash-Lite call judging the draft against the
     *live* Brand DNA: voice drift, ungrounded claims (not traceable to user
     input), avoid-rule violations. Adaptive by construction — edit the DNA,
     the critic enforces the new version next generation.
   - `reviseDraft` — ONE Flash revise call if either layer flags issues. Hard
     stop, no loops. Saves the *corrected* text as both `body` and
     `original_body` (so a machine revision is never mistaken for a user
     edit — keeps the gold-signal clean).
   Wired into `generate/route.ts` post-stream. Approve route keeps `runLinter`
   as a final gate (user could've edited after the generation-time check).
   UI: pass/fixed/flagged banner on the generate page.
6. **`lib/ai-tells.ts`**: the editable pattern library `runLinter` reads.
   Plain phrases work with no regex (auto-escaped); `isRegex: true` opts into
   real patterns. Each entry has a `note` shown to the user. **This is where
   the user's own 6-years-of-content-review patterns should go** — offered,
   not yet delivered as of last session end. Only add *universal* tells here
   (wrong for everyone); personal taste belongs in a user's avoid-list or
   standing rules, enforced by the critic instead.
7. **Voice-first onboarding**: intro screen before the wizard. Records via
   `MediaRecorder`, sends to `app/api/voice-extract/route.ts`, which feeds
   audio directly to Gemini (no separate STT vendor) and extracts structured
   profile fields (role, industry, audience, voice description, tones,
   topics) + a transcript. Non-empty fields prefill the wizard; user reviews
   each step (voice seeds, manual confirms — never voice-only, because sliders
   and chip-pickers don't work spoken). "I'd rather type" escapes anywhere.
   **English-only guardrail**: extraction also returns a detected `language`;
   non-`en` gets rejected with a friendly re-record/type message (mostly-English
   with occasional foreign words still counts as English — don't lock out
   lightly code-mixed speakers). The transcript is stored as
   `sections.voice_sample_transcript` in Brand DNA — profile material and
   activation-draft input, **deliberately never a writing exemplar** (spoken
   register ≠ written register; don't ever feed it to RAG retrieval).
8. **Activation moment** (end of `app/onboarding/page.tsx`,
   `ActivationDrafts` component): if a voice transcript exists, finishing
   onboarding fires 3 parallel generations (top 3 preferred platforms,
   transcript as `raw` input) instead of redirecting to the dashboard. Streams
   into 3 cards with per-card Approve. Passes `activation: true`, which the
   generate route uses to skip the usage-counter increment — but only while
   `workspace.generations_used < 3` server-side, so the flag can't be replayed
   later. No-transcript users land on `/generate` where trending topics catch
   them instead.
9. **Diff→rulebook** (`lib/rulebook.ts`, `content_edits` table): when an
   approved piece was edited (`body != original_body`), one Flash-Lite call
   does two things: categorizes the delta (`phrase_killed`, `shortened`,
   `opener_changed`, `claim_softened`, `detail_added`, `tone_shifted`,
   `restructured`, `other` — patterns are matched on **structure/behavior
   across different topics, never on topic content**, e.g. "always converts
   to bullets" or "always opens with a specific pain" regardless of subject)
   and checks the persona's last 10 edits + existing rules for a preference
   that's now appeared 3+ times uncovered. If so, proposes a rule. Suggestions
   land in `contexts` with `status='suggested'` (generation only reads
   `status='active'`, so nothing changes until accepted). UI: one-tap "Make it
   a rule" / "No thanks" card on the generate page after approve. Dismissed
   suggestions (`status='closed'`) are fed back to the analyzer so they're
   never re-proposed. Cost: ~$0.0005 per edited approval only, non-edited
   approvals cost nothing extra.
10. **Publish nudge + streak** (`lib/streak.ts`, dashboard page): weekly streak
    (consecutive 7-day windows with ≥1 approval, current week gets grace) and
    a cadence-aware nudge — threshold derived from the cadence the user picked
    in onboarding (`CADENCE_THRESHOLD_DAYS` map). Approval is the v1 publish
    proxy (no real publish-tracking exists — that needs a "mark as posted"
    toggle or a platform integration, neither built). Dashboard is a server
    component; streak/nudge computed server-side, no new API route.
11. **Vowwl rebrand**: `app/page.tsx` rewritten as a real marketing home page
    (hero, how-it-works, feature grid, CTAs). Brand strings updated in login,
    sidebar, `/dna`, voice-extract error copy, `layout.tsx` metadata. Primary
    CTA is self-serve "Start free"; secondary is a `mailto:` "Book time with
    me" walkthrough link (swap for a real scheduling link when one exists).
12. **Eval instrumentation**: each generation's `voice_check` outcome
    (ran/passed/revised + all flags) is persisted into
    `content_pieces.resolved_context` — queryable per piece from day one.

## Built in the follow-up session (branch `claude/main-branch-hardening-pass-c48bif`)

13. **Security hardening**: shared ownership guards (`lib/auth-guard.ts`) on
    every route, length caps on all prompt-bound inputs (`lib/input-limits.ts`),
    atomic quota reservation, signup email-domain policy
    (`lib/signup-policy.ts`), Brand DNA normalization on the primary write path.
14. **Multi-sample onboarding**: "paste your best content" → up to 3 samples
    ("created or admire"), stored as `examples.good_samples[]` with legacy
    single-string fallback via `readGoodSamples` (`lib/brand-dna-schema.ts`).
15. **Rejection feedback** ("I don't like this one", `/api/feedback`,
    `lib/rejection-feedback.ts`): archives the draft (never reaches RAG),
    records structured reasons + free-text note into
    `resolved_context.rejection`. Three consumers, ALL confirm-first:
    (a) "Regenerate, fixing this" — one-shot corrective steers an immediate
    retry (the only place the raw note reaches a prompt); (b) a reason
    recurring 3×/15 drafts → "make it a standing rule?" card (same
    suggested→active/closed contexts flow as the edit-rulebook); (c) the note
    is distilled by Flash-Lite (`lib/dna-feedback.ts`) into a proposed DNA
    avoid-list entry and/or standing preference. Positives deliberately never
    go into `examples.good` — samples stay 100% real user writing.
16. **Golden-set eval**: see Known gaps section — `npm run eval`.

Next planned (agreed with user): **Observed Voice profile** — a
`voice_profile.json` beside `brand_dna.json`, periodically distilled from
approved pieces (gold-weighted) + edit deltas + rejections into descriptive
style observations, stances/takes, and evolution notes. Confirm-before-apply
("Your voice has evolved" review card), injected as soft texture (never rules),
and designed as the shared voice source for the future comment-generation
feature. Declared DNA stays authoritative; observed supplements beside it.

## Schema / migrations

Two migration files exist under `supabase/migrations/` — **written this
session, not auto-applied**. Run them manually in the Supabase SQL Editor:

- `20260712_trending_cache.sql` — creates `trending_cache` + RLS policies.
  **User already created a same-named table manually with different columns
  and hand-fixed it to match** (`workspace_id, persona_id, topics jsonb,
  generated_at`) — but likely never ran the RLS-policy portion of this file.
  Re-running it is safe (`create table if not exists` no-ops on the table;
  the policy statements just add what's missing) and closes a tenant-isolation
  gap. Verify column names match exactly if trending topics ever silently stop
  caching.
- `20260713_content_edits.sql` — creates `content_edits` (required for the
  rulebook feature to work at all — **confirm this has actually been run**
  before relying on rule suggestions in production).

No CHECK constraint exists on `contexts.status` (confirmed via screenshot) —
`'suggested'` inserts fine as-is, no ALTER needed. If one is ever added, it
must include `'suggested'` alongside `'active'`/`'closed'`.

**No other schema is tracked as SQL anywhere.** `contexts`, `original_body`,
`campaign_context_id`, `one_time_context`, `resolved_context`,
`active_rag_count`, the `increment_generation_count` RPC — all live only in
the actual Supabase instance. If you're debugging a "column does not exist"
error, check the live schema before assuming the code is wrong.

## Deployment

- Source of truth: `hardening-pass` branch, deployed via
  `gcloud run deploy omni-content-web --source . --region us-central1`.
- Custom domain: vowwl.com → Cloud Run direct domain mapping (done). DNS
  managed at Hostinger; Hostinger web hosting itself is unused/irrelevant now
  (an old placeholder `index.html` sitting there is harmless — DNS no longer
  routes to it).
- **Supabase Auth → URL Configuration must include `https://vowwl.com`** in
  Site URL + redirect allowlist, or magic links break. Verify this was done.
- No billing/Stripe integration exists anywhere. `plan_tier` is a column with
  no enforcement beyond the solo-tier generation cap. Don't imply paid-plan
  differentiation in marketing copy until this is real.

## Known gaps / deliberately deferred

- **Vertex AI Search retrieval**: write-only, not read. Would need a re-index
  with structured/filterable metadata before it's safe to query per-tenant.
  Not urgent — Supabase retrieval is doing the job.
- **AI-tells pattern library** (`lib/ai-tells.ts`): user has 6+ years of
  content-review experience and offered to contribute a real pattern list.
  Not yet collected/added. Ask for it; convert to entries (plain phrases,
  `isRegex` only when needed).
- **Real publish-tracking**: nudge/streak use approval as a proxy. A "mark as
  posted" toggle would make it real and would also unlock the eval metric
  "% approved + posted within 48h" (see below).
- **Activation-draft feedback loop**: no 👍/👎 "does this sound like you?" on
  the 3 activation drafts yet. This is the direct measurement for "% who hit
  'sounds like me' on draft #1" — the metric the original build plan called
  out as *the* validation signal before adding more breadth. Small build,
  high value — do this before anything else evals-related.
- **Golden-set eval script** — DONE (`npm run eval`). `scripts/eval-golden-set.ts`
  runs 30 must-flag + 30 must-pass samples (`eval/golden-set/*.json`) against
  `runLinter`; strict, free, CI-able (exit 1 on any miss). Must-flag samples
  declare which tell id must fire, so a sample can't silently rot by flagging
  for the wrong reason. `npm run eval -- --critic` additionally runs 8 curated
  `runLLMCritic` cases against a fixture DNA (live Gemini, ~$0.0005/case,
  80%-accuracy threshold because LLM output varies). **Run it after every edit
  to `lib/ai-tells.ts` or the critic prompt.** The must-pass set is synthetic
  seed data — replace/augment with the user's real posts over time (that's the
  real wedge protection), and add a must-flag entry for every new tell.
- **Early-access / "first 10 founders" offer**: no enforced cap exists (no
  billing, no waitlist counter). Either commit to something crediblly scarce
  without needing billing (founding-member status, locked-in pricing later)
  or build a trivial signup counter — decide before publicizing the offer.
- **Two Brand DNA copies historically existed** — resolved (see #4 above) but
  if any other page/route is ever found reading `personas.brand_dna` directly,
  that's a regression, fix it to use `/api/brand-dna`.

## Working conventions established this session

- Deterministic/regex logic (linter) vs. LLM judgment (critic) is a
  deliberate split — universal rules in code (free, instant, never needs to
  adapt because it's the same for everyone), personal/brand-specific rules
  enforced by the critic reading live Brand DNA (adaptive, costs a cheap
  model call). Don't blur this line by adding user-specific regex or by
  making the critic re-check universal AI-tells the linter already covers.
- Every LLM call in a request path is wrapped to be **non-fatal** — critic,
  rulebook, topics-cache, revise — failures log and degrade gracefully, never
  break the user-facing flow. Keep this pattern for any new LLM-backed
  feature.
- Ownership checks follow a consistent two-query pattern (workspace by id,
  then persona filtered by `workspace_id`) rather than a joined query, to
  avoid PostgREST relationship ambiguity now that multiple FK paths exist.
- Machine revisions are saved as both `body` and `original_body` — never let
  an automated fix look like a user edit, since that signal feeds both RAG
  ranking (gold pieces) and the rulebook (which only analyzes genuine edits).
