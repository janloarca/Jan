// La aritmética de "un número que se mueve de A a B", pura y testeable.
//
// El componente que la usa (components/ui/AnimatedNumber.jsx) es cuatro líneas
// de requestAnimationFrame alrededor de esto. Está separado a propósito: lo que
// decide si una cifra de DINERO se anima o no es una regla de producto, y una
// regla de producto tiene que poder probarse sin montar React.
//
// ⛔ EL INVARIANTE, y es de dinero: mientras la animación corre, la pantalla
// muestra valores que NO son la verdad. Eso solo es aceptable si se cumplen
// tres cosas, y las tres están fijadas en tests:
//
//   1. SIEMPRE aterriza en el valor exacto. El último frame no interpola: se
//      asigna el objetivo tal cual. Un tween que termina en 27,291.9998 es
//      peor que no tener tween.
//   2. NUNCA anima lo que no es un cambio. Que un dato llegue por primera vez
//      (de nada a algo) no es que el patrimonio haya subido: es que la app
//      terminó de cargar. Contar desde cero ahí es una mentira animada, y
//      además convierte cada carga en un espectáculo de cajero automático.
//   3. Es CORTA. Medio segundo es el techo. Más que eso y el usuario está
//      esperando a que un número le diga cuánto tiene.

export const MAX_MS = 460
export const MIN_MS = 180

// ¿Este cambio merece animarse, o hay que saltar directo al valor nuevo?
//
// `from == null` es el primer render y la llegada del dato: se salta.
// Un salto de más de 4x tampoco se anima: no es que el número "creció", es que
// pasó a describir otra cosa (cambió la moneda base, se importó una cuenta
// entera, se cambió de portafolio). Interpolar entre dos cosas distintas
// produce cifras intermedias que nunca existieron.
export function shouldAnimate(from, to, { reducedMotion = false } = {}) {
  if (reducedMotion) return false
  if (from == null || to == null) return false
  if (!isFinite(from) || !isFinite(to)) return false
  if (from === to) return false
  if (from === 0) return false
  const ratio = Math.abs(to) / Math.abs(from)
  if (!isFinite(ratio) || ratio > 4 || ratio < 0.25) return false
  return true
}

// Cuánto dura, según qué tan grande es el cambio RELATIVO. Un tick de precio
// que mueve el patrimonio 0.1% no puede tardar lo mismo que un movimiento que
// lo mueve 30%: si todo dura igual, lo chico se siente lento y lo grande
// apurado.
export function tweenDuration(from, to) {
  if (!isFinite(from) || !isFinite(to) || from === 0) return MIN_MS
  const rel = Math.min(1, Math.abs(to - from) / Math.abs(from))
  return Math.round(MIN_MS + (MAX_MS - MIN_MS) * Math.sqrt(rel))
}

// La misma curva que `--ease-out` en globals.css, para que un número que se
// mueve y una barra que crece al lado lleguen juntos. Dos curvas distintas en
// la misma card se notan aunque nadie sepa decir por qué.
export function easeOut(t) {
  const c = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - c, 3)
}

// El valor a mostrar en el instante `elapsed`. En `elapsed >= duration`
// devuelve `to` EXACTO (invariante 1), sin pasar por la curva.
export function tweenValue(from, to, elapsed, duration) {
  if (!(duration > 0) || elapsed >= duration) return to
  if (elapsed <= 0) return from
  return from + (to - from) * easeOut(elapsed / duration)
}
