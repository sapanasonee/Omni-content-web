import { createClient as createServiceRoleClient } from '@supabase/supabase-js'

// ─── Founder admin gate ──────────────────────────────────────────────────────
//
// Why this is NOT a self-serve upgrade flow: plan_tier grants entitlements
// (brand voices today, generation limits once the quota rework lands) and
// there is no billing anywhere in this system. A user-facing "upgrade" button
// would therefore just hand out Studio for free. Until Stripe/Lemon exists,
// changing a tier is an ADMIN action performed by the founder on behalf of an
// account — a manual grant, which is exactly what early access is.
//
// Two independent conditions must BOTH hold for any admin action:
//
//   1. The caller is authenticated and their email is in FOUNDER_EMAILS.
//   2. SUPABASE_SERVICE_ROLE_KEY is configured.
//
// (2) is required because granting a tier writes to ANOTHER user's workspace
// row, which RLS correctly forbids for a normal session. That makes the
// service-role client the sharpest tool in this codebase: it bypasses RLS
// entirely, so it must never be constructed before (1) has passed, and must
// never be reachable from a route that takes its identity from client input.
// Every caller here follows that order.
//
// The gate keys on EMAIL rather than a user id because the founder's account
// can be recreated (this app is magic-link only, and the auth user is
// disposable), and because it must be configurable without a code change when
// a teammate needs access.
// ─────────────────────────────────────────────────────────────────────────────

// Comma-separated allowlist. Defaults mirror the convention already used by
// lib/founder-alert.ts (which hardcodes the founder's inbox as NOTIFY_TO's
// default): both known founder addresses are included so this works on the
// current deployment without a new env var. Set FOUNDER_EMAILS in Cloud Run to
// override — narrowing it there is strictly safer than editing this default.
const DEFAULT_FOUNDER_EMAILS = 'sonisapna45@gmail.com,spnsn9@gmail.com'

export function founderEmails(): string[] {
  return (process.env.FOUNDER_EMAILS || DEFAULT_FOUNDER_EMAILS)
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

// Exact, case-insensitive match. Deliberately NOT a domain or prefix match:
// this allowlist is an authorization boundary, and "endsWith('@vowwl.com')"
// style checks are the classic way those become forgeable.
export function isFounderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return founderEmails().includes(email.trim().toLowerCase())
}

export function hasServiceRole(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// Build a service-role Supabase client. ONLY call after isFounderEmail() has
// passed for the authenticated caller.
//
// Returns null rather than throwing when the key is absent so routes can
// answer with an actionable "not configured" message instead of a 500 —
// SUPABASE_SERVICE_ROLE_KEY is documented in the README but has never actually
// been used by any code, so it may well be unset in Cloud Run.
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createServiceRoleClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    // No session persistence or auto-refresh: this client is constructed
    // per-request on the server and must never inherit or write session state.
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
