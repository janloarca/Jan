// Data-completeness engine: pure gap-detection over the user's raw data so
// nothing slips through — accounts with balances no transaction explains,
// shares no lot dates, income that vanishes because it has no destination, etc.
// Each finding carries a stable id (code:itemId) for dismissal persistence and
// an `action` the UI can wire to a one-tap fix (edit the item, open the cash
// flow modal prefilled, open the review wizard).
//
// Pure module: no React, no Firestore. Callers pass RAW items (prices in the
// item's own currency), transactions, lots, and the convert(amount, from, to)
// helper. `now` is injectable for tests.

import { isBankLikeItem } from '@/lib/contributions'
import { isExcludedFromNetWorth, getGeographyFromItem, getItemPrice } from '@/components/dashboard/utils'

const SEVERITY_WEIGHT = { high: 40, medium: 20, low: 10 }
// Ignore accounts worth less than this (in base currency) for history checks —
// a $30 leftover doesn't deserve a "no history" nag.
const MIN_BALANCE_BASE = 100
// partial-history only fires when the unexplained slice is at least this big.
const UNEXPLAINED_FLOOR_BASE = 200
// Un activo recién dado de alta todavía no pudo haber cobrado nada, así que
// preguntarle "¿ya recibiste un pago?" el mismo día es puro ruido. Dos meses
// cubre hasta un pagador trimestral que acaba de arrancar su ciclo.
const INCOME_GRACE_DAYS = 60
const EXPLAINED_PCT_THRESHOLD = 0.5
const STALE_DAYS = 180

const BROKER_SOURCES = /^(ibkr|blockchain|ledger)$/i

const fmt = (n) => (Math.round(n) || 0).toLocaleString()
// Cantidades, no dinero: 0.5 BTC redondeado a "0 unidades" afirma que no hay
// nada que cubrir (anotado desde FASE EZ4). Hasta 8 decimales, los que una
// cripto de verdad usa; un entero sigue imprimiendo entero.
const fmtQty = (n) => {
  const v = Number(n) || 0
  return Number(v.toFixed(8)).toLocaleString(undefined, { maximumFractionDigits: 8 })
}

function itemCurrency(it) {
  return it.currency || it._originalCurrency || 'USD'
}

// A market asset's live price is NEVER persisted to Firestore by design —
// AddAccountModal never sets currentPrice for a stock/crypto/fund at
// creation, and useMarketPrices resolves it fresh by symbol on every render
// instead. So a raw item's currentPrice being 0 is the NORMAL, expected state
// for a market asset, not evidence its price is missing. `marketPrices` (the
// same map useMarketPrices already produces, keyed by symbol) is the only way
// to tell "genuinely no price resolves for this symbol" apart from "this
// asset's real price just isn't the field this pure module got handed" —
// without it (older callers, tests) this falls back to the item's own stored
// price exactly like before, so nothing here changes when it's omitted.
// FASE HV11. `resolvedPrices` es el precio que la app YA está mostrando para
// ESE ítem, indexado por su id, y por eso va primero: es la única fuente que no
// puede discrepar de lo que el usuario ve en la gráfica y en el Spreadsheet.
//
// El emparejamiento por SÍMBOLO, que era lo único que había, sí puede: dos
// posiciones del mismo activo pueden tener símbolos distintos (una 'BTC' y la
// otra con el nombre puesto como símbolo, o vacío), y entonces una resuelve y
// la otra no. El usuario lo vio exactamente así: dos Bitcoin, el Spreadsheet
// imprimiendo bien los dos al mismo precio, y el aviso diciendo que uno "no
// tiene precio actual: se está contando en $0". Nunca se contó en $0; lo que
// fallaba era esta consulta.
//
// Sin el mapa (callers viejos, tests) cae al camino de siempre.
function effectivePrice(it, marketPrices, resolvedPrices) {
  const resolved = resolvedPrices && it.id ? Number(resolvedPrices[it.id]) || 0 : 0
  if (resolved > 0) return resolved
  const stored = Number(it.currentPrice) || 0
  if (stored > 0) return stored
  if (!marketPrices) return 0
  const live = marketPrices[(it.symbol || '').toUpperCase()] || marketPrices[it.symbol]
  return (live && Number(live.price)) || 0
}

function itemBalance(it, marketPrices, resolvedPrices) {
  // Value in the item's OWN currency (raw fields). Falls back to purchasePrice
  // when neither the stored nor the live price resolves, same fallback chain
  // useDashboardData's own enrichedItems uses for what actually ends up on
  // screen — without it, a market item with only a live-resolved price (never
  // stored) computed as $0 here, read as dust below MIN_BALANCE_BASE, and
  // every check after that floor (no-cost-basis, no-currency, no-history...)
  // silently never ran on it at all.
  if (isBankLikeItem(it)) return Number(it.currentPrice ?? it.purchasePrice) || 0
  const price = effectivePrice(it, marketPrices, resolvedPrices) || Number(it.purchasePrice) || 0
  return (Number(it.quantity) || 0) * price
}

function parseDay(s) {
  if (!s) return null
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}

// `it.createdAt` is written as a full ISO datetime string (useFirestoreItems'
// addItem/bulkImport), not the 'YYYY-MM-DD' shape parseDay expects — same
// accessor PortfolioSpreadsheet.jsx already uses for the same field.
function parseCreatedAt(it) {
  if (!it.createdAt) return null
  const d = new Date(it.createdAt)
  return isNaN(d.getTime()) ? null : d
}

