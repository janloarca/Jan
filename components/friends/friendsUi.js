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
