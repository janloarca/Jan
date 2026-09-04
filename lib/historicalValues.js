import { authFetch, safeJson } from './authFetch'
import { BROKER_NAV_SOURCES } from '@/components/dashboard/utils'
import { transferCredit } from '@/lib/transferTx'

// Shared with PortfolioSpreadsheet.jsx: the synthetic "unknown IBKR positions"
// bucket key MUST be built the same way on both sides, or the renderer can't
// find the entry this file writes. Never a real item id (no `.` — real ids
// come straight from Firestore doc ids).
export const IBKR_UNKNOWN_KEY_PREFIX = '__ibkr_unknown__'

function getMonthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function getMonthEndDate(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0))
}

// Parse a date string to a UTC Date so comparisons against getMonthEndDate
// (which uses Date.UTC) never drift by a day due to local-vs-UTC parsing.
function parseUTCDate(s) {
  if (!s) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function rangeForMonths(months) {
  if (months.length === 0) return '1y'
  const [y] = months[0].split('-').map(Number)
  const yearsBack = new Date().getFullYear() - y + 1
  if (yearsBack <= 1) return '1y'
  return 'max'
}

// Reconstruct shares held at a past month-end by reversing every BUY/SELL trade
// that happened AFTER it. Trades carry real dates (unlike import-stamped lots),
// so this stays correct even when lots default to the import date.
function qtyFromTx(currentQty, events, monthEnd) {
  let qty = currentQty
  const end = monthEnd.getTime()
  for (const ev of events) {
    if (ev.ts > end) qty -= ev.delta
  }
  return qty > 0 ? qty : 0
}

function qtyAtMonth(lots, symbol, monthEnd) {
  let qty = 0
  for (const lot of lots) {
    if ((lot.symbol || '').toUpperCase() !== symbol.toUpperCase()) continue
    const acqDate = parseUTCDate(lot.acquisitionDate)
    if (acqDate && acqDate > monthEnd) continue
    if (lot.status === 'closed') {
      const closedDate = parseUTCDate(lot.closedDate)
      if (closedDate && closedDate <= monthEnd) continue
      qty += lot.quantity || 0
    } else {
      qty += lot.quantity || 0
    }
  }
  return qty
}

// Convert a raw price in the item's original currency to baseCurrency. Uses the
// _original* fields (true raw values + currency) so the result is correct even
// when the item was not pre-enriched (e.g. rates not loaded yet).
function valueInBase(it, rawPrice, convert, baseCurrency) {
  const rawCurrency = it._originalCurrency || it.currency || baseCurrency || 'USD'
  let val = (it.quantity || 0) * (rawPrice || 0)
  if (convert && rawCurrency !== (baseCurrency || 'USD')) {
    val = convert(val, rawCurrency, baseCurrency || 'USD')
  }
  return val
}

// Acquisition gate for historical reconstruction. Uses the exact acquisitionDate
// when known; otherwise falls back to Jan 1 of the year the asset was ADDED to the
// app (createdAt). createdAt is an import/add timestamp, NOT an acquisition date —
// using it directly would blank a position imported mid-year for every earlier
// month of that same year. Snapping it to the start of its year hides the asset in
// PRIOR years it didn't exist while still showing it across all months of its
// add-year. Returns null when neither date is available (no gate).
function effectiveAcqDate(it) {
  const acq = parseUTCDate(it.acquisitionDate)
  if (acq) return acq
  const created = parseUTCDate(it.createdAt)
  if (created) return new Date(Date.UTC(created.getUTCFullYear(), 0, 1))
  return null
}

function fillFallback(result, it, months, convert, baseCurrency) {
  const acqDate = effectiveAcqDate(it)
  const rawPrice = it._originalPurchasePrice ?? it.purchasePrice ?? 0
  const val = valueInBase(it, rawPrice, convert, baseCurrency)
  if (val <= 0) return
  months.forEach(mk => {
    if (acqDate && getMonthEndDate(mk) < acqDate) return
    if (!result[mk][it.id]) {
      result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '', estimated: true }
    }
  })
}

