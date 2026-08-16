'use client'

// Jalar hacia abajo para refrescar, con la marca de Chispudo. Solo en el
// tablero, y solo por toque.
//
// TODO lo que dibuja sale de piezas que ya existen: la geometría del anillo de
// `lib/brandRing.js`, el rayo de `lib/brandBolt.js`, el keyframe `chispuSweep`
// de globals.css y las bandas de color de ChispudoRefreshButton. No define
// ningún color, radio ni animación propios: si el anillo del header cambia,
// este cambia con él.
//
// ES UN OVERLAY FLOTANTE, no un envoltorio. No desplaza el contenido ni lo
// envuelve en un contenedor nuevo, porque el header es `sticky top-0` y moverlo
// todo pelearía con eso; además así no toca el layout de ninguna card.
//
// Sobre el progreso: mientras el dedo está abajo, el arco es DETERMINADO y
// refleja la distancia real del tirón, así que no viola la regla que gobierna
// al anillo del header ("nunca inventar un porcentaje"): acá el porcentaje ES
// el dedo. Cuando el refresco arranca, pasa a mostrar las MISMAS etapas reales
// que ese anillo, para que los dos no puedan contar historias distintas.
//
// Por qué el gesto reemplaza al de Safari: la app no es PWA, así que hoy jalar
// desde arriba recarga la página. Es el mismo movimiento, no hay forma de
// tener los dos. Se acepta SOLO en el tablero (ver el bullet de la fase en
// CLAUDE.md); en el resto de las pantallas la recarga nativa sigue viva, y
// `UpdateAvailablePill` sigue avisando de un build nuevo en todas.

import { useEffect, useRef, useState, useCallback } from 'react'
import { Check } from 'lucide-react'
import { BOLT_PATH, BOLT_VIEWBOX, boltStrokeWidth } from '@/lib/brandBolt'
import { RING_VIEWBOX, RING_CX, RING_CY, RING_R, sweepDash, progressDashOffset } from '@/lib/brandRing'
import { progressColor } from '@/components/ui/ChispudoRefreshButton'
import {
  resist, pullProgress, isReady, shouldClaim,
  PULL_THRESHOLD_PX, MAX_PULL_PX, DIRECTION_LOCK_PX,
} from '@/lib/pullToRefresh'

// Cuántos PullToRefresh hay vivos. Con DOS sitios de montaje (tablero y
// Finanzas) aparece un caso que con uno solo no existía: en una navegación
// entre esas dos pantallas, si React monta el nuevo antes de limpiar el viejo,
// el removeAttribute del que se va corre DESPUÉS del setAttribute del que llega
// y `data-ptr` queda quitado CON un gesto vivo, o sea vuelve el pull-to-refresh
// nativo de Safari y los dos pelean. El primero en montar pone el atributo, el
// último en desmontar lo quita, y así el orden de commit de React deja de
// importar.
let mountedCount = 0

// El ancestro scrolleable más cercano entre `el` y `boundary`, si es que puede
// scrollear HACIA ARRIBA. Vive acá y no en lib/pullToRefresh.js porque es puro
// recorrido de DOM; la decisión que sale de esto sí es pura y está en
// `shouldClaim`.
function blockedByInnerScroller(el, boundary) {
  let n = el
  while (n && n !== boundary && n !== document.body && n.nodeType === 1) {
    if (n.scrollHeight > n.clientHeight + 1) {
      const oy = getComputedStyle(n).overflowY
      if (oy === 'auto' || oy === 'scroll') {
        // Con scrollTop > 0 todavía le queda recorrido hacia arriba, así que el
        // tirón es suyo. En su propio tope, pasa de largo hacia el gesto.
        return n.scrollTop > 0
      }
    }
    n = n.parentElement
  }
  return false
}

const SIZE = 34
const BOLT = Math.round(SIZE * 0.46)
// Cuánto se queda el check verde antes de recogerse. Mismo criterio (y mismo
// orden de magnitud) que el "success" de ChispudoRefreshButton: suficiente
// para leerse como un final, no tanto como para estorbar.
const DONE_HOLD_MS = 700

function label(phase, lang) {
  const t = (es, en) => (lang === 'es' ? es : en)
  if (phase === 'ready') return t('Soltá para actualizar', 'Release to refresh')
  if (phase === 'refreshing') return t('Actualizando datos', 'Updating data')
  if (phase === 'done') return t('Actualizado', 'Updated')
  return t('Jalá para actualizar', 'Pull to refresh')
}

