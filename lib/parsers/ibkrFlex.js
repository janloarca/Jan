// Pure parsing + error-classification layer for the IBKR Flex Web Service XML.
// Extracted from app/api/brokers/ibkr/route.js so it can be unit-tested: Next.js
// route files may only export HTTP handlers, so anything living there is
// invisible to jest. This is exactly the surface where the recurring bugs showed
// up (the "self-closing only" regex class, the cash-transaction type filter, the
// empty-report gate, the error classification), so it is the surface that most
// needs coverage. Same pattern already used for ibkrCashReport / ibkrEquitySummary.
//
// Behavior is a verbatim move: no logic changed during the extraction.

import { parseEquitySummary, unattributedEquityDates } from './ibkrEquitySummary'
import { decodeXmlEntities } from './xmlEntities'
import { parseCashPositions, unattributedCashCurrencies } from './ibkrCashReport'
import { normalizeFlexDate } from './flexDate'

// ⛔ FASE KN. El Flex Token viaja en la URL como `?t=<token>`, y a esta función
// se le pasa también el mensaje de un fetch fallido, que puede traer la URL
// adentro. Guardar ese texto crudo sin redactar dejaría el token en el doc de
// settings del usuario y en cualquier captura de pantalla.
const MAX_RAW = 300
function redactRaw(msg) {
  if (!msg) return null
  return String(msg).replace(/([?&]t=)[^&\s]*/gi, '$1***').slice(0, MAX_RAW)
}

// Devuelve `{ errorCode, error, raw }`. `raw` es lo que IBKR dijo LITERALMENTE:
// para todo código mapeado, `error` es texto NUESTRO (más accionable), así que
// sin este campo las palabras exactas del servidor se perdían. Importa porque
// no todos los estados de IBKR están documentados: el bloqueo por intentos
// fallidos no figura en ninguno de los 19 códigos de la spec v3, y ahí el texto
// crudo es la única evidencia de qué pasó.
export function classifyError(errMsg, errCode) {
  const raw = redactRaw(errMsg)
  const out = classifyErrorInner(errMsg, errCode)
  return raw ? { ...out, raw } : out
}

function classifyErrorInner(errMsg, errCode) {
  // IBKR's documented numeric Flex codes are far more stable than its English
  // phrasing — map them first so a reworded message never degrades to UNKNOWN.
  const code = String(errCode || '').trim()
  if (code) {
    // 1019/1018: statement generation in progress → retryable.
    if (code === '1019' || code === '1018') return { errorCode: 'RATE_LIMITED', error: 'IBKR está generando el reporte. Reintentando...' }
    // 1020 invalid request · 1021 invalid reference code.
    if (code === '1020' || code === '1021') return { errorCode: 'RATE_LIMITED', error: 'IBKR pidió reintentar la solicitud. Reintentando...' }
    // 1003/1004/1005 statement/token/query problems.
    if (code === '1003') return { errorCode: 'INVALID_QUERY', error: 'El Query ID no existe o el reporte no está disponible. Verifica en IBKR → Flex Queries.' }
    // 1012 es el código de "Token has expired", la causa MÁS común de que un
    // sync que funcionaba deje de funcionar (IBKR expira los Flex Token solos).
    // No tenía rama: caía a UNKNOWN, que no es fatal, así que el auto-sync
    // seguía reintentando cada 30 minutos con un token muerto y el usuario
    // nunca veía el mensaje de "genera uno nuevo". Cada reintento suma un
    // intento fallido, que es justo lo que dispara el bloqueo de IBKR.
    if (code === '1012' || code === '1015' || code === '1016' || code === '1017') return { errorCode: 'TOKEN_EXPIRED', error: 'Tu Flex Token expiró o es inválido. Genera uno nuevo en IBKR.' }
    // 1014: la query no es válida (borrada, desactivada, o de otro usuario).
    if (code === '1014') return { errorCode: 'INVALID_QUERY', error: 'El Query ID no existe o no está activo. Verifica en IBKR → Flex Queries.' }
  }
  const msg = (errMsg || '').toLowerCase()
  // IBKR lockout after repeated failed logins ("Too many failed attempts. Please
  // review your configuration."). MUST be fatal: every retry counts as another
  // failed login and refreshes the lock — the old UNKNOWN classification let the
  // 30-min auto-sync keep the account blocked indefinitely.
  if (msg.includes('too many failed attempts') || msg.includes('review your configuration'))
    // Solo el HECHO, sin prescripción: qué hacer lo decide el cliente, que sí
    // sabe hace cuánto dura el bloqueo (lib/ibkrRetryPolicy.js). Este mensaje
    // decía "reintenta en ~1 hora", que es cierto el primer día y falso a la
    // semana, y encima quedaba impreso junto al consejo del cliente diciendo lo
    // mismo con otras palabras.
    return { errorCode: 'LOCKED', error: 'IBKR rechazó el acceso por intentos fallidos ("Too many failed attempts").' }
  // "expired" SOLO junto a "token": a secas podría atrapar un mensaje sobre un
  // reference code vencido, que es transitorio y se reintenta, y marcarlo fatal
  // detendría el sync de alguien cuyo token está perfecto.
  if (msg.includes('invalid token') || msg.includes('token is not valid') || msg.includes('not authenticated')
    || (msg.includes('expired') && msg.includes('token')))
    return { errorCode: 'TOKEN_EXPIRED', error: 'Tu Flex Token expiró o es inválido. Genera uno nuevo en IBKR.' }
  // "query is invalid" además de "invalid query": IBKR usa las dos formas y la
  // condición vieja solo cubría una.
  if (msg.includes('invalid query') || msg.includes('query is invalid') || msg.includes('no matching flex') || msg.includes('query id'))
    return { errorCode: 'INVALID_QUERY', error: 'El Query ID no existe o no está activo. Verifica en IBKR → Flex Queries.' }
  if (msg.includes('try again') || msg.includes('could not be generated') || msg.includes('please try'))
    return { errorCode: 'RATE_LIMITED', error: 'IBKR está ocupado generando el reporte. Reintentando...' }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort'))
    return { errorCode: 'TIMEOUT', error: 'IBKR no respondió a tiempo. Intenta de nuevo en unos minutos.' }
  return { errorCode: 'UNKNOWN', error: errMsg || 'Error desconocido de IBKR.' }
}

