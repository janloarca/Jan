// Pure transaction-rewind engine: reconstructs past portfolio state from the
// CURRENT state plus the imported transaction history, the way a broker's own
// value chart does. Instead of holding today's positions flat into the past
// (which pretends deposits and buys always existed), it walks backwards:
//
//   qty_t   = current_qty  - Σ buys after t   + Σ sells after t
//   cash_t  = current_cash - Σ deposits after t + Σ withdrawals after t
//             + Σ buy cost after t - Σ sell proceeds after t - Σ dividends after t
//
// value_t = Σ qty_t × price_t + cash_t then matches the broker's stepped value
// curve (deposits show as steps, buys move money from cash into positions).
// Everything here is currency-agnostic: callers convert amounts to one currency
// (USD for the portfolio-history API) BEFORE building events.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const toTs = (d) => {
  const t = new Date(d).getTime()
  return Number.isFinite(t) ? t : null
}

// Per-symbol share-count deltas from BUY/SELL transactions.
// Returns { SYM: [{ ts, qtyDelta }] } sorted by ts ascending.
export function buildTxEvents(transactions) {
  const bySymbol = {}
  for (const tx of transactions || []) {
    const type = (tx.type || '').toUpperCase()
    if (type !== 'BUY' && type !== 'SELL') continue
    const sym = (tx.symbol || '').toUpperCase().trim()
    const ts = toTs(tx.date)
    const qty = Math.abs(num(tx.quantity))
    if (!sym || ts == null || qty <= 0) continue
    if (!bySymbol[sym]) bySymbol[sym] = []
    bySymbol[sym].push({ ts, qtyDelta: type === 'BUY' ? qty : -qty })
  }
  for (const sym of Object.keys(bySymbol)) bySymbol[sym].sort((a, b) => a.ts - b.ts)
  return bySymbol
}