// Reconstruct a fixed-value asset's history: hold the current balance, then
// reverse any deposits/dividends/withdrawals that happened AFTER each month so
// the value steps down for earlier months (e.g. a bond at 6000 before a 240
// dividend in May, 6240 after). Used for true static assets AND for items whose
// "symbol" isn't a real market ticker (Yahoo returns no prices).
//
// `trueStatic` distinguishes WHY this function is running, because the two
// cases carry different confidence:
//  - true: the item has no market price to begin with (a bond, a bank
//    balance, an alternative) — held-flat-minus-events IS its real value, not
//    a guess, because that value only ever moves through tracked events.
//  - false (default): a market-type item (stock/crypto/fund) fell back here
//    because Yahoo had no price data — we're ASSUMING its quantity/price held
//    flat, which genuinely might be wrong, so it stays flagged.
// Getting this backwards was the bug behind "~6000" on a bond worth exactly
// 6000: every static reconstruction was unconditionally tagged `estimated`,
// so the spreadsheet's "~" (uncertain) marker showed on numbers that were
// exact by construction (FASE DS).
// ⛔ FASE IX6 (extensión de la lógica congelada F, aprobada por el usuario el
// 16 ago 2026). El ingreso REINVERTIDO se buscaba solo por SÍMBOLO, y un
// símbolo no identifica una cuenta: dos cuentas con el mismo nombre y sin
// ticker propio (el caso real: DOS "ClubCashIn") caen en el mismo cajón y cada
// una rebobina el rendimiento de AMBAS. La prueba está en los propios datos del
// usuario: la primera cuenta subía ~$5.89 al mes y pasó a ~$13 exactamente el
// mes en que apareció la segunda, que también sube ~$13; si cada una ganara lo
// suyo serían ~$6 y ~$7.4, y $13 es justo la suma.
//
// Es la MISMA lección de FASE IO: un mapa indexado por símbolo no puede guardar
// nada que dependa del ACTIVO. `reinvestById` (por id de cuenta, que toda
// transacción de rendimiento estampa) manda; el cajón por símbolo queda como
// respaldo para movimientos sin vínculo, así que un ítem cuyos eventos no traen
// id se reconstruye exactamente igual que antes.
// El precio CRUDO (en la moneda del propio ítem) con el que se reconstruye su
// pasado, con la MISMA prioridad que `getItemPrice`, que es la que usa la
// columna del mes actual.
//
// ⛔ `lastManualValuation` va PRIMERO para un ilíquido, y ese era el hueco: la
// cascada de acá no la conocía, así que un inmueble revaluado a mano mostraba
// el valor VIEJO en todos los meses históricos y el NUEVO solo en la columna de
// hoy, o sea un salto inventado en el mes en curso (medido: $200,000 en todo el
// histórico contra $250,000 hoy). Es la familia "dos convenciones para el mismo
// campo": la columna en vivo pregunta por `getItemPrice` y la reconstrucción
// tenía su propia cascada. `EditAccountModal` escribe esa valuación sin tocar
// `currentPrice`, y el enriquecido tampoco la considera, así que `_originalPrice`
// se queda con el precio anterior.
//
// Una sola definición para los DOS sitios que reconstruyen (el bucket estático y
// la red de seguridad), que si no vuelven a divergir.
function rawItemPrice(it) {
  if (it?.isIlliquid && Number(it.lastManualValuation) > 0) return Number(it.lastManualValuation)
  return it?._originalPrice ?? it?.currentPrice ?? it?.purchasePrice ?? it?.price ?? it?.cost ?? 0
}

function applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvest, trueStatic = false) {
  const acqDate = effectiveAcqDate(it)
  const rawPrice = rawItemPrice(it)
  const curVal = valueInBase(it, rawPrice, convert, baseCurrency)
  const balEvents = balanceEventsById[it.id] || []
  const byId = reinvest?.byId || {}
  const bySym = reinvest?.bySym || reinvest || {}
  const symEvents = byId[it.id]
    || bySym[(it.symbol || it.name || '').toUpperCase()]
    || []
  const allEvents = balEvents.length && symEvents.length ? [...balEvents, ...symEvents] : (balEvents.length ? balEvents : symEvents)
  months.forEach(mk => {
    const monthEnd = getMonthEndDate(mk)
    if (acqDate && monthEnd < acqDate) return
    let val = curVal
    if (allEvents.length) {
      const end = monthEnd.getTime()
      for (const ev of allEvents) if (ev.ts > end) val -= ev.amount
      if (val < 0) val = 0
    }
    result[mk][it.id] = { value: val, symbol: it.name || it.symbol || '', category: it._category || '', institution: it.institution || '', estimated: !trueStatic }
  })
}

