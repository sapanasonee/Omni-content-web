// ─── Signup email policy ─────────────────────────────────────────────────────
//
// Why this exists: the early-access "start free" offer is meant for founders
// and operators, and the observed abuse pattern is drive-by signups from
// disposable/burner inboxes — zero-intent accounts that burn Gemini spend
// (voice extraction, activation drafts, generations) and pollute metrics.
// Policy: work/custom domains and the major personal providers (Gmail etc.)
// are welcome; throwaway-mail domains are not.
//
// Design decisions, deliberately:
//
// 1. BLOCKLIST of disposable providers, not an allowlist of "approved"
//    domains. A founder's work domain can be literally anything, so an
//    allowlist would mostly reject the exact people the product is for. The
//    personal-provider list below therefore documents intent (these are
//    explicitly fine) rather than gating; unknown custom domains are treated
//    as work domains and allowed. If low-intent signups shift to cheap custom
//    domains later, tighten HERE — one file, both enforcement points inherit.
//
// 2. EXISTING ACCOUNTS ARE NEVER GATED. All accounts created before the
//    cutoff below are grandfathered unconditionally (they're the owner's
//    personal testing accounts, some on domains this policy might not love).
//    The exemption keys on auth-account creation time — a server-controlled
//    Supabase value the client can't forge — rather than an email allowlist
//    that would need maintaining and could miss one.
//
// 3. Enforcement lives SERVER-SIDE at the two endpoints where a
//    workspace-less user can first spend money or create durable state:
//    /api/onboarding (workspace + activation drafts) and /api/voice-extract
//    (Gemini audio call). Magic-link auth itself is not blocked: Supabase
//    creates the auth user client-side via signInWithOtp, and stopping THAT
//    would require a dashboard-configured Auth Hook outside this repo. A
//    stray auth user with no workspace costs nothing and can do nothing —
//    every spend path is behind these gates. The login page deliberately
//    does NOT check the policy: login and signup share one magic-link form,
//    and the client can't know an account's creation date before sign-in —
//    a domain check there would also lock out grandfathered pre-policy
//    accounts, violating decision 2. A disallowed new signup instead gets an
//    inert auth session and sees the policy message (the `reason` string
//    below) the moment it tries to onboard or record.
//
// This module must stay framework-free (no next/server imports) so it can be
// shared with client components if a UI surface ever needs to EXPLAIN the
// policy (as opposed to enforcing it).
// ─────────────────────────────────────────────────────────────────────────────

// Accounts created before this instant are exempt from the domain policy.
// Set a few days past when the policy was written (2026-07-15) so the
// branch-review window is covered: every pre-existing testing account AND
// any account created while exercising this branch before merge stays
// safely grandfathered. If deployment slips past this date, move the cutoff
// forward BEFORE deploying — a gated "existing" account is a policy bug,
// the failure mode we must never have. (The flip side: until this date,
// disposable-domain signups are also exempt, so don't publicize the offer
// before the cutoff has passed or been tightened.)
export const SIGNUP_POLICY_CUTOFF = '2026-07-20T00:00:00Z'

// Major personal providers, explicitly welcome ("standard personal emails,
// like official Gmail IDs"). Kept as data (not logic) so product can review
// the list without reading code.
const PERSONAL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'aol.com', 'hey.com', 'fastmail.com', 'zoho.com', 'gmx.com',
])

// Disposable/burner-mail providers — the actual low-intent signup vector.
// Deliberately the common offenders rather than an exhaustive mirror of some
// 10k-domain list: each entry here is cheap, and the long tail can be added
// the day it shows up in signups. Extend freely; every entry must be a
// full domain, lowercase.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'sharklasers.com',
  '10minutemail.com', 'yopmail.com', 'temp-mail.org', 'tempmail.com',
  'throwawaymail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
  'trashmail.com', 'fakeinbox.com', 'mintemail.com', 'mytemp.email',
  'tempinbox.com', 'mail.tm', 'moakt.com', 'emailondeck.com',
  'burnermail.io', 'mailnesia.com', 'spamgourmet.com', 'mohmal.com',
])

export interface SignupEmailVerdict {
  allowed: boolean
  // Which bucket the domain fell into. Both 'personal' and 'work' are
  // allowed today; the distinction is carried so a future tightening (or
  // signup analytics) can branch on it without re-deriving domain class.
  kind?: 'personal' | 'work'
  // Human-readable, safe to show the user directly.
  reason?: string
}

export function evaluateSignupEmail(email: string): SignupEmailVerdict {
  const normalized = (email || '').trim().toLowerCase()
  const at = normalized.lastIndexOf('@')
  // No parseable domain → reject. Supabase would reject the address anyway;
  // this just keeps the verdict total so callers never branch on undefined.
  if (at === -1 || at === normalized.length - 1) {
    return { allowed: false, reason: 'Please use a valid email address.' }
  }

  const domain = normalized.slice(at + 1)

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      allowed: false,
      reason:
        'Vowwl early access is for founders and operators — please sign up with your work email or a personal address like Gmail, not a temporary inbox.',
    }
  }

  // Personal providers and unknown (presumed work/custom) domains both pass;
  // the verdict records which case matched so callers never have to.
  return { allowed: true, kind: PERSONAL_PROVIDERS.has(domain) ? 'personal' : 'work' }
}

// True when the account predates the policy and must bypass it entirely.
// `created_at` comes from Supabase's auth user record (server-issued, not
// client input). Fail-safe direction: if created_at is missing or unparseable
// we treat the account as EXEMPT — the cost of accidentally waving through an
// odd account is one signup; the cost of gating a legitimate existing user is
// locking a paying-intent human out of their own data.
export function isExemptExistingAccount(created_at: string | undefined): boolean {
  if (!created_at) return true
  const created = Date.parse(created_at)
  if (Number.isNaN(created)) return true
  return created < Date.parse(SIGNUP_POLICY_CUTOFF)
}
