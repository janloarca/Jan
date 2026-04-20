'use client'

import { useState } from 'react'

const CURRENCIES = ['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY']

const TYPES = [
  { key: 'Stock', icon: '📈', es: 'Acción', en: 'Stock' },
  { key: 'Crypto', icon: '₿', es: 'Crypto', en: 'Crypto' },
  { key: 'Fund', icon: '💼', es: 'Fondo/ETF', en: 'Fund/ETF' },
  { key: 'Inmueble', icon: '🏠', es: 'Inmueble', en: 'Real Estate' },
  { key: 'Bank', icon: '🏦', es: 'Banco', en: 'Bank' },
  { key: 'Inversion', icon: '🏛', es: 'Inversión', en: 'Investment' },
]

export default function AddAccountModal({ onClose, onAdd, existingItems = [], lang = 'es' }) {
  const [type, setType] = useState('Stock')
  const [form, setForm] = useState({
    symbol: '', name: '', quantity: '', purchasePrice: '', currentPrice: '',
    institution: '', currency: 'USD', acquisitionDate: '',
    incomeAmount: '', incomePayDay: '', incomeMonths: [],
    capitalReturn: '', incomeDestination: '', capitalDestination: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const t = (es, en) => lang === 'es' ? es : en
  const set = (k, v) => setForm({ ...form, [k]: v })

  const isMarketAsset = type === 'Stock' || type === 'Crypto' || type === 'Fund'
  const isProperty = type === 'Inmueble'
  const isBank = type === 'Bank'
  const hasIncome = !isMarketAsset

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (isMarketAsset && !form.symbol) {
      setError(t('Ingresa el símbolo (ej: AAPL, BTC, VOO)', 'Enter the symbol (e.g. AAPL, BTC, VOO)'))
      return
    }
    if (!isMarketAsset && !form.name) {
      setError(t('Ingresa el nombre del activo', 'Enter the asset name'))
      return
    }

    setSaving(true)
    try {
      const item = {
        type,
        currency: form.currency,
        institution: form.institution.trim(),
      }

      if (form.acquisitionDate) item.acquisitionDate = form.acquisitionDate

      if (isMarketAsset) {
        item.symbol = form.symbol.trim().toUpperCase()
        item.name = form.name.trim() || item.symbol
        item.quantity = parseFloat(form.quantity) || 0
        item.purchasePrice = parseFloat(form.purchasePrice) || 0
      } else if (isProperty) {
        item.symbol = form.symbol.trim() || form.name.trim().replace(/\s+/g, '-').toUpperCase().slice(0, 12)
        item.name = form.name.trim()
        item.quantity = 1
        item.purchasePrice = parseFloat(form.purchasePrice) || 0
        if (form.currentPrice) item.currentPrice = parseFloat(form.currentPrice)
      } else if (isBank) {
        item.symbol = form.symbol.trim() || form.institution.trim().replace(/\s+/g, '-').toUpperCase().slice(0, 8)
        item.name = form.name.trim() || `${form.institution.trim()} - ${t('Cuenta', 'Account')}`
        item.quantity = 1
        item.purchasePrice = parseFloat(form.purchasePrice) || 0
        item.currentPrice = parseFloat(form.purchasePrice) || 0
      } else {
        item.symbol = form.symbol.trim() || form.name.trim().replace(/\s+/g, '-').toUpperCase().slice(0, 12)
        item.name = form.name.trim()
        item.quantity = parseFloat(form.quantity) || 1
        item.purchasePrice = parseFloat(form.purchasePrice) || 0
        if (form.currentPrice) item.currentPrice = parseFloat(form.currentPrice)
      }

      if (hasIncome && form.incomeAmount) {
        item.incomeAmount = parseFloat(form.incomeAmount) || 0
        item.incomePayDay = parseInt(form.incomePayDay) || 1
        item.incomeMonths = form.incomeMonths.length > 0 ? form.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
        if (form.incomeDestination) item.incomeDestination = form.incomeDestination
        if (form.capitalReturn) {
          item.capitalReturn = parseFloat(form.capitalReturn) || 0
          if (form.capitalDestination) item.capitalDestination = form.capitalDestination
        }
      }

      await onAdd(item)
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45]">
          <h2 className="text-lg font-bold text-white">{t('Agregar Activo', 'Add Asset')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          {/* Type selector */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Tipo de activo', 'Asset type')}</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((tp) => (
                <button key={tp.key} type="button" onClick={() => setType(tp.key)}
                  className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg transition-all text-center ${
                    type === tp.key
                      ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                      : 'bg-[#0b1120] border border-[#1e2d45] text-slate-400 hover:border-slate-500'
                  }`}>
                  <span className="text-lg">{tp.icon}</span>
                  <span className="text-[10px] font-medium">{lang === 'es' ? tp.es : tp.en}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Market assets: Symbol + Name */}
          {isMarketAsset && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  {t('Símbolo', 'Symbol')} *
                  <span className="text-slate-600 ml-1">
                    {type === 'Stock' ? '(AAPL, MSFT)' : type === 'Crypto' ? '(BTC, ETH)' : '(VOO, VTI)'}
                  </span>
                </label>
                <input value={form.symbol} onChange={(e) => set('symbol', e.target.value)}
                  placeholder={type === 'Stock' ? 'AAPL' : type === 'Crypto' ? 'BTC-USD' : 'VOO'}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Nombre', 'Name')}</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder={type === 'Stock' ? 'Apple Inc' : type === 'Crypto' ? 'Bitcoin' : 'Vanguard S&P 500'}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
            </div>
          )}

          {/* Market assets: Qty + Purchase Price */}
          {isMarketAsset && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Cantidad', 'Quantity')} *</label>
                <input value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
                  placeholder={type === 'Crypto' ? '0.5' : '10'} type="number" step="any"
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Precio de entrada', 'Entry price')} *</label>
                <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                  placeholder="150.00" type="number" step="any"
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
            </div>
          )}
          {isMarketAsset && (
            <p className="text-[10px] text-slate-600 -mt-2">
              {t('El precio actual se actualiza automáticamente del mercado.', 'Current price updates automatically from market data.')}
            </p>
          )}

          {/* Real estate */}
          {isProperty && (
            <>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Nombre / Descripción', 'Name / Description')} *</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder={t('Apartamento Centro Zona 10', 'Downtown Apartment')}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Valor de compra', 'Purchase value')} *</label>
                  <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                    placeholder="85000" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Valor actual estimado', 'Est. current value')}</label>
                  <input value={form.currentPrice} onChange={(e) => set('currentPrice', e.target.value)}
                    placeholder="95000" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
              </div>
              <p className="text-[10px] text-slate-600 -mt-2">
                {t('Si no pones valor actual, se usa el valor de compra. Puedes editarlo después.', 'If blank, purchase value is used. You can edit it later.')}
              </p>
            </>
          )}

          {/* Bank account */}
          {isBank && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Banco', 'Bank')} *</label>
                  <input value={form.institution} onChange={(e) => set('institution', e.target.value)}
                    placeholder={t('BAM, BI, Banrural...', 'Chase, BoA...')}
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Nombre de cuenta', 'Account name')}</label>
                  <input value={form.name} onChange={(e) => set('name', e.target.value)}
                    placeholder={t('Cuenta de ahorro', 'Savings account')}
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Saldo actual', 'Current balance')} *</label>
                <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                  placeholder="5000" type="number" step="any"
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
              <p className="text-[10px] text-slate-600 -mt-2">
                {t('Puedes actualizar el saldo en cualquier momento editando la cuenta.', 'You can update the balance anytime by editing the account.')}
              </p>
            </>
          )}

          {/* Investment (bonds, CDs, etc) */}
          {type === 'Inversion' && (
            <>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Nombre', 'Name')} *</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder={t('CDT Banco Industrial', 'Certificate of Deposit')}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Monto invertido', 'Amount invested')} *</label>
                  <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                    placeholder="10000" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Valor actual', 'Current value')}</label>
                  <input value={form.currentPrice} onChange={(e) => set('currentPrice', e.target.value)}
                    placeholder="10800" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
              </div>
            </>
          )}

          {/* Institution (for non-bank types that don't already show it) */}
          {!isBank && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Institución', 'Institution')}</label>
                <input value={form.institution} onChange={(e) => set('institution', e.target.value)}
                  placeholder={isProperty ? t('N/A', 'N/A') : 'IBKR, Binance...'}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
                <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Currency for bank (separate since institution is already shown) */}
          {isBank && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
              <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* Income / Dividends for non-market assets */}
          {hasIncome && (
            <div className="border border-[#1e2d45] rounded-lg p-3 space-y-3">
              <label className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                💰 {isProperty ? t('Ingreso por renta', 'Rental income') : isBank ? t('Intereses', 'Interest') : t('Rendimiento / Dividendos', 'Yield / Dividends')}
                <span className="text-slate-600 font-normal">({t('opcional', 'optional')})</span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">{t('Intereses por pago', 'Interest per payment')}</label>
                  <input value={form.incomeAmount} onChange={(e) => set('incomeAmount', e.target.value)}
                    placeholder={isProperty ? '800' : '48'} type="number" step="any"
                    className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">{t('Día de pago', 'Pay day')}</label>
                  <input value={form.incomePayDay} onChange={(e) => set('incomePayDay', e.target.value)}
                    placeholder="10" type="number" min="1" max="31"
                    className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1.5 block">{t('Meses de pago', 'Payment months')}</label>
                <div className="flex flex-wrap gap-1">
                  {[
                    { m: 0, l: 'Ene' }, { m: 1, l: 'Feb' }, { m: 2, l: 'Mar' }, { m: 3, l: 'Abr' },
                    { m: 4, l: 'May' }, { m: 5, l: 'Jun' }, { m: 6, l: 'Jul' }, { m: 7, l: 'Ago' },
                    { m: 8, l: 'Sep' }, { m: 9, l: 'Oct' }, { m: 10, l: 'Nov' }, { m: 11, l: 'Dic' },
                  ].map(({ m, l }) => {
                    const active = form.incomeMonths.includes(m)
                    return (
                      <button key={m} type="button"
                        onClick={() => set('incomeMonths', active ? form.incomeMonths.filter((x) => x !== m) : [...form.incomeMonths, m].sort((a, b) => a - b))}
                        className={`px-2 py-1 text-[10px] font-medium rounded transition-all ${
                          active ? 'bg-emerald-500/25 text-emerald-400 border border-emerald-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45] hover:text-slate-300'
                        }`}>
                        {l}
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2 mt-1.5">
                  <button type="button" onClick={() => set('incomeMonths', [0,1,2,3,4,5,6,7,8,9,10,11])}
                    className="text-[9px] text-slate-500 hover:text-emerald-400 transition-colors">{t('Todos', 'All')}</button>
                  <button type="button" onClick={() => set('incomeMonths', [])}
                    className="text-[9px] text-slate-500 hover:text-emerald-400 transition-colors">{t('Ninguno', 'None')}</button>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">
                  {t('Capital devuelto por pago', 'Capital returned per payment')}
                  <span className="text-slate-600 ml-1">({t('opcional', 'optional')})</span>
                </label>
                <input value={form.capitalReturn} onChange={(e) => set('capitalReturn', e.target.value)}
                  placeholder={t('50 (reduce tu inversión cada pago)', '50 (reduces your investment each payment)')} type="number" step="any"
                  className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
              </div>

              {/* Destination accounts */}
              {existingItems.length > 0 && (
                <div className="space-y-2 pt-1 border-t border-[#1e2d45]/50">
                  <label className="text-[10px] text-slate-500 font-medium">{t('Destino de pagos', 'Payment destination')}</label>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">
                      {t('Intereses/dividendos van a:', 'Interest/dividends go to:')}
                    </label>
                    <select value={form.incomeDestination} onChange={(e) => set('incomeDestination', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white focus:outline-none focus:border-emerald-500/50">
                      <option value="">{t('-- Sin asignar --', '-- Not assigned --')}</option>
                      {existingItems.map((it) => (
                        <option key={it.id || it.symbol} value={it.id || it.symbol}>
                          {it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.capitalReturn && (
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block">
                        {t('Capital devuelto va a:', 'Returned capital goes to:')}
                      </label>
                      <select value={form.capitalDestination} onChange={(e) => set('capitalDestination', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white focus:outline-none focus:border-emerald-500/50">
                        <option value="">{t('-- Sin asignar --', '-- Not assigned --')}</option>
                        {existingItems.map((it) => (
                          <option key={it.id || it.symbol} value={it.id || it.symbol}>
                            {it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Acquisition date */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Fecha de compra', 'Purchase date')}</label>
            <input value={form.acquisitionDate} onChange={(e) => set('acquisitionDate', e.target.value)}
              type="date"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
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
