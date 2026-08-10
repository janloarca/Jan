// Serves /__/firebase/* for the same-origin OAuth helper. next.config.js
// rewrites that path here rather than straight to Firebase, so the one file
// Hosting may not have (init.json) can be filled in from our own config
// instead of returning a 404 the helper cannot recover from. See
// lib/firebaseHelperConfig.js for why that 404 happens at all.
//
// It lives under /api because Next treats any route segment starting with "_"
// as private and never routes it, so an app/__/firebase/... folder would not
// exist as a route no matter what the rewrite says.
import { NextResponse } from 'next/server'
import { buildFirebaseInitJson, resolveHelperHost, INIT_JSON_PATH } from '@/lib/firebaseHelperConfig'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const parts = (await params).path || []
  const path = parts.join('/')
  const host = resolveHelperHost(process.env)

  // Upstream first, always: Google's own answer wins wherever it exists, so a
  // project WITH Hosting behaves exactly as it did before this route existed.
  if (host) {
    try {
      const upstream = await fetch(`https://${host}/__/firebase/${path}`, { cache: 'no-store' })
      if (upstream.ok) {
        const body = await upstream.arrayBuffer()
        return new NextResponse(body, {
          status: upstream.status,
          headers: {
            'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
            'cache-control': 'no-store',
            // Read by the login diagnostic, so a report says whether Firebase
            // answered or we filled in for it.
            'x-helper-source': 'upstream',
          },
        })
      }
    } catch {
      // Falls through to the local answer below, which is the whole point of
      // not depending on that request succeeding.
    }
  }

  if (path === INIT_JSON_PATH) {
    const init = buildFirebaseInitJson(process.env, { authDomain: request.nextUrl.host })
    if (init) return NextResponse.json(init, { headers: { 'cache-control': 'no-store', 'x-helper-source': 'local' } })
  }

  return new NextResponse('Not found', { status: 404 })
}
