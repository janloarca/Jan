'use client'

// El panel de avance de un broker: los requisitos, un porcentaje del 0 al 100
// y una fila tocable por requisito para ir a editar ESE paso.
//
// Pedido del usuario: "para usuarios que solo tienen una cosa conectada, un
// panel con los requisitos y un % del 1 al cien y que toque el que quiere
// editar". Reemplaza al botón "Empezar" en cuanto el usuario cumple el primer
// requisito: antes de eso no hay nada que mostrar y "Empezar" es la respuesta
// correcta; después, un botón que sigue diciendo "Empezar" miente sobre un
// viaje que ya arrancó.
//
// Vive en DOS superficies con el mismo aspecto (ConnectionsModal en línea y
// BrokerCompletionModal), no una copia por pantalla: un requisito que se lee
// distinto según desde dónde se mire es cómo alguien concluye que la app
// dice dos cosas.

import { useState } from 'react'
import { Check, ChevronRight, Minus } from 'lucide-react'

const RING_SIZE = 46
const RING_STROKE = 4

function ProgressRing({ pct, size = RING_SIZE, stroke = RING_STROKE }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct || 0))
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          style={{ stroke: 'var(--bg-tertiary)' }} />
        {/* En 0% no se dibuja el arco: con strokeLinecap redondo, un largo de
            cero igual pinta un punto, que se lee como un avance mínimo que no
            existe. */}
        {clamped > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * c} ${c}`}
            style={{ stroke: clamped >= 100 ? 'var(--accent-green)' : 'var(--accent-blue)', transition: 'stroke-dasharray 400ms ease' }} />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums"
        style={{ color: clamped >= 100 ? 'var(--accent-green)' : 'var(--text-primary)' }}>
        {clamped}%
      </span>
    </div>
  )
}

export default function BrokerProgressPanel({
  progress,
  brokerName = 'Interactive Brokers',
  onOpenStep,
  lang = 'es',
  // `compact` es la variante en línea dentro de una lista (ConnectionsModal):
  // sin nombre del broker en el encabezado, que la fila de arriba ya lo dice.
  compact = false,
  // El botón de "seguir con lo que falta" se apaga donde la superficie que
  // envuelve al panel ya tiene el suyo, para no poner dos botones que hacen
  // exactamente lo mismo a dos centímetros uno del otro.
  showCta = true,
  // FASE IH3: dentro de una LISTA de conexiones el panel se pliega, porque
  // ahí compite por espacio con los demás brokers ("si hay muchos brokers no
  // es mucho espacio?"). El resumen (anillo + estado) se queda siempre
  // visible: ocupa una fila y es lo que de verdad se escanea.
  collapsible = false,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  // Arranca cerrado SOLO cuando ya no hay nada que hacer: cuatro checks verdes
  // permanentes son la parte que menos vale la pena tener siempre desplegada,
  // y con algo pendiente esconder qué falta sería esconder justamente la
  // información por la que existe el panel.
  const [open, setOpen] = useState(() => !(progress?.complete))
  if (!progress || !progress.steps?.length) return null

  const { steps, pct, satisfied, total, complete, nextStep } = progress
  const missing = total - satisfied
  const showRows = !collapsible || open

  const Summary = (
    <>
      <ProgressRing pct={pct} />
      <div className="min-w-0 flex-1">
        {!compact && (
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{brokerName}</p>
        )}
        <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          {complete
            ? t('Todo listo', 'All set')
            : t(`${satisfied} de ${total} listos`, `${satisfied} of ${total} done`)}
        </p>
        <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
          {complete
            ? t('Tu historial y tus retornos son lo más reales que se puede.', 'Your history and returns are as real as it gets.')
            : t(`Falta${missing === 1 ? '' : 'n'} ${missing}. Ninguno es obligatorio: tocá el que quieras completar.`,
                 `${missing} left. None are required: tap the one you want to complete.`)}
        </p>
      </div>
    </>
  )

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--card-border)', backgroundColor: 'var(--bg-card)' }}>
      {collapsible ? (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-theme-elevated">
          {Summary}
          <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {open ? t('Ocultar ▴', 'Hide ▴') : t('Ver pasos ▾', 'See steps ▾')}
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-3 px-3.5 py-3">{Summary}</div>
      )}

      {showRows && (
      <div style={{ borderTop: '1px solid var(--card-border)' }}>
        {steps.map((s) => {
          const isDone = s.status === 'done'
          const isSkippable = s.status === 'skippable'
          const isNext = s.step === nextStep
          const label = lang === 'es' ? s.title.es : s.title.en
          const desc = s.desc ? (lang === 'es' ? s.desc.es : s.desc.en) : null
          // FASE NT: un aviso del paso (una calibración copiada que la app
          // está ignorando). Gana sobre "Listo"/"Pendiente": el estado del
          // círculo no cambia, la frase de al lado sí, porque "Pendiente"
          // sobre un paso que el usuario ya hizo se lee como trabajo borrado.
          const attention = s.attention ? (lang === 'es' ? s.attention.es : s.attention.en) : null
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpenStep && onOpenStep(s.step, s.id)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-theme-elevated"
              style={{ borderTop: '1px solid var(--card-border)' }}
            >
              <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={isDone
                  ? { backgroundColor: 'var(--accent-green)', color: 'var(--bg-card)' }
                  : isSkippable
                    ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }
                    : isNext
                      ? { backgroundColor: 'var(--bg-card)', color: 'var(--accent-blue)', border: '2px solid var(--accent-blue)' }
                      : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                {isDone ? <Check size={13} strokeWidth={3} /> : isSkippable ? <Minus size={12} /> : s.step}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium truncate" style={{ color: isDone ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                  {label}
                </span>
                <span className="block text-[11px] mt-0.5 leading-snug"
                  data-step-attention={attention ? 'true' : undefined}
                  style={{ color: attention ? 'var(--alert-warn-icon)' : 'var(--text-muted)' }}>
                  {attention
                    ? attention
                    : isDone
                      ? t('Listo', 'Done')
                      : isSkippable
                        ? t('No hace falta: ya está cubierto.', 'Not needed: already covered.')
                        : (isNext && desc ? desc : t('Pendiente', 'Pending'))}
                </span>
              </span>
              <ChevronRight size={15} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
            </button>
          )
        })}
      </div>
      )}

      {showRows && showCta && !complete && nextStep != null && onOpenStep && (
        <div className="px-3.5 py-3" style={{ borderTop: '1px solid var(--card-border)' }}>
          <button type="button" onClick={() => onOpenStep(nextStep)}
            className="w-full py-2 text-xs font-semibold rounded-lg transition-all hover:brightness-110 active:scale-[0.99]"
            style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
            {t('Completar lo que falta', 'Complete what is missing')}
          </button>
        </div>
      )}
    </div>
  )
}
