'use client'

import { useMemo } from 'react'
import { computeSharpeRatio, computeVolatility, computeMaxDrawdown, computePeriodicReturns, computeBeta } from './analytics'

export default function RiskMetrics({ snapshots, benchmarkData, netWorth, lang, transactions, convert, baseCurrency }) {
  const metrics = useMemo(() => {
    const returns = computePeriodicReturns(snapshots, transactions, convert, baseCurrency)
    const sharpeResult = computeSharpeRatio({ returns })
    const vol = computeVolatility({ returns })

    const valueSeries = (snapshots || [])
      .map((s) => ({ ts: new Date(s.date).getTime(), value: s.netWorthUSD ?? s.totalActivosUSD ?? 0 }))
      .filter((p) => !isNaN(p.ts) && p.value > 0)
      .sort((a, b) => a.ts - b.ts)
    const drawdown = computeMaxDrawdown(valueSeries)

    let beta = null
    if (benchmarkData?.dataPoints?.length > 2 && valueSeries.length > 2) {
      const bPts = benchmarkData.dataPoints
      const bReturns = []
      for (let i = 1; i < valueSeries.length; i++) {
        const targetTs = valueSeries[i].ts
        const prevTargetTs = valueSeries[i - 1].ts
        let closestCurr = null, closestPrev = null
        let minDiffCurr = Infinity, minDiffPrev = Infinity
        for (const bp of bPts) {
          const diffCurr = Math.abs(bp.ts - targetTs)
          const diffPrev = Math.abs(bp.ts - prevTargetTs)
          if (diffCurr < minDiffCurr) { minDiffCurr = diffCurr; closestCurr = bp }
          if (diffPrev < minDiffPrev) { minDiffPrev = diffPrev; closestPrev = bp }
        }
        if (closestCurr && closestPrev && closestPrev.close > 0) {
          bReturns.push((closestCurr.close - closestPrev.close) / closestPrev.close)
        }
      }
      beta = computeBeta(returns, bReturns)
    }

    return { sharpe: sharpeResult.sharpe, vol, drawdown, beta }
  }, [snapshots, benchmarkData, transactions, convert, baseCurrency])

  const hasData = snapshots && snapshots.length >= 3
  const t = (es, en) => lang === 'es' ? es : en

  const sharpeColor = metrics.sharpe == null ? 'text-slate-500'
    : metrics.sharpe > 1 ? 'text-emerald-400'
    : metrics.sharpe > 0.5 ? 'text-amber-400'
    : 'text-red-400'

  const volColor = metrics.vol == null ? 'text-slate-500'
    : metrics.vol < 15 ? 'text-emerald-400'
    : metrics.vol < 25 ? 'text-amber-400'
    : 'text-red-400'

  const ddColor = metrics.drawdown.maxDrawdownPct === 0 ? 'text-slate-500'
    : metrics.drawdown.maxDrawdownPct < 10 ? 'text-emerald-400'
    : metrics.drawdown.maxDrawdownPct < 20 ? 'text-amber-400'
    : 'text-red-400'

  const insight = useMemo(() => {
    if (!hasData) return null
    const { sharpe, vol, drawdown } = metrics
    if (sharpe != null && sharpe > 1 && vol != null && vol < 20) {
      return t('Buen balance riesgo-retorno. Portafolio eficiente.', 'Good risk-return balance. Efficient portfolio.')
    }
    if (drawdown.maxDrawdownPct > 25) {
      return t(`Caída máx de ${drawdown.maxDrawdownPct.toFixed(0)}% indica alta volatilidad histórica.`, `Max drawdown of ${drawdown.maxDrawdownPct.toFixed(0)}% indicates high historical volatility.`)
    }
    if (sharpe != null && sharpe < 0.3) {
      return t('Retorno bajo vs riesgo tomado. Evalúa posiciones volátiles.', 'Low return vs risk taken. Evaluate volatile positions.')
    }
    return null
  }, [hasData, metrics, lang])

  return (
    <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        {t('MÉTRICAS DE RIESGO', 'RISK METRICS')}
      </h3>

      {!hasData ? (
        <div className="text-center py-4 text-sm text-slate-600">
          {t('Se necesitan más datos históricos (mín. 3 snapshots)', 'More historical data needed (min. 3 snapshots)')}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#334155]/50 text-center">
              <span className="text-[9px] text-slate-500 block">Sharpe</span>
              <span className={`text-base sm:text-lg font-bold block ${sharpeColor}`}>
                {metrics.sharpe != null ? metrics.sharpe.toFixed(2) : '---'}
              </span>
              <span className="text-[8px] text-slate-600">
                {metrics.sharpe == null ? '' : metrics.sharpe > 1 ? t('Excelente', 'Excellent') : metrics.sharpe > 0.5 ? t('Aceptable', 'Acceptable') : t('Bajo', 'Low')}
              </span>
            </div>

            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#334155]/50 text-center">
              <span className="text-[9px] text-slate-500 block">{t('Volatilidad', 'Volatility')}</span>
              <span className={`text-base sm:text-lg font-bold block ${volColor}`}>
                {metrics.vol != null ? `${metrics.vol.toFixed(1)}%` : '---'}
              </span>
              <span className="text-[8px] text-slate-600">{t('Anualizada', 'Annualized')}</span>
            </div>

            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#334155]/50 text-center">
              <span className="text-[9px] text-slate-500 block">Max Drawdown</span>
              <span className={`text-base sm:text-lg font-bold block ${ddColor}`}>
                {metrics.drawdown.maxDrawdownPct > 0 ? `-${metrics.drawdown.maxDrawdownPct.toFixed(1)}%` : '0%'}
              </span>
              {metrics.drawdown.peakDate && (
                <span className="text-[8px] text-slate-600">
                  {new Date(metrics.drawdown.peakDate).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', year: '2-digit' })}
                </span>
              )}
            </div>

            <div className="bg-[#0f172a] rounded-lg p-3 border border-[#334155]/50 text-center">
              <span className="text-[9px] text-slate-500 block">Beta</span>
              <span className="text-base sm:text-lg font-bold text-slate-300 block">
                {metrics.beta != null ? metrics.beta.toFixed(2) : 'N/A'}
              </span>
              <span className="text-[8px] text-slate-600">vs S&P 500</span>
            </div>
          </div>

          {insight && (
            <p className="text-[11px] text-slate-400 mt-3 px-1 italic">{insight}</p>
          )}
        </>
      )}
    </div>
  )
}
