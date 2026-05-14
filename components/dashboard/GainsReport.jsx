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
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
      <h3 className="text-base font-semibold text-white mb-4">
        {t('Ganancias y Pérdidas', 'Gains & Losses')}
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#0f172a] rounded-lg p-3 text-center border border-[#334155]/50">
          <span className="text-xs text-slate-500 block">{t('Realizada', 'Realized')}</span>
          <span className={`text-sm font-bold block ${report.totalRealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {report.totalRealized >= 0 ? '+' : ''}{formatCurrency(report.totalRealized)}
          </span>
        </div>
        <div className="bg-[#0f172a] rounded-lg p-3 text-center border border-[#334155]/50">
          <span className="text-xs text-slate-500 block">{t('No Realizada', 'Unrealized')}</span>
          <span className={`text-sm font-bold block ${report.totalUnrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {report.totalUnrealized >= 0 ? '+' : ''}{formatCurrency(report.totalUnrealized)}
          </span>
        </div>
        <div className="bg-[#0f172a] rounded-lg p-3 text-center border border-[#334155]/50">
          <span className="text-xs text-slate-500 block">Total</span>
          <span className={`text-sm font-bold block ${report.totalGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {report.totalGain >= 0 ? '+' : ''}{formatCurrency(report.totalGain)}
          </span>
        </div>
      </div>

      {report.symbols.length > 0 && (
        <div className="space-y-1.5">
          {report.symbols.slice(0, 8).map((s) => (
            <div key={s.symbol} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[#283548]/30 transition-colors">
              <span className="text-sm text-white font-medium">{s.symbol}</span>
              <div className="flex items-center gap-3 text-xs">
                {s.realized !== 0 && (
                  <span className={s.realized >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    R: {s.realized >= 0 ? '+' : ''}{formatCurrency(s.realized)}
                  </span>
                )}
                {s.unrealized !== 0 && (
                  <span className={s.unrealized >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}>
                    U: {s.unrealized >= 0 ? '+' : ''}{formatCurrency(s.unrealized)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
