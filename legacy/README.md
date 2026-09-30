# Legacy: the old Vowwl voice/content product (parked, not served)

vowwl.com was repurposed on 2026-09-30 for the proof-capture service. The
previous product (AI voice/content tool, purple brand) was moved here intact
so nothing is lost. Next.js only routes files under `/app`, so nothing in this
folder is reachable, and `tsconfig.json` excludes `legacy/` from the build.

- `voice-product-app/` — the entire old `app/` directory, unchanged: marketing
  home, `/pricing`, `/login`, `/onboarding`, `/dashboard`, `/generate`,
  `/library`, `/comments`, `/dna`, `/auth/callback`, and all `/api/*` routes.
- `voice-product-middleware.ts` — the old root `middleware.ts` (Supabase
  session refresh).

The shared code those pages import (`components/`, `lib/`, `supabase/`,
`scripts/`, `eval/`) was left in place at the repo root, so restoring is a move,
not a rewrite.

## How to restore the old product

1. `git mv app app-proof-site` (park the new one-page site).
2. `git mv legacy/voice-product-app app`
3. `git mv legacy/voice-product-middleware.ts middleware.ts`
4. Remove `"legacy"` from `exclude` in `tsconfig.json`.
5. `npm run build`, then redeploy.

The last commit where the old product was live is also on the
`hardening-pass` branch history (before the "Repurpose vowwl.com" commit).