export function mapAssetCategory(cat, putCall) {
  const c = (cat || '').toUpperCase()
  if (c === 'STK' || c === 'STOCK') return 'Stock'
  if (c === 'BOND' || c === 'BILL') return 'Bond'
  if (c === 'FUND' || c === 'ETF') return 'ETF'
  if (c === 'CASH') return 'Bank'
  if (c === 'OPT' || c === 'FOP') return putCall ? `Option (${putCall})` : 'Option'
  if (c === 'FUT') return 'Futures'
  if (c === 'CRYPTO') return 'Crypto'
  if (c === 'WAR') return 'Warrant'
  return c || 'Stock'
}

// ⛔ La definición vive en `./flexDate` y la comparte con `ibkrEquitySummary`:
// eran DOS copias y cada una fallaba con un separador distinto (esta con la
// coma, la del NAV con el punto y coma), o sea un depósito o un día entero de
// historial desaparecía en silencio según cómo estuviera configurado el Flex
// Query. Se re-exporta con el nombre viejo para no tocar a sus callers.
export const formatDate = normalizeFlexDate

export function parseFlexPositions(xml) {
  const positions = []
  // \b[^>]*> matches self-closing AND paired tag shapes (rule from CLAUDE.md:
  // a `/>`-only regex silently drops every row on reports that emit paired tags;
  // the \b keeps the <OpenPositions> container from matching).
  const posRegex = /<OpenPosition\b[^>]*>/g
  let match
  while ((match = posRegex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'))
      // FASE KD: el valor viene con las entidades XML sin decodificar
      // (`AT&amp;T INC`). Se hace acá, una sola vez para todo atributo.
      return m ? decodeXmlEntities(m[1]) : ''
    }
    const symbol = attr('symbol')
    const qty = parseFloat(attr('position')) || 0
    if (!symbol || qty === 0) continue
    positions.push({
      symbol: symbol.toUpperCase(),
      name: attr('description') || symbol,
      quantity: Math.abs(qty),
      purchasePrice: parseFloat(attr('costBasisPrice')) || 0,
      currentPrice: parseFloat(attr('markPrice')) || parseFloat(attr('closePrice')) || 0,
      currency: attr('currency') || 'USD',
      type: mapAssetCategory(attr('assetCategory'), attr('putCall')),
      institution: 'Interactive Brokers',
      acquisitionDate: formatDate(attr('openDateTime')) || undefined,
      isDebt: qty < 0,
      _ibkrAccountId: attr('accountId'),
      _ibkrConId: attr('conid'),
      _levelOfDetail: (attr('levelOfDetail') || '').toUpperCase(),
    })
  }
  return collapseLotRows(positions)
}

