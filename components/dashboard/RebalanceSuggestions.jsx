'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, getItemValue } from './utils'

const DEFAULT_TARGETS = {
  stocks: 40, crypto: 10, funds: 20, bonds: 15, banks: 5, realestate: 5, alternatives: 5,
}

export default function RebalanceSuggestions({ items, netWorth, goals, onSaveGoals, lang, onDismiss }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [editing, setEditing] = useState(false)

  const targets = goals?.allocationTargets || DEFAULT_TARGETS
  const [form, setForm] = useState({ ...DEFAULT_TARGETS, ...targets })

  const allocation = useMemo(() => {
    const cats = {}
    const assetItems = items.filter((it) => !it.isDebt)
    const totalAssets = assetItems.reduce((s, it) => s + Math.max(0, getItemValue(it)), 0)

    assetItems.forEach((it) => {
      const cat = getTypeCategory(it)
      const val = Math.max(0, getItemValue(it))
      cats[cat] = (cats[cat] || 0) + val
    })

    const allCats = new Set([...Object.keys(cats), ...Object.keys(targets)])
    const result = []

    for (const cat of allCats) {
      if (cat === 'debts' || cat === 'other') continue
      const current = cats[cat] || 0
      const currentPct = totalAssets > 0 ? (current / totalAssets) * 100 : 0
      const targetPct = targets[cat] || 0
      const diff = currentPct - targetPct
      const diffValue = totalAssets > 0 ? (diff / 100) * totalAssets : 0

      result.push({ cat, current, currentPct, targetPct, diff, diffValue })
    }

    return { categories: result.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), totalAssets }
  }, [items, targets])

  const maxDrift = Math.max(...allocation.categories.map((c) => Math.abs(c.diff)), 0)
  const isBalanced = maxDrift < 5

  const handleSave = () => {
    if (onSaveGoals) {
      onSaveGoals({ ...goals, allocationTargets: form })
    }
    setEditing(false)
  }

  return (
    <div className="bg-[#1C1C1E]/80 rounded-xl border border-[#38383A]/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
          {t('REBALANCEO', 'REBALANCING')}
        </h3>
        <div className="flex items-center gap-2">
          {isBalanced ? (
            <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              {t('Balanceado', 'Balanced')}
            </span>
          ) : (
            <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
              {t('Drift', 'Drift')}: {maxDrift.toFixed(1)}%
            </span>
          )}
          <button onClick={() => setEditing(!editing)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            {editing ? t('Cancelar', 'Cancel') : t('Editar', 'Edit')}
          </button>
          {onDismiss && (
            <button onClick={onDismiss}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
              ✕
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          {allocation.categories.map((c) => (
            <div key={c.cat} className="flex items-center gap-2">
              <span className="text-xs text-slate-300 w-24 capitalize">{c.cat}</span>
              <input type="number" min="0" max="100" step="5"
                value={form[c.cat] || 0}
                onChange={(e) => setForm({ ...form, [c.cat]: parseInt(e.target.value) || 0 })}
                className="w-16 px-2 py-1 text-xs bg-[#000000] border border-[#38383A] rounded text-white text-center" />
              <span className="text-xs text-slate-500">%</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-500">
              {t('Total', 'Total')}: {Object.values(form).reduce((s, v) => s + (v || 0), 0)}%
            </span>
            <button onClick={handleSave}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">
              {t('Guardar', 'Save')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {allocation.categories.filter((c) => c.targetPct > 0 || c.currentPct > 1).map((c) => {
            const color = TYPE_COLORS[c.cat]?.bg || '#64748b'
            const isOver = c.diff > 2
            const isUnder = c.diff < -2
            return (
              <div key={c.cat}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300 capitalize flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    {c.cat}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{c.currentPct.toFixed(1)}%</span>
                    <span className="text-slate-600">/</span>
                    <span className="text-slate-400">{c.targetPct}%</span>
                    {(isOver || isUnder) && (
                      <span className={`font-medium ${isOver ? 'text-amber-400' : 'text-cyan-400'}`}>
                        {c.diff > 0 ? '+' : ''}{c.diff.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-1.5 bg-slate-700/30 rounded-full overflow-hidden relative">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(c.currentPct, 100)}%`, backgroundColor: color, opacity: 0.7 }} />
                  {c.targetPct > 0 && (
                    <div className="absolute top-0 h-full w-0.5 bg-white/40"
                      style={{ left: `${Math.min(c.targetPct, 100)}%` }} />
                  )}
                </div>
              </div>
            )
          })}

          {!isBalanced && (
            <div className="pt-2 border-t border-[#38383A]/30 space-y-1">
              {allocation.categories
                .filter((c) => Math.abs(c.diff) > 2 && c.targetPct > 0)
                .slice(0, 3)
                .map((c) => (
                  <div key={c.cat} className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      {c.diff > 0
                        ? `${t('Reducir', 'Reduce')} ${c.cat}`
                        : `${t('Aumentar', 'Increase')} ${c.cat}`}
                    </span>
                    <span className={`font-medium ${c.diff > 0 ? 'text-amber-400' : 'text-cyan-400'}`}>
                      {c.diff > 0 ? '-' : '+'}{formatCurrency(Math.abs(c.diffValue))}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
