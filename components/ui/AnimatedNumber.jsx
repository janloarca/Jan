'use client'

import { useEffect, useRef, useState } from 'react'
import { shouldAnimate, tweenDuration, tweenValue } from '@/lib/tween'

// Una cifra que se MUEVE de su valor viejo al nuevo en vez de saltar.
//
// Hasta ahora este repo no tenía ninguna infraestructura para esto: cero
// requestAnimationFrame fuera de una medición del tour, y ninguna librería de
// animación instalada. Cada número (el patrimonio, el YTD, un total) pasaba de
// A a B en un frame, que es lo que hace que la app se sienta correcta pero
// mecánica.
//
// Las reglas de cuándo animar y cuánto viven en lib/tween.js, con tests. Acá
// solo está el bucle.
//
// `format` recibe el número y devuelve lo que se pinta, así que el componente
// no sabe nada de monedas ni de idiomas: se le pasa el mismo formateador que ya
// usaba el caller. `value` tiene que ser el NÚMERO, no la cadena ya formateada.
export default function AnimatedNumber({ value, format = (v) => String(v), className = '', style, ...rest }) {
  const [shown, setShown] = useState(value)
  // El valor que de verdad se está mostrando, para poder arrancar el siguiente
  // tween desde donde quedó el anterior si se interrumpe a mitad. Sin esto, un
  // segundo cambio mientras el primero corre produce un salto.
  const shownRef = useRef(value)
  const rafRef = useRef(0)

  useEffect(() => {
    const from = shownRef.current
    const to = value

    const reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!shouldAnimate(from, to, { reducedMotion })) {
      shownRef.current = to
      setShown(to)
      return undefined
    }

    const duration = tweenDuration(from, to)
    const start = performance.now()
    const step = (now) => {
      const v = tweenValue(from, to, now - start, duration)
      shownRef.current = v
      setShown(v)
      if (now - start < duration) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value])

  return (
    // tabular-nums no es decoración acá: sin él cada dígito tiene ancho propio
    // y el número BAILA mientras se mueve, que es peor que el salto que este
    // componente vino a evitar.
    <span className={`tabular-nums ${className}`} style={style} {...rest}>
      {format(shown)}
    </span>
  )
}
