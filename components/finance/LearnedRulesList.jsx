'use client'

import { CATEGORY_COLORS } from '@/lib/financeCategories'

// Lo que Chispu aprendió de vos: qué comercio va en qué categoría, y con qué
// palabra lo llamás.
//
// Es la superficie de "acordarse de cosas chicas": la etiqueta ("mecánico") no
// decide nada por sí sola, pero es lo que hace que la lista se pueda leer. Sin
// ella dice "donald → Transporte", que es correcto y no significa nada dentro de
// seis meses.
//
// Vive aparte de AutoCaptureModal para poder montarse y medirse sola: dentro del
// modal solo se pinta después de que la API contesta, y esa API exige sesión.

export default function LearnedRulesList({ rules = [], onForget, busy = false, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  if (!rules.length) return null

  return (
    <div>
      <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        {t('Lo que le enseñaste', 'What you taught it')}
      </p>
      <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
        {t(
          'Cada vez que corregís la categoría de un movimiento, se guarda la regla y el siguiente cobro de ese comercio entra ya clasificado. Vale para el atajo, el correo y los estados de cuenta.',
          'Every time you fix a transaction category, the rule is saved and the next charge from that merchant lands already classified. It applies to the shortcut, the email and statement imports.'
        )}
      </p>
      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
        {rules.map((r) => (
          <div key={r.match} className="flex items-center gap-2 px-2 py-1.5 bg-theme-base rounded-lg">
            <span className="flex-1 min-w-0 text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
              {r.match}
              {r.label && (
                <span style={{ color: 'var(--text-muted)' }}> · {r.label}</span>
              )}
            </span>
            {/* El nombre va en tinta normal y el color lo lleva el punto: el
                azul de acento mide 3.81:1 a 12px sobre el fondo oscuro, bajo el
                mínimo, y no hay un solo token de azul que pase en los dos temas
                (--accent-blue falla en oscuro, --accent-blue-soft en claro).
                Un punto de color no es texto y no arrastra ese requisito. */}
            <span className="shrink-0 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-primary)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[r.category] || 'var(--text-muted)' }} />
              {r.category}
            </span>
            <button
              onClick={() => onForget?.(r.match)}
              disabled={busy}
              aria-label={t('Olvidar', 'Forget')}
              className="shrink-0 px-1 text-xs disabled:opacity-40"
              style={{ color: 'var(--text-negative)', opacity: 0.7 }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
