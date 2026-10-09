import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { isDemoEmailAllowed } from '@/lib/demo-access'

// Paths a signed-in but UNINVITED user may still reach: the marketing page,
// the login screen (where they see the "invite-only" message), the auth
// callback, and the invite check itself. Everything else is blocked for them.
const OPEN_TO_UNINVITED = ['/', '/login', '/auth/callback', '/api/demo-access']

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request)

  // Signed-out visitors: unchanged behavior. Pages/routes handle their own
  // auth (layouts redirect to /login, API routes return 401).
  if (!user) return response

  // Signed-in and invited: carry on as normal.
  if (isDemoEmailAllowed(user.email)) return response

  // Signed-in but NOT invited (e.g. an account left over from the old
  // product, or someone who went around the login page's check).
  const { pathname } = request.nextUrl
  if (OPEN_TO_UNINVITED.includes(pathname)) return response

  // API calls get a plain 403 so nothing can spend Gemini quota.
  // Pages get sent to the login screen with an explanation.
  const blocked = pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'This demo is invite-only.' }, { status: 403 })
    : NextResponse.redirect(new URL('/login?error=not_invited', request.url))

  // Drop the Supabase session cookies (all named "sb-…") so the uninvited
  // session is gone rather than bouncing on every request.
  request.cookies.getAll()
    .filter(({ name }) => name.startsWith('sb-'))
    .forEach(({ name }) => blocked.cookies.delete(name))

  return blocked
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
