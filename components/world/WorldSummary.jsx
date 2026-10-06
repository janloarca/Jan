'use client'

// Resumen de la ciudad. Las tres primeras cifras salen tal cual del portafolio;
// la cuarta es la metáfora y lo dice.
import { formatCurrency } from '@/components/dashboard/utils'

export default function WorldSummary({ world, lang, baseCurrency }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const cells = [
    { k: 'total', label: t('Invertido', 'Invested'), value: formatCurrency(world.total, baseCurrency) },
    { k: 'inst', label: t('Instituciones', 'Institutions'), value: world.institutionCount },
    { k: 'inv', label: t('Inversiones', 'Investments'), value: world.investmentCount },
    { k: 'workers', label: t('Trabajadores', 'Workers'), value: world.workerCount, note: t('metáfora del tamaño', 'a metaphor for size') },
  ]
  return (
    <div className="card p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
      {cells.map((c) => (
        <div key={c.k} className="min-w-0">
          <div className="text-caption" style={{ color: 'var(--text-muted)' }}>{c.label}</div>
          <div className="text-h2 font-semibold tabular-nums truncate" style={{ color: 'var(--text-primary)' }}>{c.value}</div>
          {c.note && <div className="text-micro" style={{ color: 'var(--text-muted)' }}>{c.note}</div>}
        </div>
      ))}
    </div>
  )
}
