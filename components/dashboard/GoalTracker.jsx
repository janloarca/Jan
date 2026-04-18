'use client'

import { useState } from 'react'
import { formatCurrency } from './utils'

export default function GoalTracker({ netWorth, annualDividends, goals, onSaveGoals, lang }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    incomeGoal: goals?.incomeGoal || 12000,
    portfolioGoal: goals?.portfolioGoal || 100000,
  })

  const t = (es, en) => lang === 'es' ? es : en

  const incomeGoal = goals?.incomeGoal || form.incomeGoal
  const portfolioGoal = goals?.portfolioGoal || form.portfolioGoal
  const incomePct = incomeGoal > 0 ? Math.min(100, (annualDividends / incomeGoal) * 100) : 0
  const portfolioPct = portfolioGoal > 0 ? Math.min(100, (netWorth / portfolioGoal) * 100) : 0

  const handleSave = async () => {
    if (onSaveGoals) {
      await onSaveGoals({
        incomeGoal: parseFloat(form.incomeGoal) || 0,
        portfolioGoal: parseFloat(form.portfolioGoal) || 0,
      })
    }
    setEditing(false)
  }

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          {t('METAS', 'GOAL TRAJECTORY')}
        </h3>
        <button onClick={() => setEditing(!editing)}
          className="text-[10px] text-slate-400 hover:text-emerald-400 transition-colors">
          {editing ? t('Cancelar', 'Cancel') : t('Editar →', 'Details →')}
        </button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Meta de ingreso anual', 'Annual income goal')}</label>
            <input value={form.incomeGoal} onChange={(e) => setForm({ ...form, incomeGoal: e.target.value })}
              type="number" step="1000"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Meta de portfolio', 'Portfolio size goal')}</label>
            <input value={form.portfolioGoal} onChange={(e) => setForm({ ...form, portfolioGoal: e.target.value })}
              type="number" step="10000"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>
          <button onClick={handleSave}
            className="w-full py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
            {t('Guardar', 'Save')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Income goal */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-white">{t(`Meta de ingreso (${formatCurrency(incomeGoal)}/año)`, `Income goal (${formatCurrency(incomeGoal)}/yr)`)}</span>
              <span className="text-xs text-emerald-400 font-medium">{incomePct.toFixed(0)}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
                style={{ width: `${incomePct}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-500">{formatCurrency(annualDividends)} / {formatCurrency(incomeGoal)}</span>
            </div>
          </div>

          {/* Portfolio goal */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-white">{t('Meta de portfolio', 'Portfolio size goal')}</span>
              <span className="text-xs text-emerald-400 font-medium">{portfolioPct.toFixed(0)}%</span>
            </div>
            <div className="w-full h-2.5 bg-slate-700/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                style={{ width: `${portfolioPct}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-slate-500">{formatCurrency(netWorth)} / {formatCurrency(portfolioGoal)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
