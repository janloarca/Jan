// ⛔ CUÁNDO sincronizar con IBKR. Una sola decisión, con su razón.
//
// Antes esto vivía repartido en el efecto de `useDashboardData`: tres
// constantes de tiempo, un contador de fallos y una lista de códigos fatales,
// evaluados inline. Con eso, cuando el sync NO corría, no había forma de saber
// cuál de las compuertas lo había parado, ni para el usuario ni para quien
// depura. Es la lección de FASE HP aplicada antes de pagarla otra vez: la
// decisión devuelve `reason` y esa razón se imprime.
//
// LAS REGLAS, y de dónde salen:
//
// 1. UN sync exitoso por día. IBKR dice, textual, que los datos de un Flex de
//    Activity Statement "se actualizan una sola vez al día, al cierre de
//    operaciones, así que no hay beneficio en generar y bajar esos reportes más
//    de una vez al día". Sincronizar cada 30 minutos no traía nada nuevo y
//    costaba ~48 solicitudes diarias contra un servicio que espera 1.
//
// 2. NUNCA dentro de la ventana de reset (ver `inIbkrResetWindow`). Ahí IBKR
//    reinicia sus servidores y la autenticación se interrumpe, o sea es el
//    horario donde una petición es MÁS probable que falle. Con la cadencia de
//    30 minutos le pegábamos dos veces cada noche, todas las noches.
//
// 3. Un PRESUPUESTO de intentos por día, contado en la unidad correcta. IBKR no
//    bloquea por volumen sino por intentos FALLIDOS ("Too many failed
//    attempts"), así que el techo tiene que estar escrito en fallos, no ser el
//    efecto secundario de dos constantes de tiempo. Un token muerto pasa de 48
//    intentos fallidos por día a 3.
//
// 4. Lo fatal y el bloqueo trabado siguen mandando y son más estrictos: ver
//    lib/ibkrRetryPolicy.js.
//
// El sync MANUAL (el pill del header, el botón del modal) no pasa por acá a
// propósito: es una acción que el usuario acaba de tomar y siempre debe correr.
// Esto gobierna solo el automático.

import { ibkrSyncIntervalMs, ibkrLockIsStuck } from './ibkrRetryPolicy'

// Códigos que necesitan que el usuario cambie algo (token nuevo, query
// arreglada): reintentar no puede funcionar, así que el automático se detiene.
export const FATAL_ERROR_CODES = ['TOKEN_EXPIRED', 'INVALID_QUERY']

// Tres y no uno: un fallo aislado por un mal rato de IBKR tiene que poder
// reintentarse el mismo día, o un tropiezo transitorio dejaría los datos sin
// actualizar hasta mañana. Tres y no diez: cada fallo es la moneda con la que
// se compra el bloqueo.
export const MAX_ATTEMPTS_PER_DAY = 3

const ET = 'America/New_York'

