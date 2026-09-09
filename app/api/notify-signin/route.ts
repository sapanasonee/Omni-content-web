import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendFounderAlert } from '@/lib/founder-alert'
import { checkRateLimit, clientKey } from '@/lib/rate-limit'

// Temporary founder-alert on EVERY sign-in-link request (early-access
// engagement tracking — includes returning users). Called best-effort from the
// login form; it NEVER blocks login and NEVER tells the requester anything (the
// New/Returning label goes only to the founder inbox, so this can't be used to
// enumerate accounts).
//
// Self-expiring: after NOTIFY_UNTIL the route no-ops, so the every-login alerts
// stop on their own without a redeploy. The PERMANENT new-user alert lives in
// /api/onboarding (fires once per genuinely-new user, not time-boxed) — that's
// the one that keeps going after this window closes.
const NOTIFY_UNTIL = new Date('2026-08-21T23:59:59Z')

// Unauthenticated, and every accepted call both writes a login_events row and
// emails the founder — so without a ceiling it is a free inbox-flooder that
// also poisons the New-vs-Returning analytics this route exists to collect.
// A real person requests a handful of sign-in links at most; anything past
// that on one IP inside an hour is noise or abuse. See lib/rate-limit.ts for
// the per-instance caveat.
const RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 5, globalMax: 100 }

export async function POST(request: Request) {
  try {
    // Window closed → silently do nothing.
    if (new Date() > NOTIFY_UNTIL) return NextResponse.json({ ok: true })

    const { email } = await request.json()
    const clean = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!clean || !clean.includes('@')) return NextResponse.json({ ok: true })

    // Throttled requests return the SAME { ok: true } as every other outcome
    // rather than a 429. This route's contract is that the requester learns
    // nothing from it and that it can never affect login — a distinguishable
    // status code would break the first half of that, and the login form
    // ignores this response entirely anyway. Dropping the work silently is
    // the whole point: no email, no row, no signal.
    if (!checkRateLimit(`notify-signin:${clientKey(request)}`, RATE_LIMIT).allowed) {
      return NextResponse.json({ ok: true })
    }

    // New vs returning via the private login_events log (SECURITY DEFINER RPC).
    // Non-fatal: a failure just yields an "Unknown" label, never a broken login.
    let label = 'Unknown'
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('record_login', { p_email: clean })
      if (!error && typeof data === 'boolean') label = data ? 'New' : 'Returning'
      else if (error) console.error('record_login failed (non-fatal):', error)
    } catch (err) {
      console.error('record_login threw (non-fatal):', err)
    }

    // Founder alert (shared best-effort sender; no-ops if Resend unconfigured).
    await sendFounderAlert(
      `[Vowwl] ${label} user signing in — ${clean}`,
      `A ${label.toLowerCase()} user just requested a sign-in link.\n\n` +
        `Email:  ${clean}\n` +
        `Type:   ${label}\n` +
        `Time:   ${new Date().toISOString()}\n`,
    )

    return NextResponse.json({ ok: true })
  } catch {
    // Absolutely never surface an error to the login form.
    return NextResponse.json({ ok: true })
  }
}
