'use client'

import { useMemo } from 'react'
import { formatCurrency } from './utils'

export default function GainsReport({ lots, items, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  const report = useMemo(() => {
    if (!lots || lots.length === 0) return null

    let totalRealized = 0
    let totalUnrealized = 0
    const bySymbol = {}

    lots.forEach((lot) => {
      const sym = lot.symbol || 'Unknown'
      if (!bySymbol[sym]) bySymbol[sym] = { realized: 0, unrealized: 0, openLots: 0, closedLots: 0 }

      if (lot.status === 'closed' && lot.realizedGain != null) {
        totalRealized += lot.realizedGain
        bySymbol[sym].realized += lot.realizedGain
        bySymbol[sym].closedLots++
      } else if (lot.status === 'open' && lot.quantity > 0) {
        const item = (items || []).find((it) => (it.symbol || '').toUpperCase() === sym.toUpperCase())
        const currentPrice = item?.currentPrice || item?.purchasePrice || lot.costBasis
        const unrealized = (currentPrice - lot.costBasis) * lot.quantity
        totalUnrealized += unrealized
        bySymbol[sym].unrealized += unrealized
        bySymbol[sym].openLots++
      }
    })

    const symbols = Object.entries(bySymbol)
      .map(([sym, data]) => ({ symbol: sym, ...data, total: data.realized + data.unrealized }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

    return { totalRealized, totalUnrealized, totalGain: totalRealized + totalUnrealized, symbols }
  }, [lots, items])

  if (!report) return null

  return (
    <div className="bg-theme-surface/80 rounded-xl border border-glass-border/50 p-4">
      <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
        {t('GANANCIAS Y PÉRDIDAS', 'GAINS & LOSSES')}
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-theme-base rounded-lg p-3 text-center border border-glass-border/50">
          <span className="text-xs text-slate-500 block">{t('Realizada', 'Realized')}</span>
          <span className="text-sm font-bold block" style={{ color: report.totalRealized >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {report.totalRealized >= 0 ? '+' : ''}{formatCurrency(report.totalRealized)}
          </span>
        </div>
        <div className="bg-theme-base rounded-lg p-3 text-center border border-glass-border/50">
          <span className="text-xs text-slate-500 block">{t('No Realizada', 'Unrealized')}</span>
          <span className="text-sm font-bold block" style={{ color: report.totalUnrealized >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {report.totalUnrealized >= 0 ? '+' : ''}{formatCurrency(report.totalUnrealized)}
          </span>
        </div>
        <div className="bg-theme-base rounded-lg p-3 text-center border border-glass-border/50">
          <span className="text-xs text-slate-500 block">Total</span>
          <span className="text-sm font-bold block" style={{ color: report.totalGain >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
            {report.totalGain >= 0 ? '+' : ''}{formatCurrency(report.totalGain)}
          </span>
        </div>
      </div>

      {report.symbols.length > 0 ? (
        <div className="space-y-1.5">
          {report.symbols.slice(0, 8).map((s) => (
            <div key={s.symbol} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-theme-elevated/30 transition-colors">
              <span className="text-sm text-white font-medium">{s.symbol}</span>
              <div className="flex items-center gap-3 text-xs">
                {s.realized !== 0 && (
                  <span style={{ color: s.realized >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                    R: {s.realized >= 0 ? '+' : ''}{formatCurrency(s.realized)}
                  </span>
                )}
                {s.unrealized !== 0 && (
                  <span style={{ color: s.unrealized >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                    U: {s.unrealized >= 0 ? '+' : ''}{formatCurrency(s.unrealized)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 text-center py-2">
          {t('Agrega lotes al comprar o vender para ver ganancias.', 'Add lots by buying or selling to see gains.')}
        </p>
      )}
    </div>
  )
}
