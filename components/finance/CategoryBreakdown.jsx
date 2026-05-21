'use client'

import { CATEGORY_COLORS } from '@/lib/financeCategories'

export default function CategoryBreakdown({ transactions, type = 'EXPENSE', lang = 'es' }) {
  const t = (es, en) => lang === 'es' ? es : en
  const filtered = transactions.filter(tx => tx.type === type)
  const total = filtered.reduce((s, tx) => s + tx.amount, 0)

  const byCategory = {}
  filtered.forEach(tx => {
    byCategory[tx.category] = (byCategory[tx.category] || 0) + tx.amount
  })

  const sorted = Object.entries(byCategory)
    .map(([cat, amount]) => ({ category: cat, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)

  if (sorted.length === 0) {
    return (
      <div className="bg-[#1e293b] border border-[#334155] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3">
          {type === 'EXPENSE' ? t('Gastos por Categoría', 'Expenses by Category') : t('Ingresos por Categoría', 'Income by Category')}
        </h3>
        <p className="text-xs text-slate-500">{t('Sin datos este mes', 'No data this month')}</p>
      </div>
    )
  }

  const fmt = (v) => v.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="bg-[#1e293b] border border-[#334155] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white mb-3">
        {type === 'EXPENSE' ? t('Gastos por Categoría', 'Expenses by Category') : t('Ingresos por Categoría', 'Income by Category')}
      </h3>
      <div className="space-y-2">
        {sorted.map(({ category, amount, pct }) => (
          <div key={category}>
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[category] || '#64748b' }} />
                <span className="text-slate-300">{category}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Q{fmt(amount)}</span>
                <span className="text-slate-500 w-10 text-right">{pct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="w-full h-1.5 bg-[#0f172a] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[category] || '#64748b' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