// A Flex Query whose Open Positions section is set to "Lots" emits BOTH a
// SUMMARY row per holding AND one LOT row per tax lot. Summing them blindly
// double-counts every position and inflates net worth, which is the single most
// damaging bug this app can ship (see the broker-sync duplication incident).
//
// So: collapse per holding. The SUMMARY row is the authority on quantity and
// cost basis; the LOT rows are the authority on WHEN each parcel was bought, and
// the earliest of them is the position's real acquisition date. That date is the
// whole reason to turn Lots on: it arrives with today's positions, so the chart
// stops estimating the past even when the query period is short.
export function collapseLotRows(positions) {
  const hasLots = positions.some((p) => p._levelOfDetail === 'LOT')
  if (!hasLots) return positions.map(({ _levelOfDetail, ...p }) => p)

  const groups = new Map()
  for (const p of positions) {
    const key = `${p._ibkrConId || p.symbol}|${p._ibkrAccountId || ''}`
    if (!groups.has(key)) groups.set(key, { summary: null, lots: [] })
    const g = groups.get(key)
    if (p._levelOfDetail === 'LOT') g.lots.push(p)
    else if (!g.summary) g.summary = p
  }

  const out = []
  for (const { summary, lots } of groups.values()) {
    // Earliest parcel wins: it is when this holding actually started existing.
    const earliest = lots
      .map((l) => l.acquisitionDate)
      .filter(Boolean)
      .sort()[0]

    if (summary) {
      const { _levelOfDetail, ...base } = summary
      out.push({ ...base, ...(earliest ? { acquisitionDate: earliest } : {}) })
      continue
    }
    // Lots only (no summary row): rebuild the holding by adding the parcels up.
    const { _levelOfDetail, ...base } = lots[0]
    out.push({
      ...base,
      quantity: lots.reduce((s, l) => s + (l.quantity || 0), 0),
      ...(earliest ? { acquisitionDate: earliest } : {}),
    })
  }
  return out
}

export function parseTrades(xml) {
  const trades = []
  // Self-closing AND paired shapes; \b keeps the <Trades> container out.
  const tradeRegex = /<Trade\b[^>]*>/g
  let match
  while ((match = tradeRegex.exec(xml)) !== null) {
    const tag = match[0]
    const attr = (name) => {
      const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'))
      // FASE KD: el valor viene con las entidades XML sin decodificar
      // (`AT&amp;T INC`). Se hace acá, una sola vez para todo atributo.
      return m ? decodeXmlEntities(m[1]) : ''
    }
    const symbol = attr('symbol')
    if (!symbol) continue
    trades.push({
      symbol: symbol.toUpperCase(),
      description: attr('description') || symbol,
      buySell: attr('buySell'),
      quantity: parseFloat(attr('quantity')) || 0,
      tradePrice: parseFloat(attr('tradePrice')) || 0,
      proceeds: parseFloat(attr('proceeds')) || 0,
      commission: parseFloat(attr('ibCommission') || attr('commission')) || 0,
      currency: attr('currency') || 'USD',
      // NORMALIZADA en el parser, no en cada consumidor. IBKR emite "20260115"
      // y `new Date("20260115")` es Invalid Date: cualquier consumidor que la
      // parsee como fecha (buildTxEvents, que reconstruye tus posiciones
      // rebobinando compras y ventas) descarta la fila en silencio. El
      // adaptador del archivo ya llamaba a formatDate por su cuenta; el sync
      // por API no, así que el MISMO trade llegaba con dos formas distintas
      // según por dónde entrara y el ledger del broker quedaba invisible para
      // la reconstrucción. formatDate es idempotente sobre "2026-01-15", así
      // que el adaptador puede seguir llamándolo sin cambiar nada.
      // El respaldo al crudo es a propósito: si formatDate no reconoce el
      // formato (el usuario cambió el Date Format de la query), devolver
      // undefined haría que el caller estampara la fecha de HOY sobre un trade
      // viejo, que es una fecha equivocada con cara de válida. Preferimos
      // dejarlo como estaba: el dato queda visible y la fila se salta aguas
      // abajo, en vez de mentir sobre cuándo pasó.
      tradeDate: formatDate(attr('tradeDate') || attr('dateTime')) || attr('tradeDate') || attr('dateTime'),
      accountId: attr('accountId'),
      assetCategory: attr('assetCategory'),
      costBasis: parseFloat(attr('cost')) || 0,
      realizedPL: parseFloat(attr('fifoPnlRealized') || attr('realizedPL')) || 0,
      // Only present when the query includes the Trade ID column. The XML file
      // adapter turns it into _ibkrTxnId for collision-safe dedup; the API sync
      // ignores it (its deterministic doc ids must stay stable).
      tradeId: attr('tradeID') || '',
    })
  }
  return trades
}

