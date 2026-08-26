'use client'
import AmountInput from '@/components/ui/AmountInput'
import { parseAmount } from '@/lib/numberParse'

import { useState, useMemo } from 'react'
import { formatCurrency } from './utils'

const FREQUENCIES = [
  { value: 'weekly', labelEs: 'Semanal', labelEn: 'Weekly', multiplier: 52 },
  { value: 'biweekly', labelEs: 'Quincenal', labelEn: 'Bi-weekly', multiplier: 26 },
  { value: 'monthly', labelEs: 'Mensual', labelEn: 'Monthly', multiplier: 12 },
  { value: 'quarterly', labelEs: 'Trimestral', labelEn: 'Quarterly', multiplier: 4 },
  { value: 'annual', labelEs: 'Anual', labelEn: 'Annual', multiplier: 1 },
]

const CATEGORIES = [
  { value: 'savings', labelEs: 'Ahorro', labelEn: 'Savings', icon: '💰', color: 'var(--accent-green)' },
  { value: 'investment', labelEs: 'Inversión', labelEn: 'Investment', icon: '📈', color: 'var(--accent-blue)' },
  { value: 'income', labelEs: 'Ingreso', labelEn: 'Income', icon: '💵', color: 'var(--accent-green)' },
  { value: 'expense', labelEs: 'Gasto', labelEn: 'Expense', icon: '💸', color: 'var(--text-negative)' },
  { value: 'debt', labelEs: 'Pago deuda', labelEn: 'Debt payment', icon: '🏦', color: 'var(--accent-orange)' },
]

