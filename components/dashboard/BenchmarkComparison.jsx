'use client'

export default function BenchmarkComparison({ benchmarkReturn, portfolioReturn, benchmarkName, lang }) {
  if (benchmarkReturn == null || !isFinite(benchmarkReturn)) return (
    <div className="text-center py-2">
      <p className="text-sm text-slate-500">{lang === 'es' ? 'Benchmark no disponible' : 'Benchmark unavailable'}</p>
    </div>
  )

  const t = (es, en) => lang === 'es' ? es : en
  const name = benchmarkName || 'S&P 500'
  const pr = portfolioReturn ?? 0
  const unreliable = Math.abs(pr) > 200
  const displayPR = unreliable ? 0 : pr
  const delta = displayPR - benchmarkReturn
  const isOut = delta >= 0

  if (unreliable) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
            {t('Benchmark', 'Benchmark')}
          </span>
          <span className="text-xs text-slate-500">{name}</span>
        </div>
        <div className="text-center py-2">
          <span className="text-base font-bold" style={{ color: benchmarkReturn >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {benchmarkReturn >= 0 ? '+' : ''}{benchmarkReturn.toFixed(2)}%
          </span>
          <p className="text-xs text-slate-500 mt-2">
            {t('Se necesitan más snapshots para comparar tu retorno de forma confiable.', 'More snapshots needed for a reliable portfolio return comparison.')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
          {t('Benchmark', 'Benchmark')}
        </span>
        <span className="text-xs text-slate-500">{name}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-2">
        <div>
          <span className="text-xs text-slate-500 block">{t('Tu portafolio', 'Your portfolio')}</span>
          <span className="text-base font-bold" style={{ color: displayPR >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {displayPR >= 0 ? '+' : ''}{displayPR.toFixed(2)}%
          </span>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500 block">{name}</span>
          <span className="text-base font-bold" style={{ color: benchmarkReturn >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {benchmarkReturn >= 0 ? '+' : ''}{benchmarkReturn.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium"
        style={isOut
          ? { backgroundColor: 'color-mix(in srgb, var(--accent-green) 12%, transparent)', color: 'var(--accent-green)' }
          : { backgroundColor: 'color-mix(in srgb, var(--text-negative) 12%, transparent)', color: 'var(--text-negative)' }
        }>
        <span>{isOut ? '▲' : '▼'}</span>
        <span>
          {isOut
            ? t(`Superas al mercado por ${Math.abs(delta).toFixed(1)}%`, `Outperforming ${name} by ${Math.abs(delta).toFixed(1)}%`)
            : t(`Por debajo del mercado por ${Math.abs(delta).toFixed(1)}%`, `Underperforming ${name} by ${Math.abs(delta).toFixed(1)}%`)
          }
        </span>
      </div>
    </div>
  )
}