// External cash flows — deposits & withdrawals. These are what Modified Dietz
// needs to strip contributions from performance; without them, an auto-synced
// IBKR portfolio's YTD/MTD return is distorted by unaccounted deposits. IBKR
// tags them type="Deposits/Withdrawals"; the sign of `amount` decides direction.
export function parseCashTransactions(xml) {
  const txns = []
  // Self-closing AND paired tag shapes (same bug class fixed for EquitySummary
  // and CashReport: a `/>`-only regex silently drops everything on reports that
  // emit paired tags).
  const regex = /<CashTransaction\b[^>]*>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    const tag = match[0]
    // (?:^|\s) boundary: without it, attr('type') matched the TAIL of
    // securityIDType="" (case-insensitive, and IBKR emits it BEFORE type= when
    // the query has all fields selected), so EVERY cash transaction classified
    // as empty-type and was dropped: zero deposits, dividends and taxes
    // imported while the section counter saw 175 rows. Same fix applied to
    // every attr() helper in these parsers: positions/trades only survived by
    // luck of attribute order. Fourth Flex regex bug: after `\b[^>]*>` for
    // tags, attributes need their own boundary too.
    const attr = (name) => {
      const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'))
      // FASE KD: el valor viene con las entidades XML sin decodificar
      // (`AT&amp;T INC`). Se hace acá, una sola vez para todo atributo.
      return m ? decodeXmlEntities(m[1]) : ''
    }
    const type = attr('type')
    const isFlow = /deposit|withdrawal/i.test(type)
    // "Dividends", "Payment In Lieu Of Dividends": cash income the account
    // received. Needed for the transaction-rewind cash line and the income module.
    const isDividend = /dividend/i.test(type)
    // Costs the account paid (or interest received). These used to be dropped in
    // silence, so real fees/taxes never reached the app. Now captured for the
    // Costs view. Order matters: dividend/flow are checked first so a
    // "Payment In Lieu Of Dividends" never falls into the fee bucket.
    const isTax = /tax|withholding/i.test(type)
    const isInterest = /interest/i.test(type)
    const isFee = /fee|commission/i.test(type)
    let kind = null
    if (isFlow) kind = 'flow'
    else if (isDividend) kind = 'dividend'
    else if (isTax) kind = 'tax'
    else if (isInterest) kind = 'interest'
    else if (isFee) kind = 'fee'
    if (!kind) continue
    const amount = parseFloat(attr('amount')) || 0
    if (amount === 0) continue
    const date = formatDate(attr('dateTime') || attr('reportDate') || attr('settleDate'))
    if (!date) continue
    txns.push({
      amount,
      currency: attr('currency') || 'USD',
      date,
      txnId: attr('transactionID') || '',
      description: attr('description') || attr('type') || '',
      accountId: attr('accountId') || '',
      kind,
      symbol: (attr('symbol') || '').toUpperCase(),
    })
  }
  return txns
}

// EquitySummaryByReportDateInBase values are in the account's BASE currency, not
// necessarily USD. Detect that base currency from AccountInformation when present
// so the client can convert; defaults to USD (current behavior) when absent.
export function parseBaseCurrency(xml) {
  const m = xml.match(/<AccountInformation\b[^>]*\bcurrency="([^"]+)"/i)
  return (m && m[1] ? m[1].toUpperCase() : 'USD')
}

export function parseXmlToData(xml) {
  const positions = parseFlexPositions(xml)
  const cash = parseCashPositions(xml)
  const trades = parseTrades(xml)
  const cashTransactions = parseCashTransactions(xml)
  const baseCurrency = parseBaseCurrency(xml)
  const equityHistory = parseEquitySummary(xml).map((e) => ({ ...e, _equityCurrency: baseCurrency }))
  const all = [...positions, ...cash]

  // RAW per-section tag counts, independent of what the parsers accepted. This is
  // the forensic layer: it distinguishes "the Flex Query does not deliver this
  // section" (count 0 → fix the query config) from "the section arrives but our
  // pipeline drops it" (count > 0 with 0 imported → our bug).
  const countTags = (name) => (xml.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) || []).length
  const sections = {
    openPositions: countTags('OpenPosition'),
    trades: countTags('Trade'),
    cashTransactions: countTags('CashTransaction'),
    equitySummary: countTags('EquitySummaryByReportDateInBase'),
    cashReport: countTags('CashReportCurrency'),
    // FASE MP: filas que compiten por la misma llave porque el reporte no trae
    // `accountId`. Viven acá y no en un campo aparte porque son de la misma
    // naturaleza que el resto: forense del archivo, no del resultado.
    unattributedEquityDates: unattributedEquityDates(xml),
    unattributedCashCurrencies: unattributedCashCurrencies(xml),
  }

  // equityHistory counts too: a valid history-only / fully-liquidated query that
  // returns just the NAV series must NOT be discarded as EMPTY_REPORT.
  if (all.length === 0 && trades.length === 0 && cashTransactions.length === 0 && equityHistory.length === 0) {
    return { empty: true, sections }
  }

  return {
    positions: all,
    trades,
    cashTransactions,
    equityHistory,
    sections,
    count: all.length,
    syncedAt: new Date().toISOString(),
  }
}
