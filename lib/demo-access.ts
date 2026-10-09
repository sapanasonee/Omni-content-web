// ─── Invite-only demo access ─────────────────────────────────────────────────
//
// This branch runs the retired voice/content product as a private demo
// (vowwl.com itself now serves a different one-page site). Only people the
// owner explicitly invites may use it.
//
// The invite list is the DEMO_ALLOWED_EMAILS environment variable on the
// Cloud Run service: a comma-separated list of email addresses, e.g.
//   DEMO_ALLOWED_EMAILS=me@gmail.com,friend@company.com
// Adding or removing someone = updating that variable (new revision, ~30s),
// no code change and no database migration.
//
// FAIL CLOSED: if the variable is unset or empty, NOBODY gets in. A
// misconfigured demo should lock everyone out, never open up to everyone.
//
// Enforcement points (see middleware.ts and /api/demo-access):
//   1. Login page asks /api/demo-access before sending a magic link, so an
//      uninvited email never gets a link and never creates a Supabase user.
//   2. middleware.ts checks every request from a signed-in user and kicks out
//      anyone not on the list. This is the authoritative gate: it also covers
//      accounts that already existed in Supabase from the old product.
//
// Framework-free on purpose: it is imported by the Edge middleware and by a
// Node API route.
// ─────────────────────────────────────────────────────────────────────────────

// Normalize so "  Me@Gmail.com " and "me@gmail.com" are the same person.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Parsed fresh on each call: reading one env var is trivially cheap, and it
// avoids any doubt about module-level caching across runtimes.
function allowedEmails(): Set<string> {
  const raw = process.env.DEMO_ALLOWED_EMAILS || ''
  return new Set(
    raw
      .split(/[,;\s]+/) // accept commas, semicolons or whitespace as separators
      .map(normalizeEmail)
      .filter(Boolean)
  )
}

export function isDemoEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false
  return allowedEmails().has(normalizeEmail(email))
}

// Shown to anyone not on the list. Safe to display directly.
export const NOT_INVITED_MESSAGE =
  'This Vowwl demo is invite-only, and this email is not on the list yet.'
