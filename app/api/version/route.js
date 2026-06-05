import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_BUILD_ID || '__dev__' },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
