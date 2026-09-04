'use client'

// Lo que cambió este mes, en prosa.
//
// Este archivo llevaba CUATRO cosas: el estado del mes, los tiles de ingreso,
// la comparativa por grupo y los insights. Las tres primeras se fueron a
// `MonthStatusBar` y a `BreakdownCard`, porque dos de ellas dibujaban el mismo
// dinero que otra card ya dibujaba (y a otra escala). Acá queda solo lo que no
// se puede leer de una barra: la frase.
//
// La selección de qué frase merece un lugar vive en `buildFinanceInsights`
// (lib/financeMonth.js), no acá.

const SEV_COLOR = { warn: 'var(--alert-warn-icon)', good: 'var(--accent-green)', info: 'var(--alert-info-icon)' }

export default function FinanceInsights({ insights = [], lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  if (insights.length === 0) return null

  return (
    <div className="card p-4 sm:p-5">
      <h3 className="card-title mb-3">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
        {t('QUÉ CAMBIÓ', 'WHAT CHANGED')}
      </h3>
      <ul className="space-y-1.5">
        {insights.map((ins, i) => (
          <li key={i} className="text-xs flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
            <span className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: SEV_COLOR[ins.severity] || 'var(--text-muted)' }}>●</span>
            {lang === 'es' ? ins.textEs : ins.textEn}
          </li>
        ))}
      </ul>
    </div>
  )
}