// Signed cash-balance deltas for the account's cash line. amountToBase converts
// (amount, currency) to the target currency; defaults to identity.
// DEPOSIT +, WITHDRAWAL -, BUY -(total+commission), SELL +(total-commission),
// DIVIDEND + (skip reinvested ones: their cash never sat in the account).
//
// ⛔ FASE IX. `rewindableSymbols` es la regla que mantiene las dos mitades del
// rebobinado coherentes entre sí: **el efecto en efectivo de un trade solo se
// deshace cuando el efecto en ACCIONES del MISMO trade también se deshace.**
// Sin ella, cada trade cuya contraparte no se puede reconstruir mueve dinero
// que ninguna posición reemplaza, en las dos direcciones:
//
//  · Una VENTA de una posición que hoy ya no existe (se cerró completa, así que
//    no viene entre los items y no hay serie de precios que reconstruir) le
//    RESTA sus ingresos al efectivo del pasado sin devolver las acciones que
//    los produjeron: ese capital simplemente desaparece de la historia. Con
//    suficientes posiciones cerradas el portafolio reconstruido termina en
//    NEGATIVO, y la gráfica lo dibuja (la vista "Todas" arrancando en -$6.3K
//    con un "Max drawdown" que nunca ocurrió).
//  · Una COMPRA de un símbolo que el server reconstruye HOLD-FLAT (su ledger
//    no alcanza a explicar la cantidad de hoy) le SUMA su costo al efectivo del
//    pasado mientras las acciones se mantienen planas: el mismo dinero contado
//    dos veces, ahora inflando.
//
// Dejar esos trades fuera del ledger deja el capital representado como
// efectivo, que es la mejor aproximación disponible ("tenías algo que valía
// aproximadamente eso") y nunca pierde ni duplica dinero. Los movimientos
// EXTERNOS (depósito, retiro, dividendo) nunca se filtran: no tienen
// contraparte en acciones y siempre son ciertos.
//
// Sin el parámetro, comportamiento byte-idéntico al de siempre.
export function buildCashFlows(transactions, amountToBase, { rewindableSymbols } = {}) {
  const conv = amountToBase || ((amt) => amt)
  const canRewind = (sym) => !rewindableSymbols
    || rewindableSymbols.has((sym || '').toUpperCase().trim())
  const flows = []
  for (const tx of transactions || []) {
    const type = (tx.type || '').toUpperCase()
    const ts = toTs(tx.date)
    if (ts == null) continue
    const total = Math.abs(num(tx.totalAmount ?? tx.amount))
    const commission = Math.abs(num(tx.commission))
    const cur = tx.currency || 'USD'
    let amount = null
    if (type === 'DEPOSIT') amount = conv(total, cur)
    else if (type === 'WITHDRAWAL') amount = conv(-total, cur)
    else if (type === 'BUY') amount = canRewind(tx.symbol) ? conv(-(total + commission), cur) : null
    else if (type === 'SELL') amount = canRewind(tx.symbol) ? conv(total - commission, cur) : null
    else if (type === 'DIVIDEND' && !tx._reinvested) amount = conv(total, cur)
    // FASE IX. Comisiones, impuestos retenidos e intereses del broker SÍ mueven
    // el efectivo (el caso real: 102 retenciones en un año), así que el
    // rebobinado tiene que deshacerlos o el efectivo del pasado queda corto por
    // la suma de todos ellos. No son flujos EXTERNOS y por eso Dietz los ignora
    // (dietzTransactions es otra lista): esto es solo la línea de caja.
    // `_signedAmount` viene del propio reporte (negativo = la cuenta pagó);
    // sin él, la convención por tipo.
    else if (type === 'FEE' || type === 'TAX') {
      // ⛔ FASE MY. La otra mitad de FASE MX. Un gasto que el usuario pagó desde
      // OTRA cuenta no movió la caja del broker, por más que esté archivado
      // contra una posición suya: `brokerAccountTransactions` incluye toda fila
      // cuyo `_linkedItemId` sea de un ítem del broker, así que un gasto sobre
      // una acción de IBKR pagado desde el banco entraba igual acá y le restaba
      // el monto a una caja que no se movió (reproducido: −300).
      //
      // Suelto ya era un defecto, pero desde MX es peor: esa fase le dio a la
      // cuenta que DE VERDAD pagó su propio evento de saldo, así que sin este
      // guard el mismo gasto movería DOS cuentas y el total del pasado quedaría
      // corto por su monto.
      //
      // `_paidFromItemId` lo escribe SOLO CashFlowModal: una comisión importada
      // del broker nunca lo trae, así que sigue deshaciéndose exactamente igual
      // que hasta hoy (fijado como regresión negativa).
      if (tx._paidFromItemId) continue
      amount = conv(Number.isFinite(Number(tx._signedAmount)) ? Number(tx._signedAmount) : -total, cur)
    } else if (type === 'INTEREST' && !tx._reinvested) {
      amount = conv(Number.isFinite(Number(tx._signedAmount)) ? Number(tx._signedAmount) : total, cur)
    }
    if (amount == null || amount === 0) continue
    flows.push({ ts, amount })
  }
  flows.sort((a, b) => a - b)
  return flows
}

// ⛔ FASE IX. La línea de efectivo de un broker es la caja de ESA cuenta, así
// que su ledger solo puede llevar movimientos de ESA cuenta. Alimentarla con
// TODAS las transacciones del portafolio (lo que hacía el caller, que le pasaba
// la lista completa) mete ahí cada depósito de apertura de cada cuenta MANUAL
// (VITALI 6,098, XOCHI 1,966, ...), y esos depósitos ya rebobinan el saldo de
// su propio ítem por `balanceEventsById`: el mismo dinero se deshace dos veces,
// una en la cuenta correcta y otra en la caja del broker. El efectivo del
// broker en el pasado queda entonces ~la suma de todos los depósitos manuales
// por debajo de lo real, y el portafolio reconstruido cae en NEGATIVO (la vista
// "Todas" arrancando en -$6.3K, ~= el depósito de VITALI más los otros).
//
// Se queda con lo que de verdad pertenece a la cuenta del broker:
//  · `_source` 'ibkr' (todo lo que importa el sync/archivo) o 'inferred_flow'
//    (los depósitos deducidos de FASE DQ, misma semántica de cuenta de broker),
//  · lo vinculado explícitamente a un ítem del broker (un movimiento que el
//    usuario registró a mano contra su propia cuenta de IBKR), y
//  · sin vínculo, lo que empareja por símbolo con un ítem del broker.
export function brokerAccountTransactions(transactions, brokerItems) {
  const ids = new Set((brokerItems || []).map((it) => it?.id).filter(Boolean))
  const syms = new Set((brokerItems || [])
    .map((it) => (it?.symbol || '').toUpperCase().trim()).filter(Boolean))
  return (transactions || []).filter((tx) => {
    if (!tx) return false
    if (tx._source === 'ibkr' || tx._source === 'inferred_flow') return true
    if (tx._linkedItemId) return ids.has(tx._linkedItemId)
    const sym = (tx.symbol || '').toUpperCase().trim()
    return sym ? syms.has(sym) : false
  })
}