const isoDate = (ts) => new Date(ts).toISOString().slice(0, 10)
const MONTH_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthList = (idxs, names) => idxs.map((i) => names[i]).join(', ')

// `incomeVerification`: Map itemId -> veredicto de lib/dividendVerify.js. Lo
// calcula el caller y no este módulo porque la proyección de un activo de
// mercado NO está persistida: el rendimiento lo resuelve useMarketPrices en
// vivo desde Yahoo y solo existe en el ítem ENRIQUECIDO, mientras acá llegan
// los CRUDOS. Mismo patrón que `resolvedPrices`. Sin el mapa, el hallazgo
// simplemente no existe y nada más cambia.
export function analyzeDataCompleteness({ items = [], transactions = [], lots = [], convert, baseCurrency = 'USD', now, marketPrices = null, resolvedPrices = null, pricesReady = true, incomeVerification = null } = {}) {
  const nowDate = now ? new Date(now) : new Date()
  const cv = (amount, from, to) => {
    if (!amount || !from || !to || from === to || typeof convert !== 'function') return amount || 0
    const out = convert(amount, from, to)
    return isFinite(out) ? out : amount
  }
  const toBase = (amount, cur) => cv(amount, cur, baseCurrency)

  const findings = []
  // `suggestion` is optional and ONLY set when a concrete value can be derived
  // from data that already exists (a real transaction, the account's own
  // createdAt) — never invented. When present it lets the UI offer a one-tap
  // "use this" instead of just pointing at the gap and sending the user to
  // hunt the value down and type it in by hand.
  const push = (code, severity, itemId, textEs, textEn, action, suggestion) => {
    findings.push({ id: `${code}:${itemId || 'global'}`, code, severity, itemId: itemId || null, textEs, textEn, action, suggestion: suggestion || null })
  }

  const byId = new Map(items.map((it) => [it.id, it]))
  const bySym = new Map()
  const byName = new Map()
  for (const it of items) {
    if (it.symbol) bySym.set(String(it.symbol).toUpperCase(), it)
    if (it.name) byName.set(String(it.name).toUpperCase(), it)
  }
  const resolveRef = (ref) => {
    if (!ref) return null
    return byId.get(ref) || bySym.get(String(ref).toUpperCase()) || byName.get(String(ref).toUpperCase()) || null
  }

  const isMarket = (it) => /stock|crypto|fund|etf/i.test(it.type || '') && !/realestate/i.test(it.type || '')
  const isBroker = (it) => BROKER_SOURCES.test(it._source || '')
  // FASE JU: esto leía `it.isExcludedFromNetWorth`, una PROPIEDAD que ningún
  // ítem tiene (nadie la escribe: grep limpio). Siempre era undefined, así que
  // el filtro no filtraba nada y una cuenta por cobrar que el usuario dejó
  // FUERA del patrimonio a propósito igual generaba hallazgos sobre su saldo.
  // La regla real es la función compartida de utils.js, y es la que el
  // patrimonio, la gráfica y el backfill ya usan.
  const isTracked = (it) => !it.isDebt && !isExcludedFromNetWorth(it)

  // ── Flow index: which transactions touch which item, and by how much ──────
  // inflow/outflow are kept in the ITEM's currency so they compare directly
  // against its balance. Counts every channel that moves that account's money:
  // linked deposits/withdrawals, transfers in/out, dividends and sale proceeds
  // routed to it (explicit _destinationItemId or the source's incomeDestination).
  const flows = new Map() // itemId -> { count, inflow, outflow, lastTs, firstTs }
  const touch = (id, amountInItemCur, ts) => {
    if (!id || !byId.has(id)) return
    const f = flows.get(id) || { count: 0, inflow: 0, outflow: 0, lastTs: 0, firstTs: 0 }
    f.count += 1
    if (amountInItemCur >= 0) f.inflow += amountInItemCur
    else f.outflow += -amountInItemCur
    if (ts) {
      f.lastTs = Math.max(f.lastTs, ts)
      f.firstTs = f.firstTs ? Math.min(f.firstTs, ts) : ts
    }
    flows.set(id, f)
  }

  // Real payment history for income suggestions below: which months a source
  // actually paid in, and which account its payments actually landed in —
  // both read straight off past DIVIDEND/INTEREST transactions, never guessed.
  const incomeMonthsByItem = new Map() // itemId -> Set<monthIndex 0-11>
  const incomeDestByItem = new Map() // itemId -> { id, ts } (most recent destination seen)

  for (const tx of transactions) {
    const ty = (tx.type || '').toUpperCase()
    const amt = Number(tx.totalAmount ?? tx.amount) || 0
    if (!(amt > 0)) continue
    const txCur = tx.currency || baseCurrency
    const ts = parseDay(tx.date)?.getTime() || 0
    const inItemCur = (id) => cv(amt, txCur, itemCurrency(byId.get(id) || {}))

    if (ty === 'DEPOSIT' && tx._linkedItemId) {
      touch(tx._linkedItemId, inItemCur(tx._linkedItemId), ts)
    } else if (ty === 'WITHDRAWAL' && tx._linkedItemId) {
      touch(tx._linkedItemId, -inItemCur(tx._linkedItemId), ts)
    } else if (ty === 'TRANSFER') {
      if (tx._originItemId) touch(tx._originItemId, -inItemCur(tx._originItemId), ts)
      if (tx._linkedItemId) touch(tx._linkedItemId, inItemCur(tx._linkedItemId), ts)
    } else if (ty === 'DIVIDEND') {
      if (tx._destinationItemId) {
        touch(tx._destinationItemId, inItemCur(tx._destinationItemId), ts)
      } else if (tx._linkedItemId) {
        const src = byId.get(tx._linkedItemId)
        if (tx._reinvested || (src && src.dividendAction === 'reinvest')) {
          // Reinvested into the source: it explains the source's growth.
          touch(tx._linkedItemId, inItemCur(tx._linkedItemId), ts)
        } else {
          const dest = resolveRef(src?.incomeDestination)
          if (dest) touch(dest.id, cv(amt, txCur, itemCurrency(dest)), ts)
          else touch(tx._linkedItemId, 0, ts) // at least marks the source as "has history"
        }
      }
    } else if (ty === 'SELL') {
      if (tx._destinationItemId) touch(tx._destinationItemId, inItemCur(tx._destinationItemId), ts)
      if (tx._linkedItemId) touch(tx._linkedItemId, 0, ts)
    }

    if ((ty === 'DIVIDEND' || ty === 'INTEREST') && tx._linkedItemId) {
      const day = parseDay(tx.date)
      if (day) {
        const set = incomeMonthsByItem.get(tx._linkedItemId) || new Set()
        set.add(day.getUTCMonth())
        incomeMonthsByItem.set(tx._linkedItemId, set)
      }
      if (tx._destinationItemId) {
        const prev = incomeDestByItem.get(tx._linkedItemId)
        if (!prev || ts >= prev.ts) incomeDestByItem.set(tx._linkedItemId, { id: tx._destinationItemId, ts })
      }
    }
  }

  // ── Per-item checks ────────────────────────────────────────────────────────
  for (const it of items) {
    const name = it.name || it.symbol || '-'
    const cur = itemCurrency(it)
    const balance = itemBalance(it, marketPrices, resolvedPrices)
    const balanceBase = toBase(balance, cur)
    const broker = isBroker(it)

    // 4. Missing acquisition date. NOT for broker items: their date comes from the
    // sync/Excel import, not something the user should hand-type. Nagging on an IBKR
    // stock is noise (and if it's missing that's an import concern, not a user to-do).
    if (!broker && !it.acquisitionDate) {
      // Best real date we have: the earliest transaction actually linked to
      // this item, else the moment the account itself was added to Chispudo
      // (createdAt) — both are values already on file, never a guess.
      const firstFlowTs = flows.get(it.id)?.firstTs || null
      const createdTs = parseCreatedAt(it)?.getTime() || null
      const candidateTs = firstFlowTs || createdTs
      const suggestion = candidateTs ? {
        patch: { acquisitionDate: isoDate(candidateTs) },
        textEs: firstFlowTs
          ? `Usar la fecha de tu primer movimiento registrado: ${isoDate(candidateTs)}.`
          : `Usar la fecha en que agregaste esta cuenta: ${isoDate(candidateTs)}.`,
        textEn: firstFlowTs
          ? `Use the date of your first recorded transaction: ${isoDate(candidateTs)}.`
          : `Use the date you added this account: ${isoDate(candidateTs)}.`,
      } : null
      push('no-acq-date', 'high', it.id,
        `${name} no tiene fecha de adquisición: sin ella el historial no sabe desde cuándo existe.`,
        `${name} has no acquisition date: history can't tell when it started.`,
        { kind: 'edit-item' }, suggestion)
    }

    // 13. Market asset silently worth $0: a real holding (quantity > 0) whose
    // price never synced or was left blank shows as zero on every card, as if
    // the position vanished. Placed BEFORE the dust-floor `continue` below on
    // purpose: the bug IS that its value reads as dust, so the floor would
    // hide exactly the case this exists to catch.
    //
    // A market item's currentPrice is NEVER the raw item's own field in
    // practice — it's resolved live by symbol on every render
    // (useMarketPrices), never written back to Firestore. Reading
    // it.currentPrice directly here flagged nearly every working stock/crypto
    // position in the portfolio: real holdings, real prices shown everywhere
    // else, just not the field this pure module was handed. effectivePrice
    // checks the live marketPrices map (when the caller passes one) before
    // concluding the price is actually missing.
    // `pricesReady` false = la cotización todavía viene en camino (o el fetch de
    // esta vuelta falló). Ahí "no tiene precio" no es un hueco de datos del
    // usuario sino un estado momentáneo de la app, y avisarlo es gritar lobo:
    // el usuario lo reportó como "A VECES con BTC no detecta el precio, pero en
    // la gráfica y en el Spreadsheet me aparece bien". Un activo genuinamente
    // sin precio sigue avisando en cuanto la vuelta de precios termina.
    //
    // ⛔ Y el aviso se le PREGUNTA a la función que de verdad valúa el activo,
    // en vez de concluir "$0" desde su propio gate. `getItemPrice` (la que usa
    // `getItemValue`, o sea el patrimonio, la Hoja y los reportes) cae en
    // cascada a `purchasePrice`, `price`, `cost` y `averagePrice`, así que una
    // acción sin cotización viva pero CON precio de compra se cuenta a ESE
    // precio y no en cero: verificado ejecutándola, un ítem de 10 unidades a 56
    // vale 560 para toda la app mientras el aviso afirmaba "$0". Son dos
    // situaciones distintas y solo una es una pérdida de dinero, así que se
    // dicen distinto: sin ninguna fuente de precio, la cifra SÍ desaparece del
    // patrimonio (high); con respaldo, lo que pasa es que el precio quedó
    // quieto (medium). Tercera vez que este mismo check afirma de más: FASE
    // EZ4 y FASE HV11 arreglaron sus otras dos formas.
    if (pricesReady && !broker && isTracked(it) && isMarket(it) && (Number(it.quantity) || 0) > 0 && !(effectivePrice(it, marketPrices, resolvedPrices) > 0)) {
      const fallback = getItemPrice(it)
      if (fallback > 0) {
        push('no-market-price-stale', 'medium', it.id,
          `${name} no se está cotizando: se cuenta a ${cur} ${fmt(fallback)} por unidad, el precio que tú registraste, y no al de hoy. Revisa que su símbolo sea el correcto.`,
          `${name} is not being quoted: it counts at ${cur} ${fmt(fallback)} per unit, the price you recorded, not today's. Check that its symbol is right.`,
          { kind: 'edit-item' })
      } else {
        push('no-market-price', 'high', it.id,
          `${name} tiene ${it.quantity} unidades pero sin ningún precio: se está contando en $0 en tu patrimonio.`,
          `${name} holds ${it.quantity} units but has no price at all: it's being counted as $0 in your net worth.`,
          { kind: 'edit-item' })
      }
    }

    // 19. El rendimiento declarado contra lo que el BROKER de verdad pagó.
    //
    // ⛔ Va ANTES de la puerta que excluye a los items de broker, y esa es la
    // parte deliberada: en todos los demás checks el dato del broker es
    // autoritativo y no hay nada que preguntarle al usuario, pero acá el broker
    // es justamente la SEGUNDA FUENTE. El rendimiento que se muestra para una
    // acción no lo puso el usuario: lo resuelve Yahoo en vivo
    // (useMarketPrices), y contrastarlo contra el ledger de caja del propio
    // broker es la única verificación cruzada que no depende de contratar otro
    // proveedor (ver la cabecera de lib/dividendVerify.js).
    //
    // El motor rehúsa en cada caso donde la comparación no sería justa, así que
    // aquí solo llega un desacuerdo por un FACTOR: un decimal corrido, un
    // rendimiento viejo de antes de un recorte, una moneda mezclada.
    const verdict = incomeVerification && it.id ? incomeVerification.get(it.id) : null
    if (verdict && verdict.status === 'mismatch') {
      const proj = `${cur} ${fmt(verdict.projected)}`
      const paid = `${cur} ${fmt(verdict.actual)}`
      push('income-mismatch', 'medium', it.id,
        `${name} proyecta ${proj} al año y en los últimos 12 meses cobró ${paid} (${verdict.payments} pagos). Revisa el rendimiento declarado: es el que alimenta "Ingreso anual estimado" y los próximos pagos.`,
        `${name} projects ${proj} a year but received ${paid} over the last 12 months (${verdict.payments} payments). Check the declared yield: it feeds "Estimated annual income" and upcoming payments.`,
        { kind: 'edit-item' })
    }

    // Global exemptions for the rest: broker data is authoritative, debt and
    // excluded items don't feed the history math, dust accounts are noise.
    if (broker || !isTracked(it) || balanceBase < MIN_BALANCE_BASE) continue

    // 14. Cost basis missing on a priced market holding: the gain shown
    // assumes it cost $0, inflating the return on every P&L card. Same
    // effectivePrice reasoning as #13 above for the gate.
    if (isMarket(it) && (Number(it.quantity) || 0) > 0 && effectivePrice(it, marketPrices, resolvedPrices) > 0 && !((Number(it.purchasePrice) || 0) > 0)) {
      push('no-cost-basis', 'medium', it.id,
        `${name} no tiene precio de compra: la ganancia mostrada asume que costó $0.`,
        `${name} has no purchase price: the gain shown assumes it cost $0.`,
        { kind: 'edit-item' })
    }

    // 15. Market asset with no symbol: price sync, lot matching and dividend
    // attribution all key off it, so a blank symbol silently opts the asset
    // out of all three.
    if (isMarket(it) && !it.symbol) {
      push('no-symbol', 'medium', it.id,
        `${name} no tiene símbolo: no se puede sincronizar su precio ni vincular sus movimientos.`,
        `${name} has no symbol: its price can't sync and its transactions can't be matched to it.`,
        { kind: 'edit-item' })
    }

    // 5. Missing currency (assumed USD silently — a 7.8× error for GTQ).
    if (!it.currency && !it._originalCurrency) {
      push('no-currency', 'medium', it.id,
        `${name} no tiene moneda: se asume USD, lo que distorsiona los totales si no lo es.`,
        `${name} has no currency: USD is assumed, which skews totals if it isn't.`,
        { kind: 'edit-item' })
    }

    // 10. Missing institution (drives merges and lot attribution).
    if (!it.institution) {
      push('no-institution', 'low', it.id,
        `${name} no tiene institución: ayuda a agrupar y a atribuir compras.`,
        `${name} has no institution: it helps grouping and lot attribution.`,
        { kind: 'edit-item' })
    }

    const hasIncome = (Number(it.incomeRate) || 0) > 0 || (Number(it.incomeAmount) || 0) > 0 || (Number(it.dividendYield) || 0) > 0

    // 6. Income without payment months → projections assume all 12.
    if (hasIncome && !(Array.isArray(it.incomeMonths) && it.incomeMonths.length > 0)) {
      const seenMonths = incomeMonthsByItem.get(it.id)
      const suggestion = seenMonths && seenMonths.size > 0 ? (() => {
        const idxs = [...seenMonths].sort((a, b) => a - b)
        return {
          patch: { incomeMonths: idxs, incomeMonthsExplicit: true },
          textEs: `Ya vimos pagos en ${monthList(idxs, MONTH_ES)}: usar esos meses.`,
          textEn: `We already saw payments in ${monthList(idxs, MONTH_EN)}: use those months.`,
        }
      })() : null
      push('income-no-months', 'medium', it.id,
        `${name} genera ingresos pero no dice en qué meses pagan: la proyección asume los 12.`,
        `${name} earns income but has no payment months: projections assume all 12.`,
        { kind: 'edit-item' }, suggestion)
    }

    // 7. Cash income with nowhere to land → payments vanish from tracking.
    if (hasIncome && it.dividendAction !== 'reinvest' && !it.incomeDestination) {
      const seenDest = incomeDestByItem.get(it.id)
      const destItem = seenDest ? byId.get(seenDest.id) : null
      const suggestion = destItem ? {
        patch: { incomeDestination: destItem.id },
        textEs: `Sus pagos ya llegan a ${destItem.name || destItem.symbol}: usar esa cuenta como destino.`,
        textEn: `Its payments already land in ${destItem.name || destItem.symbol}: use that account as the destination.`,
      } : null
      push('income-no-dest', 'low', it.id,
        `¿A qué cuenta llegan los pagos de ${name}? Sin destino, desaparecen del rastreo.`,
        `Where do ${name}'s payments land? Without a destination they vanish from tracking.`,
        { kind: 'edit-item' }, suggestion)
    }

    // 9. Broken income destination link. No real replacement to suggest (the
    // account it pointed to is genuinely gone), but clearing a dead reference
    // is a safe action, not a guess — it removes stale data, it invents none.
    if (it.incomeDestination && !resolveRef(it.incomeDestination)) {
      push('broken-link', 'medium', it.id,
        `El destino de ingresos de ${name} apunta a una cuenta que ya no existe.`,
        `${name}'s income destination points at an account that no longer exists.`,
        { kind: 'edit-item' }, {
          patch: { incomeDestination: null },
          textEs: 'Quitar la referencia rota: después puedes asignar una cuenta nueva.',
          textEn: 'Clear the broken reference: you can assign a new account afterward.',
        })
    }

    // 9b. Préstamo vinculado que ya no existe. Mismo criterio que el destino de
    // ingresos: no hay reemplazo real que sugerir (la deuda se borró de verdad),
    // pero limpiar una referencia muerta quita dato viejo sin inventar ninguno.
    if (it.linkedDebtId && !resolveRef(it.linkedDebtId)) {
      push('broken-link', 'medium', it.id,
        `El préstamo vinculado a ${name} apunta a una deuda que ya no existe.`,
        `${name}'s linked loan points at a debt that no longer exists.`,
        { kind: 'edit-item' }, {
          patch: { linkedDebtId: null },
          textEs: 'Quitar la referencia rota: después puedes vincular otro préstamo.',
          textEn: 'Clear the broken reference: you can link another loan afterward.',
        })
    }

    // 17. Sin país, y SOLO donde de verdad se cuenta mal.
    // "Asignación de activos > Geo" resuelve el país del SÍMBOLO
    // (getGeographyFromSymbol) y cae a EE.UU. cuando no matchea ningún sufijo
    // bursátil conocido. Para un ticker real (AAPL, VOO) esa respuesta es
    // correcta y preguntar sería ruido; el caso que sale mal es el activo cuyo
    // "símbolo" es sintético (un bono, un inmueble, un alternativo), que se
    // cuenta como estadounidense sin que nada lo diga. Es exactamente la queja
    // de FASE FN. Sin sugerencia automática: el país no se adivina, es dato del
    // usuario.
    //
    // ⛔ La condición se le PREGUNTA a la función que de verdad resuelve la
    // geografía, en vez de aproximarla con "no es de mercado". Verificado
    // ejecutándola: un activo SIN símbolo (una cuenta líquida, un inmueble, o
    // sea las dos formas más comunes que no cotizan) resuelve a 'Unknown', NO a
    // 'US'. Con la condición ancha el aviso salía sobre esas cuentas afirmando
    // una consecuencia falsa, que es peor que no avisar: manda a arreglar algo
    // que no está mal. Solo el símbolo SINTÉTICO (un bono tecleado a mano) cae
    // de verdad en el default estadounidense, y ese es el caso que el
    // comentario de arriba siempre describió.
    if (!it.assetCountry && !isMarket(it) && getGeographyFromItem(it) === 'US') {
      push('no-country', 'low', it.id,
        `${name} no dice en qué país está: sin eso, el desglose por geografía lo cuenta como EE.UU.`,
        `${name} has no country: without it, the geography breakdown counts it as the US.`,
        { kind: 'edit-item' })
    }

    // 18. Rendimiento declarado que nunca pagó nada. Es literalmente la pregunta
    // del usuario ("si ya recibió dividendos"): un activo que dice rendir y no
    // tiene UN solo movimiento de ingreso en su historia, o nunca cobró (y hay
    // que capturarlo) o el rendimiento declarado no es real. Gateado a que el
    // activo tenga al menos INCOME_GRACE_DAYS de antigüedad: recién creado no
    // pudo haber cobrado todavía, y preguntarlo el mismo día es ruido.
    //
    // ⛔ Y NUNCA sobre una cuenta que REINVIERTE, que es el mismo gate que su
    // hermano `income-no-dest` ya aplica tres bloques arriba. En una cuenta que
    // compone, el rendimiento vive DENTRO del saldo por diseño: no existe un
    // pago que registrar hasta que el motor de rendimiento deducido
    // (lib/liquidYield.js) lo deduzca y lo escriba. Sin este gate el hallazgo
    // era permanente, imposible de resolver, y su acción (un DEPOSIT con
    // `origin:'yield'`) habría escrito un ingreso ENCIMA de un saldo que ya lo
    // contiene, o sea contando el mismo dinero dos veces.
    if (hasIncome && it.dividendAction !== 'reinvest' && !incomeMonthsByItem.has(it.id)) {
      const born = parseDay(it.acquisitionDate) || parseCreatedAt(it)
      if (born && nowDate.getTime() - born.getTime() > INCOME_GRACE_DAYS * 86400000) {
        push('income-never-received', 'low', it.id,
          `${name} dice que genera rendimiento pero no tiene ni un pago registrado: ¿ya cobraste alguno?`,
          `${name} says it earns income but has no payment on file: have you received any?`,
          { kind: 'cashflow', prefill: { flowType: 'DEPOSIT', origin: 'yield', linkedId: it.id } })
      }
    }

    // 11. Matured but still on the books.
    const maturity = parseDay(it.maturityDate)
    if (maturity && maturity < nowDate) {
      push('past-maturity', 'medium', it.id,
        `${name} venció el ${it.maturityDate}: ¿se renovó, se cobró, se convirtió?`,
        `${name} matured on ${it.maturityDate}: was it renewed, cashed out, converted?`,
        { kind: 'edit-item' })
    }

    // 16. Maturity before acquisition: the two dates contradict each other,
    // almost always a typo in one of them. Independent of #11 above (a bond
    // can fail this check while still being in the future).
    const acqForMaturity = parseDay(it.acquisitionDate)
    if (maturity && acqForMaturity && maturity < acqForMaturity) {
      push('bad-maturity-date', 'medium', it.id,
        `${name} vence el ${it.maturityDate}, antes de haberse adquirido el ${it.acquisitionDate}: revisa las fechas.`,
        `${name} matures on ${it.maturityDate}, before it was acquired on ${it.acquisitionDate}: check the dates.`,
        { kind: 'edit-item' })
    }

    // History checks only make sense for balance-style (static) assets —
    // market assets reconstruct from lots (checked separately below).
    if (!isMarket(it)) {
      const f = flows.get(it.id)
      // "¿De dónde vino este dinero?" — asked and answered once, at creation
      // (AddAccountModal's "es dinero nuevo" toggle, stamped as
      // `_newMoneyConfirmed`). It must not come back just because the DEPOSIT
      // transaction that normally proves it got edited, deduped, or never
      // synced the way this check expects — that reads as the app not having
      // listened, and worse, invites a real duplicate deposit from a
      // well-meaning second click on "Capturar historia". Scoped to ONLY
      // these two checks: staleness (#8 below) is a different question and
      // still deserves its own nag regardless of how the money arrived.
      const originConfirmed = !!it._newMoneyConfirmed

      // 1. No history at all: a balance no movement explains.
      if (!originConfirmed && (!f || f.count === 0)) {
        push('no-history', 'high', it.id,
          `${name} tiene ${cur} ${fmt(balance)} sin ningún movimiento que lo explique: ¿cuándo entró este dinero?`,
          `${name} holds ${cur} ${fmt(balance)} with no movement explaining it: when did this money arrive?`,
          { kind: 'cashflow', prefill: { flowType: 'DEPOSIT', origin: 'external', linkedId: it.id, alreadyReflected: true } })
      } else if (f) {
        // 2. Partial history: flows explain less than half the balance.
        // Growth (interest) legitimately widens balance beyond net flows, so
        // the 50% bar + an absolute floor keep compounding out of the noise.
        const explained = f.inflow - f.outflow
        const unexplained = balance - explained
        const unexplainedBase = toBase(unexplained, cur)
        // ⛔ Los movimientos netean NEGATIVO sobre un saldo positivo: salió más
        // de lo que entró y aun así la cuenta tiene dinero. Eso NO es "historia
        // parcial" y decirlo así produce dos afirmaciones falsas a la vez, las
        // dos reproducidas contra el motor real con los números del usuario:
        //
        //   "Solo el 0% del saldo tiene historia"  ← sobre una cuenta con DOS
        //     movimientos registrados. El 0% sale de clampear un porcentaje
        //     negativo, no de que falte historia.
        //   "faltan aportes por USD 722"           ← sobre una cuenta que tiene
        //     USD 500. Se afirma que falta MÁS dinero del que la cuenta guarda,
        //     y el prellenado archivaría ese monto como un aporte único que no
        //     corresponde a ningún evento (la regla de FASE JH: el monto de la
        //     acción tiene que ser el del texto, y acá los dos estaban mal).
        //
        // Además "falta un aporte" es solo UNA de las dos explicaciones; la
        // otra es que sobre una salida. Así que el hallazgo nombra el hecho
        // (los movimientos no cuadran con el saldo) y manda a mirarlos, sin
        // prellenar ningún monto. Es la misma pregunta que
        // `lib/liquidYield.js` ya trata como 'negative-residual', con la
        // diferencia de que aquella exige `balanceAsOf` y esta cubre el resto.
        //
        // ⛔ La rama negativa CORTA, aunque su propio piso no se alcance. Un
        // `else if` encadenado dejaba el defecto entrando por la puerta de al
        // lado con un exceso chico (500 de entrada, 520 de salida, saldo 500:
        // el exceso son 20 y no llega al piso, pero `unexplained` da 520 y
        // `partial-history` volvía a decir "solo el 0%... faltan aportes por
        // 520" sobre una cuenta de 500). Lo cazó el test del piso, no la
        // lectura del código: con `explained < 0` la historia parcial no
        // aplica NUNCA, se reporte o no el hecho.
        if (!originConfirmed && balance > 0 && explained < 0) {
          if (toBase(-explained, cur) > UNEXPLAINED_FLOOR_BASE) {
            push('flows-exceed-balance', 'medium', it.id,
              `Los movimientos de ${name} no cuadran con su saldo: salieron ${cur} ${fmt(-explained)} más de los que entraron, y la cuenta igual tiene ${cur} ${fmt(balance)}. Revisa si falta una entrada o si sobra una salida.`,
              `${name}'s movements do not add up to its balance: ${cur} ${fmt(-explained)} more went out than came in, yet the account still holds ${cur} ${fmt(balance)}. Check whether an inflow is missing or an outflow is wrong.`,
              { kind: 'edit-item' })
          }
        } else if (!originConfirmed && balance > 0 && explained / balance < EXPLAINED_PCT_THRESHOLD && unexplainedBase > UNEXPLAINED_FLOOR_BASE) {
          const pct = Math.max(0, Math.round((explained / balance) * 100))
          push('partial-history', 'medium', it.id,
            `Solo el ${pct}% del saldo de ${name} tiene historia: faltan aportes por ${cur} ${fmt(unexplained)}.`,
            `Only ${pct}% of ${name}'s balance has history: contributions worth ${cur} ${fmt(unexplained)} are missing.`,
            // ⛔ El monto va EXPLÍCITO, y no es una comodidad.
            //
            // Sin él, CashFlowModal cae a su respaldo y prellena el saldo
            // COMPLETO de la cuenta (correcto para `no-history`, donde no hay
            // ningún movimiento, y equivocado acá). Este hallazgo dispara
            // cuando los movimientos ya explican hasta el 49% del saldo, así
            // que aceptar el prellenado registraría un aporte por el total
            // ENCIMA de los que ya están en el archivo: los aportes se cuentan
            // dos veces, y con ellos se infla "invertido" y se desinfla el
            // retorno. Lo que falta es el HUECO, que es el número que este
            // mismo hallazgo acaba de calcular y de imprimir en su texto.
            { kind: 'cashflow', prefill: { flowType: 'DEPOSIT', origin: 'external', linkedId: it.id, alreadyReflected: true, amount: unexplained } })
        }
      }
      // 8. Stale value: nothing touched it in a long time. A different
      // question from "where did it come from" — still asked even once the
      // origin is confirmed.
      //
      // ⛔ `balanceAsOf` va PRIMERO porque es la respuesta EXACTA a lo que este
      // hallazgo pregunta. La spec congelada lo define literal ("DESDE CUÁNDO ES
      // CIERTO el saldo", lib/assetLogic/liquidFundYield.js) y lo estampan las
      // TRES superficies que corrigen un saldo (AddAccountModal,
      // EditAccountModal, la Hoja) en cada guardado de un activo que no cotiza.
      // Sin leerlo, este check miraba tres proxies más débiles y le decía "no
      // registra valuación en más de 180 días" a una cuenta cuyo saldo el
      // usuario acababa de confirmar este mes: una afirmación falsa sobre un
      // dato que la app sí tenía y no consultaba.
      const lastTouch = Math.max(
        parseDay(it.balanceAsOf)?.getTime() || 0,
        f?.lastTs || 0,
        parseDay(it.lastValuationDate)?.getTime() || 0,
        parseDay(it.acquisitionDate)?.getTime() || 0,
        new Date(it.createdAt || 0).getTime() || 0,
      )
      if (!it.isIlliquid && lastTouch > 0 && (nowDate.getTime() - lastTouch) > STALE_DAYS * 86400000) {
        push('stale-value', 'low', it.id,
          `${name} no registra movimientos ni valuación en más de ${STALE_DAYS} días: ¿sigue valiendo lo mismo?`,
          `${name} has had no movement or valuation in over ${STALE_DAYS} days: is it still worth the same?`,
          { kind: 'edit-item' })
      }
    }
  }

  // ── 3. Uncovered shares: market quantity without lot dates ────────────────
  // Lots are keyed by symbol (attribution prefers institution, like
  // closeLotsFIFO), and reconstruction is per-symbol, so the gap is evaluated
  // per symbol aggregate — shared symbols across wallets don't false-positive.
  const marketBySym = new Map()
  for (const it of items) {
    if (!isMarket(it) || !it.symbol || isBroker(it) || !isTracked(it)) continue
    // Rate-bearing qty-1 "funds" (liquid funds, CDT-style) are balance assets:
    // there are no shares to cover with lots — their history comes from linked
    // deposits, not purchase records.
    if ((Number(it.quantity) || 0) === 1 && (Number(it.incomeRate) || 0) > 0) continue
    const sym = String(it.symbol).toUpperCase()
    const g = marketBySym.get(sym) || { qty: 0, items: [] }
    g.qty += Number(it.quantity) || 0
    g.items.push(it)
    marketBySym.set(sym, g)
  }
  const openLotQty = new Map()
  for (const lot of lots) {
    if ((lot.status || 'open') !== 'open') continue
    const sym = String(lot.symbol || '').toUpperCase()
    if (!sym) continue
    openLotQty.set(sym, (openLotQty.get(sym) || 0) + (Number(lot.quantity) || 0))
  }
  for (const [sym, g] of marketBySym) {
    if (!(g.qty > 0)) continue
    const covered = openLotQty.get(sym) || 0
    const gap = g.qty - covered
    if (gap > g.qty * 0.01) {
      const biggest = g.items.reduce((a, b) => (itemBalance(a, marketPrices, resolvedPrices) >= itemBalance(b, marketPrices, resolvedPrices) ? a : b))
      // ⛔ El texto viejo mandaba a "confirmar la fecha de adquisición", y eso
      // NO limpia el hallazgo: comprobado ejecutando el motor antes y después
      // de ponerla, sigue ahí, porque lo que falta es un LOTE y una fecha no
      // crea ninguno. Y no hay ninguna otra puerta: `onAddLot` solo llega a
      // `AddAccountModal` (el alta), y el aporte desde la cuenta crea un lote
      // por las unidades que AGREGA, así que sube cantidad y cobertura a la
      // vez y el hueco queda igual. O sea es irresoluble hoy, verificado por
      // ausencia (ningún componente del repo edita lotes).
      //
      // Así que deja de ser un pendiente y pasa a ser lo que de verdad es: un
      // dato sobre la PRECISIÓN de la historia de esa posición. Se dice la
      // consecuencia real (se reconstruye manteniendo la cantidad de hoy hacia
      // atrás, un estimado) en vez de una instrucción que no funciona, y baja a
      // 'low' porque un aviso sin acción posible no puede pesar más que los que
      // sí se pueden resolver ni ocuparles su lugar en los tres de arriba.
      push('uncovered-shares', 'low', biggest.id,
        `${fmtQty(gap)} de ${fmtQty(g.qty)} unidades de ${sym} no tienen registro de compra: su historial se reconstruye manteniendo la cantidad de hoy hacia atrás, o sea es un estimado. Su valor de hoy no se ve afectado.`,
        `${fmtQty(gap)} of ${fmtQty(g.qty)} ${sym} units have no purchase record: their history is rebuilt by holding today's quantity flat backwards, so it is an estimate. Today's value is unaffected.`,
        { kind: 'edit-item' })
    }
  }

  // ── 12. Duplicate suspects: same symbol + institution, both manual ────────
  const dupKey = new Map()
  for (const it of items) {
    if (isBroker(it) || !it.symbol || it.isDebt) continue
    const key = `${String(it.symbol).toUpperCase()}|${(it.institution || '').toLowerCase()}`
    ;(dupKey.get(key) || dupKey.set(key, []).get(key)).push(it)
  }
  for (const [, group] of dupKey) {
    if (group.length < 2) continue
    // Answered once, stays answered — same pattern as _newMoneyConfirmed
    // (FASE DP): a flag on the ITEM, not a client-only dismiss, so "no son
    // iguales" sticks across every surface that runs this same check
    // (ChispuSuggestions AND AccountReviewModal), not just the one it was
    // clicked in. Only suppressed while the group is EXACTLY these items —
    // a new item later sharing the same symbol+institution has no flag of
    // its own, so it re-asks about the new situation, not the old one.
    if (group.every((it) => it._dupConfirmedDistinct)) continue
    const names = group.map((g) => g.name || g.symbol).join(', ')
    push('dup-suspect', 'low', group[0].id,
      `${names} comparten símbolo e institución: ¿son la misma posición duplicada?`,
      `${names} share symbol and institution: are they the same position duplicated?`,
      { kind: 'review', itemIds: group.map((g) => g.id) })
  }

  // ── Scores ─────────────────────────────────────────────────────────────────
  const itemScores = {}
  for (const it of items) itemScores[it.id] = 100
  for (const fnd of findings) {
    if (fnd.itemId && itemScores[fnd.itemId] != null) {
      itemScores[fnd.itemId] = Math.max(0, itemScores[fnd.itemId] - SEVERITY_WEIGHT[fnd.severity])
    }
  }
  let weightSum = 0
  let scoreSum = 0
  for (const it of items) {
    if (!isTracked(it)) continue
    const w = Math.max(toBase(itemBalance(it, marketPrices, resolvedPrices), itemCurrency(it)), 1)
    weightSum += w
    scoreSum += w * itemScores[it.id]
  }
  const globalScore = weightSum > 0 ? Math.round(scoreSum / weightSum) : 100

  const order = { high: 0, medium: 1, low: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return { findings, itemScores, globalScore }
}
