// "¿Estos dos cobros son el mismo cobro?", respondido por la HORA.
//
// La regla que fija el usuario: dos cobros del mismo monto en fechas distintas
// son dos cobros y se suman; con la misma fecha Y la misma hora es un duplicado,
// y ahí no se pregunta, se fusiona.
//
// Lo que hace falta para poder aplicarla, y por qué esto es un módulo aparte:
//
//   1. La hora no siempre viene de la misma calidad. El atajo del iPhone y la
//      alerta del banco pueden REPORTAR el instante de la compra; cuando no lo
//      traen, lo único que hay es CUÁNDO LLEGÓ la captura, que se le parece
//      pero no es lo mismo. Los dos casos necesitan ventanas distintas y
//      confundirlos es cómo se borra un cobro real.
//   2. El estado de cuenta NUNCA trae hora, así que sobre él la pregunta no se
//      puede contestar y hay que decir 'unknown' en vez de inventar un veredicto.
//
// Se compara el INSTANTE absoluto, nunca la hora de pared. Guatemala es UTC-6,
// así que una compra a las 7pm local cae al día siguiente en UTC y las dos
// capturas del MISMO cobro pueden terminar con etiquetas de fecha distintas.
// Comparando instantes eso deja de importar: si están a segundos, es el mismo
// cobro por más que el rótulo del día no coincida.
//
// Módulo puro + tests.

// Dos instantes REPORTADOS del mismo cobro son el mismo instante; el margen
// existe solo para el redondeo al minuto que hacen los bancos en sus alertas.
// Más ancho que esto fusionaría dos compras reales seguidas.
export const EXACT_TOLERANCE_MS = 60 * 1000
// Con al menos un instante APROXIMADO (la hora de llegada), el margen tiene que
// absorber la demora de un correo reenviado. Cinco minutos: elegido por el
// usuario, y suficiente para un reenvío normal sin llegar a juntar dos rondas
// en el mismo bar.
export const APPROX_TOLERANCE_MS = 5 * 60 * 1000

// { ms, exact } o null cuando la fila no tiene hora utilizable.
// `exact` distingue el instante que la fuente REPORTÓ del que solo sabemos por
// cuándo llegó la captura.
export function chargeInstant(tx) {
  const raw = tx?.occurredAt
  if (!raw) return null
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw))
  if (!isFinite(ms)) return null
  // Sin hora en la cadena (un 'YYYY-MM-DD' pelado) esto es una fecha, no un
  // instante: tratarla como medianoche compararía etiquetas de día disfrazadas
  // de horas, que es justo lo que este módulo existe para no hacer.
  if (typeof raw === 'string' && !/\d{2}:\d{2}/.test(raw)) return null
  return { ms, exact: tx?.timeSource !== 'received' }
}

// 'same' | 'different' | 'unknown'
//
// 'unknown' NO es un empate técnico: es la respuesta correcta cuando al menos
// una de las dos filas no tiene hora (un estado de cuenta, algo tecleado a
// mano), y el caller tiene que seguir decidiendo con lo que sí tenga.
export function sameChargeByTime(a, b) {
  const ia = chargeInstant(a)
  const ib = chargeInstant(b)
  if (!ia || !ib) return 'unknown'
  const tolerance = ia.exact && ib.exact ? EXACT_TOLERANCE_MS : APPROX_TOLERANCE_MS
  return Math.abs(ia.ms - ib.ms) <= tolerance ? 'same' : 'different'
}

// Una alerta bancaria imprime la hora de PARED, sin zona ("Hora: 14:32"). El
// servidor corre en UTC y el usuario está en UTC-6, así que leerla como UTC la
// correría seis horas y el mismo cobro se leería como dos.
//
// La zona sale de la cabecera Date del PROPIO mensaje, que sí la trae escrita
// ("Mon, 3 Aug 2026 14:35:00 -0600"): el banco manda la alerta desde el mismo
// huso en que imprime la hora, así que ese desfase es el que hay que aplicar.
//
// Lo que NO se hace, y vale escrito porque parece razonable hasta que se mide:
// buscar el desfase que deja la hora impresa más cerca de la llegada. Con 105
// desfases posibles cubriendo 26 horas, SIEMPRE hay uno que cae cerca, así que
// esa búsqueda no distingue el desfase correcto de una coincidencia y devuelve
// un instante inventado con cara de preciso.
//
// Sin cabecera utilizable, null: el caller cae a la hora de llegada, que para
// una alerta en tiempo real está a minutos del cobro.

