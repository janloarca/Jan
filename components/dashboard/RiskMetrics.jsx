'use client'

import { useMemo } from 'react'
import { computeSharpeRatio, computeVolatility, computeMaxDrawdown, computePeriodicReturns, pairPortfolioWithBenchmark, computeSortino, computeTreynor, computeJensensAlpha, computeInformationRatio, inferPeriodsPerYear, filterValueSpikes } from './analytics'
import { InfoTip } from '../ui/Tooltip'
import { formatShortDate } from './utils'
import { snapshotAssetsUSD } from '@/lib/assetReturns'

export default function RiskMetrics({ snapshots, benchmarkData, netWorth, lang, transactions, convert, baseCurrency, benchmarkName }) {
  const metrics = useMemo(() => {
    const returns = computePeriodicReturns(snapshots, transactions, convert, baseCurrency)
    const ppy = inferPeriodsPerYear(snapshots)
    const sharpeResult = computeSharpeRatio({ returns, periodsPerYear: ppy })
    const vol = computeVolatility({ returns, periodsPerYear: ppy })

    const valueSeries = (snapshots || [])
      .filter((s) => s.date)
      // FASE LV: solo-activos, el mismo universo del YTD (FASE LU). La lista
      // de transacciones que llega ya es la de activos (page.jsx pasa
      // assetTransactions a AnalysisTabs).
      .map((s) => ({ ts: new Date(s.date).getTime(), value: snapshotAssetsUSD(s) }))
      .filter((p) => !isNaN(p.ts) && isFinite(p.ts) && p.value > 0)
      .sort((a, b) => a.ts - b.ts)
    const drawdown = computeMaxDrawdown(filterValueSpikes(valueSeries))

    // Benchmark-relative metrics need the portfolio and benchmark return series
    // sampled over the SAME pairs. `returns` (Modified Dietz over snapshots) is
    // filtered/derived differently than the per-valueSeries benchmark returns, so
    // pairing them by slice(-len) would misalign. Shared pairing (analytics.js,
    // FASE HT5): the hook's riskMetrics uses the same one for the report's beta.
    const { pReturnsB, bReturns, beta } = pairPortfolioWithBenchmark(valueSeries, benchmarkData)

    const sortino = computeSortino(returns)
    const treynor = computeTreynor(pReturnsB, bReturns)
    const alpha = computeJensensAlpha(pReturnsB, bReturns)
    const ir = computeInformationRatio(pReturnsB, bReturns)

    return { sharpe: sharpeResult.sharpe, vol, drawdown, beta, sortino, treynor, alpha, ir }
  }, [snapshots, benchmarkData, transactions, convert, baseCurrency])

  const hasData = snapshots && snapshots.length >= 15
  const t = (es, en) => lang === 'es' ? es : en

  const sharpeColor = metrics.sharpe == null ? '#64748b'
    : metrics.sharpe > 1 ? 'var(--accent-green)'
    : metrics.sharpe > 0.5 ? 'var(--accent-orange)'
    : 'var(--text-negative)'

  const volColor = metrics.vol == null ? '#64748b'
    : metrics.vol < 15 ? 'var(--accent-green)'
    : metrics.vol < 25 ? 'var(--accent-orange)'
    : 'var(--text-negative)'

  const ddColor = metrics.drawdown.maxDrawdownPct === 0 ? '#64748b'
    : metrics.drawdown.maxDrawdownPct < 10 ? 'var(--accent-green)'
    : metrics.drawdown.maxDrawdownPct < 20 ? 'var(--accent-orange)'
    : 'var(--text-negative)'

  const sortinoColor = metrics.sortino === 0 ? '#64748b'
    : metrics.sortino > 1 ? 'var(--accent-green)'
    : metrics.sortino > 0.5 ? 'var(--accent-orange)'
    : 'var(--text-negative)'

  const treynorColor = metrics.treynor === 0 ? '#64748b'
    : metrics.treynor > 0.1 ? 'var(--accent-green)'
    : metrics.treynor > 0 ? 'var(--accent-orange)'
    : 'var(--text-negative)'

  const alphaColor = metrics.alpha === 0 ? '#64748b'
    : metrics.alpha > 0 ? 'var(--accent-green)'
    : metrics.alpha >= -0.02 ? 'var(--accent-orange)'
    : 'var(--text-negative)'

  const irColor = metrics.ir === 0 ? '#64748b'
    : metrics.ir > 0.5 ? 'var(--accent-green)'
    : metrics.ir > 0 ? 'var(--accent-orange)'
    : 'var(--text-negative)'

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

  // No card chrome of its own: this renders inside the Analysis card (see
  // AnalysisTabs in app/dashboard/page.jsx), and a card within a card would
  // double the border and the padding.
  return (
    <div>
      <h3 className="card-title mb-4">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
        {t('MÉTRICAS DE RIESGO', 'RISK METRICS')}
      </h3>

      {!hasData ? (
        <div className="text-center py-4 text-sm text-slate-600">
          {t('Se necesitan más datos históricos (mín. 15 snapshots)', 'More historical data needed (min. 15 snapshots)')}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">Sharpe<InfoTip text={t('Retorno ajustado al riesgo. Mayor = mejor recompensa por unidad de riesgo. Arriba de 1 es bueno, arriba de 2 es excelente.', 'Risk-adjusted return. Higher = better reward per unit of risk. Above 1 is good, above 2 is excellent.')} /></span>
              <span className="text-base sm:text-h1 block" style={{ color: sharpeColor }}>
                {metrics.sharpe != null ? metrics.sharpe.toFixed(2) : '---'}
              </span>
              <span className="text-xs text-slate-600">
                {metrics.sharpe == null ? '' : metrics.sharpe > 1 ? t('Excelente', 'Excellent') : metrics.sharpe > 0.5 ? t('Aceptable', 'Acceptable') : t('Bajo', 'Low')}
              </span>
            </div>

            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">{t('Volatilidad', 'Volatility')}<InfoTip text={t('Cuánto fluctúa el valor de tu portafolio. Menor = más estable. Desviación estándar anualizada de retornos.', 'How much your portfolio value fluctuates. Lower = more stable. Annualized standard deviation of returns.')} /></span>
              <span className="text-base sm:text-h1 block" style={{ color: volColor }}>
                {metrics.vol != null ? `${metrics.vol.toFixed(1)}%` : '---'}
              </span>
              <span className="text-xs text-slate-600">{t('Anualizada', 'Annualized')}</span>
            </div>

            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">Max Drawdown<InfoTip text={t('Mayor caída de pico a valle. Muestra el peor escenario de pérdida desde el punto más alto.', 'Largest peak-to-trough decline. Shows worst-case loss scenario from highest point.')} /></span>
              <span className="text-base sm:text-h1 block" style={{ color: ddColor }}>
                {metrics.drawdown.maxDrawdownPct > 0 ? `-${metrics.drawdown.maxDrawdownPct.toFixed(1)}%` : '0%'}
              </span>
              {metrics.drawdown.peakDate && (
                <span className="text-xs text-slate-600">
                  {/* FASE ME5: el ts del pico es la medianoche UTC de un dia calendario;
                      formatearlo en hora local lo retrocedia un dia (y en el 1 del mes,
                      un MES) al oeste de UTC. formatShortDate lleva el guard UTC. */}
                  {formatShortDate(metrics.drawdown.peakDate)}
                </span>
              )}
            </div>

            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">Beta<InfoTip text={t('Sensibilidad a los movimientos del mercado. 1.0 = se mueve igual que el mercado, mayor a 1 = más volátil, menor a 1 = más estable.', 'Sensitivity to market movements. 1.0 = moves with the market, above 1 = more volatile, below 1 = more stable.')} /></span>
              <span className="text-base sm:text-h1 text-slate-300 block">
                {metrics.beta != null ? metrics.beta.toFixed(2) : 'N/A'}
              </span>
              <span className="text-xs text-slate-600">vs {benchmarkName || 'S&P 500'}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-2 sm:mt-3">
            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">Sortino<InfoTip text={t('Como Sharpe, pero solo penaliza riesgo a la baja. Mayor = mejor. Ignora la volatilidad al alza.', 'Like Sharpe, but only penalizes downside risk. Higher = better. Ignores upside volatility.')} /></span>
              <span className="text-base sm:text-h1 block" style={{ color: sortinoColor }}>
                {metrics.sortino !== 0 ? metrics.sortino.toFixed(2) : '---'}
              </span>
              <span className="text-xs text-slate-600">
                {metrics.sortino === 0 ? '' : metrics.sortino > 1 ? t('Excelente', 'Excellent') : metrics.sortino > 0.5 ? t('Aceptable', 'Acceptable') : t('Bajo', 'Low')}
              </span>
            </div>

            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">Treynor<InfoTip text={t('Retorno por unidad de riesgo de mercado (beta). Mayor = mejor compensación por riesgo sistemático.', 'Return earned per unit of market risk (beta). Higher = better compensation for systematic risk.')} /></span>
              <span className="text-base sm:text-h1 block" style={{ color: treynorColor }}>
                {metrics.treynor !== 0 ? metrics.treynor.toFixed(2) : '---'}
              </span>
              <span className="text-xs text-slate-600">{t('Exceso/Beta', 'Excess/Beta')}</span>
            </div>

            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">{t('Alfa de Jensen', "Jensen's Alpha")}<InfoTip text={t('Retorno en exceso vs. el benchmark de mercado. Positivo = superando al mercado. Negativo = por debajo.', 'Excess return vs. the market benchmark. Positive = outperforming. Negative = underperforming.')} /></span>
              <span className="text-base sm:text-h1 block" style={{ color: alphaColor }}>
                {metrics.alpha !== 0 ? `${(metrics.alpha * 100).toFixed(2)}%` : '---'}
              </span>
              <span className="text-xs text-slate-600">vs {benchmarkName || 'S&P 500'}</span>
            </div>

            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">{t('Ratio Información', 'Information Ratio')}<InfoTip text={t('Consistencia de retornos en exceso vs. benchmark. Mayor = superación más consistente.', 'Consistency of excess returns vs. benchmark. Higher = more consistent outperformance.')} /></span>
              <span className="text-base sm:text-h1 block" style={{ color: irColor }}>
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
