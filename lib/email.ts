import { Resend } from 'resend'

// Transactional email to an ARBITRARY recipient — as opposed to
// lib/founder-alert, which only ever emails the founder inbox. Best-effort:
// never throws, and no-ops (with a warning) when Resend isn't configured, so a
// failed send never breaks the request path that triggered it.
//
// vowwl.com is verified in Resend (DKIM/SPF/MX all green), so info@vowwl.com
// is the default sender and reaches real recipients. NOTIFY_FROM still
// overrides it if ever needed.
const FROM = process.env.NOTIFY_FROM || 'Vowwl <info@vowwl.com>'

export async function sendUserEmail(to: string, subject: string, text: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('email: RESEND_API_KEY not set — email skipped')
    return
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({ from: FROM, to, subject, text })
  } catch (err) {
    console.error('User email send failed (non-fatal):', err)
  }
}
