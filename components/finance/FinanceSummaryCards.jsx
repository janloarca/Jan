'use client'

export default function FinanceSummaryCards({ income, expenses, lang = 'es' }) {
  const savings = income - expenses
  const savingsRate = income > 0 ? (savings / income) * 100 : 0
  const t = (es, en) => lang === 'es' ? es : en

  const fmt = (v) => v.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Ingresos', 'Income')}</p>
        <p className="text-h2 text-emerald-400 font-mono tabular-nums">Q{fmt(income)}</p>
      </div>
      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Gastos', 'Expenses')}</p>
        <p className="text-h2 text-red-400 font-mono tabular-nums">Q{fmt(expenses)}</p>
      </div>
      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Ahorro', 'Savings')}</p>
        <p className={`text-h2 font-mono tabular-nums ${savings >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
          Q{fmt(savings)}
        </p>
        {income > 0 && (
          <p className={`text-xs font-mono tabular-nums mt-0.5 ${savingsRate >= 0 ? 'text-blue-400/70' : 'text-red-400/70'}`}>
            {savingsRate >= 0 ? '+' : ''}{savingsRate.toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  )
}
