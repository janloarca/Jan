// Parser for the IBKR Flex Query "Cash Report" section: the account's cash balance
// per currency (<CashReportCurrency currency=".." endingCash="..">). Without this
// section in the Flex Query there are no rows and the account's cash silently never
// shows up in the portfolio.
//
// Extracted from the route handler so it can be unit-tested (Next.js route files only
// allow HTTP-method / segment-config exports).
import { decodeXmlEntities } from './xmlEntities'

// Match the opening tag whether it is self-closing (<... />) or paired
// (<...>...</...>): IBKR emits either shape depending on the report version, and
// every attribute we read lives on the opening tag. A `/>`-only regex silently
// dropped ALL cash for accounts whose Flex used the paired form (same bug class as
// parseEquitySummary, fixed in FASE AE). The optional (?:Currency)? also matches the
// bare <CashReport> container, which has no currency attribute and falls through
// the guard below.
//
// UNA sola definición para el parser y para el detector de FASE MP.
const CASH_TAG = /<CashReport(?:Currency)?\b[^>]*>/g

function attrOf(tag) {
  return (name) => {
    const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'))
    // FASE KD: el valor viene con las entidades XML sin decodificar
    // (`AT&amp;T INC`). Se hace acá, una sola vez para todo atributo.
    return m ? decodeXmlEntities(m[1]) : ''
  }
}

function cashBalance(attr) {
  return parseFloat(attr('endingCash')) || parseFloat(attr('endingSettledCash')) || 0
}

export function parseCashPositions(xml) {
  if (!xml) return []
  const positions = []
  const seen = new Set()
  const cashRegex = new RegExp(CASH_TAG.source, 'g')
  let match
  while ((match = cashRegex.exec(xml)) !== null) {
    const attr = attrOf(match[0])
    const currency = attr('currency')
    const balance = cashBalance(attr)
    if (!currency || currency === 'BASE_SUMMARY' || balance === 0) continue
    // A report can repeat the same currency (per-account plus summary detail rows).
    // First occurrence wins; keyed by account+currency so true multi-account cash
    // still comes through as separate rows.
    const key = `${attr('accountId')}-${currency}`
    if (seen.has(key)) continue
    seen.add(key)
    positions.push({
      symbol: `CASH-${currency}`,
      name: `Cash (${currency})`,
      quantity: 1,
      purchasePrice: Math.abs(balance),
      currentPrice: Math.abs(balance),
      currency,
      type: 'Bank',
      institution: 'Interactive Brokers',
      isDebt: balance < 0,
    })
  }
  return positions
}

// ⛔ FASE MP. El mismo hueco que `unattributedEquityDates`, del lado del
// efectivo: sin `accountId` las dos cuentas comparten la llave `-USD`, la
// primera gana, y el efectivo de la otra nunca aparece en el portafolio.
//
// Acá el "no sumar" no es precaución: el comentario del dedupe de arriba ya
// documenta que un reporte repite la misma moneda "per-account plus summary
// detail rows", o sea la fila consolidada EXISTE y es indistinguible de una
// segunda cuenta cuando el campo falta. Sumarlas contaría el efectivo dos
// veces. Se avisa y se nombra el arreglo, que vive del lado del usuario.
//
// Mismo criterio que su hermana: solo cuenta cuando los saldos DIFIEREN, para
// no gritar lobo sobre una página repetida.
export function unattributedCashCurrencies(xml) {
  if (!xml) return 0
  const byCurrency = new Map()
  const regex = new RegExp(CASH_TAG.source, 'g')
  let match
  while ((match = regex.exec(xml)) !== null) {
    const attr = attrOf(match[0])
    if (attr('accountId')) continue
    const currency = attr('currency')
    const balance = cashBalance(attr)
    if (!currency || currency === 'BASE_SUMMARY' || balance === 0) continue
    if (!byCurrency.has(currency)) byCurrency.set(currency, new Set())
    byCurrency.get(currency).add(balance)
  }
  let currencies = 0
  for (const balances of byCurrency.values()) if (balances.size > 1) currencies++
  return currencies
}