// Los símbolos cuyo conteo de acciones el server SÍ va a rebobinar con el
// ledger de trades (la primera rama de reconstructionFor en
// app/api/prices/portfolio-history/route.js): tiene que existir el activo HOY y
// su ledger tiene que explicar por completo la cantidad actual. Es exactamente
// el conjunto que buildCashFlows necesita para que las dos mitades coincidan.
export function rewindableTradeSymbols(items, txEventsBySymbol) {
  const out = new Set()
  for (const it of items || []) {
    const sym = (it?.symbol || '').toUpperCase().trim()
    if (!sym || out.has(sym)) continue
    if (isTradeLedgerComplete((txEventsBySymbol || {})[sym], it.quantity)) out.add(sym)
  }
  return out
}

// Share count at ts: rewind by undoing every delta AFTER ts.
export function qtyAtTs(currentQty, events, ts) {
  let qty = num(currentQty)
  for (const ev of events || []) {
    if (ev.ts > ts) qty -= ev.qtyDelta
  }
  return qty > 0 ? qty : 0
}

// Cash balance at ts: rewind by undoing every flow AFTER ts. Negative balances
// are legitimate (margin), so no floor.
export function cashAtTs(currentCash, flows, ts) {
  let cash = num(currentCash)
  for (const f of flows || []) {
    if (f.ts > ts) cash -= f.amount
  }
  return cash
}

// Income events (dividends) that belong to ONE item, out of the shared list
// buildIncomeEvents() (components/dashboard/utils.js) builds for the whole
// scope. Matched by itemId first; falls back to symbol only when the event
// carries no itemId (a destination-redirected dividend always carries one).
function incomeEventsForItem(incomeEvents, itemId, itemSym) {
  if (!incomeEvents || incomeEvents.length === 0) return []
  return incomeEvents.filter((ev) =>
    (ev.itemId && itemId && ev.itemId === itemId) ||
    (!ev.itemId && ev.symbol && itemSym && ev.symbol === itemSym)
  )
}

// Value of a STATIC (non-market-priced) item at a past ts, reversing BOTH
// event streams that can move it — never just one. `flows` is
// DEPOSIT/WITHDRAWAL only (indexBalanceEvents in lib/historicalValues.js
// NEVER puts a reinvested dividend there — it goes to reinvestBySym
// instead), `incomeEvents` is DIVIDEND-only. The two are disjoint for the
// same item, so reversing both here can never double-count the same peso.
//
// ⛔ Bug this fixes (FASE FD, ClubCashIn case): an item that has BOTH its
// own opening deposit (virtually every manually-added account has one) AND
// income that reinvests into itself (a bond/CD paying interest on its own
// balance) used to reverse ONLY the deposit — the chart held the accrued
// yield flat at whatever the deposit alone implied, so an account that was
// genuinely compounding every month showed 0% return. Mirrors
// lib/historicalValues.js's applyStaticHistory, which already merges both
// event kinds into one list before reversing for the Spreadsheet (that's
// why the Spreadsheet never had this bug) — this brings the chart/API path
// (portfolio-history route) to parity with it, without touching
// applyStaticHistory or indexBalanceEvents themselves.
//
// clampZero mirrors each caller's EXISTING floor behavior exactly, so an
// item that only ever hit one of the two streams reconstructs identically
// to before: the no-cashFlow caller always floors (its own prior behavior,
// unconditional), the cashFlow caller floors only when the item is flagged
// _flowClampZero (its own prior behavior too — a real cash ledger can
// legitimately go negative on margin).
// FASE HU. Un cupón pagado EN EFECTIVO a otra cuenta entra en DOS listas a la
// vez, y hay que reversarlo una sola:
//
//  - `indexBalanceEvents` lo registra como movimiento de saldo de la cuenta
//    DESTINO (es dinero que de verdad entró ahí), y
//  - `buildIncomeEvents` lo atribuye TAMBIÉN a la cuenta destino, marcado como
//    step-up para que el API lo conserve (utils.js, la rama `dest`).
//
// Reversar las dos al rebobinar resta el mismo cupón dos veces. Con
// `clampZero` (el default de una cuenta manual) el saldo se va a negativo y se
// corta en CERO, así que la cuenta desaparece del pasado: el caso real de IDC,
// donde el Fondo Líquido valía $0 en todo 2024-2025 y por lo tanto el TWR de
// la institución salía plano en 0% aunque los cupones estuvieran bien
// registrados y el Spreadsheet los mostrara perfecto.
//
// El comentario de `staticItemValueAtTs` dice que los dos flujos son disjuntos
// por ítem, y eso es cierto SOLO para el ingreso REINVERTIDO (que
// `indexBalanceEvents` manda a `reinvestBySym`, nunca a `balanceEventsById`):
// ese sí debe reversarse por la vía de ingresos, y por eso no se puede
// simplemente ignorar el stream de ingresos cuando hay flujos (rompería el
// caso ClubCashIn de FASE FD). La regla correcta es más fina: se descarta el
// ingreso que YA está representado como movimiento de saldo del MISMO ítem, y
// solo ese.
export function dedupeIncomeAgainstFlows(incomeEvents, flowsByItemId, { tol = 0.01 } = {}) {
  if (!Array.isArray(incomeEvents) || incomeEvents.length === 0) return incomeEvents || []
  if (!flowsByItemId || typeof flowsByItemId.get !== 'function') return incomeEvents
  const DAY = 86400000
  return incomeEvents.filter((ev) => {
    if (!ev || !ev.itemId) return true
    const flows = flowsByItemId.get(ev.itemId)
    if (!flows || flows.length === 0) return true
    const day = Math.floor(num(ev.ts) / DAY)
    return !flows.some((f) => Math.floor(num(f.ts) / DAY) === day
      && Math.abs(num(f.amount) - num(ev.amount)) <= tol)
  })
}

