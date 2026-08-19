// El cuerpo de la petición a /api/prices/portfolio-history, en UN solo lugar.
//
// ⛔ POR QUÉ ESTO EXISTE (FASE JU). Tres superficies reconstruyen el pasado con
// la MISMA ruta y cada una armaba su propio payload: el backfill automático, el
// botón "Reparar ahora" y la gráfica. El botón se quedó sin `income` (la
// corriente de rendimiento reinvertido) y sin `lots`, así que archivaba un ancla
// de 1 de enero donde una cuenta que compone quedaba pegada a su valor de HOY.
// El panel del YTD, que sí pide `income` en su propio fetch, medía esa cuenta
// bien, y la diferencia salía en la fila "Sin atribuir".
//
// La regla que se deriva: el rendimiento REINVERTIDO nunca entra a
// `balanceEventsById` (indexBalanceEvents lo manda a reinvestBySym/ById), así
// que `income` es el ÚNICO canal por el que el server se entera de él. Un
// consumidor que arma `items` a mano y se olvida de `income` no falla
// ruidosamente: reconstruye plano y parece que funciona.
//
// Callers: hooks/useDashboardData.js (backfill + ancla del YTD) y
// components/dashboard/PortfolioGrowthChart.jsx (repair). La gráfica conserva
// su propio armado porque marca `_flowIsAccountLevel` en la línea de efectivo
// del broker (ver abajo), que es una diferencia deliberada, no una copia.
import { buildTxEvents, buildCashFlows, rewindableTradeSymbols, brokerAccountTransactions } from '@/lib/portfolioRewind'
import { indexBalanceEvents } from '@/lib/historicalValues'
import { shouldHoldFlat, hasUnreliableAcqDate, buildIncomeEvents } from '@/components/dashboard/utils'

// FASE GE. Un solo constructor del payload de items. Antes el backfill mandaba
// items SIN txEvents/cashFlows: los docs 'backfill' que escribía eran lot-aware
// para las posiciones con trades reales (las compras de mitad de año NO existen
// en el valor de enero) pero ciegos al timing de los depósitos, y el YTD
// anclado en uno de esos docs excluía además los flujos de IBKR (regla de FASE
// AI, pensada para reconstrucciones hold-flat puras donde el depósito ya vive
// dentro del valor de arranque): cada depósito al broker durante el año se leía
// como ganancia.
export function buildHistoryItemsPayload({ items, transactions, lots, convert }) {
  const txEventsBySym = buildTxEvents(transactions)
  // FASE IX. Dos reglas, las dos para que las dos mitades del rebobinado
  // (efectivo y acciones) hablen del mismo portafolio:
  //  · la caja del broker solo lleva movimientos de ESA cuenta (si no, cada
  //    depósito manual se deshace dos veces y el efectivo del pasado se hunde), y
  //  · solo entran los trades cuyas acciones el server también va a rebobinar.
  // Ver lib/portfolioRewind.js para el detalle de cada una.
  const brokerItems = (items || []).filter((it) => it?._source === 'ibkr')
  const brokerTx = brokerAccountTransactions(transactions, brokerItems)
  const accountCashFlows = buildCashFlows(brokerTx,
    (amt, cur2) => convert ? convert(amt, cur2, 'USD') : amt,
    { rewindableSymbols: rewindableTradeSymbols(items, txEventsBySym) })
  // Only rewind the cash line when there is a REAL external flow
  // (deposit/withdrawal). With hold-flat stocks, rewinding cash by BUY/SELL
  // double-counts (the flat holding already implies the shares were owned),
  // which collapses the January baseline and blows up the YTD Dietz. Without
  // deposits, leave cash flat.
  const hasExternalFlow = brokerTx.some((t) => /^(DEPOSIT|WITHDRAWAL)$/i.test(t.type || ''))
  // Prefer the CASH-{ccy} holding; fall back to any single IBKR bank-type item
  // so the ledger still rebuilds cash when the symbol isn't exactly CASH-*.
  const cashItem = (accountCashFlows.length > 0 && hasExternalFlow)
    ? ((items || []).find((it) => it._source === 'ibkr' && /^CASH-/i.test(it.symbol || ''))
       || (items || []).find((it) => it._source === 'ibkr' && /bank|cash/i.test(it.type || '')))
    : null
  // Per-item balance history for the MANUAL side, from the same index the
  // spreadsheet reconstructs with. Without it a destination account was held
  // flat at today's balance all the way back, so a coupon earned in May was
  // already sitting there on Jan 1: start and end matched and YTD read +0.00%
  // on a bond that had really paid 240 (FASE DW). Note these never carry
  // _flowIsAccountLevel — only the broker's own reconciled cash ledger
  // promotes the whole response to "transactional".
  const { balanceEventsById } = indexBalanceEvents(transactions, items, convert, 'USD')
  return (items || []).map((it) => {
    const cur = it._originalCurrency || it.currency || 'USD'
    const toUSD = (p) => convert ? convert(p || 0, cur, 'USD') : (p || 0)
    return {
      id: it.id,
      symbol: it.symbol, type: it.type, quantity: it.quantity,
      currentPrice: toUSD(it._originalPrice ?? it.currentPrice),
      purchasePrice: toUSD(it._originalPurchasePrice ?? it.purchasePrice),
      currency: 'USD',
      acquisitionDate: it.acquisitionDate,
      _holdFlat: shouldHoldFlat(it, transactions, lots),
      // FASE HL: la fecha es un sello de sync, así que el server no puede
      // usarla como puerta de existencia (ni los lots que ese import creó).
      _dateUnreliable: hasUnreliableAcqDate(it),
      txEvents: txEventsBySym[(it.symbol || '').toUpperCase()] || undefined,
      // The broker's own reconciled ledger keeps the shape it always had. A
      // manual account's flows are marked _flowClampZero: an opening DEPOSIT
      // can exceed the asset's own value (it carries the entry fee: 6,098
      // deposited into a 6,000 bond), and rewinding past it would leave the
      // asset at -98 instead of "did not exist yet".
      ...(cashItem && it.id === cashItem.id
        ? { cashFlows: accountCashFlows }
        : (balanceEventsById[it.id]?.length
          ? { cashFlows: balanceEventsById[it.id], _flowClampZero: true }
          : {})),
    }
  })
}

// El cuerpo COMPLETO. Existe para que `income` y `lots` no puedan volver a
// quedarse fuera por olvido: quien reconstruye el pasado para ARCHIVARLO pide
// el cuerpo entero, no solo los items.
export function buildHistoryRequestBody({ items, transactions, lots, convert, period, breakdown = false }) {
  const openLots = (lots || []).filter((l) => l && l.quantity > 0)
  return {
    items: buildHistoryItemsPayload({ items, transactions, lots, convert }),
    lots: openLots.length > 0 ? openLots.map((l) => ({
      symbol: l.symbol, quantity: l.quantity,
      acquisitionDate: l.acquisitionDate, closedDate: l.closedDate || null,
    })) : undefined,
    // FASE IG: misma corriente de ingresos que la gráfica y que el fetch del
    // ancla. Va en TODOS o en ninguno: el ancla sale de un doc archivado por el
    // backfill y las partes del panel de otro fetch, así que si reconstruyen
    // distinto el reparto deja de cuadrar contra su propio ancla (que es como
    // el panel terminaba rehusando, y de donde salía la fila "Sin atribuir").
    income: buildIncomeEvents(transactions, items, convert, 'USD'),
    period,
    ...(breakdown ? { breakdown: true } : {}),
  }
}
