import { NextResponse, type NextRequest } from 'next/server'

// vowwl.com is now a single page. Any other path (old /pricing, /login,
// /onboarding, /dashboard, /api/*, bookmarked links, typos) is sent to `/`,
// so visitors can never land on the retired voice/content product or call
// its old API. An allowlist of one ("/") means no route list to keep in sync.
//
// 307 (temporary) on purpose: browsers cache 301/308 redirects, which would
// make restoring any old route harder later. The old middleware (Supabase
// session refresh) is parked at legacy/voice-product-middleware.ts.
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/') return NextResponse.next()

  const home = request.nextUrl.clone()
  home.pathname = '/'
  home.search = '' // drop old query strings (e.g. ?next=, auth codes)
  return NextResponse.redirect(home, 307)
}

export const config = {
  // Skip Next's own build assets and the favicon; everything else is checked.
  matcher: ['/((?!_next/|favicon.ico).*)'],
}
