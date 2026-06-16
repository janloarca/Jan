'use client'

import { useState, useEffect } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

export default function AddTransactionModal({ onClose, onAdd, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const [form, setForm] = useState({
    type: 'BUY', symbol: '', description: '', date: new Date().toISOString().split('T')[0],
    quantity: '', pricePerUnit: '', totalAmount: '', currency: 'USD',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.symbol && !form.description) {
      setError(t('Ingresa al menos el símbolo o descripción.', 'Enter at least symbol or description.'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const qty = parseFloat(form.quantity) || 0
      const price = parseFloat(form.pricePerUnit) || 0
      const total = parseFloat(form.totalAmount) || qty * price
      await onAdd({
        type: form.type,
        symbol: form.symbol.trim().toUpperCase(),
        description: form.description.trim(),
        date: form.date,
        quantity: qty,
        pricePerUnit: price,
        totalAmount: total,
        currency: form.currency,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const set = (k, v) => setForm({ ...form, [k]: v })

  const typeOptions = [
    { value: 'BUY', label: t('Compra', 'Buy'), color: 'var(--accent-green)' },
    { value: 'SELL', label: t('Venta', 'Sell'), color: 'var(--text-negative)' },
    { value: 'DIVIDEND', label: t('Dividendo', 'Dividend'), color: '#6ee7b7' },
    { value: 'DEPOSIT', label: t('Depósito', 'Deposit'), color: '#60a5fa' },
    { value: 'WITHDRAWAL', label: t('Retiro', 'Withdrawal'), color: '#fbbf24' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-tx-modal-title">
      <div ref={trapRef} className="bg-[#1C1C1E] border border-[#38383A] rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#38383A]">
          <h2 id="add-tx-modal-title" className="text-lg font-bold text-white">{t('Registrar Transacción', 'Record Transaction')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          {/* Type pills */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block">{t('Tipo', 'Type')}</label>
            <div className="flex flex-wrap gap-2">
              {typeOptions.map((opt) => (
                <button key={opt.value} type="button" onClick={() => set('type', opt.value)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border"
                  style={form.type === opt.value
                    ? { backgroundColor: 'rgba(59,130,246,0.2)', color: opt.color, borderColor: 'rgba(59,130,246,0.3)' }
                    : { color: '#94a3b8', borderColor: '#38383A' }
                  }>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Símbolo', 'Symbol')}</label>
              <input value={form.symbol} onChange={(e) => set('symbol', e.target.value)}
                placeholder="AAPL" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Fecha', 'Date')}</label>
              <input value={form.date} onChange={(e) => set('date', e.target.value)}
                type="date" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Descripción', 'Description')}</label>
            <input value={form.description} onChange={(e) => set('description', e.target.value)}
              placeholder={t('Compra de acciones...', 'Stock purchase...')}
              className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
          </div>

          {form.type === 'DIVIDEND' || form.type === 'DEPOSIT' || form.type === 'WITHDRAWAL' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Monto', 'Amount')}</label>
                <input value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)}
                  placeholder="500" type="number" step="any" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
                <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-2 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                  {['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Cantidad', 'Qty')}</label>
                <input value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
                  placeholder="10" type="number" step="any" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Precio', 'Price')}</label>
                <input value={form.pricePerUnit} onChange={(e) => set('pricePerUnit', e.target.value)}
                  placeholder="150" type="number" step="any" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Total</label>
                <input value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)}
                  placeholder={form.quantity && form.pricePerUnit ? (parseFloat(form.quantity) * parseFloat(form.pricePerUnit)).toFixed(2) : '1500'}
                  type="number" step="any" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
                <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-2 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                  {['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-[#38383A] text-slate-300 rounded-lg hover:bg-[#2C2C2E] transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
              {saving ? '...' : t('Registrar', 'Record')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
