'use client'

import { useState, useRef, useEffect } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { CATEGORY_COLORS, FINANCE_CATEGORIES } from '@/lib/financeCategories'
import { suggestCategoryForLabel } from '@/lib/merchantLabels'

// Corregir la categoría de un movimiento.
//
// Antes era un <select> con dieciséis opciones, y eso le pide al usuario que
// traduzca su mundo al nuestro: él sabe que Donald es su mecánico, no sabe en
// cuál de nuestras categorías cae un mecánico. Acá puede escribir "mecánico" y
// la categoría se propone sola; la lista completa sigue estando abajo para
// quien prefiera elegirla directo, que es más rápido cuando ya se sabe cuál es.
//
// Lo que se escribe se GUARDA como etiqueta del comercio, así que la próxima
// vez ese cobro entra clasificado y además se puede mostrar "DONALD · mecánico"
// en vez de un código de banco.

export default function CategoryEditor({ tx, onApply, onCancel, onToggleAnnual = null, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [label, setLabel] = useState(tx?.userLabel || '')
  // FASE LJ. La marca de pago anual/semestral. Aplica AL INSTANTE con su
  // propio callback (no al elegir categoria): si viajara con onApply, marcar
  // una fila sin cambiar su categoria exigiria re-elegir la misma, un paso
  // escondido que nadie va a adivinar. Es la marca que alimenta la linea
  // "Qx son pagos anuales" del resumen del mes; con pocos meses de historial
  // una prima anual aparece UNA vez y ninguna deteccion de cadencia la ve.
  const [annual, setAnnual] = useState(tx?._annualCadence === true)
  const inputRef = useRef(null)
  const boxRef = useRef(null)

  const categories = tx?.type === 'INCOME' ? FINANCE_CATEGORIES.INCOME : FINANCE_CATEGORIES.EXPENSE
  // Solo se sugiere sobre gasto: no hay tabla de oficios para un ingreso, y
  // proponer algo ahí sería inventar.
  const suggestion = tx?.type === 'INCOME' ? null : suggestCategoryForLabel(label)

  // Tocar afuera lo cierra, pero de eso se encarga el fondo de la capa que lo
  // monta: dos mecanismos para el mismo gesto es cómo uno se queda atrás.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEscClose(onCancel)

  // La etiqueta viaja siempre que se haya escrito algo, aunque la categoría se
  // elija a mano de la lista: "mecánico" sigue siendo lo que el usuario sabe de
  // ese lugar, y es lo que hace legible la fila después.
  const apply = (category) => onApply?.(category, label.trim() || null)

  return (
    <div
      ref={boxRef}
      className="modal-anim card p-3 space-y-2.5 w-[17rem] max-w-[calc(100vw-2rem)]"
      style={{ boxShadow: 'var(--shadow-modal, 0 12px 32px rgba(0,0,0,0.35))' }}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {tx?.description || tx?.merchant || '-'}
        </p>
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('¿Qué es este lugar?', 'What is this place?')}
        </label>
      </div>

      <input
        ref={inputRef}
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && suggestion) apply(suggestion.category) }}
        placeholder={t('ej. mecánico, almuerzo, dentista', 'e.g. mechanic, lunch, dentist')}
        className="w-full px-2.5 py-1.5 bg-theme-base border border-glass-border rounded-lg text-xs focus:outline-none focus:border-blue-500/50"
        style={{ color: 'var(--text-primary)' }}
      />

      {tx?.type !== 'INCOME' && onToggleAnnual && (
        <label className="flex items-start gap-2 px-2.5 py-2 rounded-lg text-xs cursor-pointer border"
          style={{ borderColor: annual ? 'var(--accent-blue)' : 'var(--card-border)', color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={annual}
            onChange={(e) => { setAnnual(e.target.checked); onToggleAnnual(e.target.checked) }}
            className="mt-0.5 shrink-0"
          />
          <span>
            {t('Pago anual o semestral (cae 1-2 veces al año)', 'Annual or semiannual payment (lands 1-2 times a year)')}
            <span className="block" style={{ color: 'var(--text-muted)' }}>
              {t('El mes lo separa del gasto recurrente; el total no cambia.', 'The month separates it from recurring spend; the total does not change.')}
            </span>
          </span>
        </label>
      )}

      {suggestion && (
        <button
          onClick={() => apply(suggestion.category)}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: '#ffffff' }} />
          <span className="truncate">{t('Guardar como', 'Save as')} {suggestion.category}</span>
        </button>
      )}

      <div>
        <p className="text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
          {suggestion ? t('o elegí otra', 'or pick another') : t('Elegí la categoría', 'Pick the category')}
        </p>
        <div className="flex flex-wrap gap-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => apply(cat)}
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-xs border transition-colors hover:bg-theme-elevated"
              style={{
                borderColor: cat === tx?.category ? 'var(--accent-blue)' : 'var(--card-border)',
                color: 'var(--text-secondary)',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat] || 'var(--text-muted)' }} />
              {cat}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