export default function PullToRefresh({
  onRefresh,
  loading = false,
  error = false,
  stagesDone = 0,
  stagesTotal = 0,
  lang = 'es',
  // El contenedor cuyo borde superior arma el gesto. Los modales del tablero se
  // renderizan FUERA de <main>, así que este único filtro también descarta el
  // header, la nav de abajo y todos los modales, sin tener que enumerarlos.
  scopeSelector = '#main-content',
}) {
  const [pull, setPull] = useState(0)
  // 'idle' | 'pulling' | 'refreshing' | 'done'
  const [phase, setPhase] = useState('idle')

  // Todo el estado del gesto vive en un ref: cambia en cada touchmove y no
  // debe provocar renders por sí mismo (el único que sí pinta es `pull`).
  const g = useRef({ active: false, claimed: false, released: false, x0: 0, y0: 0 })
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // Marca <html> mientras este componente está montado, para que la regla de
  // globals.css que apaga el pull-to-refresh NATIVO aplique SOLO acá. Mismo
  // patrón que `data-journey` en IBKRJourneyBar.
  useEffect(() => {
    const root = document.documentElement
    mountedCount += 1
    root.setAttribute('data-ptr', 'on')
    return () => {
      mountedCount -= 1
      if (mountedCount <= 0) {
        mountedCount = 0
        root.removeAttribute('data-ptr')
      }
    }
  }, [])

  const finish = useCallback(() => {
    g.current.active = false
    g.current.claimed = false
    g.current.released = false
  }, [])

  useEffect(() => {
    const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0

    const onStart = (e) => {
      // Multitáctil (pellizcar para hacer zoom) no es un tirón.
      if (e.touches.length !== 1) { finish(); return }
      if (phaseRef.current === 'refreshing' || phaseRef.current === 'done') return
      const tch = e.touches[0]
      const scope = tch.target?.closest?.(scopeSelector) || null
      g.current = {
        active: true,
        claimed: false,
        // `released` = "ya decidí que este toque NO es mío". Una vez puesto no
        // se vuelve a evaluar, así que un scroll largo no puede convertirse en
        // tirón a mitad de camino.
        released: false,
        x0: tch.clientX,
        y0: tch.clientY,
        insideMain: !!scope,
        // Se resuelve en el touchstart, que es el único momento con un `target`
        // y con el scroller todavía en su posición inicial.
        blockedByScroller: scope ? blockedByInnerScroller(tch.target, scope) : false,
      }
    }

    const onMove = (e) => {
      const s = g.current
      if (!s.active || s.released) return
      if (e.touches.length !== 1) { finish(); setPull(0); return }
      const tch = e.touches[0]
      const dx = tch.clientX - s.x0
      const dy = tch.clientY - s.y0

      if (!s.claimed) {
        // Antes del mínimo no se decide nada: a 1-2px la dirección es ruido.
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return
        if (!shouldClaim({ dx, dy, atTop: atTop(), insideMain: s.insideMain, blockedByScroller: s.blockedByScroller })) {
          s.released = true
          return
        }
        s.claimed = true
        setPhase('pulling')
      }

      // Solo a partir de acá se bloquea el scroll nativo, y solo para este
      // toque. El listener es no pasivo justo para poder hacer esto: React
      // registra touchmove como PASIVO, así que un onTouchMove de JSX no
      // podría (y avisaría en consola).
      if (e.cancelable) e.preventDefault()
      setPull(resist(dy))
    }

    const onEnd = () => {
      const s = g.current
      if (!s.active || !s.claimed) { finish(); return }
      const px = pull
      finish()
      if (isReady(px)) {
        setPhase('refreshing')
        setPull(PULL_THRESHOLD_PX)
        onRefresh?.()
      } else {
        setPhase('idle')
        setPull(0)
      }
    }

    // `passive: false` en touchmove es el requisito de todo esto (ver arriba).
    // touchstart puede ser pasivo: ahí nunca llamamos preventDefault.
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [pull, onRefresh, finish, scopeSelector])

  // El cierre depende de `loading` del padre, no de un temporizador: el
  // indicador no puede decir "listo" antes que los datos. El caso de un
  // refresco que resuelve ANTES de que `loading` alcance a prenderse queda
  // cubierto porque la fase igual sale de 'refreshing' en cuanto loading es
  // false y ya pasó un tick.
  const wasLoading = useRef(false)
  useEffect(() => {
    if (phase !== 'refreshing') { wasLoading.current = loading; return undefined }
    if (loading) { wasLoading.current = true; return undefined }
    const id = setTimeout(() => {
      setPhase('done')
      const id2 = setTimeout(() => { setPhase('idle'); setPull(0) }, DONE_HOLD_MS)
      return () => clearTimeout(id2)
    }, wasLoading.current ? 0 : 400)
    return () => clearTimeout(id)
  }, [loading, phase])

  useEffect(() => {
    if (phase !== 'done') return undefined
    const id = setTimeout(() => { setPhase('idle'); setPull(0) }, DONE_HOLD_MS)
    return () => clearTimeout(id)
  }, [phase])

  if (phase === 'idle' && pull <= 0) return null

  const ready = isReady(pull)
  const uiPhase = phase === 'pulling' && ready ? 'ready' : phase
  // Mientras se jala el porcentaje es el DEDO (real). Refrescando son las
  // etapas reales del padre, o null si no las hay (y entonces se barre).
  const pct = phase === 'refreshing'
    ? (stagesTotal > 0 ? Math.round((stagesDone / stagesTotal) * 100) : null)
    : Math.round(pullProgress(pull) * 100)
  const visual = progressColor(phase === 'refreshing' ? pct : (ready ? 100 : pct), error)
  const done = phase === 'done'
  const ringColor = done ? 'var(--accent-green)' : visual.color
  const indeterminate = phase === 'refreshing' && pct == null

  return (
    <div
      className="chispu-ptr"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        // DEBAJO del header (que es sticky z-20), a propósito: así el
        // indicador asoma desde atrás de la barra en vez de taparla. Encima
        // quedaría montado sobre el anillo de refrescar del propio header, o
        // sea dos anillos apilados diciendo lo mismo.
        zIndex: 10,
        display: 'flex',
        justifyContent: 'center',
        // Nunca tapa un toque: es un aviso, no un control.
        pointerEvents: 'none',
        transform: `translateY(${Math.min(pull, MAX_PULL_PX)}px)`,
        transition: g.current.claimed ? 'none' : 'transform 260ms cubic-bezier(0.34, 1.2, 0.64, 1)',
      }}
    >
      <span
        className="chispu-ptr-badge"
        style={{
          marginTop: 8,
          width: SIZE + 14,
          height: SIZE + 14,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-card)',
          border: 'var(--glass-border)',
          boxShadow: 'var(--shadow-elevated)',
          opacity: Math.min(1, pull / 18),
        }}
      >
        <span style={{ position: 'relative', width: SIZE, height: SIZE, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox={RING_VIEWBOX} width={SIZE} height={SIZE} aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
            <circle cx={RING_CX} cy={RING_CY} r={RING_R} fill="none" strokeWidth="2.4"
              style={{ stroke: 'var(--card-border)', opacity: 0.75 }} />
            {indeterminate ? (
              <circle cx={RING_CX} cy={RING_CY} r={RING_R} fill="none" strokeWidth="2.4" strokeLinecap="round"
                className="chispu-ptr-arc"
                style={{
                  stroke: ringColor,
                  strokeDasharray: sweepDash(),
                  transformOrigin: '16px 16px',
                  animation: 'chispuSweep 1.1s linear infinite',
                }} />
            ) : (
              <circle cx={RING_CX} cy={RING_CY} r={RING_R} fill="none" strokeWidth="2.4" strokeLinecap="round"
                transform="rotate(-90 16 16)"
                style={{
                  stroke: ringColor,
                  opacity: done ? 1 : visual.opacity,
                  strokeDasharray: RING_R * 2 * Math.PI,
                  strokeDashoffset: progressDashOffset(done ? 100 : pct, 0.06),
                  transition: 'stroke-dashoffset 180ms linear, stroke 250ms ease-out',
                }} />
            )}
          </svg>
          {done ? (
            <Check size={BOLT} strokeWidth={2.5} style={{ color: 'var(--accent-green)' }} />
          ) : (
            <svg width={BOLT} height={BOLT} viewBox={BOLT_VIEWBOX} aria-hidden="true"
              className="chispu-ptr-bolt"
              style={{
                // El rayo se endereza conforme el tirón avanza: a mitad de
                // camino está inclinado, y queda derecho justo cuando ya se
                // puede soltar. Es la misma información que el arco, en un
                // canal que se percibe sin leer.
                transform: `rotate(${(1 - pullProgress(pull)) * -35}deg)`,
                transition: 'transform 120ms linear',
              }}>
              <path d={BOLT_PATH} fill={ringColor} stroke={ringColor}
                strokeWidth={boltStrokeWidth(BOLT)} strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}
        </span>
      </span>
      <span className="sr-only">{label(uiPhase, lang)}</span>

      <style jsx>{`
        @media (prefers-reduced-motion: reduce) {
          .chispu-ptr, .chispu-ptr-bolt { transition: none !important; }
        }
      `}</style>
    </div>
  )
}