// Partes de la fecha en hora del Este, que es el huso en el que IBKR define su
// día de operaciones y su ventana de mantenimiento. Intl resuelve el horario de
// verano solo, así que no hay ningún offset escrito a mano que se rompa dos
// veces al año. `hourCycle: 'h23'` y no `hour12: false`: el segundo devuelve
// "24" para la medianoche en varias versiones de ICU.
function etParts(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hourCycle: 'h23',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(now)
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || ''
  return {
    weekday: get('weekday'),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

// La fecha calendario EN HORA DEL ESTE. El "día" de un statement es el de IBKR,
// no el del navegador: alguien en Guatemala a las 23:00 ya está en el día
// siguiente para ellos, y su statement del día que cerró es el que corresponde.
export function ibkrDayKey(now = new Date()) {
  return etParts(now).date
}

// Reset diario de IBKR: 23:45 a 00:45 ET de sábado a jueves, y 23:45 a 00:30 ET
// los viernes (o sea la ventana que ARRANCA un viernes por la noche termina más
// temprano). No se le suma ningún margen inventado: son las horas publicadas.
export function inIbkrResetWindow(now = new Date()) {
  const { weekday, hour, minute } = etParts(now)
  // Lado de entrada: arranca todas las noches a las 23:45.
  if (hour === 23 && minute >= 45) return true
  // Lado de salida: la ventana que estamos terminando arrancó AYER, así que un
  // sábado a las 00:xx corresponde a la ventana del viernes, la corta.
  if (hour === 0) {
    const endMinute = weekday === 'Sat' ? 30 : 45
    return minute < endMinute
  }
  return false
}

// `attempts` es lo guardado en settings: { date, count }. Un día distinto al de
// hoy vale cero, así el contador se reinicia solo sin ningún trabajo de
// limpieza.
export function attemptsOn(attempts, dayKey) {
  if (!attempts || attempts.date !== dayKey) return 0
  const n = Number(attempts.count)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function bumpAttempts(attempts, dayKey) {
  return { date: dayKey, count: attemptsOn(attempts, dayKey) + 1 }
}

/**
 * ¿Corre el auto-sync ahora?
 *
 * Devuelve { sync: true } o { sync: false, reason }. La razón es parte del
 * contrato, no un extra: es lo que hace que "no sincronizó" sea diagnosticable
 * desde una captura en vez de deducible.
 */
export function ibkrSyncDecision({
  now = new Date(),
  lastSuccess = null,
  lastAttempt = null,
  attempts = null,
  errorCode = null,
  failCount = 0,
} = {}) {
  // Absolutos primero: no dependen del reloj ni del presupuesto.
  if (FATAL_ERROR_CODES.includes(errorCode)) return { sync: false, reason: 'fatal' }
  if (ibkrLockIsStuck({ errorCode, failCount })) return { sync: false, reason: 'lock-stuck' }

  // Antes que cualquier cosa de cadencia: en esta ventana la petición es más
  // probable que falle, y un fallo cuesta presupuesto.
  if (inIbkrResetWindow(now)) return { sync: false, reason: 'reset-window' }

  const nowTs = now.getTime()
  const dayKey = ibkrDayKey(now)

  // Ya tenemos el dato de hoy. Vale tanto un sync automático como uno manual:
  // si el usuario acaba de sincronizar a mano, el automático no puede aportar
  // nada distinto.
  const successTs = toTs(lastSuccess)
  if (successTs && ibkrDayKey(new Date(successTs)) === dayKey) {
    return { sync: false, reason: 'synced-today' }
  }

  if (attemptsOn(attempts, dayKey) >= MAX_ATTEMPTS_PER_DAY) {
    return { sync: false, reason: 'budget-spent' }
  }

  // Espaciado mínimo entre intentos del MISMO día: 30 minutos normalmente, 12
  // horas si viene fallando (ibkrRetryPolicy). Se mide contra el último
  // INTENTO, nunca contra el último éxito: si no, cada recarga de página en
  // estado de error disparaba otro intento fallido.
  const interval = ibkrSyncIntervalMs({ errorCode, failCount })
  const lastTs = Math.max(successTs || 0, toTs(lastAttempt) || 0)
  if (lastTs && nowTs - lastTs < interval) return { sync: false, reason: 'too-soon' }

  return { sync: true }
}

function toTs(v) {
  if (!v) return 0
  const ts = new Date(v).getTime()
  return Number.isFinite(ts) ? ts : 0
}

// Texto humano para cada razón. Vive acá y no en el componente para que la
// decisión y su explicación no puedan divergir.
export function syncSkipReasonText(reason, lang = 'es') {
  const es = lang !== 'en'
  switch (reason) {
    case 'fatal':
      return es ? 'Detenido: hay que arreglar las credenciales.' : 'Stopped: credentials need fixing.'
    case 'lock-stuck':
      return es ? 'Detenido: IBKR lleva días sin levantar el bloqueo.' : 'Stopped: IBKR has not lifted the block for days.'
    case 'reset-window':
      return es ? 'En pausa: IBKR está en su ventana de mantenimiento diaria.' : 'Paused: IBKR is in its daily maintenance window.'
    case 'synced-today':
      return es ? 'Ya sincronizado hoy: IBKR actualiza estos datos una vez al día.' : 'Already synced today: IBKR updates this data once a day.'
    case 'budget-spent':
      return es ? 'Sin intentos por hoy: se reanuda mañana.' : 'No attempts left today: resumes tomorrow.'
    case 'too-soon':
      return es ? 'Esperando antes del próximo intento.' : 'Waiting before the next attempt.'
    default:
      return null
  }
}
