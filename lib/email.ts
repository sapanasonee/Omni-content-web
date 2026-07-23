import { Resend } from 'resend'

// Transactional email to an ARBITRARY recipient — as opposed to
// lib/founder-alert, which only ever emails the founder inbox. Best-effort:
// never throws, and no-ops (with a warning) when Resend isn't configured, so a
// failed send never breaks the request path that triggered it.
//
// DELIVERY CAVEAT: the default NOTIFY_FROM 'onboarding@resend.dev' is Resend's
// shared test sender, which only delivers to the Resend account owner's own
// inbox. A confirmation sent to a real prospect will NOT arrive until
// NOTIFY_FROM is set to a @vowwl.com address on a Resend-verified domain. The
// code path is in place; end-user delivery is gated on that one config change.
const FROM = process.env.NOTIFY_FROM || 'Vowwl <onboarding@resend.dev>'

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