// Which transactions move WHICH item's balance, and when. Exported because two
// separate engines reconstruct the past and they must agree on this: the
// spreadsheet (getHistoricalItemValues, below) and the YTD/NAV baseline that
// useDashboardData asks /api/prices/portfolio-history for. When only the
// spreadsheet knew that a coupon lands in a different account, that account was
// held flat at today's balance all the way back through the API path, so the
// year "started" already holding income it had not earned yet: start and end
// came out identical and YTD read +0.00% on a bond that had genuinely paid
// (FASE DW).
//
// Returns amounts in `baseCurrency`:
//   balanceEventsById: { [itemId]: [{ ts, amount }] }  signed, + is money in
//   reinvestById:      { [itemId]: [{ ts, amount }] }   reinvested income (FASE IX6)
//   reinvestBySym:     { [SYMBOL]: [{ ts, amount }] }   idem, sin vinculo a item
//   txBySymbol:        { [SYMBOL]: [{ ts, delta }] }    share count changes
// ⛔ LÓGICA CONGELADA (F). Esta funcion es la UNICA que decide que transaccion
// mueve el saldo de que item, y la usan las TRES reconstrucciones (spreadsheet,
// baseline del YTD, grafica). Cuando cada una tenia su copia, los numeros no
// cuadraban entre pantallas. Antes de tocarla, leer
// lib/assetLogic/corporateBondWithEntryFee.js y seguir el protocolo de su
// cabecera: hay que PREGUNTAR antes de cambiarla.
export function indexBalanceEvents(transactions, items, convert, baseCurrency) {
  const txBySymbol = {}
  const balanceEventsById = {}
  const reinvestBySym = {}
  const reinvestById = {}
  if (transactions && transactions.length) {
    const itemById = new Map(items.map(it => [it.id, it]))
    const itemBySym = new Map(items.map(it => [(it.symbol || '').toUpperCase(), it]))
    const itemByName = new Map(items.filter(it => it.name).map(it => [it.name.toUpperCase(), it]))
    const pushBalance = (id, ev) => { (balanceEventsById[id] = balanceEventsById[id] || []).push(ev) }
    for (const tx of transactions) {
      const ty = (tx.type || '').toUpperCase()
      if (ty === 'BUY' || ty === 'SELL') {
        const sym = (tx.symbol || '').toUpperCase()
        const d = parseUTCDate(tx.date)
        const q = Math.abs(Number(tx.quantity) || 0)
        // Sale proceeds routed to a tracked account step that account's balance
        // at the sale date (before this, the credit was invisible to history and
        // past months of the destination were overestimated).
        if (ty === 'SELL' && tx._destinationItemId && itemById.get(tx._destinationItemId) && d) {
          const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
          if (amtRaw > 0) {
            const cur = tx.currency || baseCurrency || 'USD'
            const amount = convert && cur !== (baseCurrency || 'USD') ? convert(amtRaw, cur, baseCurrency || 'USD') : amtRaw
            pushBalance(tx._destinationItemId, { ts: d.getTime(), amount })
          }
        }
        if (!sym || !d || !q) continue
        if (!txBySymbol[sym]) txBySymbol[sym] = []
        txBySymbol[sym].push({ ts: d.getTime(), delta: ty === 'BUY' ? q : -q })
      } else if (ty === 'DEPOSIT' || ty === 'DIVIDEND' || ty === 'WITHDRAWAL') {
        const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
        const d = parseUTCDate(tx.date)
        if (!(amtRaw > 0) || !d) continue
        const linked = tx._linkedItemId ? itemById.get(tx._linkedItemId) : null
        const cur = tx.currency || baseCurrency || 'USD'
        const amount = convert && cur !== (baseCurrency || 'USD') ? convert(amtRaw, cur, baseCurrency || 'USD') : amtRaw
        const delta = ty === 'WITHDRAWAL' ? -amount : amount
        const ts = d.getTime()

        if (ty === 'DIVIDEND') {
          // Each dividend feeds exactly ONE reconstruction bucket so a value is
          // never reversed twice (source AND symbol):
          //  - explicit destination (manual yield) → balanceEventsById[_destinationItemId]
          //  - reinvested into the source  → reinvestBySym[source] (static path)
          //  - cash routed to a destination → balanceEventsById[destination]
          //  - cash with no destination     → ignored (left the tracked portfolio)
          if (tx._destinationItemId && itemById.get(tx._destinationItemId)) {
            pushBalance(tx._destinationItemId, { ts, amount: delta })
            continue
          }
          const reinvest = tx._reinvested === true
            || (linked && linked.dividendAction === 'reinvest')
            || tx._source === 'manual_contribution'
            || !tx._linkedItemId
          if (!reinvest && linked && linked.incomeDestination) {
            const dest = itemById.get(linked.incomeDestination)
              || itemBySym.get(String(linked.incomeDestination).toUpperCase())
              || itemByName.get(String(linked.incomeDestination).toUpperCase())
            if (dest && dest.id) pushBalance(dest.id, { ts, amount: delta })
          } else if (reinvest) {
            // FASE IX6: por ID de cuenta cuando la transacción lo trae (todo
            // rendimiento reinvertido lo estampa). El cajón por símbolo mezcla
            // dos cuentas con el mismo nombre y les acredita el rendimiento de
            // ambas; ver el comentario de applyStaticHistory.
            if (linked && linked.id) {
              ;(reinvestById[linked.id] = reinvestById[linked.id] || []).push({ ts, amount })
            } else {
              const sym = (tx.symbol || (linked && (linked.symbol || linked.name)) || '').toUpperCase()
              if (sym) (reinvestBySym[sym] = reinvestBySym[sym] || []).push({ ts, amount })
            }
          }
        } else if (tx._linkedItemId) {
          // DEPOSIT / WITHDRAWAL change the linked account's balance directly.
          pushBalance(tx._linkedItemId, { ts, amount: delta })
        }
      } else if (ty === 'TRANSFER') {
        // FASE GU. Money moved between two of the user's own accounts changes
        // BOTH balances on its date, so both need the event or their past is
        // rebuilt wrong: the receiving account gets held flat at today's higher
        // balance all the way back (as if the money had always been there) and
        // the sending one at today's lower balance (as if it never had it).
        // Nothing here nets or cancels: each side is independently true, and
        // each is recorded on its own, so a row that names only one end still
        // fixes that end instead of being dropped for lack of the other.
        //
        // Rows written before lib/transferTx.js became the single builder carry
        // neither id and are skipped, exactly as they were before this branch
        // existed.
        const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
        const d = parseUTCDate(tx.date)
        if (!(amtRaw > 0) || !d) continue
        const base = baseCurrency || 'USD'
        const toBase = (v, cur) => (convert && cur && cur !== base ? convert(v, cur, base) : v)

        // ⛔ EXTENSIÓN (24 ago 2026, aprobada explícitamente por el usuario).
        //
        // Hasta acá esta rama hacía UNA sola conversión y empujaba el MISMO
        // monto a los dos lados, con el argumento de que "el monto viene en la
        // moneda de la cuenta que ENVÍA". Eso vale cuando las dos cuentas
        // comparten moneda y es FALSO en cuanto no: mover Q2,500 a una cuenta
        // en dólares no le suma 2,500 dólares a nadie, le suma lo que el BANCO
        // acreditó, que ni siquiera es la tasa de mercado (el banco pone su
        // spread). Es el bug que el usuario reportó con una transferencia real.
        //
        // Ahora cada lado usa el monto de SU propia moneda: lo que salió para
        // el origen, lo que entró para el destino, cada uno convertido a base
        // por separado. Los dos siguen siendo eventos independientes, así que
        // una fila que nombra un solo extremo sigue arreglando ese extremo.
        //
        // Deja de valer que se cancelen a nivel de portafolio, y eso es
        // CORRECTO: un cambio de divisa con spread del banco de verdad cuesta
        // dinero, y ese costo tiene que verse.
        //
        // Compatibilidad: una fila SIN `_toAmount` (todas las escritas antes de
        // este cambio) cae a `totalAmount` con la moneda del origen, o sea el
        // comportamiento exacto de antes, byte por byte. Una transferencia de
        // misma moneda también, porque ahí lo que entra ES lo que sale.
        const credit = transferCredit(tx)
        const sentBase = toBase(amtRaw, tx.currency || base)
        const recvBase = toBase(credit.amount, credit.currency || tx.currency || base)

        const ts = d.getTime()
        const fromId = tx._originItemId && itemById.get(tx._originItemId) ? tx._originItemId : null
        const toId = tx._linkedItemId && itemById.get(tx._linkedItemId) ? tx._linkedItemId : null
        if (fromId && fromId === toId) continue
        if (fromId) pushBalance(fromId, { ts, amount: -sentBase })
        if (toId) pushBalance(toId, { ts, amount: recvBase })

        // ⛔ EXTENSIÓN (FASE KZ3, aprobada explícitamente por el usuario el 26
        // ago 2026). Un pago de DEUDA es un TRANSFER cuyo destino viaja en
        // `_debtItemId` y NO en `_linkedItemId`, justamente porque el reparto
        // de arriba (+monto al destino) sería al revés sobre una deuda: se
        // guarda en POSITIVO y getItemValue la niega al leer, así que un
        // +monto la reconstruiría como si se hubiera debido MENOS antes de
        // pagar (ver lib/transferTx.js). El evento correcto para la deuda es
        // -aplicado: el pago BAJÓ su magnitud ese día, y el rebobinado
        // (`val -= ev.amount` para eventos posteriores al mes) la SUBE hacia
        // atrás, que es lo que de verdad se debía. Antes de esto la deuda
        // quedaba plana en su saldo de HOY en toda la serie histórica mientras
        // la cuenta que pagó sí se rebobinaba: las dos mitades del mismo pago
        // medían pasados distintos. El monto es el APLICADO a la deuda
        // (_toAmount, en la moneda de la deuda), igual que el lado del destino
        // de su hermana de arriba.
        const debtId = tx._debtItemId && itemById.get(tx._debtItemId) ? tx._debtItemId : null
        if (debtId && debtId !== fromId) pushBalance(debtId, { ts, amount: -recvBase })
      } else if (ty === 'FEE') {
        // ⛔ EXTENSIÓN (FASE MX, aprobada explícitamente por el usuario el 2 sep
        // 2026). Un gasto sobre un activo pagado DESDE una cuenta registrada
        // (reparar el techo de un inmueble, FASE KW) baja el saldo de esa cuenta
        // el día que se paga: `CashFlowModal` lo escribe con
        // `buildContributionFields`, o sea el saldo de HOY ya está más bajo.
        // Pero la fila se archiva contra el INMUEBLE (`_linkedItemId`), y esta
        // función no tenía rama para `FEE`, así que la cuenta que pagó se
        // reconstruía PLANA en su saldo de hoy hacia atrás: el pasado decía que
        // ese dinero nunca estuvo ahí. Es el MISMO defecto que FASE KZ3 cerró
        // para el pago de una hipoteca, y la tercera vez que el id viaja en un
        // campo propio porque el reparto normal sería el equivocado.
        //
        // Solo se registra el lado de la CUENTA QUE PAGÓ, y esa asimetría es la
        // decisión de producto de FASE KW, no un olvido: un gasto NO revalúa el
        // activo sobre el que se hizo (reparar el techo no sube el precio de la
        // casa), así que el inmueble no recibe ningún evento y su serie no se
        // mueve un centavo.
        //
        // Una fila FEE SIN `_paidFromItemId` —toda comisión de broker, todo
        // costo importado, todo gasto que no se pagó desde una cuenta
        // registrada— no produce ningún evento, exactamente como antes de que
        // esta rama existiera. O sea el radio del cambio es la poblacion que la
        // feature de FASE KW creó y nada más.
        const paidFrom = tx._paidFromItemId && itemById.get(tx._paidFromItemId) ? tx._paidFromItemId : null
        if (!paidFrom) continue
        const amtRaw = Math.abs(Number(tx.totalAmount ?? tx.amount ?? 0))
        const d = parseUTCDate(tx.date)
        if (!(amtRaw > 0) || !d) continue
        const cur = tx.currency || baseCurrency || 'USD'
        const amount = convert && cur !== (baseCurrency || 'USD') ? convert(amtRaw, cur, baseCurrency || 'USD') : amtRaw
        pushBalance(paidFrom, { ts: d.getTime(), amount: -amount })
      }
    }
  }
  return { balanceEventsById, reinvestBySym, reinvestById, txBySymbol }
}

