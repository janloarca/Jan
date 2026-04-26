'use client'

import { useState } from 'react'

export default function AddTransactionModal({ onClose, onAdd, lang = 'es' }) {
  const [form, setForm] = useState({
    type: 'BUY', symbol: '', description: '', date: new Date().toISOString().split('T')[0],
    quantity: '', pricePerUnit: '', totalAmount: '', currency: 'USD',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const t = (es, en) => lang === 'es' ? es : en

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
    { value: 'BUY', label: t('Compra', 'Buy'), color: 'text-emerald-400' },
    { value: 'SELL', label: t('Venta', 'Sell'), color: 'text-red-400' },
    { value: 'DIVIDEND', label: t('Dividendo', 'Dividend'), color: 'text-emerald-300' },
    { value: 'DEPOSIT', label: t('Depósito', 'Deposit'), color: 'text-blue-400' },
    { value: 'WITHDRAWAL', label: t('Retiro', 'Withdrawal'), color: 'text-amber-400' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45]">
          <h2 className="text-lg font-bold text-white">{t('Registrar Transacción', 'Record Transaction')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          {/* Type pills */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block">{t('Tipo', 'Type')}</label>
            <div className="flex flex-wrap gap-2">
              {typeOptions.map((opt) => (
                <button key={opt.value} type="button" onClick={() => set('type', opt.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    form.type === opt.value
                      ? `bg-blue-500/20 ${opt.color} border border-blue-500/30`
                      : 'text-slate-400 border border-[#1e2d45] hover:bg-[#1a2540]'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Símbolo', 'Symbol')}</label>
              <input value={form.symbol} onChange={(e) => set('symbol', e.target.value)}
                placeholder="AAPL" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Fecha', 'Date')}</label>
              <input value={form.date} onChange={(e) => set('date', e.target.value)}
                type="date" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Descripción', 'Description')}</label>
            <input value={form.description} onChange={(e) => set('description', e.target.value)}
              placeholder={t('Compra de acciones...', 'Stock purchase...')}
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
          </div>

          {form.type === 'DIVIDEND' || form.type === 'DEPOSIT' || form.type === 'WITHDRAWAL' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Monto', 'Amount')}</label>
                <input value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)}
                  placeholder="500" type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
                <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-2 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
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
                  placeholder="10" type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Precio', 'Price')}</label>
                <input value={form.pricePerUnit} onChange={(e) => set('pricePerUnit', e.target.value)}
                  placeholder="150" type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Total</label>
                <input value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)}
                  placeholder={form.quantity && form.pricePerUnit ? (parseFloat(form.quantity) * parseFloat(form.pricePerUnit)).toFixed(2) : '1500'}
                  type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
                <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-2 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                  {['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-[#1e2d45] text-slate-300 rounded-lg hover:bg-[#1a2540] transition-colors text-sm">
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
