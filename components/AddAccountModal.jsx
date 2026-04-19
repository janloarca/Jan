'use client'

import { useState } from 'react'

export default function AddAccountModal({ onClose, onAdd, lang = 'es' }) {
  const [form, setForm] = useState({
    symbol: '', name: '', type: 'Stock', quantity: '', purchasePrice: '', institution: '', currency: 'USD',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const t = (es, en) => lang === 'es' ? es : en

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.symbol && !form.name) {
      setError(t('Ingresa al menos el símbolo o nombre.', 'Enter at least symbol or name.'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await onAdd({
        symbol: form.symbol.trim(),
        name: form.name.trim(),
        type: form.type,
        quantity: parseFloat(form.quantity) || 0,
        purchasePrice: parseFloat(form.purchasePrice) || 0,
        institution: form.institution.trim(),
        currency: form.currency,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const set = (k, v) => setForm({ ...form, [k]: v })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45]">
          <h2 className="text-lg font-bold text-white">{t('Nueva Cuenta', 'New Account')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Símbolo', 'Symbol')} *</label>
              <input value={form.symbol} onChange={(e) => set('symbol', e.target.value)}
                placeholder="AAPL" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Nombre', 'Name')}</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="Apple Inc" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Tipo', 'Type')}</label>
              <select value={form.type} onChange={(e) => set('type', e.target.value)}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50">
                <option value="Stock">Stock</option>
                <option value="Crypto">Crypto</option>
                <option value="Bond">{t('Bono/Instrumento', 'Bond')}</option>
                <option value="Fund">{t('Fondo/ETF', 'Fund/ETF')}</option>
                <option value="Bank">{t('Banco/Cash', 'Bank/Cash')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Institución', 'Institution')}</label>
              <input value={form.institution} onChange={(e) => set('institution', e.target.value)}
                placeholder="IBKR" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Cantidad', 'Quantity')} *</label>
              <input value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
                placeholder="10" type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Precio unitario', 'Unit price')} *</label>
              <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                placeholder="150.00" type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50">
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="MXN">MXN</option>
                <option value="GTQ">GTQ</option>
                <option value="COP">COP</option>
                <option value="CLP">CLP</option>
                <option value="ARS">ARS</option>
                <option value="BRL">BRL</option>
                <option value="PEN">PEN</option>
                <option value="CAD">CAD</option>
                <option value="CHF">CHF</option>
                <option value="JPY">JPY</option>
                <option value="CNY">CNY</option>
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-[#1e2d45] text-slate-300 rounded-lg hover:bg-[#1a2540] transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors text-sm font-medium">
              {saving ? '...' : t('Agregar', 'Add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
