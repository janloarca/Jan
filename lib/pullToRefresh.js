// Las decisiones del gesto de "jalar para refrescar", fuera del DOM para poder
// probarlas de verdad. El hook que escucha los eventos táctiles
// (`components/ui/PullToRefresh.jsx`) queda como una cáscara delgada encima de
// esto, igual que `lib/loadStages.js` es el motor del anillo del header.
//
// Lo que se decide acá es lo único que puede romper la pantalla entera, así que
// vale la pena tenerlo aislado: si `shouldClaim` se equivoca, un listener a
// nivel de window empieza a llamar preventDefault sobre gestos que no son
// suyos y el scroll deja de funcionar.

// Cuánto hay que jalar (ya con resistencia aplicada) para que soltar dispare
// el refresco. 64px es cómodo con el pulgar sin dispararse por accidente al
// arrancar un scroll hacia abajo.
export const PULL_THRESHOLD_PX = 64
// Techo del indicador. Que sature en vez de seguir al dedo para siempre es lo
// que hace que el gesto se sienta elástico y no como arrastrar una hoja.
export const MAX_PULL_PX = Math.round(PULL_THRESHOLD_PX * 1.6)
// Cuánto sigue el indicador al dedo ANTES de armarse. 0.55 se siente
// controlado sin sentirse pegajoso, y pone el umbral a ~116px de recorrido:
// un tirón de pulgar natural.
const TRACKING = 0.55

// Distancia del dedo -> distancia del indicador, en dos tramos:
//
//  1. Hasta el umbral es LINEAL. Mientras el gesto todavía se puede cancelar,
//     el indicador tiene que seguir al dedo de forma predecible: es la única
//     forma de que se entienda cuánto falta para armarlo.
//  2. Pasado el umbral se amortigua hacia MAX_PULL_PX. Ahí ya no queda nada
//     que comunicar salvo "hasta acá llega", y la resistencia es justo lo que
//     dice eso sin palabras.
//
// La primera versión era asintótica DESDE CERO y resultó inusable: saturaba
// tan pronto que armar el gesto pedía ~429px de recorrido (medido en el
// navegador, no deducido). Por eso el test de abajo fija el recorrido real
// contra un pulgar, y no solo que la curva sea monótona.
export function resist(dy) {
  if (!(dy > 0)) return 0
  const linear = dy * TRACKING
  if (linear <= PULL_THRESHOLD_PX) return linear
  const over = linear - PULL_THRESHOLD_PX
  const room = MAX_PULL_PX - PULL_THRESHOLD_PX
  return PULL_THRESHOLD_PX + (room * over) / (room + over)
}

// 0..1 contra el umbral. Se clampea arriba: pasado el umbral el anillo ya está
// lleno y lo que cambia es el mensaje ("soltá"), no el arco.
export function pullProgress(px) {
  if (!(px > 0)) return 0
  return Math.min(1, px / PULL_THRESHOLD_PX)
}

export function isReady(px) {
  return px >= PULL_THRESHOLD_PX
}

// La regla que protege todo lo demás. Se evalúa UNA vez, en el primer
// movimiento real del toque, y su respuesta vale para todo ese toque:
//
//  - `atTop`: solo desde el borde superior. Jalar a mitad de página es scroll.
//  - `dy > 0`: solo hacia abajo. Hacia arriba es scroll normal.
//  - `|dy| > |dx|`: y sobre todo esto, que es lo que deja vivo el swipe
//    HORIZONTAL de los "mayores movimientos" (NetWorthCard) y el touchmove de
//    la gráfica. Sin esta comparación, un swipe lateral con dos píxeles de
//    deriva vertical quedaría secuestrado por el pull-to-refresh.
//
// `insideMain` lo resuelve el caller con un closest('#main-content'): en el
// tablero los modales se renderizan FUERA de <main>, así que ese único chequeo
// también descarta el header, la nav de abajo y los ~20 modales.
export function shouldClaim({ dx = 0, dy = 0, atTop = false, insideMain = true } = {}) {
  if (!atTop || !insideMain) return false
  if (!(dy > 0)) return false
  return Math.abs(dy) > Math.abs(dx)
}

// Antes de este mínimo no se decide nada: los primeros píxeles de cualquier
// toque son ruido y ahí `|dy| > |dx|` es una moneda al aire.
export const DIRECTION_LOCK_PX = 6
