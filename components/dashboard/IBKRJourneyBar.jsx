'use client'

// FASE GM. La barra de progreso del viaje continuo de IBKR: un strip fijo
// ARRIBA de cualquier modal del viaje (z-index mayor que el z-50 de los
// modales) que responde las dos preguntas que el flujo viejo dejaba en el
// aire: ¿en qué paso voy? y ¿cuántos faltan? El bug reportado que motiva
// esto: subir el archivo soltaba al usuario en el dashboard sin decirle si
// había más pasos ("me quedo pensando si habrán más pasos o con eso ya
// estoy"). Regla dura del usuario: secuencia seguida, sin pop-ups
// inesperados, y NUNCA de vuelta a la pantalla principal a mitad del viaje.
//
// Ningún paso es obligatorio (regla de la casa desde FASE EZ): "Saltar"
// avanza sin hacer el paso, "Salir" abandona el viaje entero. El contenido
// de cada paso lo renderiza el orquestador (app/dashboard/page.jsx) reusando
// los modales existentes; esta barra solo lleva el hilo.
//
// Los círculos son TOCABLES: el viaje es una secuencia sugerida, no un riel
// obligatorio, y el usuario pidió explícitamente poder "tocar el que quiere
// editar". Los que ya están cumplidos llevan check y los que legítimamente no
// hacen falta llevan raya (estado REAL de los datos, vía lib/ibkrJourney.js,
// no "por dónde pasé"): los dos suman al porcentaje, así que los dos tienen
// que verse distintos de un pendiente.

import { useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'
import { journeyProgressLabel, journeySatisfiedSteps } from '@/lib/ibkrJourney'

export default function IBKRJourneyBar({
  step = 1, total = 5, title = '', onSkip, onExit, onJump, lang = 'es',
  // El avance REAL de los 4 requisitos (lib/ibkrJourney.js). La barra no
  // arma su propia frase ni su propia lista de pasos cumplidos: las pide,
  // para que no pueda volver a contradecir al panel sobre el mismo viaje.
  // El paso 5 es el resumen, no un requisito, así que nunca lleva marca.
  progress = null,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  // El strip es `fixed`, así que no empuja nada: sin esto tapaba la cabecera
  // del modal del paso (el título "Calibrar rendimiento" quedaba medio
  // escondido debajo, visible en las capturas del usuario). La regla de CSS
  // que consume este atributo vive en globals.css y solo aplica mientras el
  // viaje está activo.
  // El alto se MIDE, no se supone: la barra crece con el tamaño de fuente del
  // sistema, y un valor fijo escrito a mano en el CSS volvería a tapar la
  // cabecera en cuanto alguien agrande la letra. El fallback de globals.css
  // solo cubre el frame previo a la primera medición.
  const barRef = useRef(null)
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-journey', '1')
    const measure = () => {
      const h = barRef.current?.offsetHeight
      if (h) root.style.setProperty('--journey-bar-h', `${h}px`)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && barRef.current) ro.observe(barRef.current)
    return () => {
      ro?.disconnect()
      root.removeAttribute('data-journey')
      root.style.removeProperty('--journey-bar-h')
    }
  }, [])

  // Un paso "satisfecho" es cumplido O legítimamente innecesario: los dos
  // suman al porcentaje, así que los dos llevan marca. Antes solo la llevaba
  // `done`, con lo que un paso que ya contaba para el 75% se dibujaba igual
  // que uno pendiente y la barra contradecía al panel sobre ese mismo paso.
  const satisfied = new Map(journeySatisfiedSteps(progress).map((s) => [s.step, s.status]))
  const progressLabel = journeyProgressLabel(progress, lang)

  return (
    <div ref={barRef} className="fixed top-0 inset-x-0 z-[60] px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3"
      style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--card-border)', boxShadow: 'var(--shadow-modal)' }}>

      <div className="flex items-center shrink-0">
        {Array.from({ length: total }, (_, i) => {
          const n = i + 1
          const isCurrent = n === step
          const mark = satisfied.get(n)
          const isDone = mark === 'done'
          const isSkipped = mark === 'skippable'
          const isPast = n < step
          const reached = !!mark || isPast
          return (
            <span key={n} className="flex items-center">
              {i > 0 && (
                <span className="w-3 sm:w-5 h-[2px] rounded-full transition-colors"
                  style={{ backgroundColor: reached || isCurrent ? 'var(--accent-blue)' : 'var(--bg-tertiary)' }} />
              )}
              <button type="button"
                onClick={() => onJump && onJump(n)}
                disabled={!onJump}
                aria-label={t(`Ir al paso ${n}`, `Go to step ${n}`)}
                aria-current={isCurrent ? 'step' : undefined}
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all disabled:cursor-default"
                style={isDone
                  ? { backgroundColor: 'var(--accent-green)', color: 'var(--bg-card)' }
                  : isSkipped
                  ? { backgroundColor: 'color-mix(in srgb, var(--accent-green) 16%, transparent)', color: 'var(--accent-green)' }
                  : isCurrent
                    ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff', boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent-blue) 22%, transparent)' }
                    : isPast
                      ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 18%, transparent)', color: 'var(--accent-blue)' }
                      : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {isDone ? <Check size={12} strokeWidth={3} /> : isSkipped ? <Minus size={12} strokeWidth={3} /> : n}
              </button>
            </span>
          )
        })}
      </div>

      {/* La posición ya la dibujan los círculos (son `total` puntos, uno
          resaltado), así que el texto dice lo que ellos no pueden: cuántos
          requisitos están cumplidos, con la MISMA frase del panel. El "Paso X
          de Y" que vivía aquí era redundante con los círculos y además
          introducía un segundo denominador (5 pantallas contra 4 requisitos):
          sobrevive para lectores de pantalla, donde los círculos no se
          escanean de un vistazo. */}
      <p className="text-xs min-w-0 flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
        <span className="sr-only">{t(`Paso ${step} de ${total}. `, `Step ${step} of ${total}. `)}</span>
        {progressLabel ? <span className="font-semibold">{progressLabel}</span> : null}
        {title ? <span style={{ color: 'var(--text-muted)' }}>{progressLabel ? ' · ' : ''}{title}</span> : null}
      </p>

      {onSkip && step < total && (
        <button type="button" onClick={onSkip}
          className="text-xs px-2.5 py-1 rounded-lg border shrink-0 transition-colors hover:bg-theme-elevated"
          style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
          {t('Saltar', 'Skip')}
        </button>
      )}
      {onExit && (
        <button type="button" onClick={onExit}
          className="text-xs px-2.5 py-1 rounded-lg shrink-0 transition-colors hover:bg-theme-elevated"
          style={{ color: 'var(--text-muted)' }}>
          {t('Salir', 'Exit')}
        </button>
      )}
    </div>
  )
}
