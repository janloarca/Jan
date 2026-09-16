import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'
import { fetchWithRetry } from '@/lib/fetchWithRetry'
import { isMarketPriced } from '@/components/dashboard/utils'
import { qtyAtTs, staticItemValueAtTs, isTradeLedgerComplete, lotsReconcile, dedupeIncomeAgainstFlows } from '@/lib/portfolioRewind'
import { CRYPTO_MAP } from '@/lib/cryptoMap'
import { saveLastGood, getLastGood } from '@/lib/priceCache'
import { kvBackend } from '@/lib/kvClient'

export const dynamic = 'force-dynamic'
// FASE HJ. Sin esto, el default de Vercel (10s en Hobby) mataba la petición
// de la vista "Todas" (~20 símbolos con reintentos) con un 504 que el cliente
// se tragaba en silencio: la gráfica quedaba sin dataPoints NI staticPoints
// (cola de NAV pelado, drawdown falso) y el backfill abortaba sin escribir,
// dejando los docs viejos congelados para siempre.
export const maxDuration = 60

const VALID_PERIODS = ['DAY', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y', 'ALL']
const SYMBOL_RE = /^[A-Z0-9._\-^=]{1,20}$/i

// Ticker -> CoinGecko id comes from lib/cryptoMap.js (shared with /api/prices
// and /api/prices/chart). This route used to keep its own 22-coin copy: any
// coin missing from it silently fell to the static (flat) path, so a Ledger
// wallet holding TRX/TON/SUI/etc. drew a fake flat history.

const RANGE_MAP = {
  DAY: { range: '5d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
  YTD: { range: 'ytd', interval: '1d' },
  ALL: { range: 'max', interval: '1wk' },
}

// Both history fetchers degrade to the last-known-good series on upstream
// failure (same pattern as /api/prices/chart): a Yahoo/CoinGecko outage or a
// shared-IP rate limit used to return [] here, which dropped the item into
// the static flat path — the chart then alternated between a real curve and a
// fake flat line depending on whether CoinGecko happened to answer ("a veces
// falla la gráfica").
// FASE HJ. Presupuesto por símbolo acotado (timeout 6s, 1 reintento, backoff
// 500ms): el peor caso de UN símbolo pasa de ~33s a ~13s, y el de la petición
// completa (2 tandas de 10 + crypto) queda muy por debajo del maxDuration.
// Antes, un solo símbolo lento agotaba el límite de la función entera.
const FETCH_BUDGET = { retries: 1, backoff: 500 }
const FETCH_TIMEOUT_MS = 6000

async function fetchYahooHistory(symbol, range, interval) {
  const cacheKey = `ph:yahoo:${symbol}:${range}:${interval}`
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }, FETCH_BUDGET)
    if (!res.ok) return (await getLastGood(cacheKey))?.data || []
    const data = await res.json()
    const result = data.chart?.result?.[0]
    if (!result) return []
    const timestamps = result.timestamp || []
    const closes = result.indicators?.quote?.[0]?.close || []
    const series = timestamps
      .map((ts, i) => ({ ts: ts * 1000, close: closes[i] }))
      .filter((p) => p.close != null)
    if (series.length > 0) saveLastGood(cacheKey, series).catch(() => {})
    return series
  } catch (err) {
    console.error(`[api/portfolio-history] Yahoo failed for ${symbol}:`, err.message)
    return (await getLastGood(cacheKey))?.data || []
  }
}

