import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendFounderAlert } from '@/lib/founder-alert'
import { checkRateLimit, clientKey } from '@/lib/rate-limit'

// Public waitlist capture for not-yet-purchasable tiers on /pricing. No auth
// (marketing page). Persists to the sealed waitlist table via the
// join_waitlist RPC AND fires a founder alert. Both are best-effort: if the
// waitlist migration hasn't been run, the RPC failure is swallowed and the
// email still reaches the founder inbox, so the feature works the moment it
// deploys and only gains durable storage once the migration is applied.
const ALLOWED_TIERS = ['studio', 'agency']

// Joining a waitlist is a once-per-person action, so the honest ceiling is
// low. Every accepted request emails the founder and writes a row, which is
// exactly what makes an unthrottled version a free amplifier — see
// lib/rate-limit.ts for what this does and does not guarantee.
const RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 3, globalMax: 60 }

export async function POST(request: Request) {
  try {
    const { email, tier } = await request.json()
    const clean = typeof email === 'string' ? email.trim().toLowerCase() : ''
    const t = typeof tier === 'string' && ALLOWED_TIERS.includes(tier) ? tier : ''
    if (!clean || !clean.includes('@') || clean.length > 200 || !t) {
      return NextResponse.json({ error: 'Invalid email or tier' }, { status: 400 })
    }

    // Checked AFTER validation so malformed junk can't burn a real visitor's
    // allowance, and BEFORE the RPC/email so a throttled request costs nothing.
    const limit = checkRateLimit(`waitlist:${clientKey(request)}`, RATE_LIMIT)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "You're already on the list — we'll be in touch shortly." },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      )
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

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Failed to join waitlist' }, { status: 500 })
  }
}
