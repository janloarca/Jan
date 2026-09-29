// ⛔ La ventana de la sesión regular de NYSE (9:30am–4:00pm hora del Este,
// DST resuelto vía Intl, nunca un offset UTC fijo que se rompería dos veces
// al año). Usada para acotar la vista "DAY" del gráfico de patrimonio a lo
// que de verdad es "hoy" para el mercado de EE.UU., sin importar en qué huso
// esté el navegador que la mira.
//
// SIN calendario de feriados, a propósito: un feriado de NYSE en día hábil
// (4 de julio, Acción de Gracias...) sigue resolviendo a la ventana de ESE
// día de la semana, sin datos de mercado adentro — la misma limitación que
// FASE KT ya aceptó para el devengo diario, por la misma razón (no hay una
// fuente de feriados que mantener sin que se desactualice sola).

const NY_TZ = 'America/New_York'
const MARKET_OPEN = { hour: 9, minute: 30 }
const MARKET_CLOSE = { hour: 16, minute: 0 }

// hourCycle:'h23' y no hour12:false a propósito: hay versiones de ICU donde
// hour12:false da "24" para medianoche en vez de "00" (la misma trampa que
// ya documenta lib/ibkrSchedule.js).
const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function nyParts(ts) {
  const parts = nyFormatter.formatToParts(ts)
  const get = (type) => Number((parts.find((p) => p.type === type) || {}).value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

// El día calendario (año/mes/día) que un instante representa en hora del
// Este, sin importar la zona del navegador que lo mira.
export function nyDateParts(ts = Date.now()) {
  const { year, month, day } = nyParts(ts)
  return { year, month, day }
}

// 0 = domingo ... 6 = sábado. Se calcula sobre el DÍA, nunca sobre un
// instante con hora, para que nunca dependa de si ese instante cruzó
// medianoche en alguna zona.
function weekdayOf({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

// El instante UTC que corresponde a una hora de PARED en Nueva York
// (año/mes/día/hora/minuto tal como los leería un reloj ahí).
//
// Truco de "adivinar y corregir": se trata la hora de pared como si YA
// fuera UTC (adivinanza), se lee qué hora de Nueva York representa ESE
// instante adivinado, y se corrige la adivinanza por la diferencia entre
// lo pedido y lo leído. Converge en un solo paso porque el offset de NY
// (-4h verano, -5h invierno) no cambia dentro del rango chico que estamos
// resolviendo (la hora de pared que pedimos y la que se lee de vuelta caen
// del mismo lado de cualquier transición de horario de verano).
function nyWallClockToUtc(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const readBack = nyParts(guess)
  const asUtcIfNy = Date.UTC(
    readBack.year, readBack.month - 1, readBack.day,
    readBack.hour, readBack.minute, readBack.second,
  )
  return guess + (guess - asUtcIfNy)
}

function sessionBoundsFor({ year, month, day }) {
  return {
    open: nyWallClockToUtc(year, month, day, MARKET_OPEN.hour, MARKET_OPEN.minute),
    close: nyWallClockToUtc(year, month, day, MARKET_CLOSE.hour, MARKET_CLOSE.minute),
  }
}

// Apertura y cierre (timestamps UTC) de la sesión de NYSE del día calendario
// (en NY) que contiene `ts`. No mira si es fin de semana: para eso está
// `currentOrLastSession`.
export function nySessionBounds(ts = Date.now()) {
  return sessionBoundsFor(nyDateParts(ts))
}

// Un día calendario antes, por aritmética de FECHA (Date.UTC + setUTCDate),
// nunca restando milisegundos reales de un instante. Un día de Nueva York
// puede durar 23 o 25 horas las dos noches de transición de horario de
// verano por año; restar 86400000ms a un instante cercano a medianoche NY
// ahí puede aterrizar en el día calendario equivocado. Esto no toca ninguna
// hora de pared hasta el paso final de `nyWallClockToUtc`, así que el caso
// no existe.
function prevCalendarDay({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() - 1)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function walkBackToWeekday(parts) {
  let p = parts
  while (weekdayOf(p) === 0 || weekdayOf(p) === 6) p = prevCalendarDay(p)
  return p
}

// La sesión de NYSE "de hoy", o la más reciente ya COMPLETADA si hoy no
// hubo (fin de semana) o todavía no abrió. Nunca vacío: siempre hay una
// sesión hábil hacia atrás.
//
//   · en sesión (día hábil, entre open y close): la sesión de hoy.
//   · después del cierre de un día hábil: la sesión de hoy (completa).
//   · antes de que abra un día hábil: la sesión hábil anterior.
//   · fin de semana: la del viernes (o el hábil anterior más cercano).
export function currentOrLastSession(ts = Date.now()) {
  let parts = walkBackToWeekday(nyDateParts(ts))
  let { open, close } = sessionBoundsFor(parts)
  if (ts < open) {
    parts = walkBackToWeekday(prevCalendarDay(parts))
    ;({ open, close } = sessionBoundsFor(parts))
  }
  return { open, close }
}
