import { NextResponse } from 'next/server'
import { validateOAuthState } from '@/lib/oauthState'

export async function GET(request) {
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

  const redirectUrl = new URL('/dashboard', request.url)
  redirectUrl.searchParams.set('oauth_code', code)
  redirectUrl.searchParams.set('oauth_broker', broker)

  const response = NextResponse.redirect(redirectUrl)
  response.headers.set('Set-Cookie', 'oauth_nonce=; Path=/; HttpOnly; Max-Age=0')
  return response
}