async function fetchCryptoHistory(id, days) {
  const cacheKey = `ph:crypto:${id}:${days}`
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`
    const res = await fetchWithRetry(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }, FETCH_BUDGET)
    if (!res.ok) return (await getLastGood(cacheKey))?.data || []
    const data = await res.json()
    const series = (data.prices || []).map(([ts, price]) => ({ ts, close: price }))
    if (series.length > 0) saveLastGood(cacheKey, series).catch(() => {})
    return series
  } catch (err) {
    console.error(`[api/portfolio-history] CoinGecko failed for ${id}:`, err.message)
    return (await getLastGood(cacheKey))?.data || []
  }
}

// Earliest plausible portfolio date. Anything before this is treated as corrupt
// (a 6-digit cell misread as YYYYMM → e.g. 1982, an epoch/0, or a seconds-vs-ms
// confusion) and excluded from the ALL-period chart start.
const MIN_VALID_TS = Date.UTC(1990, 0, 1)
function validAcqTs(raw) {
  if (!raw) return null
  const t = new Date(raw).getTime()
  if (!Number.isFinite(t)) return null
  if (t < MIN_VALID_TS) return null
  if (t > Date.now() + 86400000) return null
  return t
}

// FASE IV. CoinGecko se consume por su API PÚBLICA (sin key, ver
// fetchCryptoHistory), y ese plan limita el histórico a los ÚLTIMOS 365 DÍAS:
// pedir exactamente 365, o 'max', cae fuera del rango permitido y la respuesta
// vuelve vacía. Ahí el activo cae al camino estático y se dibuja PLANO en su
// valor de hoy, con "+0.00%" sobre una cripto que se movió 40% en el año.
//
// El patrón de qué períodos fallaban lo delata sin ambigüedad: DAY/1W/1M/3M y
// YTD (todos por debajo del límite) funcionaban, y 1Y y ALL (los dos únicos
// que lo tocan) no. Acotar por debajo del borde devuelve el histórico completo
// que ese plan sí entrega. Para ALL significa un año hacia atrás en vez de
// "todo", que es lo máximo disponible sin key: un dato real y acotado, no una
// línea plana que afirma que no pasó nada.
const CRYPTO_MAX_DAYS = 364
function getCryptoDays(period) {
  const map = { DAY: 1, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, ALL: CRYPTO_MAX_DAYS }
  if (period === 'YTD') {
    const now = new Date()
    const jan1 = new Date(now.getFullYear(), 0, 1)
    return Math.min(CRYPTO_MAX_DAYS, Math.ceil((now - jan1) / 86400000))
  }
  return Math.min(CRYPTO_MAX_DAYS, map[period] || 365)
}

// Transaction-rewind inputs (lib/portfolioRewind): per-item share deltas and
// signed cash flows, pre-converted to USD by the client. Sanitized hard
// (numbers only, bounded sizes) since they multiply into the per-ts loop.
// When present they reconstruct the TRUE past (deposits step in, buys move
// cash into shares) instead of holding today's state flat backwards.
const sanitizeEvents = (arr, maxLen, key) => {
  if (!Array.isArray(arr)) return null
  const out = []
  for (const e of arr.slice(0, maxLen)) {
    const ts = Number(e?.ts)
    const val = Number(e?.[key])
    if (!Number.isFinite(ts) || !Number.isFinite(val) || val === 0) continue
    out.push(key === 'qtyDelta' ? { ts, qtyDelta: val } : { ts, amount: val })
  }
  return out.length > 0 ? out : null
}

// Pick the reconstruction inputs for one market item, with STALENESS GUARDS
// against the item's current quantity (lib/portfolioRewind):
//  - txEvents (trade rewind): dropped when the ledger can't account for the
//    current quantity (Ledger sync imports inflows only → implied start < 0).
//  - lots: dropped when the open lots no longer sum to the current quantity
//    (never-closed lots from an old import drew a phantom flat ~$65K line that
//    "crashed" to the real ~$727 at the live point — a fake -98.9% and a max
//    drawdown that never happened).
// With both dropped, the caller falls through to holding the current quantity
// from the acquisition date — the honest best guess given the data we have.
function reconstructionFor(it, sym, lotsForSymbol) {
  const qtyNow = it.quantity || 0
  const txEvents = sanitizeEvents(it.txEvents, 500, 'qtyDelta')
  const usableTx = txEvents && isTradeLedgerComplete(txEvents, qtyNow) ? txEvents : null
  // FASE HL. Cuando la fecha de adquisición es un SELLO DE SYNC
  // (_dateUnreliable, ver hasUnreliableAcqDate en utils.js) no puede usarse
  // como puerta de existencia, y los lots creados por ese mismo import
  // heredan el sello. Sin esto, una posición de broker cuyo ledger de trades
  // no alcanza a explicar la cantidad de hoy (lo normal: el Flex entrega
  // ~365 días) caía a la rama de lots o al gate de acquisitionDate y
  // contribuía CERO en todo el pasado anterior al sync: la reconstrucción
  // entera omitía la cuenta del broker, dejando el histórico al nivel
  // solo-manual mientras los días con doc 'daily' real (escrito con la app
  // abierta) marcaban el total correcto. Esa alternancia es el diente de
  // sierra de la vista "Todas".
  //
  // Mantener la cantidad de HOY plana hacia atrás es un ESTIMADO (asume
  // cantidad constante) pero es la convención que este pipeline ya fijó para
  // fechas no confiables (FASE AD), y es estrictamente mejor que cero, que
  // afirma que la cuenta no existía. La reconstrucción REAL por trades
  // (usableTx) sigue teniendo prioridad y no cambia.
  const dateUnreliable = !!it._dateUnreliable
  const usableLots = lotsForSymbol && lotsReconcile(lotsForSymbol, qtyNow) ? lotsForSymbol : null
  return {
    qty: qtyNow,
    acquiredTs: it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0,
    costBasis: qtyNow * (it.purchasePrice || 0),
    lots: dateUnreliable && !usableTx ? null : usableLots,
    holdFlat: !!it._holdFlat || (dateUnreliable && !usableTx),
    txEvents: usableTx,
  }
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests', errorCode: 'RATE_LIMITED' }, { status: 429 })

  const auth = await verifyAuth(request)
  if (auth.error) return auth.error

  try {
    const { items, lots, period, income, breakdown } = await request.json()
    if (!items || !Array.isArray(items) || items.length > 100) {
      return NextResponse.json({ error: 'Invalid request', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }
    if (income && (!Array.isArray(income) || income.length > 2000)) {
      return NextResponse.json({ error: 'Invalid request', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }

    // Reinvested income events raise the value of their linked asset as a
    // step-up from the payment date onward. Cash-destination income is excluded
    // (its value already lives in the destination account's balance), so the
    // client marks those reinvested:false and they never reach here.
    const incomeEvents = []
    if (income && Array.isArray(income)) {
      for (const ev of income) {
        const ts = ev.date ? new Date(ev.date).getTime() : 0
        const amt = Number(ev.amount) || 0
        if (!ts || amt <= 0 || ev.reinvested === false) continue
        incomeEvents.push({
          ts, amount: amt,
          itemId: ev.itemId || null,
          symbol: (ev.symbol || '').toUpperCase().trim() || null,
        })
      }
    }

    const lotsBySymbol = {}
    if (lots && Array.isArray(lots) && lots.length <= 500) {
      for (const lot of lots) {
        const sym = (lot.symbol || '').toUpperCase().trim()
        if (!sym || !lot.quantity) continue
        if (!lotsBySymbol[sym]) lotsBySymbol[sym] = []
        lotsBySymbol[sym].push({
          qty: lot.quantity,
          acquiredTs: lot.acquisitionDate ? new Date(lot.acquisitionDate).getTime() : 0,
          closedTs: lot.closedDate ? new Date(lot.closedDate).getTime() : null,
        })
      }
    }
    const hasLots = Object.keys(lotsBySymbol).length > 0

    let usedTransactional = false

    const per = period || 'YTD'
    if (!VALID_PERIODS.includes(per)) {
      return NextResponse.json({ error: 'Invalid period', errorCode: 'BAD_REQUEST' }, { status: 400 })
    }

    // FASE OA: solo se valida la forma del simbolo de lo que SI se va a pedir
    // a un proveedor. Un activo estatico (bono, banco, inmueble) lleva un
    // simbolo SINTETICO armado del nombre ("BONO-AZUCAR-2027", con acentos o
    // un `%` si el nombre los trae) que jamas sale a la red: rechazar la
    // peticion ENTERA por el (400) dejaba la grafica, el ancla del YTD y el
    // backfill sin respuesta para todo el portafolio por un nombre tecleado.
    for (const it of items) {
      const sym = (it.symbol || '').trim()
      if (sym && isMarketPriced(it) && !SYMBOL_RE.test(sym)) {
        return NextResponse.json({ error: 'Invalid symbol', errorCode: 'BAD_REQUEST' }, { status: 400 })
      }
    }

    const { range, interval } = RANGE_MAP[per] || RANGE_MAP.YTD

    const marketItems = []
    const cryptoItems = []
    const staticItems = []

    items.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase().trim()
      if (!sym) return
      const type = (it.type || '').toLowerCase()
      // Same whitelist as live quotes (isMarketPriced): anything not clearly a
      // market instrument is reconstructed held-flat instead of being priced by
      // whatever Yahoo ticker its symbol happens to match.
      if (!isMarketPriced(it)) {
        staticItems.push(it)
      } else if (/crypto|cripto|blockchain/i.test(type) || CRYPTO_MAP[sym]) {
        cryptoItems.push(it)
      } else {
        marketItems.push(it)
      }
    })

    const allTimeSeries = {}

    // FASE HK. Deadline GLOBAL de la fase de fetches: el cliente aborta a los
    // 30s (authFetch, AbortSignal.timeout), asi que sobrevivir hasta el
    // maxDuration de 60s no sirve de nada si la respuesta llega despues de
    // que el cliente colgo. Pasado el deadline, los simbolos restantes se
    // SALTAN (caen al camino degradado explicito de FASE HJ) y la respuesta
    // sale a tiempo: una respuesta parcial y honesta que llega vale mas que
    // una completa que nadie recibe.
    const fetchDeadline = Date.now() + 20000

    const stockBatches = []
    for (let i = 0; i < marketItems.length; i += 10) stockBatches.push(marketItems.slice(i, i + 10))
    for (const batch of stockBatches) {
      if (Date.now() > fetchDeadline) break
      await Promise.all(batch.map(async (it) => {
        if (Date.now() > fetchDeadline) return
        const sym = it.symbol.toUpperCase()
        const history = await fetchYahooHistory(sym, range, interval)
        // Solo el HISTORIAL se guarda por símbolo (es lo único que de verdad
        // depende del símbolo). La reconstrucción es POR ACTIVO y se arma
        // abajo: ver el comentario de `marketSeries`.
        if (history.length > 0 && !allTimeSeries[sym]) allTimeSeries[sym] = { history }
      }))
    }

    await Promise.all(cryptoItems.map(async (it) => {
      if (Date.now() > fetchDeadline) return
      const sym = it.symbol.toUpperCase()
      const id = CRYPTO_MAP[sym]
      if (!id) return
      const days = getCryptoDays(per)
      const history = await fetchCryptoHistory(id, days)
      if (history.length > 0 && !allTimeSeries[sym]) allTimeSeries[sym] = { history }
    }))

    // FASE HJ. Un ítem de mercado cuyo fetch de historial FALLÓ cae al camino
    // estático (plano al valor de hoy) igual que antes: para MOSTRAR una
    // gráfica, algo es mejor que nada. Pero la respuesta ya no lo esconde:
    // `degraded`/`failedSymbols` viajan al cliente, porque un consumidor que
    // PERSISTE totales (el backfill de snapshots) no debe escribir un pasado
    // reconstruido con símbolos planos: cada sesión fallaba un subconjunto
    // distinto (rate limit de Yahoo con ~20 símbolos en ráfaga) y los docs
    // 'backfill' quedaban a un nivel distinto por pasada, el churn exacto del
    // diente de sierra de la vista "Todas". Un crypto sin id en CRYPTO_MAP no
    // cuenta: ese es estático por diseño (determinista), no por fallo.
    //
    // FASE IN: `failedSymbols` responde "¿debe el backfill abstenerse de
    // escribir?" y por eso deja fuera al crypto sin id en CRYPTO_MAP (estático
    // determinista, no un fallo transitorio). Pero hay una segunda pregunta,
    // distinta y hasta ahora sin respuesta: "¿este activo se MIDIÓ o se
    // mantuvo plano?". Para quien lee un retorno, las dos rutas producen el
    // mismo defecto: un activo plano en su valor de HOY aporta CERO al cambio
    // del período, así que su pérdida (o ganancia) desaparece sin dejar rastro.
    // Eso es exactamente la degradación muda que el invariante 5 prohíbe, una
    // capa más abajo. `staticFallbackSymbols` las junta a las dos: TODO activo
    // de mercado que terminó reconstruido como estático, por la razón que sea.
    const failedSymbols = []
    const staticFallbackSymbols = []
    marketItems.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase()
      if (!allTimeSeries[sym]) {
        failedSymbols.push(sym)
        staticFallbackSymbols.push(sym)
        staticItems.push(it)
      }
    })
    cryptoItems.forEach((it) => {
      const sym = (it.symbol || '').toUpperCase()
      if (!allTimeSeries[sym]) {
        if (CRYPTO_MAP[sym]) failedSymbols.push(sym)
        staticFallbackSymbols.push(sym)
        staticItems.push(it)
      }
    })
    const degraded = failedSymbols.length > 0

    // FASE IO. UNA entrada POR ACTIVO, no por símbolo. `allTimeSeries` se
    // indexa por símbolo porque el historial de precios sí depende solo del
    // símbolo; la reconstrucción (cantidad, lots, ledger) depende del ACTIVO.
    // Mientras las dos cosas vivieron en el mismo mapa, dos posiciones del
    // mismo símbolo en cuentas distintas colapsaban: la segunda sobrescribía a
    // la primera y su cantidad NO se contaba en ningún punto de la serie.
    // El defecto solo aparece en una petición que abarca las dos cuentas (la
    // del panel del YTD), nunca en una escopada a una sola (la de su gráfica),
    // así que se manifiesta como "el panel mide menos que la gráfica sobre los
    // mismos activos", con un desvío que es el valor ENTERO de la posición
    // perdida y por eso constante sesión tras sesión.
    const marketSeries = []
    ;[...marketItems, ...cryptoItems].forEach((it) => {
      const sym = (it.symbol || '').toUpperCase()
      const entry = allTimeSeries[sym]
      if (!entry) return
      marketSeries.push({
        it, sym, history: entry.history,
        ...reconstructionFor(it, sym, hasLots ? lotsBySymbol[sym] : null),
      })
    })

    if (Object.keys(allTimeSeries).length === 0 && staticItems.length === 0) {
      return NextResponse.json({ dataPoints: [], staticTotal: 0, staticPoints: [], degraded, failedSymbols, staticFallbackSymbols })
    }

    const allTs = new Set()
    Object.values(allTimeSeries).forEach(({ history }) => {
      history.forEach((p) => allTs.add(p.ts))
    })

    if (per === 'ALL') {
      const allDates = [
        ...items.map((it) => validAcqTs(it.acquisitionDate)),
        ...(lots || []).map((l) => validAcqTs(l.acquisitionDate)),
      ].filter((t) => t != null)

      let earliest = allDates.length > 0 ? Math.min(...allDates) : 0

      if (earliest === 0 && allTs.size > 0) {
        const threeYearsAgo = Date.now() - 3 * 365.25 * 86400000
        earliest = Math.max(Math.min(...allTs), threeYearsAgo)
      }

      if (earliest > 0) {
        const dayBefore = earliest - 86400000
        allTs.add(dayBefore)
      }
    }

    // Static-only scope (e.g. a single fixed-value account) has no market history
    // to anchor timestamps, which would leave the chart empty. Synthesize a weekly
    // series across the period so fixed-value assets still plot a line.
    //
    // Gated on "no REAL market series" (allTimeSeries), not "allTs is still
    // empty": for period ALL, the block above already added ONE lone point
    // (earliest acquisitionDate minus a day) to allTs before this runs, so a
    // portfolio with zero market items still had allTs.size === 1 here — the
    // gate never fired, and ALL rendered that single point instead of the
    // full weekly-synthesized history back to the account's real first
    // movement (FASE EJ; the chart-side half of this fix is
    // PortfolioGrowthChart's reconstructionIsExact gate on ALL).
    if (Object.keys(allTimeSeries).length === 0 && staticItems.length > 0) {
      const now = Date.now()
      const acqs = staticItems.map((it) => validAcqTs(it.acquisitionDate)).filter((t) => t != null)
      const SPAN = { DAY: 1, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }
      let start
      if (per === 'YTD') start = Date.UTC(new Date().getUTCFullYear(), 0, 1)
      else if (per === 'ALL') start = acqs.length > 0 ? Math.min(...acqs) : now - 365 * 86400000
      else start = now - (SPAN[per] || 365) * 86400000
      // Only ALL cares about the true earliest acquisition. A BOUNDED window
      // (1M, YTD, ...) must stay bounded to what it asked for — dragging start
      // back to an old acquisitionDate turns e.g. a 1M request into a
      // multi-year one, and since the step below goes weekly past 1 day, the
      // resulting grid is phased off a two-year-old anchor instead of the
      // requested window. The 30-day snapshot backfill (useDashboardData)
      // calls this with period '1M' and matches points by EXACT date string —
      // a caller like it never sees the dates it asked for, so a bond added
      // later with a real past acquisitionDate leaves some days holding a
      // stale reconstruction next to fresh ones forever, sawtoothing by that
      // asset's whole value (FASE EG; the other half of the fix is
      // lib/snapshotBackfill.js, which stops treating an old backfill day as
      // "already covered").
      if (per === 'ALL' && acqs.length > 0) start = Math.min(start, ...acqs)
      // Floor the synthesized range: a far-past acquisitionDate (attacker-controlled)
      // could otherwise generate thousands of weekly points and blow up the income-
      // reversal inner loop below (|ts| × |staticItems| × |income|).
      const FLOOR = now - 12 * 365.25 * 86400000
      if (start < FLOOR) start = FLOOR
      // '1M' joins the daily set: it's the period the 30-day backfill asks
      // for, and a purely static reconstruction is cheap enough (no external
      // price fetch) that daily resolution costs nothing extra.
      const step = per === 'DAY' || per === '1W' || per === '1M' ? 86400000 : 7 * 86400000
      for (let t = start; t < now; t += step) allTs.add(t)
      allTs.add(now)
    }

    let sortedTs = [...allTs].sort((a, b) => a - b)
    // Hard cap on the number of timestamps to bound per-request CPU regardless of
    // input source; downsample evenly (keeping the last point) if exceeded.
    const MAX_TS = 800
    if (sortedTs.length > MAX_TS) {
      const stride = sortedTs.length / MAX_TS
      const sampled = []
      for (let i = 0; i < MAX_TS - 1; i++) sampled.push(sortedTs[Math.floor(i * stride)])
      sampled.push(sortedTs[sortedTs.length - 1])
      sortedTs = sampled
    }

    const staticPoints = []
    // Cash accounts with an imported flow history get the TRUE rewind (deposits
    // step the balance up, buys move cash into shares) instead of the flat value
    // plus income-reversal heuristic. Sanitized once, outside the per-ts loop.
    const staticCashFlows = new Map()
    const flowsByItemId = new Map()
    staticItems.forEach((it, si) => {
      const flows = sanitizeEvents(it.cashFlows, 2000, 'amount')
      if (flows) {
        staticCashFlows.set(si, flows)
        if (it.id) flowsByItemId.set(it.id, flows)
      }
    })
    // FASE HU: un cupón en efectivo llega acá por DOS vías (movimiento de saldo
    // del destino + evento de ingreso atribuido al destino). Reversar ambas
    // resta el mismo cupón dos veces, y con clampZero la cuenta desaparece del
    // pasado. Ver dedupeIncomeAgainstFlows para por qué no se puede resolver
    // ignorando el stream de ingresos cuando hay flujos.
    const dedupedIncome = dedupeIncomeAgainstFlows(incomeEvents, flowsByItemId)

    // FASE GQ: per-item value at each timestamp, keyed by item id (falling back to
    // its uppercase symbol for market/crypto items, which are reconstructed per
    // SYMBOL in allTimeSeries rather than per item). Feeds the dashboard's "what
    // drove my YTD" breakdown (useDashboardData.ytdBreakdown) — that consumer
    // already only trusts this when the breakdown's own first point IS the anchor
    // the headline used, so a caller that doesn't ask for it (breakdown !== true)
    // pays nothing extra: byKey stays undefined and every existing consumer that
    // only reads `total` is untouched.
    const wantBreakdown = breakdown === true

    const dataPoints = sortedTs.map((ts) => {
      let total = 0
      let staticSubtotal = 0
      const byKey = wantBreakdown ? {} : null

      staticItems.forEach((it, si) => {
        const flows = staticCashFlows.get(si)
        const itId = it.id || null
        const itSym = (it.symbol || '').toUpperCase().trim() || null
        if (flows) {
          // Only the ONE designated account-level cash line (the broker's real
          // reconciled ledger) promotes the whole response to "transactional" —
          // that flag relaxes flow-netting and rebase logic for the FULL scope,
          // so an unrelated manual item's own contribution history (bonds, cash
          // accounts with a later top-up) must not trip it for a scope that's
          // otherwise still estimated.
          if (it._flowIsAccountLevel) usedTransactional = true
          // Reverses BOTH the deposit/withdrawal flows AND (FASE FD) any income
          // this item reinvested into itself — an item with its own opening
          // deposit AND self-reinvesting yield (ClubCashIn) used to reverse only
          // the deposit, so the chart never showed the accrued interest. See
          // staticItemValueAtTs's own comment for the full story; the two event
          // streams are disjoint per item so combining them can't double-count.
          const v = staticItemValueAtTs((it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0), ts, {
            flows,
            incomeEvents: dedupedIncome,
            itemId: itId,
            itemSym: itSym,
            // A MANUAL account's opening deposit can be larger than the asset it
            // funded, because it carries the entry fee (6,098 deposited into a
            // 6,000 bond). Rewinding past it then lands on -98, which is not "what
            // it was worth", it is "it did not exist yet" — so those flows come
            // flagged and floor at 0. The broker's own reconciled ledger is left
            // alone: a real cash line can legitimately go negative (margin).
            clampZero: !!it._flowClampZero,
          })
          staticSubtotal += v
          total += v
          if (byKey) { const k = itId || itSym; if (k) byKey[k] = (byKey[k] || 0) + v }
          return
        }
        const acqTs = it.acquisitionDate ? new Date(it.acquisitionDate).getTime() : 0
        // Hold-flat items (IBKR import-date positions) keep their current value back
        // through the whole period — their acquisitionDate is a sync stamp, not a
        // real purchase date, so it must not zero out the past.
        if (!it._holdFlat && ts < acqTs) return
        // The current value already includes interest/dividends paid INTO this
        // asset (a bond that reinvests, or a cash account credited by another
        // asset's dividend). So reconstruct the past by REVERSING income that
        // happened AFTER ts — the value steps down before each payment. Market
        // assets get their reinvested shares via lots (qtyAtTime) instead, so
        // this applies only to static items, avoiding double-counting. Always
        // floors at 0 (unconditional, same as before this item ever had a
        // clampZero flag to check).
        const v = staticItemValueAtTs((it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0), ts, {
          incomeEvents,
          itemId: itId,
          itemSym: itSym,
          clampZero: true,
        })
        staticSubtotal += v
        total += v
        if (byKey) { const k = itId || itSym; if (k) byKey[k] = (byKey[k] || 0) + v }
      })
      staticPoints.push({ ts, value: Math.round(staticSubtotal * 100) / 100 })

      marketSeries.forEach((data) => {
        const sym = data.sym
        let price = null
        for (let i = data.history.length - 1; i >= 0; i--) {
          if (data.history[i].ts <= ts) { price = data.history[i].close; break }
        }
        if (price == null && data.history.length > 0) price = data.history[0].close

        let contribution = 0
        if (data.txEvents) {
          // TRUE reconstruction: rewind the current share count through the
          // imported BUY/SELL history. Beats hold-flat and lots because it knows
          // exactly when each share was bought or sold. (Only ledgers that fully
          // account for the current quantity reach here — see reconstructionFor.)
          usedTransactional = true
          contribution = qtyAtTs(data.qty || 0, data.txEvents, ts) * (price || 0)
        } else if (data.holdFlat) {
          // IBKR import-date position: no reliable acquisition date and no genuine
          // trade history, so hold the current quantity flat back through the period
          // (Σ current qty × historical price) instead of zeroing it before the sync
          // stamp. Mirrors the dateUnreliable path in lib/historicalValues.js.
          contribution = (data.qty || 0) * (price || 0)
        } else if (data.lots) {
          // Lots reach here ONLY when the open lots reconcile with the current
          // quantity (reconstructionFor) — stale never-closed lots used to draw a
          // phantom flat line at the old total and a fake crash at "now".
          let qtyAtTime = 0
          for (const lot of data.lots) {
            if (ts >= lot.acquiredTs && (!lot.closedTs || ts < lot.closedTs)) {
              qtyAtTime += lot.qty
            }
          }
          contribution = qtyAtTime * (price || 0)
        } else {
          if (ts < data.acquiredTs) return
          contribution = (data.qty || 0) * (price || 0)
        }
        total += contribution
        // Por ID DE ACTIVO cuando lo hay, igual que la rama estática, y con el
        // símbolo como respaldo para un ítem sin id. Antes iba SIEMPRE por
        // símbolo, así que dos posiciones del mismo símbolo compartían llave y
        // el consumidor le entregaba la suma entera a la primera que encontrara:
        // una cuenta se quedaba con el valor de la otra. El consumidor ya
        // resuelve las dos formas (`it.id === k || it.symbol === k`).
        if (byKey) { const k = data.it?.id || sym; byKey[k] = (byKey[k] || 0) + contribution }
      })

      const point = { ts, total: Math.round(total * 100) / 100 }
      if (byKey) {
        point.byKey = Object.fromEntries(
          Object.entries(byKey).map(([k, v]) => [k, Math.round(v * 100) / 100])
        )
      }
      return point
    })

    const staticTotal = staticItems.reduce((s, it) => {
      return s + (it.quantity || 1) * (it.currentPrice || it.purchasePrice || 0)
    }, 0)

    return NextResponse.json({ dataPoints, staticTotal, staticPoints, transactional: usedTransactional, degraded, failedSymbols, staticFallbackSymbols, cache: kvBackend() })
  } catch (err) {
    console.error('portfolio-history error:', err)
    return NextResponse.json({ error: 'Internal server error', errorCode: 'INTERNAL', dataPoints: [] }, { status: 500 })
  }
}
