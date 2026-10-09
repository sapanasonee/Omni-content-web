import { NextResponse } from 'next/server'
import { isDemoEmailAllowed, NOT_INVITED_MESSAGE } from '@/lib/demo-access'

// POST /api/demo-access  { email }  →  { allowed: boolean, reason?: string }
//
// Called by the login page BEFORE sending a magic link, so uninvited people
// get a clear message instead of an email, and no Supabase auth user is
// created for them. This is a convenience front door only; middleware.ts is
// the real gate (a direct call to Supabase would bypass this check, but the
// resulting session is still rejected on every request).
//
// Note: this reveals whether a given address is invited. Acceptable for a
// small private demo; the list itself is never exposed.
export async function POST(request: Request) {
  let email = ''
  try {
    const body = await request.json()
    email = typeof body?.email === 'string' ? body.email.slice(0, 320) : ''
  } catch {
    // Malformed JSON falls through as an empty email → not allowed.
  }

  if (isDemoEmailAllowed(email)) {
    return NextResponse.json({ allowed: true })
  }
  return NextResponse.json({ allowed: false, reason: NOT_INVITED_MESSAGE })
}
