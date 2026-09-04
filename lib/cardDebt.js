// Llevar el saldo de una tarjeta importada a la Hoja, como deuda.
//
// Modulo puro: entra el estado ya parseado y los items de hoy, sale un PLAN
// (que crear, que actualizar, que saltar y por que). No escribe nada: quien
// escribe es el importador, y asi el plan se puede mostrar ANTES de confirmar.
//
// ── Las decisiones, todas del usuario o medidas antes de escribir ───────────
//
// 1. UNA DEUDA POR MONEDA. Un estado trae GTQ y USD en el mismo documento, y un
//    item tiene UNA sola moneda. Meter las dos en un item obligaria a sumarlas,
//    que necesita una tasa, y `convert` sin tasa devuelve el monto CRUDO en
//    silencio. Asi que la identidad es tarjeta + moneda, y una tarjeta con
//    saldo en las dos produce dos filas en la Hoja.
//
// 2. IDENTIDAD EXPLICITA (`item.cardKey`). Hoy `cardKey` (banco + ultimos
//    cuatro) vive SOLO en las transacciones; los items no tienen ninguna. Sin
//    inventarla, el estado del mes siguiente crearia una segunda deuda y el
//    patrimonio se inflaria sin limite (el precedente del tropiezo es la cuenta
//    "BI Monetaria" del import bancario, que se crea sin dedup). No hay
//    fallback por nombre: adivinar cual deuda es "la misma" sobre datos ajenos
//    es justo lo que este repo prohibe, y el plan se muestra antes de aplicar,
//    asi que el usuario ve si va a crear o a actualizar.
//
// 3. ⛔ `balanceAsOf` = LA FECHA DE CORTE, no hoy. Esta es la diferencia con las
//    otras tres puertas que sellan ese campo (alta, edicion, Hoja), donde la
//    spec dice "hoy: el usuario esta mirando el campo y apretando Guardar".
//    Aca el usuario no afirma nada: lo afirma el BANCO, y lo afirma sobre el
//    dia del corte, que ya paso. Sellar hoy diria que el saldo es de hoy, que
//    es falso en cuanto compres algo despues del corte. Un `balanceAsOf` en el
//    pasado es exactamente lo que hace que `lib/dataCompleteness.js` marque la
//    tarjeta como que necesita un estado nuevo, que es el comportamiento
//    correcto.
//
// 4. UN ESTADO VIEJO NO PISA UNO NUEVO. Si el saldo guardado ya es de una fecha
//    posterior a este corte, no se toca: importar el estado de junio despues
//    del de agosto no puede retroceder el saldo.
//
// 5. NO SE FABRICA UN PAGO (decision del usuario). Entre dos cortes el saldo
//    baja por lo que pagaste y sube por lo que compraste, mezclados, y ninguna
//    superficie sabe partir ese delta. Se escribe el saldo y se DICE que el
//    pasado de esa deuda queda plano entre cortes, en vez de archivar un pago
//    por un monto inventado.
//
// 6. `type: 'Debt'` EXPLICITO. No es cosmetico: el motor de rendimiento
//    deducido (`liquidYieldCandidates` en hooks/useDashboardData.js) excluye
//    por `type === 'Debt'`, no por `isDebt`. Un item con `isDebt` y otro type
//    entraria a ese motor con un `balanceAsOf` sellado, que es justo la
//    combinacion que lo dispara.

import { cardKeyOf } from './parsers/guateCardStatements'

const SYMBOL = { GTQ: 'Q', USD: '$' }

const readable = (v) => typeof v === 'number' && Number.isFinite(v)

// La moneda de un item, con el mismo respaldo que usa el resto de la app.
const itemCurrency = (it) => it?.currency || 'USD'

/**
 * Planifica que hacer con el saldo de un estado ya parseado.
 *
 * @param {object} card salida de `parseCardStatement`
 * @param {Array} items items actuales del portafolio
 * @returns {{
 *   ok: boolean,
 *   reason: string|null,        // por que no hay nada que hacer
 *   cardKey: string|null,
 *   creates: Array<{currency: string, amount: number, item: object}>,
 *   updates: Array<{id: string, name: string, currency: string, prev: number, next: number, patch: object}>,
 *   stale: Array<{name: string, currency: string, asOf: string}>,  // saldo guardado mas nuevo que este corte
 * }}
 */
