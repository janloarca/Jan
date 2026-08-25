// El detalle que una pantalla de error tiene que dejar, en UN solo lugar.
//
// ⛔ POR QUÉ EXISTE, Y ES LA MISMA LECCIÓN QUE ESTE REPO YA TIENE ESCRITA TRES
// VECES. Hay TRES superficies de error y cada una decía algo distinto:
//
//   · app/dashboard/error.jsx   mensaje + digest + build + ruta + hora +
//                               navegador + botón de copiar   (FASE IB)
//   · components/RootErrorBoundary.jsx   NADA. Solo "Something went wrong".
//   · app/global-error.jsx      el mensaje, y nada más.
//
// Y la que MENOS dice es justamente la que atrapa lo que las otras no: el
// boundary raíz cubre todo lo que pasa fuera del segmento del tablero. El
// usuario mandó una captura de esa pantalla y no traía ni el mensaje ni el
// build, así que "lo rompió el merge de hoy" y "el teléfono sigue pegado al
// bundle anterior" se veían EXACTAMENTE IGUAL desde afuera. Esa ambigüedad ya
// costó un día entero y cuatro deploys en FASES HK/HM.
//
// El objetivo, literal: que una CAPTURA baste para diagnosticar. En un teléfono
// no hay consola, y quien reporta no es programador, así que lo que no esté en
// la pantalla no existe.

// El build que está CORRIENDO. `NEXT_BUILD_ID` se inlinea en el bundle al
// compilar, así que sirve incluso en global-error, donde el layout raíz (y con
// él `window.__CHISPU_BUILD`) no llega a montarse.
export function runningBuild() {
  const inlined = process.env.NEXT_BUILD_ID
  if (inlined) return inlined
  try {
    if (typeof window !== 'undefined' && window.__CHISPU_BUILD) return window.__CHISPU_BUILD
  } catch { /* sandbox sin acceso a window */ }
  return 'desconocido'
}

// Ruta, hora y navegador SOLO existen en el cliente. Quien llame a esto tiene
// que hacerlo después de montar (en un efecto, o desde componentDidCatch):
// calcularlo durante el render haría que el HTML del servidor y el del
// navegador no coincidan, y una pantalla de ERROR que a su vez provoca un error
// de hidratación es lo último que queremos (la trampa que FASE JT ya pagó).
export function clientErrorContext() {
  try {
    return {
      where: window.location.pathname + window.location.search,
      when: new Date().toISOString(),
      ua: navigator.userAgent,
    }
  } catch {
    return null
  }
}

// Cuántas líneas del árbol de componentes se guardan. En producción vienen
// minificadas, pero la FORMA del árbol igual dice en qué pantalla ocurrió, que
// es más de lo que decía antes; y un stack entero no cabe en una captura.
const STACK_LINES = 4

// Un frame en producción viene así:
//   at s (https://chispu.xyz/_next/static/chunks/app/dashboard/page-7c0f9cab.js:1:2314)
// El nombre está minificado a una letra, así que lo que de verdad informa es el
// CHUNK: dice si el error salió de la página, del layout o de una librería.
// Pero con el origen, el hash y el línea:columna, cuatro frames se comen ocho
// líneas visuales de un bloque que tiene que caber en UNA captura, que es
// justamente lo que este reporte existe para lograr. Se conserva la ruta lógica
// del chunk y se tira el resto.
function shortFrame(line) {
  const t = line.trim()
  const m = t.match(/^(.*?)\s*\((https?:\/\/[^)]*)\)$/)
  if (!m) return t
  const chunk = m[2].match(/\/_next\/static\/chunks\/(.+?)\.js/)
  if (!chunk) return m[1]
  return `${m[1]} (${chunk[1].replace(/-[0-9a-f]{8,}$/, '')})`
}

export function buildErrorReport(error, { context = null, componentStack = null, title = 'Chispudo' } = {}) {
  const msg = typeof error?.message === 'string' && error.message
    ? error.message
    : 'Error inesperado.'
  const stack = typeof componentStack === 'string' && componentStack.trim()
    ? componentStack.trim().split('\n').slice(0, STACK_LINES).map(shortFrame).join(' / ')
    : null

  return [
    title,
    `mensaje: ${msg}`,
    error?.digest ? `digest: ${error.digest}` : null,
    `build: ${runningBuild()}`,
    context?.where ? `pantalla: ${context.where}` : null,
    context?.when ? `cuando: ${context.when}` : null,
    stack ? `componente: ${stack}` : null,
    context?.ua ? `navegador: ${context.ua}` : null,
  ].filter(Boolean).join('\n')
}
