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
    { value: 'DIVIDEND', label: t('Dividendo', 'Dividend'), color: 'var(--accent-green)' },
    { value: 'DEPOSIT', label: t('Depósito', 'Deposit'), color: 'var(--accent-blue)' },
    { value: 'WITHDRAWAL', label: t('Retiro', 'Withdrawal'), color: 'var(--accent-orange)' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-tx-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="bg-theme-card border border-glass-border rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="add-tx-modal-title" className="text-lg font-bold text-white">{t('Registrar Transacción', 'Record Transaction')}</h2>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close add transaction modal">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {error && <div role="alert" aria-live="assertive" className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--text-negative) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--text-negative) 20%, transparent)', color: 'var(--text-negative)' }}>{error}</div>}

          {/* Type pills */}
          <div>
            <label className="text-xs mb-2 block" style={{ color: 'var(--text-secondary)' }}>{t('Tipo', 'Type')}</label>
            <div className="flex flex-wrap gap-2">
              {typeOptions.map((opt) => (
                <button key={opt.value} type="button" onClick={() => set('type', opt.value)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border"
                  style={form.type === opt.value
                    ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', color: opt.color, borderColor: 'color-mix(in srgb, var(--accent-blue) 30%, transparent)' }
                    : { color: 'var(--text-muted)', borderColor: 'var(--card-border)' }
                  }>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="tx-symbol" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Símbolo', 'Symbol')}</label>
              <input id="tx-symbol" value={form.symbol} onChange={(e) => set('symbol', e.target.value)}
                placeholder="AAPL" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none input-focus" />
            </div>
            <div>
              <label htmlFor="tx-date" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Fecha', 'Date')}</label>
              <input id="tx-date" value={form.date} onChange={(e) => set('date', e.target.value)}
                type="date" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none input-focus" />
            </div>
          </div>

          <div>
            <label htmlFor="tx-description" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Descripción', 'Description')}</label>
            <input id="tx-description" value={form.description} onChange={(e) => set('description', e.target.value)}
              placeholder={t('Compra de acciones...', 'Stock purchase...')}
              className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none input-focus" />
          </div>

          {form.type === 'DIVIDEND' || form.type === 'DEPOSIT' || form.type === 'WITHDRAWAL' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="tx-amount" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Monto', 'Amount')}</label>
                <input id="tx-amount" value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)}
                  placeholder="500" type="number" step="any" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none input-focus" />
              </div>
              <div>
                <label htmlFor="tx-currency-1" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Moneda', 'Currency')}</label>
                <select id="tx-currency-1" value={form.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-2 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none input-focus">
                  {['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label htmlFor="tx-quantity" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Cantidad', 'Qty')}</label>
                <input id="tx-quantity" value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
                  placeholder="10" type="number" step="any" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none input-focus" />
              </div>
              <div>
                <label htmlFor="tx-price" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Precio', 'Price')}</label>
                <input id="tx-price" value={form.pricePerUnit} onChange={(e) => set('pricePerUnit', e.target.value)}
                  placeholder="150" type="number" step="any" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none input-focus" />
              </div>
              <div>
                <label htmlFor="tx-total" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Total</label>
                <input id="tx-total" value={form.totalAmount} onChange={(e) => set('totalAmount', e.target.value)}
                  placeholder={form.quantity && form.pricePerUnit ? (parseFloat(form.quantity) * parseFloat(form.pricePerUnit)).toFixed(2) : '1500'}
                  type="number" step="any" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none input-focus" />
              </div>
              <div>
                <label htmlFor="tx-currency-2" className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{t('Moneda', 'Currency')}</label>
                <select id="tx-currency-2" value={form.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-2 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none input-focus">
                  {['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-glass-border rounded-lg hover:bg-theme-elevated transition-colors text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 text-white rounded-lg disabled:opacity-50 transition-colors text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)' }}>
              {saving ? '...' : t('Registrar', 'Record')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
