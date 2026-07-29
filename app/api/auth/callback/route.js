import { NextResponse } from 'next/server'
import { validateOAuthState } from '@/lib/oauthState'
import { rateLimit } from '@/lib/rateLimit'

export async function GET(request) {
  // OAuth redirects are rare per user — a tight limit stops state-guessing loops.
  const { limited } = await rateLimit(request, { maxRequests: 10 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    const redirectUrl = new URL('/dashboard', request.url)
    redirectUrl.searchParams.set('oauth_error', error)
    return NextResponse.redirect(redirectUrl)
  }

  if (!code) {
    return NextResponse.json({ error: 'No authorization code' }, { status: 400 })
  }

  const cookies = request.headers.get('cookie') || ''
  const nonceMatch = cookies.match(/oauth_nonce=([a-f0-9]{32})/)
  const cookieNonce = nonceMatch ? nonceMatch[1] : null

  const broker = validateOAuthState(state, cookieNonce)
  if (!broker) {
    const redirectUrl = new URL('/dashboard', request.url)
    redirectUrl.searchParams.set('oauth_error', 'invalid_state')
    return NextResponse.redirect(redirectUrl)
  }

  // The authorization code travels in the URL FRAGMENT, not the query string:
  // fragments never reach server logs or Referer headers, so the single-use
  // code can't leak through those channels. The dashboard reads location.hash
  // and immediately cleans it with history.replaceState.
  const redirectUrl = new URL('/dashboard', request.url)
  redirectUrl.hash = `oauth_code=${encodeURIComponent(code)}&oauth_broker=${encodeURIComponent(broker)}`

  const response = NextResponse.redirect(redirectUrl)
  response.headers.set('Set-Cookie', 'oauth_nonce=; Path=/; HttpOnly; Max-Age=0')
  return response
}
