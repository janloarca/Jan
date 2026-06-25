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
  const [error, setError] = useState('')

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
    setError('')
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError(t('Ingresa un monto válido.', 'Enter a valid amount.'))
      return
    }
    if (!form.date || isNaN(new Date(form.date).getTime())) {
      setError(t('Selecciona una fecha válida.', 'Select a valid date.'))
      return
    }
    setSaving(true)
    const ok = await onAdd({
      type: form.type,
      amount: parseFloat(form.amount),
      category: form.category,
      description: form.description,
      date: form.date,
      currency: form.currency,
      source: 'manual',
    })
    setSaving(false)
    if (ok === false) {
      setError(t('No se pudo guardar. Revisa tu conexión e intenta de nuevo.', 'Could not save. Check your connection and try again.'))
      return
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-finance-tx-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div className="modal-glass max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="add-finance-tx-title" className="text-lg font-bold text-white">{t('Agregar Transacción', 'Add Transaction')}</h2>
          <button onClick={onClose} className="hover:text-white text-xl" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div role="alert" aria-live="assertive" className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--text-negative) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--text-negative) 20%, transparent)', color: 'var(--text-negative)' }}>
              {error}
            </div>
          )}
          <div className="flex bg-theme-base rounded-lg border border-glass-border">
            {['EXPENSE', 'INCOME'].map(type => (
              <button key={type} onClick={() => setForm({ ...form, type })}
                className="flex-1 py-2.5 text-sm font-medium transition-colors rounded-lg"
                style={form.type === type
                  ? { backgroundColor: type === 'INCOME' ? 'var(--accent-green)' : 'var(--text-negative)', color: '#ffffff' }
                  : { color: 'var(--text-secondary)' }
                }>
                {type === 'INCOME' ? t('Ingreso', 'Income') : t('Gasto', 'Expense')}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Monto', 'Amount')} *</label>
            <input type="number" step="0.01" value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none input-focus" />
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Categoría', 'Category')}</label>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
              className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none input-focus">
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Descripción', 'Description')}</label>
            <input type="text" value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder={t('Descripción opcional', 'Optional description')}
              className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none input-focus" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Fecha', 'Date')}</label>
              <input type="date" value={form.date}
                onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none input-focus" />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Moneda', 'Currency')}</label>
              <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none input-focus">
                <option value="GTQ">GTQ</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <button onClick={handleSubmit} disabled={saving || !form.amount}
            className="w-full py-2.5 text-white rounded-lg disabled:opacity-50 transition-colors text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)' }}>
            {saving ? t('Guardando...', 'Saving...') : t('Agregar', 'Add')}
          </button>
        </div>
      </div>
    </div>
  )
}
