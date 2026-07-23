import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendFounderAlert } from '@/lib/founder-alert'
import { sendUserEmail } from '@/lib/email'

// Public waitlist capture for not-yet-purchasable tiers on /pricing. No auth
// (marketing page). Persists to the sealed waitlist table via the
// join_waitlist RPC AND fires a founder alert. Both are best-effort: if the
// waitlist migration hasn't been run, the RPC failure is swallowed and the
// email still reaches the founder inbox, so the feature works the moment it
// deploys and only gains durable storage once the migration is applied.
const ALLOWED_TIERS = ['studio', 'agency']

export async function POST(request: Request) {
  try {
    const { email, tier } = await request.json()
    const clean = typeof email === 'string' ? email.trim().toLowerCase() : ''
    const t = typeof tier === 'string' && ALLOWED_TIERS.includes(tier) ? tier : ''
    if (!clean || !clean.includes('@') || clean.length > 200 || !t) {
      return NextResponse.json({ error: 'Invalid email or tier' }, { status: 400 })
    }

    // Persist (non-fatal — no-op if the migration hasn't been applied).
    try {
      const supabase = await createClient()
      const { error } = await supabase.rpc('join_waitlist', { p_email: clean, p_tier: t })
      if (error) console.error('join_waitlist failed (non-fatal):', error)
    } catch (err) {
      console.error('join_waitlist threw (non-fatal):', err)
    }

    // Founder alert (best-effort; no-op without RESEND_API_KEY).
    await sendFounderAlert(
      `[Vowwl] New ${t} waitlist signup — ${clean}`,
      `Someone joined the ${t} waitlist.\n\nEmail: ${clean}\nTier:  ${t}\nTime:  ${new Date().toISOString()}\n`,
    )

    // Confirmation to the person who joined (best-effort). Note: with the
    // default resend.dev sender this only reaches the Resend account owner —
    // see lib/email.ts. Once NOTIFY_FROM is a verified @vowwl.com address it
    // reaches real prospects.
    const tierLabel = t.charAt(0).toUpperCase() + t.slice(1)
    await sendUserEmail(
      clean,
      `You're on the Vowwl ${tierLabel} waitlist`,
      `Hi,\n\n` +
        `Thanks for your interest in Vowwl ${tierLabel} — you're on the waitlist. ` +
        `We'll email you the moment it opens, and as an early sign-up you'll be first in line.\n\n` +
        `In the meantime you can keep creating in your own voice on your current plan.\n\n` +
        `Any questions? Just reply to this email and we'll get back to you.\n\n` +
        `— The Vowwl team\n`,
    )

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 })
  }
}