// `diag` es un parametro de SALIDA opcional: si se pasa un objeto, esta funcion
// le escribe POR ITEM de donde salio su serie, y nada mas. Cero cambio en los
// valores, cero cambio para todo caller que no lo pase (el efecto automatico del
// Spreadsheet no lo usa). Mismo precedente que el `diag` de attributeYtd
// (FASE HT3).
//
// Existe porque el recalculo vive detras de seis compuertas y no tenia ninguna
// senal visible: desde afuera "recalculo y esta es la respuesta" y "nunca
// recalculo" se ven identicos, que es exactamente lo que consumio la ronda
// anterior. `{ [itemId]: { name, source } }` con source en:
//   'market'  el precio historico real del proveedor
//   'events'  reconstruido de los movimientos del propio activo (exacto)
//   'flat'    sin precio historico: se mantiene plano en su valor de hoy
function noteSource(diag, it, source) {
  if (!diag || !it || !it.id) return
  diag[it.id] = { name: it.name || it.symbol || it.id, symbol: it.symbol || '', source }
}

export async function getHistoricalItemValues(items, months, convert, baseCurrency, lots, transactions, snapshots, diag) {
  const result = {}
  months.forEach(mk => { result[mk] = {} })

  const hasLots = lots && lots.length > 0
  const lotSymbols = hasLots ? new Set(lots.map(l => (l.symbol || '').toUpperCase())) : new Set()

  // Index real BUY/SELL trades per symbol so past-month share counts come from
  // actual trade history (true dates) rather than import-stamped lot dates, plus
  // the balance-changing events behind each static asset (see indexBalanceEvents).
  const { balanceEventsById, reinvestBySym, reinvestById, txBySymbol } =
    indexBalanceEvents(transactions, items, convert, baseCurrency)
  // FASE IX6: por id de cuenta primero, por símbolo solo como respaldo.
  const reinvestIdx = { byId: reinvestById, bySym: reinvestBySym }

  // ⛔ Una posición de IBKR con LEDGER DE TRADES sí se reconstruye por posición.
  //
  // Hasta FASE NJ esto excluía a TODO item de IBKR, con esta razón: "solo se
  // conoce el NAV total de la cuenta en un mes pasado, nunca cómo se repartía
  // entre los nombres de HOY, así que repartirlo y etiquetar cada rebanada con
  // un ticker real se lee como 'sabemos que NOVO-NORDISK valía $78.71 en jun
  // 2023'". Esa premisa es cierta cuando lo único que hay es el NAV, y FALSA
  // cuando el Flex trae los trades: con ellos la cantidad de cada mes se
  // rebobina EXACTA (`qtyFromTx`), y el precio de ese mes lo da el proveedor.
  // O sea deja de ser un reparto y pasa a ser una medición.
  //
  // La prueba de que esta rama estaba pensada para recibirlos: su propio
  // `dateUnreliable` pregunta `it._source === 'ibkr'` y era CÓDIGO MUERTO,
  // porque el filtro de acá nunca los dejaba llegar.
  //
  // Sin trades del símbolo se queda fuera y lo cubre el bucket sintético de más
  // abajo, que para ese caso sigue siendo lo correcto.
  const ibkrHasTrades = (it) => {
    const sym = (it.symbol || '').toUpperCase()
    return !!sym && (txBySymbol[sym] || []).length > 0
  }
  const marketItems = items.filter(it => {
    if (it._source === 'ibkr' && !ibkrHasTrades(it)) return false
    if (!it.symbol || !/stock|crypto|fund|etf/i.test(it.type || '')) return false
    if (/realestate|inmueble/i.test(it.type || '')) return false
    if (!it._source && it.symbol.length > 10) return false
    return true
  })
  const marketSet = new Set(marketItems)
  const staticItems = items.filter(it =>
    it._source !== 'ibkr' && !marketSet.has(it)
  )

  staticItems.forEach(it => {
    if (!it.id) return
    applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestIdx, true)
    noteSource(diag, it, 'events')
  })

  // Count how many market items share each symbol. Lots/trades are keyed by symbol
  // (FIFO across the whole symbol), so when two distinct positions hold the SAME
  // symbol (e.g. BTC in two different wallets), the per-symbol reconstruction would
  // assign the combined total to EACH item → identical histories. For those, fall
  // back to each item's own held-flat quantity instead.
  const symItemCount = {}
  marketItems.forEach(it => {
    const s = (it.symbol || '').toUpperCase()
    symItemCount[s] = (symItemCount[s] || 0) + 1
  })

  // Una posición de IBKR que entra al camino de mercado y ahí NO se puede medir
  // (el proveedor no contesta, no tiene precios, o el símbolo resuelve a un
  // ticker que no es) vuelve al bucket sintético, que es exactamente lo que la
  // cubría antes de FASE NJ. Sin esto se quedaba sin NADA: fuera del bucket por
  // haber entrado a `marketItems`, y sin fila propia porque su respaldo estático
  // se gatea con `acquisitionDate`, que para una posición importada es el sello
  // del SYNC y deja fuera todos los meses anteriores. Se marca y se sale SIN
  // escribir su respaldo, porque escribirlo Y meterla al bucket la contaría dos
  // veces.
  const unmeasuredIbkr = new Set()
  const bailToBucket = (it) => {
    if (it._source !== 'ibkr') return false
    unmeasuredIbkr.add(it)
    noteSource(diag, it, 'flat')
    return true
  }

  const range = rangeForMonths(months)
  const BATCH_SIZE = 15
  for (let i = 0; i < marketItems.length; i += BATCH_SIZE) {
    const batch = marketItems.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (it) => {
      try {
        // Crypto tickers collide with unrelated equities on Yahoo (ETH = Ethan
        // Allen). Flag them so the endpoint routes to CoinGecko historical prices.
        const isCrypto = /crypto|cripto/i.test(it.type || '') || it._source === 'ledger' || it._source === 'blockchain'
        const res = await authFetch(`/api/prices/chart?symbol=${encodeURIComponent(it.symbol)}&range=${range}&interval=1mo${isCrypto ? '&type=crypto' : ''}`)
        // Unknown ticker / no market data → it's a fixed-value asset (e.g. a bond
        // or custom investment whose "symbol" isn't a real ticker). Reconstruct its
        // history from its balance + deposit/dividend events, not a flat figure.
        if (!res.ok) { if (bailToBucket(it)) return; applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestIdx); noteSource(diag, it, 'flat'); return }
        const data = await safeJson(res)
        const prices = data.prices || []
        if (prices.length === 0) { if (bailToBucket(it)) return; applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestIdx); noteSource(diag, it, 'flat'); return }

        const priceCurrency = data.currency || 'USD'
        const priceByMonth = {}
        prices.forEach(p => {
          if (p.close != null && p.date) {
            const mk = getMonthKey(new Date(p.date))
            priceByMonth[mk] = p.close
          }
        })

        // Ticker-collision guard: if the most recent fetched price is wildly off
        // from the item's own per-unit price (same currency), the "symbol" matched
        // an unrelated real ticker (e.g. a custom bond code). Discard the garbage
        // series and reconstruct as a held-flat static asset instead.
        const latestClose = prices.length ? prices[prices.length - 1].close : null
        const itUnit = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
        const sameCur = (it._originalCurrency || it.currency || 'USD') === priceCurrency
        if (sameCur && latestClose > 0 && itUnit > 0) {
          const ratio = latestClose / itUnit
          if (ratio > 10 || ratio < 0.1) {
            if (bailToBucket(it)) return
            applyStaticHistory(result, it, months, convert, baseCurrency, balanceEventsById, reinvestIdx)
            noteSource(diag, it, 'flat')
            return
          }
        }

        const acqDate = parseUTCDate(it.acquisitionDate)
        const currentQty = it.quantity || 0
        const sym = (it.symbol || '').toUpperCase()
        const txEvents = txBySymbol[sym] || []
        // Only trust lot-level FIFO reconstruction when there's genuine history
        // (a sell, or multiple lots). A single import-stamped lot would otherwise
        // zero out every month before the import date.
        const symLots = hasLots ? lots.filter(l => (l.symbol || '').toUpperCase() === sym) : []
        const hasRealLotHistory = symLots.length > 1 || symLots.some(l => l.status === 'closed')
        // An IBKR position with no trade history has an unreliable (import-date)
        // acquisitionDate — don't let it zero out past months. If there were a
        // real recent purchase, it would have an in-window BUY trade.
        const dateUnreliable = it._source === 'ibkr' && txEvents.length === 0
        // Symbol shared by >1 distinct position → per-symbol lots/trades can't be
        // attributed to one item; use this item's own quantity (held flat).
        const sharedSymbol = symItemCount[sym] > 1

        months.forEach(mk => {
          const monthEnd = getMonthEndDate(mk)
          const price = priceByMonth[mk]

          let qty
          if (!sharedSymbol && txEvents.length > 0) {
            // Reverse real trades after this month → exact historical share count.
            qty = qtyFromTx(currentQty, txEvents, monthEnd)
          } else if (!sharedSymbol && hasRealLotHistory) {
            qty = qtyAtMonth(lots, sym, monthEnd)
          } else {
            // Held-flat: no trade history and no multi-lot detail. Assume the
            // current position was held throughout, gated by a reliable acq date.
            qty = (dateUnreliable || !acqDate || monthEnd >= acqDate) ? currentQty : 0
          }
          if (qty <= 0) return

          if (price != null) {
            let val = qty * price
            if (convert && priceCurrency !== baseCurrency) {
              val = convert(val, priceCurrency, baseCurrency || 'USD')
            }
            result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '' }
          } else if (!result[mk][it.id]) {
            const rawCur = it._originalCurrency || it.currency || baseCurrency || 'USD'
            let val = qty * (it._originalPurchasePrice ?? it.purchasePrice ?? 0)
            if (convert && rawCur !== (baseCurrency || 'USD')) val = convert(val, rawCur, baseCurrency || 'USD')
            if (val > 0) {
              result[mk][it.id] = { value: val, symbol: it.symbol, category: it._category || '', institution: it.institution || '', estimated: true }
            }
          }
        })
        fillFallback(result, it, months, convert, baseCurrency)
        noteSource(diag, it, 'market')
      } catch (err) {
        console.error(`[historicalValues] Failed for ${it.symbol}:`, err.message)
        if (bailToBucket(it)) return
        fillFallback(result, it, months, convert, baseCurrency)
        noteSource(diag, it, 'flat')
      }
    }))
  }

  // El bucket sintético cubre lo que NO se pudo reconstruir por posición.
  //
  // Su razón original sigue en pie para ese caso: de una posición de IBKR sin
  // ledger de trades lo único que se sabe de un mes pasado es el NAV TOTAL de la
  // cuenta, nunca cómo se repartía entre los nombres de HOY, y repartirlo
  // etiquetando cada rebanada con un ticker real se lee como "sabemos que
  // NOVO-NORDISK valía $78.71 en jun 2023". Por eso se colapsa en UNA fila por
  // institución+categoría (IBKR_UNKNOWN_KEY_PREFIX; PortfolioSpreadsheet.jsx la
  // dibuja como "Posiciones no identificadas" y arma la MISMA llave).
  //
  // ⛔ Lo que cambia en FASE NJ: una posición que SÍ entró a `marketItems` ya
  // tiene su propia fila por mes, así que meterla también acá la contaría DOS
  // veces. Se excluye por pertenencia a `marketSet` y no por "¿tiene valor este
  // mes?": el camino de mercado escribe una fila por cada mes en que la posición
  // existió, y un mes en blanco ahí significa cantidad CERO (todavía no la
  // tenías, o ya la vendiste), no "no se pudo medir". Si además cayó a su
  // respaldo estático, esa fila también es suya.
  //
  // `overallCurrentNAV` sigue siendo el total de la CUENTA a propósito: el
  // factor `nav / overallCurrentNAV` es "qué tan chica era la cuenta ese mes", y
  // se aplica a la rebanada que queda por explicar.
  const ibkrItems = items.filter(it => it._source === 'ibkr' && it.id)
  const ibkrBucketItems = ibkrItems.filter(it => !marketSet.has(it) || unmeasuredIbkr.has(it))
  if (ibkrBucketItems.length) {
    const groups = new Map()
    for (const it of ibkrBucketItems) {
      const key = `${it.institution || ''}::${it._category || ''}`
      if (!groups.has(key)) groups.set(key, { institution: it.institution || '', category: it._category || '', items: [] })
      groups.get(key).items.push(it)
    }

    // Build NAV-per-month from broker-NAV snapshots (latest snapshot wins per
    // month), converting the stored USD NAV to baseCurrency, and remember
    // WHICH source backed each month. Includes 'ibkr_quarterly' (transcribed
    // from Portfolio Analyst for history a Flex Query can't reach) alongside
    // 'ibkr' (synced) — a transcribed quarter used to be silently dropped
    // here, so a user who filled in years of quarterly history still saw
    // those months fall back to flat current-value estimates.
    const ibkrSnaps = (snapshots || []).filter(s => BROKER_NAV_SOURCES.includes(s._source) && s.date)
    const navByMonth = {}
    const navSourceByMonth = {}
    const navDates = {}
    ;(ibkrSnaps.length ? ibkrSnaps : (snapshots || []).filter(s => s.date)).forEach(s => {
      const navUSD = s.netWorthUSD ?? s.totalActivosUSD ?? 0
      if (!navUSD) return
      const mk = getMonthKey(new Date(s.date))
      const sd = new Date(s.date)
      if (!navDates[mk] || sd > navDates[mk]) {
        navDates[mk] = sd
        navByMonth[mk] = convert ? convert(navUSD, 'USD', baseCurrency || 'USD') : navUSD
        navSourceByMonth[mk] = s._source || null
      }
    })

    const overallCurrentNAV = ibkrItems.reduce((sum, it) => {
      const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
      return sum + valueInBase(it, rawPrice, convert, baseCurrency)
    }, 0)

    const navMonthKeys = Object.keys(navByMonth).sort()
    // For a month without its own snapshot, carry forward the most recent prior
    // snapshot NAV (months may be a non-contiguous subset, so resolve per-month
    // against all known snapshot months rather than a running variable).
    const navForMonth = (mk) => {
      if (navByMonth[mk] != null) return { nav: navByMonth[mk], source: navSourceByMonth[mk] }
      let chosenKey = null
      for (const k of navMonthKeys) { if (k <= mk) chosenKey = k; else break }
      return chosenKey ? { nav: navByMonth[chosenKey], source: navSourceByMonth[chosenKey] } : null
    }

    for (const { institution, category, items: groupItems } of groups.values()) {
      const groupCurrentVal = groupItems.reduce((sum, it) => {
        const rawPrice = it._originalPrice ?? it.currentPrice ?? it.purchasePrice ?? 0
        return sum + valueInBase(it, rawPrice, convert, baseCurrency)
      }, 0)
      if (groupCurrentVal <= 0) continue
      const key = `${IBKR_UNKNOWN_KEY_PREFIX}${institution}__${category}`
      // Gate for the no-snapshot fallback below, deliberately NOT effectiveAcqDate:
      // an IBKR position's acquisitionDate is stamped at SYNC time, not a real one
      // (dateUnreliable, same reasoning as the per-item Yahoo path above) — gating
      // on it blanked months that came before the sync even when the account
      // demonstrably existed then (real snapshot/quarterly coverage on both sides
      // of the gap), the exact bug behind a real month blanked between two years
      // that DID have data (FASE FH). createdAt is the one signal that's actually
      // reliable: the Firestore row provably didn't exist before it. Snapped to
      // Jan 1 of its year, same convention effectiveAcqDate uses, so an account
      // added mid-year doesn't blank the months of its own add-year.
      const earliestCreated = groupItems
        .map(it => parseUTCDate(it.createdAt))
        .filter(Boolean)
        .sort((a, b) => a - b)[0]
      const fallbackGate = earliestCreated ? new Date(Date.UTC(earliestCreated.getUTCFullYear(), 0, 1)) : null
      months.forEach(mk => {
        const resolved = overallCurrentNAV > 0 ? navForMonth(mk) : null
        let value, estimated
        if (resolved) {
          value = groupCurrentVal * (resolved.nav / overallCurrentNAV)
          // A synced Flex NAV is the account's REAL reported total for that
          // month — no "~". A transcribed quarterly screenshot is a real
          // observation too, but not OUR sync: the user asked for it to read
          // as an estimate, same as any other reconstruction.
          estimated = resolved.source !== 'ibkr'
        } else {
          // No snapshot at all reaches this month (yet) — hold the group's
          // current value flat rather than leave it blank, unless the row
          // provably didn't exist in the app that far back.
          if (fallbackGate && getMonthEndDate(mk) < fallbackGate) return
          value = groupCurrentVal
          estimated = true
        }
        // `_covers` dice QUÉ ids quedan explicados por esta fila. Existe porque
        // desde FASE NJ un mes puede traer legítimamente el bucket Y filas por
        // item del MISMO broker (las reconstruidas), y el saneador de
        // `lib/spreadsheetSanitize.js` borraba toda fila por item en cuanto veía
        // un bucket: sin esta lista, el guard contra el doble conteo se lleva
        // por delante justo lo que esta fase vino a mostrar. Un bucket viejo no
        // lo trae, y ahí el saneador conserva su regla de siempre.
        if (value > 0) {
          result[mk][key] = {
            value, category, institution, estimated,
            _syntheticIbkr: true,
            _covers: groupItems.map(it => it.id).filter(Boolean),
          }
        }
      })
    }
  }

  // Held-flat safety net: any currently-held item still left blank for a displayed
  // month gets its current value, as long as the month is on/after the item's
  // effective acquisition date. This guarantees a held asset never shows blank for
  // a month it existed, while real reconstructed/scaled values above always take
  // precedence and prior-year months before the asset existed stay genuinely
  // empty. IBKR items are excluded: they're always handled by the dedicated
  // bucket above (including its own no-snapshot fallback), never per-item here.
  for (const it of items) {
    if (!it.id || it._source === 'ibkr') continue
    const rawPrice = rawItemPrice(it)
    const curVal = valueInBase(it, rawPrice, convert, baseCurrency)
    if (!(curVal > 0)) continue
    const acqDate = effectiveAcqDate(it)
    for (const mk of months) {
      if (result[mk][it.id]) continue
      if (acqDate && getMonthEndDate(mk) < acqDate) continue
      result[mk][it.id] = {
        value: curVal,
        symbol: it.symbol || it.name || '',
        category: it._category || '',
        institution: it.institution || '',
        estimated: true,
      }
    }
  }

  return result
}
