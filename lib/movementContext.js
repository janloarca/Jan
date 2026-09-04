// ¿Para qué salió (o de dónde entró) este dinero?
//
// ⛔ POR QUÉ ESTO EXISTE (FASE NF). Cuando alguien dice "saqué dinero" desde una
// celda de la Hoja, la app archiva un WITHDRAWAL y ahí se acaba la historia: el
// saldo baja y nada explica a dónde fue. Casi siempre el usuario ACABA de
// registrar la otra mitad — pagó una deuda, movió dinero a otra cuenta — y la
// app tiene esa mitad en el archivo sin usarla.
//
// ⛔ LA REGLA QUE LO HACE HONESTO: esto DESCRIBE, no afirma causalidad y NO
// escribe nada. Los montos de las dos mitades casi nunca coinciden (el caso
// real: se sacaron Q392.25 de una cuenta para cubrir UNA PARTE de un pago de
// $390, el resto lo puso otra persona), así que emparejar por monto sería
// inventar una equivalencia que no existe. Lo único que se afirma es un HECHO
// que el archivo ya contiene: "ese mismo día también bajó tu Deuda AIXEN en
// $390". Quien lee saca la conclusión, que es exactamente lo que pidió el
// usuario ("si ves movimientos en el mismo lapso de tiempo es una conexión").
//
// Y por eso NO se escribe ningún vínculo en los datos: un `_debtItemId` puesto
// por deducción cambia cómo se rebobina el pasado de DOS ítems, y con montos
// que no cuadran no hay evidencia que lo sostenga. Un enlace equivocado no se
// ve; una frase equivocada sí.

// El "mismo lapso". Un pago y el retiro que lo financia caen el mismo día o a
// un par de días (el banco postea al día siguiente). Más ancho que esto empieza
// a emparejar cosas que solo comparten la semana.
const WINDOW_DAYS = 3

// Fechas 'YYYY-MM-DD': Date.parse las lee como medianoche UTC, así que la
// DIFERENCIA entre dos es exacta y no la puede corromper ninguna zona horaria.
const dayTs = (d) => {
  if (typeof d !== 'string') return null
  const ts = Date.parse(d.slice(0, 10))
  return Number.isFinite(ts) ? ts : null
}
const daysApart = (a, b) => {
  const ta = dayTs(a); const tb = dayTs(b)
  if (ta == null || tb == null) return null
  return Math.abs(ta - tb) / 86400000
}

const labelOf = (it) => it?.name || it?.symbol || ''

/**
 * Qué más se movió alrededor de este movimiento.
 *
 * @param {object}   o.item          el ítem cuya celda se editó
 * @param {string}   o.date          'YYYY-MM-DD' del movimiento registrado
 * @param {string}   o.kind          'WITHDRAWAL' | 'DEPOSIT' | 'DEBT_PAYMENT'
 * @param {Array}    o.items         portafolio (para resolver nombres y isDebt)
 * @param {Array}    o.transactions  historial COMPLETO
 * @returns {{kind:'debt'|'account', label:string, amount:number, currency:string,
 *            sameDay:boolean} | null}  null = no se ve nada cerca
 */
