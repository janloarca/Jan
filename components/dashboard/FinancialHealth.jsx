'use client'

export default function FinancialHealth({ items, netWorth, totalAssets, lang }) {
  const totalDebt = 0 // TODO: calculate from items with type debt/payable
  const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0
  const debtScore = debtRatio < 10 ? 25 : debtRatio < 30 ? 20 : debtRatio < 50 ? 15 : 5

  // Liquidity - check if there's cash/bank holdings
  const liquidItems = items.filter((it) => /bank|cash|saving|liquid|fondo/i.test(it.type || ''))
  const liquidValue = liquidItems.reduce((s, it) => s + (it.quantity || 0) * (it.purchasePrice || 0), 0)
  const liquidPct = totalAssets > 0 ? (liquidValue / totalAssets) * 100 : 0
  const liquidScore = liquidPct > 20 ? 25 : liquidPct > 10 ? 20 : liquidPct > 5 ? 15 : 5

  // Diversification
  const typeGroups = {}
  items.forEach((it) => {
    const t = it.type || 'other'
    typeGroups[t] = (typeGroups[t] || 0) + 1
  })
  const numTypes = Object.keys(typeGroups).length
  const diversePct = Math.min(100, (numTypes / 5) * 100)
  const diverseScore = diversePct >= 80 ? 22 : diversePct >= 60 ? 18 : diversePct >= 40 ? 14 : 8

  // Growth (placeholder)
  const growthScore = 2

  const total = debtScore + liquidScore + diverseScore + growthScore

  const bars = [
    { label: 'Debt/Assets', score: debtScore, max: 25, pct: 100 - debtRatio, color: 'bg-emerald-500' },
    { label: 'Liquidity', score: liquidScore, max: 25, pct: liquidPct, color: 'bg-emerald-500' },
    { label: 'Diversification', score: diverseScore, max: 25, pct: diversePct, color: 'bg-amber-500' },
    { label: 'Growth', score: growthScore, max: 25, pct: (growthScore / 25) * 100, color: 'bg-red-500' },
  ]

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          FINANCIAL HEALTH
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-white">🅱️ {total}/100</span>
        </div>
      </div>
      <div className="space-y-3">
        {bars.map((bar) => (
          <div key={bar.label} className="flex items-center gap-3">
            <span className="text-[10px] text-slate-400 w-24">{bar.label}</span>
            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${Math.min(bar.pct, 100)}%` }} />
            </div>
            <span className="text-[10px] text-slate-400 w-10 text-right">{bar.score}/{bar.max}</span>
            <span className="text-[10px] text-slate-500 w-10 text-right">{bar.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
