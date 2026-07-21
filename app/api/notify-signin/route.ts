import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendFounderAlert } from '@/lib/founder-alert'

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

export async function POST(request: Request) {
  try {
    // Window closed → silently do nothing.
    if (new Date() > NOTIFY_UNTIL) return NextResponse.json({ ok: true })

    const { email } = await request.json()
    const clean = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!clean || !clean.includes('@')) return NextResponse.json({ ok: true })

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