export function planCardDebtSync(card, items) {
  const empty = { ok: false, reason: null, cardKey: null, creates: [], updates: [], stale: [] }
  if (!card) return { ...empty, reason: 'no-statement' }

  const cardKey = cardKeyOf(card.bank, card.cardLast4)
  // Sin banco no hay identidad estable, y sin identidad el mes que viene se
  // duplica. Es preferible no ofrecerlo que ofrecer algo que se duplica solo.
  if (!cardKey) return { ...empty, reason: 'no-card-key' }

  const cb = card.closingBalance
  if (!cb || typeof cb !== 'object') return { ...empty, cardKey, reason: 'no-balance' }

  const cutDate = typeof card.cutDate === 'string' && card.cutDate ? card.cutDate : null
  if (!cutDate) return { ...empty, cardKey, reason: 'no-cut-date' }

  const label = card.bankLabel || card.bank
  const suffix = card.cardLast4 ? ` ·${card.cardLast4}` : ''

  const creates = []
  const updates = []
  const stale = []

  for (const currency of ['GTQ', 'USD']) {
    const raw = cb[currency]
    if (!readable(raw)) continue
    // La magnitud se guarda POSITIVA y `getItemValue` la niega al leer. Un
    // negativo lo rechaza `validateItem`, asi que un estado que cierra a favor
    // se guarda como cero: no debes nada, y no existe "deuda negativa".
    const amount = raw > 0 ? Math.round(raw * 100) / 100 : 0

    const existing = (items || []).find((it) => (
      it && it.isDebt && it.cardKey === cardKey && itemCurrency(it) === currency
    ))

    if (existing) {
      // Un estado mas viejo que el saldo guardado no lo pisa.
      const savedAsOf = typeof existing.balanceAsOf === 'string' ? existing.balanceAsOf : null
      if (savedAsOf && savedAsOf > cutDate) {
        stale.push({ name: existing.name || label, currency, asOf: savedAsOf })
        continue
      }
      const prev = Math.abs(Number(existing.currentPrice ?? existing.purchasePrice) || 0)
      if (Math.abs(prev - amount) < 0.005 && savedAsOf === cutDate) continue
      updates.push({
        id: existing.id,
        name: existing.name || label,
        currency,
        prev,
        next: amount,
        // Se escribe el saldo y su fecha. NUNCA la cantidad ni el tipo: si el
        // usuario le puso tasa, cuota o dia de pago a mano, eso es suyo.
        patch: { currentPrice: amount, purchasePrice: amount, balanceAsOf: cutDate },
      })
      continue
    }

    // Nada guardado y nada que deber: no se crea una deuda vacia.
    if (amount <= 0) continue

    creates.push({
      currency,
      amount,
      item: {
        type: 'Debt',
        subtype: 'credit_card',
        isDebt: true,
        name: `${label}${suffix}${currency === 'USD' ? ' (US$)' : ''}`,
        symbol: `${cardKey}:${currency}`.toUpperCase().replace(/[^A-Z0-9:]/g, ''),
        institution: label,
        currency,
        quantity: 1,
        purchasePrice: amount,
        currentPrice: amount,
        cardKey,
        // Desde que mes existe en la Hoja. Sin esto, la reconstruccion propaga
        // el saldo de HOY a meses ya cerrados diciendo que siempre se debio eso.
        acquisitionDate: cutDate,
        balanceAsOf: cutDate,
        // Deja rastro de que la escribio el importador, para que una superficie
        // futura pueda distinguirla de una deuda tecleada a mano.
        _source: 'card_statement',
      },
    })
  }

  const ok = creates.length > 0 || updates.length > 0
  return {
    ok,
    reason: ok ? null : (stale.length > 0 ? 'stale-statement' : 'nothing-to-do'),
    cardKey,
    creates,
    updates,
    stale,
  }
}

/** Texto corto de una linea del plan, para la vista previa. */
export function describeCardDebtLine(entry, kind) {
  const sym = SYMBOL[entry.currency] || ''
  const fmt = (v) => `${sym}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (kind === 'create') return `${entry.item.name}: ${fmt(entry.amount)}`
  return `${entry.name}: ${fmt(entry.prev)} → ${fmt(entry.next)}`
}
