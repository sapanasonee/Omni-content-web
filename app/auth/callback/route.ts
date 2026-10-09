import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Redirect back to whichever host the link was opened on. The Host header
  // is checked before NEXT_PUBLIC_APP_URL because the Dockerfile bakes that
  // variable to the ORIGINAL service URL; without this, a second deployment
  // (e.g. the private demo) would bounce users to the wrong site after login.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = request.headers.get('host')
  const isLocalEnv = process.env.NODE_ENV === 'development'
  const baseUrl = isLocalEnv
    ? origin
    : forwardedHost
      ? `https://${forwardedHost}`
      : host
        ? `https://${host}`
        : process.env.NEXT_PUBLIC_APP_URL ?? origin

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${baseUrl}/dashboard`)
    }
  }

  return NextResponse.redirect(`${baseUrl}/login?error=auth_failed`)
}