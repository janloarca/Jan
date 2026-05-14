import { NextResponse } from 'next/server'

function isValidJwtFormat(token) {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64))
    if (payload.exp && payload.exp * 1000 < Date.now()) return false
    return true
  } catch {
    return false
  }
}

export function middleware(request) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/dashboard')) {
    const authCookie = request.cookies.get('__session')

    if (!authCookie || !isValidJwtFormat(authCookie.value)) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
