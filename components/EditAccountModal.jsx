'use client'

import { useState } from 'react'

export default function EditAccountModal({ item, onClose, onSave, onDelete, lang = 'es' }) {
  const [form, setForm] = useState({
    symbol: item.symbol || '',
    name: item.name || '',
    type: item.type || 'Stock',
    quantity: item.quantity?.toString() || '',
    purchasePrice: item.purchasePrice?.toString() || '',
    currentPrice: item.currentPrice?.toString() || '',
    institution: item.institution || '',
    currency: item.currency || 'USD',
    acquisitionDate: item.acquisitionDate || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const t = (es, en) => lang === 'es' ? es : en
  const set = (k, v) => setForm({ ...form, [k]: v })

  const isMarket = /stock|crypto|fund|etf/i.test(form.type)
  const isBank = /bank|banco/i.test(form.type)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const updated = {
        ...item,
        symbol: form.symbol.trim(),
        name: form.name.trim(),
        type: form.type,
        quantity: parseFloat(form.quantity) || 0,
        purchasePrice: parseFloat(form.purchasePrice) || 0,
        institution: form.institution.trim(),
        currency: form.currency,
        acquisitionDate: form.acquisitionDate || '',
      }
      if (form.currentPrice && !isMarket) {
        updated.currentPrice = parseFloat(form.currentPrice) || 0
      }
      if (isBank) {
        updated.currentPrice = parseFloat(form.purchasePrice) || 0
      }
      await onSave(updated)
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      await onDelete(item.id)
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45]">
          <h2 className="text-lg font-bold text-white">{t('Editar Cuenta', 'Edit Account')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Símbolo', 'Symbol')}</label>
              <input value={form.symbol} onChange={(e) => set('symbol', e.target.value)}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Nombre', 'Name')}</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Tipo', 'Type')}</label>
              <select value={form.type} onChange={(e) => set('type', e.target.value)}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50">
                <option value="Stock">Stock</option>
                <option value="Crypto">Crypto</option>
                <option value="Fund">{t('Fondo/ETF', 'Fund/ETF')}</option>
                <option value="Inmueble">{t('Inmueble', 'Real Estate')}</option>
                <option value="Bank">{t('Banco/Cash', 'Bank/Cash')}</option>
                <option value="Inversion">{t('Inversión', 'Investment')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Institución', 'Institution')}</label>
              <input value={form.institution} onChange={(e) => set('institution', e.target.value)}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                {isBank ? t('Saldo', 'Balance') : t('Cantidad', 'Quantity')}
              </label>
              <input value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
                type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                {isBank ? t('Saldo', 'Balance') : t('Precio compra', 'Buy price')}
              </label>
              <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50">
                {['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {!isMarket && !isBank && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Valor actual', 'Current value')}</label>
              <input value={form.currentPrice} onChange={(e) => set('currentPrice', e.target.value)}
                type="number" step="any" placeholder={t('Dejar vacío para usar precio de compra', 'Leave empty to use purchase price')}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Fecha de adquisición', 'Acquisition date')}</label>
            <input value={form.acquisitionDate} onChange={(e) => set('acquisitionDate', e.target.value)}
              type="date"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleDelete}
              className={`px-4 py-2.5 text-xs font-medium rounded-lg transition-colors ${
                confirmDelete ? 'bg-red-600 text-white' : 'border border-red-500/30 text-red-400 hover:bg-red-500/10'
              }`}>
              {confirmDelete ? t('Confirmar', 'Confirm') : t('Eliminar', 'Delete')}
            </button>
            <div className="flex-1" />
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 border border-[#1e2d45] text-slate-300 rounded-lg hover:bg-[#1a2540] transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors text-sm font-medium">
              {saving ? '...' : t('Guardar', 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
