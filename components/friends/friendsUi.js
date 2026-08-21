import { AVATAR_PALETTE } from '@/lib/colors'

// Helpers compartidos por las tres piezas de la pantalla de Amigos
// (YourCard, GroupCard, GlobalBoard). Vivían sueltos arriba de
// app/friends/page.jsx, donde solo los podía usar ese archivo.

// Un color estable por persona, hasheado del uid (nunca aleatorio, para que la
// misma persona se vea igual entre recargas y entre dispositivos).
//
// Contra AVATAR_PALETTE y NO contra CHART_PALETTE, que es lo que usaba antes:
// aquella está validada para series de gráfica adyacentes, no para identidad de
// persona, y contiene el rojo de DEUDA (que hacía que una tarjeta entera se
// leyera como pérdida), tres pasos del mismo gris (dos a ΔE 9.21, o sea la
// misma persona vista dos veces) y un azul a ΔE 2.58 del que marca "tú".
// El razonamiento completo y los números están en lib/colors.js.
export function avatarColor(seed) {
  const s = String(seed || '?')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

// El azul de marca queda RESERVADO para tu propia tarjeta: es el ancla de la
// pantalla, no una serie más. avatarColor jamás puede devolverlo (hay un test
// que lo fija), así que "tú" nunca se confunde con un amigo.
export const YOU_COLOR = 'var(--accent-blue)'

// Tokens, no literales: antes eran los hex de tema OSCURO escritos a mano, así
// que en tema claro cada porcentaje de esta pantalla salía pastel sobre blanco
// mientras el resto de la app sí cambiaba.
export function pctColor(v) {
  if (v == null) return 'var(--text-secondary)'
  return v >= 0 ? 'var(--accent-green)' : 'var(--text-negative)'
}

export function fmtPct(v, decimals = 2) {
  if (v == null || !isFinite(v)) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
}

export function timeAgo(iso, lang) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (!isFinite(diff) || diff < 0) return ''
  const min = Math.floor(diff / 60000)
  if (min < 1) return lang === 'es' ? 'ahora' : 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export const MEDALS = ['🥇', '🥈', '🥉']

// La inicial que se dibuja dentro del círculo. Una sola definición: la página
// la calculaba para ti y cada fila la calculaba de nuevo para los demás, y las
// dos versiones ya diferían en el manejo de espacios.
export function initialOf(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?'
}

// ⛔ FASE KO. ¿La cifra del "día" de esta persona es de HOY?
//
// `day` y `movers` salen de `change1d`, que para una acción es la última sesión
// bursátil COMPLETADA: un sábado es el movimiento del viernes, y lo mismo un
// feriado o un martes antes de la apertura. Para cripto es una ventana rodante
// de 24 h, siempre viva. O sea DOS miembros del mismo grupo pueden tener
// frescuras distintas al mismo tiempo, y la pantalla decía "hoy" sobre las dos.
//
// Sin `dayAsOf` (una persona que publicó antes de que este campo existiera, o
// que solo tiene cripto) se asume fresco: es el comportamiento de siempre y no
// hay nada que afirmar de más.
export function dayLabel(dayAsOf, lang, todayStr) {
  const today = todayStr || new Date().toLocaleDateString('en-CA')
  const t = (es, en) => (lang === 'es' ? es : en)
  if (!dayAsOf || dayAsOf >= today) return { text: t('hoy', 'today'), stale: false, date: null }
  return { text: t('cierre', 'close'), stale: true, date: dayAsOf }
}

// Fecha corta para el rótulo de una sesión cerrada ("15 ago" / "Aug 15").
// Se lee del propio texto 'YYYY-MM-DD' y se fecha a MEDIODÍA UTC a propósito:
// `new Date('2026-08-15')` es medianoche UTC, y al oeste de UTC eso imprime el
// día anterior (la trampa que este repo ya documenta para las llaves de mes).
export function sessionDayLabel(dayAsOf, lang) {
  if (!dayAsOf) return ''
  const d = new Date(`${dayAsOf}T12:00:00Z`)
  if (isNaN(d)) return ''
  return d.toLocaleDateString(lang === 'es' ? 'es' : 'en', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
