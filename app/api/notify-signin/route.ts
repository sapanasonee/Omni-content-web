import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

// Temporary founder-alert on every sign-in-link request (early-access
// engagement tracking). Called best-effort from the login form; it NEVER
// blocks login and NEVER tells the requester anything (the New/Returning label
// goes only to the founder inbox, so this can't be used to enumerate accounts).
//
// Self-expiring: after NOTIFY_UNTIL the route no-ops, so the alerts stop on
// their own without a redeploy. Extend the date or delete this route when the
// tracking window is over.
const NOTIFY_UNTIL = new Date('2026-08-21T23:59:59Z')
const NOTIFY_TO = process.env.NOTIFY_TO || 'spnsn9@gmail.com'
// Must be an address on a domain verified in Resend. Until vowwl.com is
// verified, Resend's shared 'onboarding@resend.dev' sender works but only
// delivers to the Resend account owner's own email — fine for this founder
// alert. Override with NOTIFY_FROM once vowwl.com is verified.
const NOTIFY_FROM = process.env.NOTIFY_FROM || 'Vowwl <onboarding@resend.dev>'

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

    // Founder alert. No-op (with a warning) if Resend isn't configured, so the
    // feature degrades cleanly rather than 500-ing the login flow.
    if (process.env.RESEND_API_KEY) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: NOTIFY_FROM,
          to: NOTIFY_TO,
          subject: `[Vowwl] ${label} user signing in — ${clean}`,
          text:
            `A ${label.toLowerCase()} user just requested a sign-in link.\n\n` +
            `Email:  ${clean}\n` +
            `Type:   ${label}\n` +
            `Time:   ${new Date().toISOString()}\n`,
        })
      } catch (err) {
        console.error('Sign-in alert send failed (non-fatal):', err)
      }
    } else {
      console.warn('notify-signin: RESEND_API_KEY not set — alert skipped')
    }

    return NextResponse.json({ ok: true })
  } catch {
    // Absolutely never surface an error to the login form.
    return NextResponse.json({ ok: true })
  }
}
