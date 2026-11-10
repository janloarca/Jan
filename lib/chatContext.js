// FASE RQ. Los HECHOS que el asistente puede citar, armados del lado del
// cliente con las MISMAS cifras que ya muestra la app. Puro (sin React ni
// Firestore) para poder probarlo.
//
// Por qué existe: el asistente inventaba cuando un dato no le llegaba. Le
// preguntaron por el rendimiento contra el S&P 500 y contestó "1 ene 2025 →
// hoy, S&P −3% a −5%, tu cartera le ganó" mientras el panel decía SPX +10.08%
// contra la cartera −0.58%: no tenía ni la fecha de hoy, ni el benchmark, ni el
// arranque del YTD. Y dio "VOO ~$378/año" cuando el panel decía $306.26, porque
// solo le llegaba un `incomeRate` y lo multiplicaba por su cuenta. La regla es:
// todo número que el asistente pueda repetir sale de acá, ya calculado y
// rotulado, y lo que no está acá el asistente tiene que decir que no lo tiene.

import { reinvestIndex, isReinvestedDividend } from './dividendCash.js'
import { todayLocalISO } from './localDate.js'

const finite = (v) => (typeof v === 'number' && isFinite(v) ? v : null)
const round2 = (v) => (finite(v) == null ? null : Math.round(v * 100) / 100)

// Qué tan "observado" es el arranque del año. Misma tabla que el panel del YTD
// (YtdBreakdownSection), en palabras que el modelo puede repetir.
export const ANCHOR_KIND = {
  daily: 'observed',
  manual: 'transcribed',
  ibkr: 'observed',
  ibkr_quarterly: 'transcribed',
  backfill: 'estimated',
  reconstruction: 'estimated',
}

export function anchorKind(src) {
  if (!src) return 'estimated'
  return ANCHOR_KIND[src] || 'estimated'
}

function isoDay(ts) {
  if (finite(ts) == null) return null
  return new Date(ts).toISOString().slice(0, 10)
}

// El dividendo pertenece al ítem por vínculo; sin vínculo, por símbolo (la
// misma regla que la card de Ingresos Pasivos).
function belongs(tx, it) {
  if (tx._linkedItemId) return tx._linkedItemId === it.id
  const s = (tx.symbol || '').toUpperCase()
  return !!s && s === (it.symbol || '').toUpperCase()
}

/**
 * Cobrado en efectivo, por año calendario en curso (YTD) y en 12 meses
 * rodantes. Dos cifras distintas, nunca una sola llamada "anual".
 */
export function dividendsReceived({ transactions = [], items = [], convert, baseCurrency = 'USD', now = new Date() }) {
  const idx = reinvestIndex(items)
  const year = now.getFullYear()
  const cutoff = now.getTime() - 365 * 86400000
  let ytd = 0
  let trailing12m = 0
  const ytdByItem = new Map()
  for (const tx of transactions || []) {
    if ((tx.type || '').toUpperCase() !== 'DIVIDEND') continue
    if (isReinvestedDividend(tx, idx)) continue
    const raw = Number(tx.totalAmount) || 0
    const amt = convert ? convert(raw, tx.currency || 'USD', baseCurrency) : raw
    if (!isFinite(amt)) continue
    const d = typeof tx.date === 'string' ? tx.date.slice(0, 10) : null
    if (!d) continue
    const ts = Date.parse(d)
    if (Number(d.slice(0, 4)) === year) {
      ytd += amt
      for (const it of items) {
        if (belongs(tx, it)) { ytdByItem.set(it.id, (ytdByItem.get(it.id) || 0) + amt); break }
      }
    }
    if (isFinite(ts) && ts >= cutoff) trailing12m += amt
  }
  return { ytd: round2(ytd), trailing12m: round2(trailing12m), ytdByItem }
}

/**
 * El contexto completo. `incomeProjections` es el mapa id -> {annual, currency}
 * que ya calcula useDashboardData (la MISMA cifra que muestra la card).
 */
export function buildChatContext({
  items = [], transactions = [], convert, baseCurrency = 'USD', now = new Date(),
  netWorth, totalAssets,
  returnYTD, ytdChange, ytdStartValue, ytdStartTs, ytdStartSrc,
  returnSinceStart, sinceStartDate,
  benchmarkReturn, benchmarkName,
  estimatedAnnualIncome, incomeProjections,
  riskMetrics,
} = {}) {
  const div = dividendsReceived({ transactions, items, convert, baseCurrency, now })
  const proj = incomeProjections instanceof Map ? incomeProjections : new Map()
  const projectedInBase = (id) => {
    const p = proj.get(id)
    if (!p || !(p.annual > 0)) return null
    const v = convert ? convert(p.annual, p.currency || baseCurrency, baseCurrency) : p.annual
    return round2(v)
  }
  return {
    today: todayLocalISO(now),
    year: now.getFullYear(),
    baseCurrency,
    netWorth: round2(netWorth),
    totalAssets: round2(totalAssets),
    ytd: finite(returnYTD) == null ? null : {
      returnPct: round2(returnYTD),
      gain: round2(ytdChange),
      startValue: round2(ytdStartValue),
      startDate: isoDay(ytdStartTs),
      startKind: anchorKind(ytdStartSrc),
      method: 'Modified Dietz (money-weighted, net of deposits and withdrawals)',
    },
    sinceStart: finite(returnSinceStart) == null ? null : {
      returnPct: round2(returnSinceStart),
      startDate: typeof sinceStartDate === 'string' ? sinceStartDate.slice(0, 10) : isoDay(sinceStartDate),
    },
    benchmark: finite(benchmarkReturn) == null ? null : {
      name: benchmarkName || 'S&P 500',
      ytdReturnPct: round2(benchmarkReturn),
      // ^GSPC es un índice de PRECIO: no incluye dividendos reinvertidos.
      kind: 'price return (dividends not included)',
    },
    income: {
      receivedYTD: div.ytd,
      receivedTrailing12m: div.trailing12m,
      estimatedAnnual: round2(estimatedAnnualIncome),
    },
    riskMetrics: riskMetrics || null,
    items: (items || []).map((it) => ({
      id: it.id,
      name: it.name, symbol: it.symbol, type: it.type, subtype: it.subtype,
      quantity: it.quantity, purchasePrice: it.purchasePrice, currentPrice: it.currentPrice,
      currency: it.currency, institution: it.institution,
      isDebt: it.isDebt, isReceivable: it.isReceivable,
      interestRate: it.interestRate, debtTerm: it.debtTerm,
      monthlyPayment: it.monthlyPayment, installmentsRemaining: it.installmentsRemaining,
      rewardType: it.rewardType, rewardBalance: it.rewardBalance, cardBrand: it.cardBrand,
      maturityDate: it.maturityDate, acquisitionDate: it.acquisitionDate, notes: it.notes,
      projectedAnnualIncome: projectedInBase(it.id),
      incomeReceivedYTD: div.ytdByItem.has(it.id) ? round2(div.ytdByItem.get(it.id)) : null,
    })),
  }
}
