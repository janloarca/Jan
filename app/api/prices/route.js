import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { verifyAuth } from '@/lib/apiAuth'
import { priceItems } from '@/lib/marketPrices'

// Cáscara delgada sobre lib/marketPrices.js (FASE HY): el motor de
// cotizaciones se extrajo para que el cron de notificaciones pueda valorar un
// portafolio sin sesión de navegador. Aquí solo quedan las políticas de la
// RUTA (rate limit, auth, forma de la respuesta).

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 60 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  // These proxy Yahoo/CoinGecko with our quota — require a signed-in user.
  const authResult = await verifyAuth(request)
  if (authResult.error) return authResult.error

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }
    const { items } = body
    if (!items || !Array.isArray(items) || items.length > 100) {
      return NextResponse.json({ error: 'Invalid request', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }

    const { prices, warnings, usedStale, requested } = await priceItems(items)

    if (requested.length > 0 && Object.keys(prices).length === 0) {
      return NextResponse.json({
        error: 'All price sources failed',
        errorCode: 'UPSTREAM_DOWN',
        prices: {},
        warnings,
        timestamp: new Date().toISOString(),
      }, { status: 503 })
    }

    return NextResponse.json({
      prices,
      ...(usedStale ? { stale: true } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('prices error:', err)
    return NextResponse.json({ error: 'Internal server error', errorCode: 'INTERNAL', prices: {} }, { status: 500 })
  }
}
