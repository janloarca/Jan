'use client'

export default function BenchmarkComparison({ benchmarkReturn, portfolioReturn, lang }) {
  if (benchmarkReturn == null) return null

  const t = (es, en) => lang === 'es' ? es : en
  const delta = (portfolioReturn ?? 0) - benchmarkReturn
  const isOut = delta >= 0

  return (
    <div className="bg-[#1e293b]/80 rounded-xl border border-[#334155]/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
          {t('Benchmark', 'Benchmark')}
        </span>
        <span className="text-xs text-slate-600">S&P 500</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-2">
        <div>
          <span className="text-xs text-slate-500 block">{t('Tu portafolio', 'Your portfolio')}</span>
          <span className={`text-base font-bold ${(portfolioReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(portfolioReturn ?? 0) >= 0 ? '+' : ''}{(portfolioReturn ?? 0).toFixed(2)}%
          </span>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500 block">S&P 500</span>
          <span className={`text-base font-bold ${benchmarkReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {benchmarkReturn >= 0 ? '+' : ''}{benchmarkReturn.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
        isOut ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
      }`}>
        <span>{isOut ? '▲' : '▼'}</span>
        <span>
          {isOut
            ? t(`Superas al mercado por ${Math.abs(delta).toFixed(1)}%`, `Outperforming market by ${Math.abs(delta).toFixed(1)}%`)
            : t(`Por debajo del mercado por ${Math.abs(delta).toFixed(1)}%`, `Underperforming market by ${Math.abs(delta).toFixed(1)}%`)
          }
        </span>
      </div>
    </div>
  )
}
