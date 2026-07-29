'use client'

// Monthly headline cards. `investmentIncome` (auto, from portfolio dividends)
// counts toward total income with a footnote; `momIncomePct`/`momExpensesPct`
// show the vs-last-month delta when there's data to compare.

export default function FinanceSummaryCards({ income, expenses, investmentIncome = 0, momIncomePct = null, momExpensesPct = null, lang = 'es' }) {
  const totalIncome = income + (investmentIncome || 0)
  const savings = totalIncome - expenses
  const savingsRate = totalIncome > 0 ? (savings / totalIncome) * 100 : 0
  const t = (es, en) => lang === 'es' ? es : en

  const fmt = (v) => v.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const Delta = ({ pct, goodWhenDown = false }) => {
    if (pct == null || !isFinite(pct)) return null
    const up = pct >= 0
    const isGood = goodWhenDown ? !up : up
    return (
      <span className="text-xs font-mono tabular-nums ml-2" style={{ color: Math.abs(pct) < 3 ? 'var(--text-muted)' : isGood ? 'var(--accent-green)' : 'var(--alert-warn-icon)' }}
        title={t('vs mes pasado', 'vs last month')}>
        {up ? '↑' : '↓'}{Math.abs(pct).toFixed(0)}%
      </span>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="bg-theme-card border border-glass-border rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Ingresos', 'Income')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: 'var(--accent-green)' }}>
          Q{fmt(totalIncome)}
          <Delta pct={momIncomePct} />
        </p>
        {investmentIncome > 0 && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {t(`incluye Q${fmt(investmentIncome)} de inversión 🔒`, `includes Q${fmt(investmentIncome)} from investments 🔒`)}
          </p>
        )}
      </div>
      <div className="bg-theme-card border border-glass-border rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Gastos', 'Expenses')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: 'var(--text-negative)' }}>
          Q{fmt(expenses)}
          <Delta pct={momExpensesPct} goodWhenDown />
        </p>
      </div>
      <div className="bg-theme-card border border-glass-border rounded-xl p-4">
        <p className="text-caption text-slate-500 mb-1">{t('Ahorro', 'Savings')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: savings >= 0 ? 'var(--accent-blue-soft)' : '#f87171' }}>
          Q{fmt(savings)}
        </p>
        {totalIncome > 0 && (
          <p className="text-xs font-mono tabular-nums mt-0.5" style={{ color: savingsRate >= 0 ? 'rgba(37,99,235,0.7)' : 'rgba(248,113,113,0.7)' }}>
            {savingsRate >= 0 ? '+' : ''}{savingsRate.toFixed(1)}%
          </p>
        )}
      </div>
    </div>
  )
}