export function explainMovement({ item, date, kind, items, transactions } = {}) {
  if (!date || !kind) return null
  const list = Array.isArray(transactions) ? transactions : []
  const byId = new Map((Array.isArray(items) ? items : []).map((it) => [it?.id, it]))

  // Un candidato es un movimiento de OTRO ítem dentro de la ventana. El propio
  // nunca cuenta: la fila recién escrita todavía no llegó por el listener, pero
  // excluirlo explícitamente es lo que impide que una edición anterior del
  // MISMO ítem se ofrezca como si explicara esta.
  const near = []
  for (const tx of list) {
    if (!tx) continue
    const d = daysApart(tx.date, date)
    if (d == null || d > WINDOW_DAYS) continue
    const amount = Math.abs(Number(tx.totalAmount) || 0)
    if (!(amount > 0)) continue
    const type = String(tx.type || '').toUpperCase()
    const currency = tx.currency || 'USD'

    // Un pago de deuda viaja con el id del préstamo en campo PROPIO
    // (`_debtItemId`, FASE KW/KZ3), nunca en `_linkedItemId`. Solo explica a un
    // RETIRO: pagar un préstamo no explica haber pagado otro.
    if (tx._debtItemId) {
      if (kind !== 'WITHDRAWAL' || tx._debtItemId === item?.id) continue
      near.push({ kind: 'debt', label: labelOf(byId.get(tx._debtItemId)), amount, currency, days: d, ts: dayTs(tx.date) })
      continue
    }
    if (tx._linkedItemId && tx._linkedItemId !== item?.id) {
      const other = byId.get(tx._linkedItemId)
      if (!other || other.isDebt) continue
      // La DIRECCIÓN es lo que hace que el vecino explique algo. Un retiro se
      // explica con dinero ENTRANDO a otro lado; un aporte y un pago de deuda
      // preguntan lo mismo ("¿de dónde salió?") y se explican con un retiro.
      // Dos retiros el mismo día no se explican entre sí: los dos sacaron.
      const quiero = (kind === 'DEPOSIT' || kind === 'DEBT_PAYMENT') ? 'WITHDRAWAL' : 'DEPOSIT'
      if (type !== quiero) continue
      near.push({ kind: 'account', label: labelOf(other), amount, currency, days: d, ts: dayTs(tx.date) })
    }
  }
  if (near.length === 0) return null

  // Un pago de deuda le gana a una transferencia: es la explicación más
  // específica de las dos. Después, el más cercano en fecha; el monto mayor
  // desempata, y el ts deja el orden ESTABLE (dos corridas sobre los mismos
  // datos dicen siempre lo mismo).
  near.sort((a, b) => (
    (a.kind === b.kind ? 0 : a.kind === 'debt' ? -1 : 1)
    || a.days - b.days
    || b.amount - a.amount
    || (a.ts || 0) - (b.ts || 0)
  ))
  const best = near[0]
  return { kind: best.kind, label: best.label, amount: best.amount, currency: best.currency, sameDay: best.days === 0 }
}

/**
 * La frase. Separada del hallazgo para que el motor no sepa de idiomas y para
 * poder fijar por test QUÉ se afirma.
 *
 * Sin hallazgo NO se calla: decir "no se ve otro movimiento cerca" es la mitad
 * de la deducción que pidió el usuario ("si no hay ningún movimiento adicional
 * probablemente se gastó"), y es información, no relleno.
 */
export function movementNote(found, { kind, lang = 'es', fmt } = {}) {
  const money = (a, c) => (typeof fmt === 'function' ? fmt(a, c) : `${c} ${Number(a).toFixed(2)}`)
  const es = lang !== 'en'
  if (!found) {
    if (kind === 'DEPOSIT') {
      return es ? 'No se ve de dónde vino: quedó registrado como aporte.'
        : 'No matching movement nearby: recorded as a contribution.'
    }
    if (kind === 'DEBT_PAYMENT') {
      return es ? 'No se ve de qué cuenta salió. Si salió de una tuya, registralo desde Movimiento.'
        : 'No source account nearby. If it came from one of yours, record it from Movimiento.'
    }
    return es ? 'No se ve otro movimiento cerca, así que cuenta como gasto.'
      : 'No other movement nearby, so it counts as spending.'
  }
  const cuando = found.sameDay
    ? (es ? 'Ese mismo día' : 'That same day')
    : (es ? 'Por esas fechas' : 'Around that date')
  const monto = money(found.amount, found.currency)
  if (found.kind === 'debt') {
    return es
      ? `${cuando} pagaste ${monto} de ${found.label}: probablemente fue para eso.`
      : `${cuando} you paid ${monto} of ${found.label}: it was probably for that.`
  }
  return kind === 'DEPOSIT'
    ? (es ? `${cuando} salieron ${monto} de ${found.label}: probablemente vino de ahí.`
          : `${cuando} ${monto} left ${found.label}: it probably came from there.`)
    : (es ? `${cuando} entraron ${monto} a ${found.label}: probablemente fue para eso.`
          : `${cuando} ${monto} went into ${found.label}: it was probably for that.`)
}