// Minutos de desfase de una cabecera Date, o null.
export function zoneOffsetFromDateHeader(line) {
  const s = String(line || '').trim()
  const numeric = s.match(/([+-])(\d{2})(\d{2})(?:\s*\(.*\))?$/)
  if (numeric) {
    const mins = Number(numeric[2]) * 60 + Number(numeric[3])
    if (Number(numeric[2]) > 14 || Number(numeric[3]) > 59) return null
    return numeric[1] === '-' ? -mins : mins
  }
  // Zonas obsoletas de RFC 5322 que siguen apareciendo. Solo las que valen 0:
  // adivinar las nombradas (EST, CST...) es justo el supuesto que este módulo
  // existe para no hacer.
  if (/\b(?:GMT|UTC|UT|Z)(?:\s*\(.*\))?$/i.test(s)) return 0
  return null
}

// Cuánto puede alejarse la hora impresa del momento en que llegó el mensaje
// antes de considerarla inconsistente con él. Un día cubre una alerta reenviada
// a mano al otro día; más allá, la hora impresa ya no describe este mensaje.
const MAX_LOCAL_DRIFT_MS = 24 * 60 * 60 * 1000

export function instantFromLocalTime({ date, time, offsetMinutes, near } = {}) {
  if (!date || !time || offsetMinutes == null || !isFinite(offsetMinutes)) return null
  const asUtc = Date.parse(`${date}T${time}Z`)
  if (!isFinite(asUtc)) return null
  const ms = asUtc - offsetMinutes * 60000

  const arrival = near instanceof Date ? near.getTime() : Date.parse(String(near || ''))
  if (isFinite(arrival) && Math.abs(ms - arrival) > MAX_LOCAL_DRIFT_MS) return null
  return new Date(ms).toISOString()
}

// Normaliza lo que una fuente diga sobre cuándo ocurrió el cobro.
//
//   reported  — la fuente dio la hora de la compra (el atajo, o la alerta del
//               banco que la trae escrita en el cuerpo).
//   received  — solo sabemos cuándo llegó la captura. Para el atajo es casi el
//               instante de la compra (dispara al momento); para el correo es
//               la cabecera Date del propio mensaje, NUNCA el momento del
//               barrido, que corre una vez al día y estaría hasta 24h tarde.
//
// Devuelve { occurredAt, timeSource } o null cuando no hay nada utilizable.
// Una hora ISO sin zona ("2026-08-19T07:17:00") NO es un instante: el estándar
// manda leerla como hora LOCAL DE QUIEN LA LEE, y quien la lee es una función
// serverless en UTC. Para una compra en Guatemala eso la corre seis horas.
//
// Y seis horas no es un detalle cosmético acá: `occurredAt` es lo que decide si
// dos capturas del mismo cobro son un cobro o dos (ventana de 60s / 5min). Con
// ese corrimiento, lo que capturó el atajo y lo que capturó el correo de la
// MISMA compra quedan a seis horas y se guardan como dos gastos.
//
// El atajo del iPhone arma su `occurredAt` con "Format Current Date → ISO 8601",
// y no está verificado si iOS le pone el offset o no. Este guard hace que dé lo
// mismo: con offset se usa tal cual, sin offset se descarta y manda la hora de
// LLEGADA, que el servidor sí conoce con certeza y que para el atajo es
// prácticamente el instante de la compra (dispara en la caja).
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i

export function resolveOccurredAt({ reported, received } = {}) {
  for (const [value, source] of [[reported, 'reported'], [received, 'received']]) {
    if (!value) continue
    const s = value instanceof Date ? value.toISOString() : String(value)
    // Una fecha sin hora no sirve para esto, y aceptarla como medianoche haría
    // que dos capturas del mismo día se leyeran como el mismo instante.
    if (!/\d{2}:\d{2}/.test(s)) continue
    // Sin zona no se puede saber a qué instante se refiere, así que se pasa a la
    // siguiente fuente en vez de inventar uno. Preferir una hora aproximada pero
    // REAL sobre una precisa y corrida.
    if (!HAS_ZONE.test(s.trim())) continue
    const ms = Date.parse(s)
    if (!isFinite(ms)) continue
    return { occurredAt: new Date(ms).toISOString(), timeSource: source }
  }
  return null
}
