'use client'

import { useMemo } from 'react'
import { computeSharpeRatio, computeVolatility, computeMaxDrawdown, computePeriodicReturns, computeBeta, computeSortino, computeTreynor, computeJensensAlpha, computeInformationRatio } from './analytics'

export default function RiskMetrics({ snapshots, benchmarkData, netWorth, lang, transactions, convert, baseCurrency, benchmarkName }) {
  const metrics = useMemo(() => {
    const returns = computePeriodicReturns(snapshots, transactions, convert, baseCurrency)
    const sharpeResult = computeSharpeRatio({ returns })
    const vol = computeVolatility({ returns })

    const valueSeries = (snapshots || [])
      .filter((s) => s.date)
      .map((s) => ({ ts: new Date(s.date).getTime(), value: s.netWorthUSD ?? s.totalActivosUSD ?? 0 }))
      .filter((p) => !isNaN(p.ts) && isFinite(p.ts) && p.value > 0)
      .sort((a, b) => a.ts - b.ts)
    const drawdown = computeMaxDrawdown(valueSeries)

    let beta = null
    let bReturns = []
    if (benchmarkData?.dataPoints?.length > 2 && valueSeries.length > 2) {
      const bPts = benchmarkData.dataPoints
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

    const sortino = computeSortino(returns)
    const treynor = computeTreynor(returns, bReturns)
    const alpha = computeJensensAlpha(returns, bReturns)
    const ir = computeInformationRatio(returns, bReturns)

    return { sharpe: sharpeResult.sharpe, vol, drawdown, beta, sortino, treynor, alpha, ir }
  }, [snapshots, benchmarkData, transactions, convert, baseCurrency])

  const hasData = snapshots && snapshots.length >= 15
  const t = (es, en) => lang === 'es' ? es : en

  const sharpeColor = metrics.sharpe == null ? '#64748b'
    : metrics.sharpe > 1 ? '#34d399'
    : metrics.sharpe > 0.5 ? '#fbbf24'
    : '#f87171'

  const volColor = metrics.vol == null ? '#64748b'
    : metrics.vol < 15 ? '#34d399'
    : metrics.vol < 25 ? '#fbbf24'
    : '#f87171'

  const ddColor = metrics.drawdown.maxDrawdownPct === 0 ? '#64748b'
    : metrics.drawdown.maxDrawdownPct < 10 ? '#34d399'
    : metrics.drawdown.maxDrawdownPct < 20 ? '#fbbf24'
    : '#f87171'

  const sortinoColor = metrics.sortino === 0 ? '#64748b'
    : metrics.sortino > 1 ? '#34d399'
    : metrics.sortino > 0.5 ? '#fbbf24'
    : '#f87171'

  const treynorColor = metrics.treynor === 0 ? '#64748b'
    : metrics.treynor > 0.1 ? '#34d399'
    : metrics.treynor > 0 ? '#fbbf24'
    : '#f87171'

  const alphaColor = metrics.alpha === 0 ? '#64748b'
    : metrics.alpha > 0 ? '#34d399'
    : metrics.alpha >= -0.02 ? '#fbbf24'
    : '#f87171'

  const irColor = metrics.ir === 0 ? '#64748b'
    : metrics.ir > 0.5 ? '#34d399'
    : metrics.ir > 0 ? '#fbbf24'
    : '#f87171'

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
    <div className="bg-[#141416]/80 rounded-xl border border-[#27272a]/50 p-4">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
        {t('MÉTRICAS DE RIESGO', 'RISK METRICS')}
      </h3>

      {!hasData ? (
        <div className="text-center py-4 text-sm text-slate-600">
          {t('Se necesitan más datos históricos (mín. 15 snapshots)', 'More historical data needed (min. 15 snapshots)')}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="bg-[#000000] rounded-lg p-3 border border-[#27272a]/50 text-center">
              <span className="text-xs text-slate-500 block">Sharpe</span>
              <span className="text-base sm:text-lg font-bold block" style={{ color: sharpeColor }}>
                {metrics.sharpe != null ? metrics.sharpe.toFixed(2) : '---'}
              </span>
              <span className="text-xs text-slate-600">
                {metrics.sharpe == null ? '' : metrics.sharpe > 1 ? t('Excelente', 'Excellent') : metrics.sharpe > 0.5 ? t('Aceptable', 'Acceptable') : t('Bajo', 'Low')}
              </span>
            </div>

            <div className="bg-[#000000] rounded-lg p-3 border border-[#27272a]/50 text-center">
              <span className="text-xs text-slate-500 block">{t('Volatilidad', 'Volatility')}</span>
              <span className="text-base sm:text-lg font-bold block" style={{ color: volColor }}>
                {metrics.vol != null ? `${metrics.vol.toFixed(1)}%` : '---'}
              </span>
              <span className="text-xs text-slate-600">{t('Anualizada', 'Annualized')}</span>
            </div>

            <div className="bg-[#000000] rounded-lg p-3 border border-[#27272a]/50 text-center">
              <span className="text-xs text-slate-500 block">Max Drawdown</span>
              <span className="text-base sm:text-lg font-bold block" style={{ color: ddColor }}>
                {metrics.drawdown.maxDrawdownPct > 0 ? `-${metrics.drawdown.maxDrawdownPct.toFixed(1)}%` : '0%'}
              </span>
              {metrics.drawdown.peakDate && (
                <span className="text-xs text-slate-600">
                  {new Date(metrics.drawdown.peakDate).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', year: '2-digit' })}
                </span>
              )}
            </div>

            <div className="bg-[#000000] rounded-lg p-3 border border-[#27272a]/50 text-center">
              <span className="text-xs text-slate-500 block">Beta</span>
              <span className="text-base sm:text-lg font-bold text-slate-300 block">
                {metrics.beta != null ? metrics.beta.toFixed(2) : 'N/A'}
              </span>
              <span className="text-xs text-slate-600">vs {benchmarkName || 'S&P 500'}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-2 sm:mt-3">
            <div className="bg-[#000000] rounded-lg p-3 border border-[#27272a]/50 text-center">
              <span className="text-xs text-slate-500 block">Sortino</span>
              <span className="text-base sm:text-lg font-bold block" style={{ color: sortinoColor }}>
                {metrics.sortino !== 0 ? metrics.sortino.toFixed(2) : '---'}
              </span>
              <span className="text-xs text-slate-600">
                {metrics.sortino === 0 ? '' : metrics.sortino > 1 ? t('Excelente', 'Excellent') : metrics.sortino > 0.5 ? t('Aceptable', 'Acceptable') : t('Bajo', 'Low')}
              </span>
            </div>

            <div className="bg-[#000000] rounded-lg p-3 border border-[#27272a]/50 text-center">
              <span className="text-xs text-slate-500 block">Treynor</span>
              <span className="text-base sm:text-lg font-bold block" style={{ color: treynorColor }}>
                {metrics.treynor !== 0 ? metrics.treynor.toFixed(2) : '---'}
              </span>
              <span className="text-xs text-slate-600">{t('Exceso/Beta', 'Excess/Beta')}</span>
            </div>

            <div className="bg-[#000000] rounded-lg p-3 border border-[#27272a]/50 text-center">
              <span className="text-xs text-slate-500 block">{t('Alfa de Jensen', "Jensen's Alpha")}</span>
              <span className="text-base sm:text-lg font-bold block" style={{ color: alphaColor }}>
                {metrics.alpha !== 0 ? `${(metrics.alpha * 100).toFixed(2)}%` : '---'}
              </span>
              <span className="text-xs text-slate-600">vs {benchmarkName || 'S&P 500'}</span>
            </div>

            <div className="bg-[#000000] rounded-lg p-3 border border-[#27272a]/50 text-center">
              <span className="text-xs text-slate-500 block">{t('Ratio Información', 'Information Ratio')}</span>
              <span className="text-base sm:text-lg font-bold block" style={{ color: irColor }}>
                {metrics.ir !== 0 ? metrics.ir.toFixed(2) : '---'}
              </span>
              <span className="text-xs text-slate-600">{t('Activo/TE', 'Active/TE')}</span>
            </div>
          </div>

          {insight && (
            <p className="text-xs text-slate-400 mt-3 px-1 italic">{insight}</p>
          )}
        </>
      )}
    </div>
  )
}
