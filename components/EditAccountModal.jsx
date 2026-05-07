'use client'

import { useState, useEffect } from 'react'

const CURRENCIES = ['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY']
const ACCOUNT_TYPES = [
  { key: 'taxable', es: 'Tributaria', en: 'Taxable' },
  { key: 'retirement', es: 'Retiro', en: 'Retirement' },
  { key: 'tax-free', es: 'Libre', en: 'Tax-free' },
]

export default function EditAccountModal({ item, onClose, onSave, onDelete, existingItems = [], lang = 'es' }) {
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
    accountType: item.accountType || 'taxable',
    dividendAction: item.dividendAction || 'cash',
    incomeMode: item.incomeMode || 'fixed',
    incomeAmount: item.incomeAmount?.toString() || '',
    incomeRate: item.incomeRate?.toString() || '',
    incomePayDay: item.incomePayDay?.toString() || '',
    incomeMonths: item.incomeMonths || [],
    incomeDestination: item.incomeDestination || '',
    capitalReturn: item.capitalReturn?.toString() || '',
    capitalDestination: item.capitalDestination || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showIncome, setShowIncome] = useState(
    !!(item.incomeAmount || item.incomeRate || item.dividendYield || item.incomeMonths?.length)
  )

  const t = (es, en) => lang === 'es' ? es : en
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const isMarket = /stock|crypto|fund|etf/i.test(form.type)
  const isBank = /bank|banco/i.test(form.type)
  const hasIncome = !isMarket

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

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
        accountType: form.accountType,
      }

      if (form.currentPrice && !isMarket) updated.currentPrice = parseFloat(form.currentPrice) || 0
      if (isBank) updated.currentPrice = parseFloat(form.purchasePrice) || 0

      // Dividend settings (market assets)
      if (isMarket) {
        updated.dividendAction = form.dividendAction
        if (form.incomeDestination) updated.incomeDestination = form.incomeDestination
      }

      // Income settings (non-market assets)
      if (hasIncome && showIncome) {
        updated.incomeMode = form.incomeMode
        if (form.incomeMode === 'percent') {
          updated.incomeRate = parseFloat(form.incomeRate) || 0
        } else {
          updated.incomeAmount = parseFloat(form.incomeAmount) || 0
        }
        updated.incomePayDay = parseInt(form.incomePayDay) || 1
        updated.incomeMonths = form.incomeMonths.length > 0 ? form.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
        if (form.incomeDestination) updated.incomeDestination = form.incomeDestination
        if (form.capitalReturn) {
          updated.capitalReturn = parseFloat(form.capitalReturn) || 0
          if (form.capitalDestination) updated.capitalDestination = form.capitalDestination
        }
      }

      await onSave(updated)
      onClose()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      await onDelete(item.id)
      onClose()
    } catch (err) { setError(err.message) }
  }

  // Check if other items reference this one
  const referencedBy = existingItems.filter(it =>
    it.id !== item.id && (it.incomeDestination === item.id || it.capitalDestination === item.id)
  )

  const inputCls = 'w-full px-3 py-2 bg-[var(--input-bg,#0f172a)] border border-[var(--card-border,#334155)] rounded-lg text-sm text-[var(--text-primary,white)] focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#334155)]">
          <h2 className="text-lg font-bold text-[var(--text-primary,white)]">{t('Editar', 'Edit')} {item.name || item.symbol}</h2>
          <button onClick={onClose} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          {/* Sector badge */}
          {item.sector && (
            <div className="flex gap-2 flex-wrap">
              <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">{item.sector}</span>
              {item.industry && <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded">{item.industry}</span>}
              {item.exchangeName && <span className="text-xs bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] px-2 py-0.5 rounded">{item.exchangeName}</span>}
            </div>
          )}

          {/* Section 1: Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('Nombre', 'Name')}</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('Institución', 'Institution')}</label>
              <input value={form.institution} onChange={e => set('institution', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>{t('Tipo', 'Type')}</label>
              <select value={form.type} onChange={e => set('type', e.target.value)} className={inputCls}>
                <option value="Stock">Stock</option>
                <option value="Crypto">Crypto</option>
                <option value="Fund">{t('Fondo/ETF', 'Fund/ETF')}</option>
                <option value="Inmueble">{t('Inmueble', 'Real Estate')}</option>
                <option value="Bank">{t('Banco', 'Bank')}</option>
                <option value="Inversion">{t('Inversión', 'Investment')}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('Moneda', 'Currency')}</label>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} className={inputCls}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('Cuenta', 'Account')}</label>
              <select value={form.accountType} onChange={e => set('accountType', e.target.value)} className={inputCls}>
                {ACCOUNT_TYPES.map(at => <option key={at.key} value={at.key}>{lang === 'es' ? at.es : at.en}</option>)}
              </select>
            </div>
          </div>

          {/* Section 2: Position */}
          {isBank ? (
            <div>
              <label className={labelCls}>{t('Saldo actual', 'Current balance')}</label>
              <input value={form.purchasePrice} onChange={e => { set('purchasePrice', e.target.value); set('quantity', '1') }}
                type="number" step="any" className={inputCls} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('Cantidad', 'Quantity')}</label>
                <input value={form.quantity} onChange={e => set('quantity', e.target.value)}
                  type="number" step="any" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{isMarket ? t('Precio compra', 'Buy price') : t('Valor compra', 'Purchase value')}</label>
                <input value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                  type="number" step="any" className={inputCls} />
              </div>
            </div>
          )}

          {!isMarket && !isBank && (
            <div>
              <label className={labelCls}>{t('Valor actual', 'Current value')}</label>
              <input value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                type="number" step="any" placeholder={t('Dejar vacío = precio de compra', 'Empty = purchase price')}
                className={inputCls} />
            </div>
          )}

          <div>
            <label className={labelCls}>{t('Fecha de adquisición', 'Acquisition date')}</label>
            <input value={form.acquisitionDate} onChange={e => set('acquisitionDate', e.target.value)}
              type="date" className={inputCls} />
          </div>

          {/* Section 3: Income/Dividends */}
          {isMarket && item.dividendYield > 0 && (
            <div className="border border-blue-500/20 bg-blue-500/5 rounded-lg p-3 space-y-2">
              <p className="text-xs text-emerald-400 font-medium">💰 {t('Dividendo', 'Dividend')} — {item.dividendYield}% {item.incomeFrequency || ''}</p>
              <div>
                <p className="text-xs text-[var(--text-muted,#475569)] mb-1">{t('Acción con dividendos:', 'Dividend action:')}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => set('dividendAction', 'cash')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.dividendAction === 'cash' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                    💵 {t('Efectivo', 'Cash')}
                  </button>
                  <button type="button" onClick={() => set('dividendAction', 'reinvest')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.dividendAction === 'reinvest' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                    🔄 {t('Reinvertir', 'Reinvest')}
                  </button>
                </div>
              </div>
              {form.dividendAction === 'cash' && existingItems.length > 0 && (
                <div>
                  <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Dividendos van a:', 'Dividends go to:')}</label>
                  <select value={form.incomeDestination} onChange={e => set('incomeDestination', e.target.value)} className={inputCls}>
                    <option value="">{t('Auto (cash del broker)', 'Auto (broker cash)')}</option>
                    {existingItems.filter(it => it.id !== item.id).map(it => (
                      <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {hasIncome && (
            <button type="button" onClick={() => setShowIncome(!showIncome)}
              className="w-full text-left px-3 py-2 border border-[var(--card-border,#334155)] rounded-lg text-xs text-[var(--text-secondary,#94a3b8)] hover:border-blue-500/30 transition-colors flex items-center justify-between">
              <span>💰 {t('Configurar rendimiento', 'Configure yield')}</span>
              <span className="text-lg">{showIncome ? '−' : '+'}</span>
            </button>
          )}

          {showIncome && hasIncome && (
            <div className="border border-[var(--card-border,#334155)] rounded-lg p-3 space-y-3">
              <div className="flex gap-1 mb-2">
                <button type="button" onClick={() => set('incomeMode', 'fixed')}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.incomeMode === 'fixed' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                  {t('Monto fijo', 'Fixed amount')}
                </button>
                <button type="button" onClick={() => set('incomeMode', 'percent')}
                  className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.incomeMode === 'percent' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                  {t('% del saldo', '% of balance')}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  {form.incomeMode === 'fixed' ? (<>
                    <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Monto por pago', 'Per payment')}</label>
                    <input value={form.incomeAmount} onChange={e => set('incomeAmount', e.target.value)}
                      type="number" step="any" className={inputCls} />
                  </>) : (<>
                    <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa anual %', 'Annual rate %')}</label>
                    <input value={form.incomeRate} onChange={e => set('incomeRate', e.target.value)}
                      type="number" step="any" className={inputCls} />
                  </>)}
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Día de pago', 'Pay day')}</label>
                  <input value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                    type="number" min="1" max="31" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted,#475569)] mb-1.5 block">{t('Meses de pago', 'Payment months')}</label>
                <div className="flex flex-wrap gap-1">
                  {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((label, i) => {
                    const active = form.incomeMonths.includes(i)
                    return (
                      <button key={i} type="button"
                        onClick={() => set('incomeMonths', active ? form.incomeMonths.filter(x => x !== i) : [...form.incomeMonths, i].sort((a, b) => a - b))}
                        className={`px-2 py-1 text-xs font-medium rounded transition-all ${active ? 'bg-blue-500/25 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {existingItems.length > 0 && (
                <div>
                  <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Pagos van a:', 'Payments go to:')}</label>
                  <select value={form.incomeDestination} onChange={e => set('incomeDestination', e.target.value)} className={inputCls}>
                    <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                    {existingItems.filter(it => it.id !== item.id).map(it => (
                      <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Capital devuelto por pago', 'Capital returned per payment')}</label>
                <input value={form.capitalReturn} onChange={e => set('capitalReturn', e.target.value)}
                  placeholder="0" type="number" step="any" className={inputCls} />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={handleDelete}
              className={`px-4 py-2.5 text-xs font-medium rounded-lg transition-colors ${
                confirmDelete ? 'bg-red-600 text-white' : 'border border-red-500/30 text-red-400 hover:bg-red-500/10'
              }`}>
              {confirmDelete ? t('Confirmar', 'Confirm') : t('Eliminar', 'Delete')}
            </button>
            <div className="flex-1" />
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 border border-[var(--card-border,#334155)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-[var(--input-bg,#283548)] transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
              {saving ? '...' : t('Guardar', 'Save')}
            </button>
          </div>

          {/* Delete warning */}
          {confirmDelete && referencedBy.length > 0 && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400">
              {t('Estos activos reciben pagos de este activo y serán desvinculados:', 'These assets receive payments from this asset and will be unlinked:')}
              <ul className="mt-1 space-y-0.5">
                {referencedBy.map(it => <li key={it.id}>• {it.name || it.symbol}</li>)}
              </ul>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
