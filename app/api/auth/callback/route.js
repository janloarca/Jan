import { NextResponse } from 'next/server'

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

  const broker = state || 'unknown'
  const redirectUrl = new URL('/dashboard', request.url)
  redirectUrl.searchParams.set('oauth_code', code)
  redirectUrl.searchParams.set('oauth_broker', broker)

  return NextResponse.redirect(redirectUrl)
}
