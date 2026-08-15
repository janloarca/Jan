import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { ttmAnnualDividend, projectNextDate } from '@/lib/dividendSchedule'

export const dynamic = 'force-dynamic'

const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i

// FASE II. La fecha de PAGO real (cuando el dinero llega), que no es la fecha
// ex-dividendo: verificado contra 6 acciones de 5 mercados, el desfase va de 0
// días (China) a ~3 meses (Japón), así que no existe ningún "sumarle N días"
// correcto. Yahoo la publica en calendarEvents.dividendDate. Best-effort a
// propósito: si el endpoint falla, cambia de forma o trae una fecha ya pasada
// (el pago anterior, con el próximo aún sin anunciar), se devuelve null y el
// caller cae a la proyección de ex-date ETIQUETADA como tal: en el peor caso
// la UI dice la verdad de siempre con el nombre correcto, nunca inventa.
async function fetchPaymentDate(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents`
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return null
    const data = await res.json()
    const raw = data.quoteSummary?.result?.[0]?.calendarEvents?.dividendDate?.raw
    if (!raw || !isFinite(raw)) return null
    const iso = new Date(raw * 1000).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]
    return iso >= today ? iso : null
  } catch {
    return null
  }
}

async function fetchDividendInfo(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=3y&events=div`
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return { hasDividend: false, symbol }

    const data = await res.json()
    const result = data.chart?.result?.[0]
    const events = result?.events?.dividends
    if (!events || Object.keys(events).length === 0) return { hasDividend: false, symbol }

    const divList = Object.values(events)
      .map((d) => ({ date: new Date(d.date * 1000), amount: d.amount }))
      .sort((a, b) => a.date - b.date)
    if (divList.length === 0) return { hasDividend: false, symbol }

    const lastDiv = divList[divList.length - 1]
    const lastAmount = lastDiv.amount

    let frequency = 'quarterly'
    if (divList.length >= 2) {
      const gaps = []
      for (let i = 1; i < divList.length; i++) {
        gaps.push((divList[i].date - divList[i - 1].date) / 86400000)
      }
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
      if (avgGap < 45) frequency = 'monthly'
      else if (avgGap < 120) frequency = 'quarterly'
      else if (avgGap < 200) frequency = 'semiannual'
      else frequency = 'annual'
    }

    const freqMonths = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }
    const monthsApart = freqMonths[frequency] || 3
    // FASE II: proyección por componentes con el día recortado al fin de mes
    // real (lib/dividendSchedule.js). El setMonth() viejo DESBORDABA: un
    // ex-date el 30 de noviembre + 3 meses caía en "2 de septiembre" (el 30 de
    // febrero no existe) y el corrimiento se quedaba para siempre.
    const nextExDate = projectNextDate(lastDiv.date.getTime(), monthsApart)

    const paymentMonths = []
    const baseMonth = lastDiv.date.getMonth()
    for (let i = 0; i < 12; i += monthsApart) paymentMonths.push((baseMonth + i) % 12)

    // FASE II: el rendimiento suma lo REALMENTE pagado en los últimos 12 meses
    // (TTM). "Último pago × frecuencia" solo acierta en pagadores parejos y en
    // los desiguales daba 2.53% o 5.55% para la MISMA empresa (Novo Nordisk,
    // interino DKK 3.75 + final DKK 7.95 = 11.70/año → 3.95%) según qué bolsa
    // hubiera pagado último. La extrapolación queda solo como respaldo para
    // historiales más jóvenes que ~11 meses, donde la suma TTM subestimaría.
    const extrapolated = frequency === 'monthly' ? lastAmount * 12
      : frequency === 'quarterly' ? lastAmount * 4
      : frequency === 'semiannual' ? lastAmount * 2 : lastAmount
    const ttm = ttmAnnualDividend(divList)
    const annualDividend = ttm != null ? ttm : extrapolated

    const meta = result?.meta
    const currentPrice = meta?.regularMarketPrice || 0
    const dividendYield = currentPrice > 0 ? (annualDividend / currentPrice) * 100 : 0

    return {
      hasDividend: true, symbol, lastAmount,
      annualDividend: Math.round(annualDividend * 100) / 100,
      dividendYield: Math.round(dividendYield * 100) / 100,
      yieldMethod: ttm != null ? 'ttm' : 'extrapolated',
      frequency,
      paymentMonths: paymentMonths.sort((a, b) => a - b),
      // Compat: nextPaymentDate sigue existiendo con la proyección de ex-date.
      // El GET del alta lo REEMPLAZA con la fecha de pago real cuando Yahoo la
      // da (paymentDateIsReal pasa a true); los consumidores viejos no cambian.
      nextPaymentDate: nextExDate,
      nextExDate,
      paymentDateIsReal: false,
      lastPaymentDate: lastDiv.date.toISOString().split('T')[0],
      historyCount: divList.length,
    }
  } catch (err) {
    console.error(`[api/dividends] Failed for ${symbol}:`, err.message)
    return { hasDividend: false, symbol }
  }
}

export async function GET(request) {
  const { limited } = await rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  const auth = await verifyAuth(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim()
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol', errorCode: 'BAD_REQUEST' }, { status: 400 })
  }
  const info = await fetchDividendInfo(symbol)
  // FASE II: la fecha de pago real SOLO en el GET (el alta de un activo, una
  // llamada por símbolo). El POST batch (hasta 50 símbolos del dashboard) no
  // la pide a propósito: duplicaría las llamadas a Yahoo por cada lote y ese
  // camino no muestra fechas, solo yield/frecuencia.
  if (info?.hasDividend) {
    const payDate = await fetchPaymentDate(symbol)
    if (payDate) {
      info.nextPaymentDate = payDate
      info.paymentDateIsReal = true
    }
  }
  return NextResponse.json(info, {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400' },
  })
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  const auth = await verifyAuth(request)
  if (auth.error) return auth.error

  try {
    const { symbols } = await request.json()
    if (!symbols || !Array.isArray(symbols) || symbols.length > 50) {
      return NextResponse.json({ error: 'Invalid request', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }

    for (const s of symbols) {
      const sym = typeof s === 'string' ? s : s?.symbol || ''
      if (sym && !SYMBOL_RE.test(sym)) {
        return NextResponse.json({ error: 'Invalid symbol', errorCode: 'BAD_REQUEST' }, { status: 400 })
      }
    }

    const dividends = {}
    const batches = []
    for (let i = 0; i < symbols.length; i += 15) batches.push(symbols.slice(i, i + 15))

    for (const batch of batches) {
      const results = await Promise.all(
        batch.map((s) => fetchDividendInfo(typeof s === 'string' ? s : s.symbol))
      )
      results.forEach((info) => {
        if (info.symbol) dividends[info.symbol.toUpperCase()] = info
      })
    }

    return NextResponse.json({ dividends })
  } catch (err) {
    console.error('dividends error:', err)
    return NextResponse.json({ error: 'Internal server error', errorCode: 'INTERNAL', dividends: {} }, { status: 500 })
  }
}