export default function RecurringTransactions({ goals, onSaveGoals, lang }) {
  const [showForm, setShowForm] = useState(false)
  const [editIdx, setEditIdx] = useState(null)
  const [form, setForm] = useState({
    name: '', amount: '', frequency: 'monthly', category: 'savings', currency: 'USD', isInflow: true,
  })

  const t = (es, en) => lang === 'es' ? es : en

  const recurring = useMemo(() => goals?.recurringTransactions || [], [goals])

  const summary = useMemo(() => {
    let monthlyIn = 0
    let monthlyOut = 0
    recurring.forEach((r) => {
      const freq = FREQUENCIES.find((f) => f.value === r.frequency)
      const monthly = (r.amount * (freq?.multiplier || 12)) / 12
      if (r.isInflow) monthlyIn += monthly
      else monthlyOut += monthly
    })
    return { monthlyIn, monthlyOut, net: monthlyIn - monthlyOut, annualNet: (monthlyIn - monthlyOut) * 12 }
  }, [recurring])

  const handleSave = () => {
    const amount = parseAmount(form.amount)
    if (!form.name.trim() || isNaN(amount) || amount <= 0) return

    const entry = {
      name: form.name.trim(),
      amount,
      frequency: form.frequency,
      category: form.category,
      currency: form.currency,
      isInflow: form.isInflow,
    }

    const updated = [...recurring]
    if (editIdx != null) {
      updated[editIdx] = entry
    } else {
      updated.push(entry)
    }
    onSaveGoals({ ...goals, recurringTransactions: updated })
    setShowForm(false)
    setEditIdx(null)
    setForm({ name: '', amount: '', frequency: 'monthly', category: 'savings', currency: 'USD', isInflow: true })
  }

  const handleDelete = (idx) => {
    const updated = recurring.filter((_, i) => i !== idx)
    onSaveGoals({ ...goals, recurringTransactions: updated })
  }

  const handleEdit = (idx) => {
    const r = recurring[idx]
    setForm({ name: r.name, amount: r.amount.toString(), frequency: r.frequency, category: r.category, currency: r.currency || 'USD', isInflow: r.isInflow })
    setEditIdx(idx)
    setShowForm(true)
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          🔄 {t('Transacciones Recurrentes', 'Recurring Transactions')}
        </h3>
        <button
          onClick={() => { setShowForm(!showForm); setEditIdx(null); setForm({ name: '', amount: '', frequency: 'monthly', category: 'savings', currency: 'USD', isInflow: true }) }}
          className="text-xs" style={{ color: 'var(--accent-blue)' }}
        >
          {showForm ? t('Cancelar', 'Cancel') : `+ ${t('Agregar', 'Add')}`}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-3 bg-theme-base rounded-lg border border-glass-border/50 space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setForm({ ...form, isInflow: true })}
              className="flex-1 py-1.5 text-xs rounded-lg border transition-colors"
              style={form.isInflow ? { backgroundColor: 'color-mix(in srgb, var(--accent-green) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-green) 30%, transparent)', color: 'var(--accent-green)' } : { borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}
            >
              ↓ {t('Ingreso', 'Inflow')}
            </button>
            <button
              onClick={() => setForm({ ...form, isInflow: false })}
              className="flex-1 py-1.5 text-xs rounded-lg border transition-colors"
              style={!form.isInflow ? { backgroundColor: 'color-mix(in srgb, var(--text-negative) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--text-negative) 30%, transparent)', color: 'var(--text-negative)' } : { borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}
            >
              ↑ {t('Gasto', 'Outflow')}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('Nombre', 'Name')}
              className="px-3 py-2 bg-theme-card border border-glass-border rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none input-focus" />
            <AmountInput value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder={t('Monto', 'Amount')}
              className="px-3 py-2 bg-theme-card border border-glass-border rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none input-focus" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              className="px-3 py-2 bg-theme-card border border-glass-border rounded-lg text-xs text-white focus:outline-none input-focus">
              {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{lang === 'es' ? f.labelEs : f.labelEn}</option>)}
            </select>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="px-3 py-2 bg-theme-card border border-glass-border rounded-lg text-xs text-white focus:outline-none input-focus">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.icon} {lang === 'es' ? c.labelEs : c.labelEn}</option>)}
            </select>
          </div>
          <button onClick={handleSave}
            className="w-full py-2 text-white rounded-lg text-xs font-medium transition-colors" style={{ backgroundColor: 'var(--accent-blue)' }}>
            {editIdx != null ? t('Guardar cambios', 'Save changes') : t('Agregar', 'Add')}
          </button>
        </div>
      )}

      {recurring.length > 0 && (
        <>
          <div className="space-y-1.5 mb-4">
            {recurring.map((r, i) => {
              const cat = CATEGORIES.find((c) => c.value === r.category) || CATEGORIES[0]
              const freq = FREQUENCIES.find((f) => f.value === r.frequency)
              const freqLabel = lang === 'es' ? freq?.labelEs : freq?.labelEn
              return (
                <div key={i} className="flex items-center gap-2 py-1.5 group">
                  <span className="text-sm">{cat.icon}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-white truncate block">{r.name}</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{freqLabel}</span>
                  </div>
                  <span className="text-xs font-medium" style={{ color: r.isInflow ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                    {r.isInflow ? '+' : '-'}{formatCurrency(r.amount)}
                  </span>
                  <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                    <button onClick={() => handleEdit(i)} className="hover:text-white text-xs" style={{ color: 'var(--text-muted)' }}>✏️</button>
                    <button onClick={() => handleDelete(i)} className="text-xs" style={{ color: 'var(--text-muted)' }}>×</button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="pt-3 border-t border-glass-border/30 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-muted)' }}>{t('Ingresos mensuales', 'Monthly inflows')}</span>
              <span className="font-medium" style={{ color: 'var(--accent-green)' }}>+{formatCurrency(summary.monthlyIn)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-muted)' }}>{t('Gastos mensuales', 'Monthly outflows')}</span>
              <span className="font-medium" style={{ color: 'var(--text-negative)' }}>-{formatCurrency(summary.monthlyOut)}</span>
            </div>
            <div className="flex justify-between text-xs font-medium pt-1 border-t border-glass-border/20">
              <span style={{ color: 'var(--text-secondary)' }}>{t('Flujo neto mensual', 'Net monthly flow')}</span>
              <span style={{ color: summary.net >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                {summary.net >= 0 ? '+' : ''}{formatCurrency(summary.net)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-muted)' }}>{t('Proyección anual', 'Annual projection')}</span>
              <span style={{ color: summary.annualNet >= 0 ? 'color-mix(in srgb, var(--accent-green) 60%, transparent)' : 'color-mix(in srgb, var(--text-negative) 60%, transparent)' }}>
                {summary.annualNet >= 0 ? '+' : ''}{formatCurrency(summary.annualNet)}/yr
              </span>
            </div>
          </div>
        </>
      )}

      {recurring.length === 0 && !showForm && (
        <div className="text-center py-6 text-xs" style={{ color: 'var(--text-muted)' }}>
          <div className="text-2xl mb-2">🔄</div>
          {t('Registra depósitos, aportes y gastos recurrentes', 'Track recurring deposits, contributions and expenses')}
        </div>
      )}
    </div>
  )
}
