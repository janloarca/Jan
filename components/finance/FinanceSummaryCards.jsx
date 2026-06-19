'use client'

export default function FinanceSummaryCards({ income, expenses, lang = 'es' }) {
  const savings = income - expenses
  const savingsRate = income > 0 ? (savings / income) * 100 : 0
  const t = (es, en) => lang === 'es' ? es : en

  const fmt = (v) => v.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-theme-card border border-glass-border rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Ingresos', 'Income')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: 'var(--accent-green)' }}>Q{fmt(income)}</p>
      </div>
      <div className="bg-theme-card border border-glass-border rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Gastos', 'Expenses')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: 'var(--text-negative)' }}>Q{fmt(expenses)}</p>
      </div>
      <div className="bg-theme-card border border-glass-border rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Ahorro', 'Savings')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: savings >= 0 ? 'var(--accent-blue-soft)' : '#f87171' }}>
          Q{fmt(savings)}
        </p>
        {income > 0 && (
          <p className="text-xs font-mono tabular-nums mt-0.5" style={{ color: savingsRate >= 0 ? 'rgba(108,122,255,0.7)' : 'rgba(248,113,113,0.7)' }}>
            {savingsRate >= 0 ? '+' : ''}{savingsRate.toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  )
}
