import { Resend } from 'resend'

// Shared best-effort founder-alert sender. Two callers today:
//   - /api/notify-signin  — TEMPORARY, every sign-in-link request (self-expires)
//   - /api/onboarding     — PERMANENT, once per genuinely-new user (activation)
//
// Contract: never throws, never blocks the caller's flow. No-ops (with a
// warning) when Resend isn't configured, so the whole feature degrades cleanly
// rather than breaking login or onboarding.
const NOTIFY_TO = process.env.NOTIFY_TO || 'spnsn9@gmail.com'
// vowwl.com is verified in Resend (DKIM/SPF/MX all green), so info@vowwl.com
// is the default sender. NOTIFY_FROM still overrides it if ever needed.
const NOTIFY_FROM = process.env.NOTIFY_FROM || 'Vowwl <info@vowwl.com>'

export async function sendFounderAlert(subject: string, text: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('founder-alert: RESEND_API_KEY not set — alert skipped')
    return
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({ from: NOTIFY_FROM, to: NOTIFY_TO, subject, text })
  } catch (err) {
    console.error('Founder alert send failed (non-fatal):', err)
  }
}
