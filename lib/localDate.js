import { parseImportDate } from './numberParse'

// El día de HOY tal como lo vive el usuario, 'YYYY-MM-DD'.
//
// ⛔ Esto NO reemplaza a UTC en todos lados, y confundir las dos cosas es un
// bug en cualquiera de las dos direcciones. La distinción:
//
//   · Un día CALENDARIO que el usuario vivió (¿cuándo compré esto?, ¿cuándo
//     gasté esto?, ¿esta fecha es futura?) es LOCAL. Nadie que gasta a las 7pm
//     del 31 de agosto considera que gastó en septiembre.
//
//   · Una FRONTERA DEL SISTEMA (a qué año pertenece un snapshot, si el backfill
//     de hoy ya corrió, el corte de un año calendario) es UTC, y este repo lo
//     tiene fijado con guardianes desde FASE KY/LF: "UTC es la correcta y no es
//     preferencia", porque esas fronteras las evalúa también el SERVIDOR y con
//     hora local el año de un usuario lo decidiría la zona del datacenter.
//
// El defecto que obligó a nombrarlo: los formularios pre-llenaban la fecha con
// `new Date().toISOString().split('T')[0]`, que es el día UTC. En Guatemala
// (UTC-6, sin horario de verano) eso ROTA A LAS 6 DE LA TARDE, así que cada
// noche la fecha sugerida era la de mañana. Medido: un gasto tecleado a las 7pm
// del 31 de agosto se pre-llenaba con `2026-09-01`.
//
// Y en Flujo eso no es un día de diferencia: la pantalla entera está organizada
// por MES, así que el gasto sale del mes en que ocurrió y engorda el siguiente,
// moviendo el total, el desglose por categoría y la tasa de ahorro de DOS meses
// a la vez. Un usuario que registra sus gastos de noche, que es cuando la gente
// los registra, lo pega el último día de cada mes.
//
// Se construye por COMPONENTES locales y no con `toISOString()` (que convierte a
// UTC por definición); `toLocaleDateString('en-CA')` da el mismo resultado pero
// depende de que el locale exista en el runtime.
export function todayLocalISO(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ---------------------------------------------------------------------------
// La misma pregunta, pero cuando quien la contesta es el SERVIDOR.
//
// `todayLocalISO` sirve en el navegador, donde el reloj YA es el del usuario.
// En el camino de captura automática no: quien decide el día es una función
// serverless en UTC, y el día de quien pagó tiene que salir del propio dato.
// ---------------------------------------------------------------------------

// Cota de cordura para un desfase, en minutos. La misma que ya aplica
// `zoneOffsetFromDateHeader` (lib/sameCharge.js): más allá de ±14h no existe
// ninguna zona, así que un valor mayor es basura y no un lugar del mundo.
const MAX_OFFSET_MINUTES = 14 * 60

function usableOffset(offsetMinutes) {
  if (offsetMinutes == null || !isFinite(offsetMinutes)) return null
  if (Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) return null
  return Number(offsetMinutes)
}

// Los minutos de desfase que una marca de tiempo declara sobre DÓNDE ESTABA
// quien la escribió, o null.
//
// ⛔ Un `Z` devuelve null, no cero, y la distinción es el corazón de todo esto.
// Técnicamente `Z` es desfase cero, pero la pregunta que hacemos no es "qué
// desfase usa esta cadena" sino "dónde estaba el pagador", y un instante Zulu es
// justamente el que ya perdió esa información. Contestar cero ahí sería afirmar
// que el usuario vive en Greenwich, que es exactamente el error que esta función
// existe para no cometer.
export function payerOffsetFromTimestamp(value) {
  const s = value instanceof Date ? '' : String(value || '').trim()
  if (!s || !/\d{2}:\d{2}/.test(s)) return null
  const m = s.match(/([+-])(\d{2}):?(\d{2})$/)
  if (!m) return null
  const mins = Number(m[2]) * 60 + Number(m[3])
  if (Number(m[2]) > 14 || Number(m[3]) > 59) return null
  return m[1] === '-' ? -mins : mins
}

// El DÍA de un cobro, 'YYYY-MM-DD', visto desde donde estaba quien pagó.
//
// El defecto que obliga a nombrarlo, y es la mitad de ESCRITURA de FASE OP: un
// instante Zulu NO dice de qué día es. `2026-09-01T02:05:00Z` son las ocho de la
// noche del 31 de agosto en Guatemala, así que tomar sus primeros diez
// caracteres archiva esa compra en SEPTIEMBRE. `parseImportDate` hace
// exactamente eso y para una FECHA es lo correcto: el problema nunca fue esa
// función, es pedirle a una fecha que conteste una pregunta de instante.
//
// ⛔ El desfase NO se adivina: viaja con el dato, y hasta hoy lo tirábamos. El
// correo lo trae escrito en su cabecera Date (`-0600`) y `lib/emailIngest.js` ya
// lo parsea para colocar la hora de pared; el atajo lo trae dentro de su propio
// `occurredAt` cuando se manda con el formato que la documentación pide
// (`yyyy-MM-dd'T'HH:mm:ssZ`, que en iOS es el desfase numérico y no una "Z"
// literal). Sin desfase conocido esto devuelve lo MISMO que antes, así que el
// cambio solo puede mejorar un caso, nunca empeorar uno que ya estaba bien.
//
// Las tres formas que no necesitan desfase, y por qué:
//   · una fecha pelada ('2026-08-31') ya ES un día que alguien decidió, y
//     desplazarla por una zona la correría sin ninguna razón;
//   · un instante con su zona escrita ('...T20:05:00-06:00') lleva su día local
//     en sus primeros diez caracteres, por definición;
//   · un instante sin zona ('...T20:05:00') es hora de pared, y su día también.
// El único que miente es el Zulu, y por eso es el único que se desplaza.
export function chargeDayISO(value, offsetMinutes) {
  if (value == null || value === '') return undefined
  const isInstant = value instanceof Date && !isNaN(value)
  const s = isInstant ? value.toISOString() : String(value).trim()
  // Todo lo que no sea un Zulu vuelve por el MISMO lector de siempre, nunca por
  // un `slice(0,10)` propio: `parseImportDate` también entiende un serial de
  // Excel y un `15/01/2024`, y una segunda copia recortada acá los perdería.
  const plain = () => parseImportDate(s)
  // Sin hora esto es una fecha, no un instante. Mismo guard que `chargeInstant`
  // (lib/sameCharge.js) y por la misma razón: tratarla como medianoche
  // compararía etiquetas de día disfrazadas de horas.
  if (!/\d{2}:\d{2}/.test(s)) return plain()
  if (!isInstant && !/Z$/i.test(s)) return plain()
  const offset = usableOffset(offsetMinutes)
  if (offset == null) return plain()
  const ms = Date.parse(s)
  if (!isFinite(ms)) return plain()
  return new Date(ms + offset * 60000).toISOString().slice(0, 10)
}
