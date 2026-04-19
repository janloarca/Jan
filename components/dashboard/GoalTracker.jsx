'use client'

import { useState } from 'react'
import { formatCurrency, formatCompact } from './utils'

export default function GoalTracker({ netWorth, annualDividends, goals, onSaveGoals, snapshots, lang }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    incomeGoal: goals?.incomeGoal || 12000,
    portfolioGoal: goals?.portfolioGoal || 100000,
    targetYear: goals?.targetYear || new Date().getFullYear() + 5,
  })

  const t = (es, en) => lang === 'es' ? es : en

  const incomeGoal = goals?.incomeGoal || form.incomeGoal
  const portfolioGoal = goals?.portfolioGoal || form.portfolioGoal
  const targetYear = goals?.targetYear || form.targetYear
  const yearsLeft = Math.max(0, targetYear - new Date().getFullYear())

  const incomePct = incomeGoal > 0 ? Math.min(100, (annualDividends / incomeGoal) * 100) : 0
  const portfolioPct = portfolioGoal > 0 ? Math.min(100, (netWorth / portfolioGoal) * 100) : 0

  const monthlyNeeded = yearsLeft > 0 && portfolioGoal > netWorth
    ? (portfolioGoal - netWorth) / (yearsLeft * 12)
    : 0

  const handleSave = async () => {
    if (onSaveGoals) {
      await onSaveGoals({
        incomeGoal: parseFloat(form.incomeGoal) || 0,
        portfolioGoal: parseFloat(form.portfolioGoal) || 0,
        targetYear: parseInt(form.targetYear) || new Date().getFullYear() + 5,
      })
    }
    setEditing(false)
  }

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          {t('METAS FINANCIERAS', 'FINANCIAL GOALS')}
        </h3>
        <div className="flex items-center gap-2">
          {!editing && (
            <span className="text-[10px] text-slate-500 bg-[#0b1120] px-2 py-0.5 rounded">
              {t(`Meta: ${targetYear}`, `Target: ${targetYear}`)} · {yearsLeft}{t(' años', 'y')}
            </span>
          )}
          <button onClick={() => { setEditing(!editing); if (!editing) setForm({ incomeGoal: incomeGoal, portfolioGoal: portfolioGoal, targetYear: targetYear }) }}
            className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors">
            {editing ? t('Cancelar', 'Cancel') : t('Editar', 'Edit')}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">{t('Meta ingreso anual', 'Annual income goal')}</label>
              <input value={form.incomeGoal} onChange={(e) => setForm({ ...form, incomeGoal: e.target.value })}
                type="number" step="1000" placeholder="12000"
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">{t('Meta de portfolio', 'Portfolio goal')}</label>
              <input value={form.portfolioGoal} onChange={(e) => setForm({ ...form, portfolioGoal: e.target.value })}
                type="number" step="10000" placeholder="100000"
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">{t('Año objetivo', 'Target year')}</label>
            <input value={form.targetYear} onChange={(e) => setForm({ ...form, targetYear: e.target.value })}
              type="number" min={new Date().getFullYear()} max="2060" placeholder="2030"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
          <button onClick={handleSave}
            className="w-full py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
            {t('Guardar metas', 'Save goals')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Income goal */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white font-medium">{t('Ingreso pasivo', 'Passive income')}</span>
                <span className="text-[9px] text-slate-500 bg-[#0b1120] px-1.5 py-0.5 rounded">{formatCompact(incomeGoal)}/{t('año', 'yr')}</span>
              </div>
              <span className={`text-xs font-bold ${incomePct >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{incomePct.toFixed(0)}%</span>
            </div>
            <div className="w-full h-3 bg-slate-700/30 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all"
                style={{ width: `${incomePct}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-500">{formatCurrency(annualDividends)}</span>
              <span className="text-[10px] text-slate-500">{formatCurrency(incomeGoal)}</span>
            </div>
          </div>

          {/* Portfolio goal */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white font-medium">{t('Tamaño de portfolio', 'Portfolio size')}</span>
                <span className="text-[9px] text-slate-500 bg-[#0b1120] px-1.5 py-0.5 rounded">{formatCompact(portfolioGoal)}</span>
              </div>
              <span className={`text-xs font-bold ${portfolioPct >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{portfolioPct.toFixed(0)}%</span>
            </div>
            <div className="w-full h-3 bg-slate-700/30 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-400 transition-all"
                style={{ width: `${portfolioPct}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-500">{formatCurrency(netWorth)}</span>
              <span className="text-[10px] text-slate-500">{formatCurrency(portfolioGoal)}</span>
            </div>
          </div>

          {/* Pace indicator */}
          {monthlyNeeded > 0 && (
            <div className="bg-[#0b1120] rounded-lg p-3 border border-[#1e2d45]/50">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">{t('Para llegar a tu meta necesitas invertir', 'To reach your goal, invest')}</span>
              </div>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-lg font-bold text-white">{formatCurrency(monthlyNeeded)}</span>
                <span className="text-[10px] text-slate-500">/{t('mes', 'mo')}</span>
                <span className="text-[10px] text-slate-600 ml-2">{t('por', 'for')} {yearsLeft} {t('años', 'years')}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
