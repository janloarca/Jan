'use client'

import { useState, useEffect } from 'react'
import { FINANCE_CATEGORIES } from '@/lib/financeCategories'

export default function AddFinanceTransactionModal({ onClose, onAdd, lang = 'es' }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [form, setForm] = useState({
    type: 'EXPENSE',
    amount: '',
    category: 'Otros Gastos',
    description: '',
    date: new Date().toISOString().split('T')[0],
    currency: 'GTQ',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const categories = form.type === 'INCOME' ? FINANCE_CATEGORIES.INCOME : FINANCE_CATEGORIES.EXPENSE

  useEffect(() => {
    setForm(f => ({
      ...f,
      category: f.type === 'INCOME' ? 'Otros Ingresos' : 'Otros Gastos',
    }))
  }, [form.type])

  const handleSubmit = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) return
    setSaving(true)
    await onAdd({
      type: form.type,
      amount: parseFloat(form.amount),
      category: form.category,
      description: form.description,
      date: form.date,
      currency: form.currency,
      source: 'manual',
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-finance-tx-title">
      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl shadow-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#38383A]">
          <h2 id="add-finance-tx-title" className="text-lg font-bold text-white">{t('Agregar Transacción', 'Add Transaction')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex bg-[#000000] rounded-lg border border-[#38383A]">
            {['EXPENSE', 'INCOME'].map(type => (
              <button key={type} onClick={() => setForm({ ...form, type })}
                className="flex-1 py-2.5 text-sm font-medium transition-colors rounded-lg"
                style={form.type === type
                  ? { backgroundColor: type === 'INCOME' ? '#059669' : '#dc2626', color: '#ffffff' }
                  : { color: '#94a3b8' }
                }>
                {type === 'INCOME' ? t('Ingreso', 'Income') : t('Gasto', 'Expense')}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Monto', 'Amount')} *</label>
            <input type="number" step="0.01" value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Categoría', 'Category')}</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
              className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Descripción', 'Description')}</label>
            <input type="text" value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder={t('Descripción opcional', 'Optional description')}
              className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Fecha', 'Date')}</label>
              <input type="date" value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
              <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                <option value="GTQ">GTQ</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <button onClick={handleSubmit} disabled={saving || !form.amount}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
            {saving ? t('Guardando...', 'Saving...') : t('Agregar', 'Add')}
          </button>
        </div>
      </div>
    </div>
  )
}
