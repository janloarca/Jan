'use client'

// Resumen de la ciudad en una linea compacta. Capital, rendimiento (la receta de
// la Hoja y Asignacion, via lib/assetSummary), instituciones e inversiones.
import { formatCurrency, formatCompact } from '@/components/dashboard/utils'
import { perfTone, formatReturn } from '@/lib/worldModel'

const TONE = { up: 'var(--accent-green)', down: 'var(--text-negative)' }

export default function WorldSummary({ world, lang, baseCurrency }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const tone = perfTone(world.returnPct)
  return (
    <div className="card p-3 sm:p-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <div className="min-w-0">
        <span className="text-caption mr-2" style={{ color: 'var(--text-muted)' }}>{t('Tamaño de portafolio', 'Portfolio size')}</span>
        <span className="text-h2 font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCompact(world.total, baseCurrency)}</span>
      </div>
      {world.returnPct != null && (
        <div className="min-w-0">
          <span className="text-caption mr-2" style={{ color: 'var(--text-muted)' }}>{t('Rendimiento desde el costo', 'Return since cost')}</span>
          <span className="text-h2 font-semibold tabular-nums" style={{ color: TONE[tone] || 'var(--text-primary)' }}>
            {formatReturn(world.returnPct)}
          </span>
          <span className="text-micro ml-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>{world.gain > 0 ? '+' : ''}{formatCompact(world.gain, baseCurrency)}</span>
        </div>
      )}
      <div className="text-caption" style={{ color: 'var(--text-muted)' }}>
        {world.institutionCount} {t('instituciones', 'institutions')} · {world.investmentCount} {t('inversiones', 'investments')}
      </div>
    </div>
  )
}