export function staticItemValueAtTs(currentValue, ts, { flows, incomeEvents, itemId, itemSym, clampZero } = {}) {
  let v = cashAtTs(currentValue, flows, ts)
  for (const ev of incomeEventsForItem(incomeEvents, itemId, itemSym)) {
    if (ev.ts > ts) v -= ev.amount
  }
  return clampZero ? Math.max(0, v) : v
}

// --- Reconstruction-source guards -------------------------------------------
// Two reconstruction sources can go STALE and paint a history that never
// happened; both are checked against the one ground truth we always have:
// the item's CURRENT quantity.

// How far a source may drift from the current quantity before it's declared
// stale. Relative (2%) so tiny crypto balances and large stock positions both
// work, with an absolute epsilon so a true zero still reconciles.
const QTY_REL_TOL = 0.02
const qtyTolerance = (qty) => Math.max(Math.abs(num(qty)) * QTY_REL_TOL, 1e-8)

// A trade ledger can only be trusted when it fully accounts for the CURRENT
// quantity: rewound past its first trade it must leave a non-negative starting
// balance. The Ledger on-chain sync imports INFLOWS as BUYs but never sees
// outflows, so its ledger implies current - Σ(deltas) < 0 — impossible — and
// would otherwise clamp every past month to 0 (erasing real holdings) or,
// mixed with stale lots, produce a phantom flat line.
export function isTradeLedgerComplete(events, currentQty) {
  if (!events || events.length === 0) return false
  const sum = events.reduce((s, e) => s + num(e.qtyDelta), 0)
  return num(currentQty) - sum >= -qtyTolerance(currentQty)
}

// Open lots must reconcile with the CURRENT quantity, or they describe a
// position that no longer exists (real case: ~65,262 USDC imported in 2021 and
// later moved off the wallet — no sale was ever recorded, so the lots were
// never FIFO-closed). Trusted blindly they drew a phantom flat ~$65K line that
// "crashed" to the real ~$727 at the live point: a fake -98.9% and a max
// drawdown that never happened. Returns false for empty lots too, so callers
// fall back to holding the current quantity from the acquisition date.
export function lotsReconcile(lotEntries, currentQty, nowTs = Date.now()) {
  if (!lotEntries || lotEntries.length === 0) return false
  let open = 0
  for (const l of lotEntries) {
    const acquired = num(l.acquiredTs)
    const closed = l.closedTs == null ? null : num(l.closedTs)
    if (closed != null && closed <= nowTs) continue
    if (acquired > nowTs) continue
    open += num(l.qty)
  }
  return Math.abs(open - num(currentQty)) <= qtyTolerance(currentQty)
}
