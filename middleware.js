import { NextResponse } from 'next/server'

export function middleware(request) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/dashboard')) {
    const authCookie = request.cookies.get('__session') || request.cookies.get('firebase-auth')
    const hasAuth = request.headers.get('cookie')?.includes('firebaseAuth')

    if (!authCookie && !hasAuth) {
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
