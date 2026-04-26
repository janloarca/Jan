'use client'

import { useState, useEffect } from 'react'

const CURRENCIES = ['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY']

const INSTITUTION_CURRENCY = {
  bi: 'GTQ', banrural: 'GTQ', bam: 'GTQ', industrial: 'GTQ', bantrab: 'GTQ',
  'g&t': 'GTQ', gyt: 'GTQ', ficohsa: 'GTQ', promerica: 'GTQ',
  banamex: 'MXN', banorte: 'MXN', azteca: 'MXN', 'hsbc mx': 'MXN',
  bancolombia: 'COP', davivienda: 'COP', 'bbva co': 'COP', nequi: 'COP',
  bcp: 'PEN', interbank: 'PEN', scotiabank: 'PEN',
  itau: 'BRL', bradesco: 'BRL', nubank: 'BRL',
  'banco estado': 'CLP', bci: 'CLP', 'santander cl': 'CLP',
  chase: 'USD', 'wells fargo': 'USD', citi: 'USD', bofa: 'USD',
  schwab: 'USD', fidelity: 'USD', vanguard: 'USD', ibkr: 'USD',
  barclays: 'GBP', lloyds: 'GBP', 'hsbc uk': 'GBP',
}

function detectCurrency(institution) {
  if (!institution) return null
  const lower = institution.toLowerCase().trim()
  for (const [key, cur] of Object.entries(INSTITUTION_CURRENCY)) {
    if (lower.includes(key) || lower === key) return cur
  }
  return null
}

const TYPES = [
  { key: 'Stock', icon: '📈', es: 'Acción', en: 'Stock' },
  { key: 'Crypto', icon: '₿', es: 'Crypto', en: 'Crypto' },
  { key: 'Fund', icon: '💼', es: 'Fondo/ETF', en: 'Fund/ETF' },
  { key: 'Inmueble', icon: '🏠', es: 'Inmueble', en: 'Real Estate' },
  { key: 'Bank', icon: '🏦', es: 'Banco', en: 'Bank' },
  { key: 'Inversion', icon: '🏛', es: 'Inversión', en: 'Investment' },
]

export default function AddAccountModal({ onClose, onAdd, onAddTransaction, existingItems = [], lang = 'es' }) {
  const [action, setAction] = useState('buy')
  const [type, setType] = useState('Stock')
  const [form, setForm] = useState({
    symbol: '', name: '', quantity: '', purchasePrice: '', currentPrice: '',
    institution: '', currency: 'USD', acquisitionDate: '',
    incomeAmount: '', incomeMode: 'fixed', incomeRate: '',
    incomePayDay: '', incomeMonths: [],
    capitalReturn: '', incomeDestination: '', capitalDestination: '',
    dividendAction: 'cash',
  })
  const [isNewMoney, setIsNewMoney] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [divInfo, setDivInfo] = useState(null)
  const [divLoading, setDivLoading] = useState(false)

  const t = (es, en) => lang === 'es' ? es : en
  const set = (k, v) => setForm({ ...form, [k]: v })

  const isMarketAsset = type === 'Stock' || type === 'Crypto' || type === 'Fund'
  const isProperty = type === 'Inmueble'
  const isBank = type === 'Bank'
  const hasIncome = !isMarketAsset

  useEffect(() => {
    if (!isMarketAsset || !form.symbol || form.symbol.length < 1) {
      setDivInfo(null)
      return
    }
    const timer = setTimeout(async () => {
      const sym = form.symbol.trim().toUpperCase()
      if (sym.length < 1) return
      setDivLoading(true)
      try {
        const res = await fetch(`/api/prices/dividends?symbol=${encodeURIComponent(sym)}`)
        if (res.ok) {
          const data = await res.json()
          setDivInfo(data)
        }
      } catch {}
      setDivLoading(false)
    }, 800)
    return () => clearTimeout(timer)
  }, [form.symbol, isMarketAsset])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (action === 'sell') {
      if (!form.symbol) { setError(t('Selecciona un activo', 'Select an asset')); return }
      const qtySell = parseFloat(form.quantity) || 0
      if (qtySell <= 0) { setError(t('Ingresa la cantidad a vender', 'Enter quantity to sell')); return }

      setSaving(true)
      try {
        const existing = existingItems.find((it) => it.id === form.symbol)
        if (!existing) { setError(t('Activo no encontrado', 'Asset not found')); setSaving(false); return }

        const salePrice = parseFloat(form.purchasePrice) || 0
        const totalSale = qtySell * salePrice
        const saleDate = form.acquisitionDate || new Date().toISOString().split('T')[0]
        const newQty = (existing.quantity || 0) - qtySell

        if (newQty <= 0.0001) {
          await onAdd({ ...existing, quantity: 0, currentPrice: 0, purchasePrice: 0 })
        } else {
          await onAdd({ ...existing, quantity: newQty })
        }

        if (onAddTransaction) {
          await onAddTransaction({
            type: 'SELL',
            symbol: existing.symbol || '',
            description: `${t('Venta', 'Sale')} ${qtySell} ${existing.name || existing.symbol} @ ${salePrice}`,
            date: saleDate,
            totalAmount: Math.round(totalSale * 100) / 100,
            currency: existing.currency || 'USD',
          })
        }

        if (form.incomeDestination === '__exit__') {
          if (onAddTransaction) {
            await onAddTransaction({
              type: 'WITHDRAWAL',
              symbol: existing.symbol || '',
              description: `${t('Retiro', 'Withdrawal')} - ${existing.name || existing.symbol}`,
              date: saleDate,
              totalAmount: Math.round(totalSale * 100) / 100,
              currency: existing.currency || 'USD',
            })
          }
        } else if (form.incomeDestination) {
          const dest = existingItems.find((it) => it.id === form.incomeDestination)
          if (dest) {
            const isBankDest = /bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i.test(dest.type || '')
            if (isBankDest) {
              const destBal = (dest.currentPrice || dest.purchasePrice || 0) + totalSale
              await onAdd({ ...dest, currentPrice: destBal, purchasePrice: destBal })
            } else {
              const newQty = (dest.quantity || 0) + (totalSale / (dest.currentPrice || dest.purchasePrice || 1))
              await onAdd({ ...dest, quantity: newQty })
            }
          }
        }

        onClose()
      } catch (err) { setError(err.message) }
      setSaving(false)
      return
    }

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

        if (divInfo && divInfo.hasDividend) {
          item.incomeAmount = divInfo.lastAmount || 0
          item.incomeMonths = divInfo.paymentMonths || []
          item.incomeFrequency = divInfo.frequency
          item.dividendYield = divInfo.dividendYield
          item.dividendAction = form.dividendAction || 'cash'
        }
      } else if (isProperty) {
        item.symbol = form.symbol.trim() || form.name.trim().replace(/\s+/g, '-').toUpperCase()
        item.name = form.name.trim()
        item.quantity = 1
        item.purchasePrice = parseFloat(form.purchasePrice) || 0
        if (form.currentPrice) item.currentPrice = parseFloat(form.currentPrice)
      } else if (isBank) {
        item.symbol = form.symbol.trim() || `${form.institution.trim().replace(/\s+/g, '-').toUpperCase()}-${(form.name.trim() || 'CUENTA').replace(/\s+/g, '-').toUpperCase()}`
        item.name = form.name.trim() || `${form.institution.trim()} - ${t('Cuenta', 'Account')}`
        item.quantity = 1
        item.purchasePrice = parseFloat(form.purchasePrice) || 0
        item.currentPrice = parseFloat(form.purchasePrice) || 0
      } else {
        item.symbol = form.symbol.trim() || form.name.trim().replace(/\s+/g, '-').toUpperCase()
        item.name = form.name.trim()
        item.quantity = parseFloat(form.quantity) || 1
        item.purchasePrice = parseFloat(form.purchasePrice) || 0
        if (form.currentPrice) item.currentPrice = parseFloat(form.currentPrice)
      }

      if (hasIncome && (form.incomeAmount || form.incomeRate)) {
        item.incomeMode = form.incomeMode
        if (form.incomeMode === 'percent') {
          item.incomeRate = parseFloat(form.incomeRate) || 0
        } else {
          item.incomeAmount = parseFloat(form.incomeAmount) || 0
        }
        item.incomePayDay = parseInt(form.incomePayDay) || 1
        item.incomeMonths = form.incomeMonths.length > 0 ? form.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
        if (form.incomeDestination) item.incomeDestination = form.incomeDestination
        if (form.capitalReturn) {
          item.capitalReturn = parseFloat(form.capitalReturn) || 0
          if (form.capitalDestination) item.capitalDestination = form.capitalDestination
        }
      }

      {
        const existing = existingItems.find((ei) => {
          const symMatch = (ei.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase()
          const instMatch = (ei.institution || '').toLowerCase() === (item.institution || '').toLowerCase()
          const curMatch = (ei.currency || '') === (item.currency || '')
          const nameMatch = (ei.name || '').toLowerCase() === (item.name || '').toLowerCase()
          if (isMarketAsset) return symMatch && instMatch
          return nameMatch && instMatch && curMatch
        })
        if (existing) {
          item.id = existing.id
          if (isMarketAsset && item.quantity > 0) {
            const oldQty = existing.quantity || 0
            const oldPrice = existing.purchasePrice || 0
            const newQty = item.quantity
            const newPrice = item.purchasePrice || 0
            item.quantity = oldQty + newQty
            item.purchasePrice = oldQty + newQty > 0
              ? (oldQty * oldPrice + newQty * newPrice) / (oldQty + newQty)
              : oldPrice
          }
        }
      }

      if (isMarketAsset && divInfo?.hasDividend && form.dividendAction === 'cash' && form.institution.trim()) {
        const inst = form.institution.trim()
        const cashSymbol = `${inst.replace(/\s+/g, '').toUpperCase()}-CASH`
        const cashExists = existingItems.some(
          (ei) => (ei.symbol || '').toUpperCase() === cashSymbol ||
                  ((ei.type || '').toLowerCase() === 'bank' && (ei.institution || '').toLowerCase() === inst.toLowerCase() && /cash/i.test(ei.name || ei.symbol || ''))
        )
        if (!cashExists) {
          await onAdd({
            type: 'Bank',
            symbol: cashSymbol,
            name: `${inst} - Cash`,
            institution: inst,
            currency: form.currency,
            quantity: 1,
            purchasePrice: 0,
            currentPrice: 0,
          })
        }
        item.incomeDestination = cashSymbol
      }

      await onAdd(item)

      const totalValue = (item.quantity || 1) * (item.purchasePrice || 0)
      if (isNewMoney && onAddTransaction && totalValue > 0) {
        await onAddTransaction({
          type: 'DEPOSIT',
          symbol: item.symbol || '',
          description: `${item.name || item.symbol} - ${t('Dinero nuevo', 'New money')}`,
          date: form.acquisitionDate || new Date().toISOString().split('T')[0],
          totalAmount: Math.round(totalValue * 100) / 100,
          currency: item.currency || 'USD',
        })
      }

      if (!isNewMoney && form.capitalDestination && totalValue > 0) {
        const source = existingItems.find((it) => it.id === form.capitalDestination)
        if (source) {
          const srcBal = (source.currentPrice || source.purchasePrice || 0) - totalValue
          await onAdd({ ...source, currentPrice: Math.max(0, srcBal), purchasePrice: Math.max(0, srcBal) })
        }
      }

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
          <h2 className="text-lg font-bold text-white">{t('Registro de Activos', 'Asset Registry')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          {/* Buy / Sell toggle */}
          <div className="flex gap-1 bg-[#0b1120] rounded-lg p-1">
            <button type="button" onClick={() => setAction('buy')}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                action === 'buy' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}>{t('Compra / Nuevo', 'Buy / New')}</button>
            <button type="button" onClick={() => setAction('sell')}
              className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${
                action === 'sell' ? 'bg-red-500 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}>{t('Venta', 'Sell')}</button>
          </div>

          {/* Type selector */}
          <div>
            <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Tipo de activo', 'Asset type')}</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((tp) => (
                <button key={tp.key} type="button" onClick={() => setType(tp.key)}
                  className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg transition-all text-center ${
                    type === tp.key
                      ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400'
                      : 'bg-[#0b1120] border border-[#1e2d45] text-slate-400 hover:border-slate-500'
                  }`}>
                  <span className="text-lg">{tp.icon}</span>
                  <span className="text-[10px] font-medium">{lang === 'es' ? tp.es : tp.en}</span>
                </button>
              ))}
            </div>
          </div>

          {/* === SELL MODE === */}
          {action === 'sell' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Activo a vender', 'Asset to sell')}</label>
                <select value={form.symbol} onChange={(e) => {
                  const sel = existingItems.find((it) => it.id === e.target.value)
                  if (sel) setForm({ ...form, symbol: sel.id, name: sel.name || sel.symbol, currency: sel.currency || 'USD', institution: sel.institution || '' })
                }}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                  <option value="">{t('-- Selecciona activo --', '-- Select asset --')}</option>
                  {existingItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.symbol} - {it.name || it.symbol} ({it.quantity} @ {it.currency})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Cantidad a vender', 'Quantity to sell')}</label>
                  <input value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
                    placeholder="10" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Precio de venta', 'Sale price')}</label>
                  <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                    placeholder="150.00" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
              </div>

              {/* Where does the money go? */}
              <div className="border border-[#1e2d45] rounded-lg p-3 space-y-2">
                <label className="text-xs text-slate-400 font-medium">{t('¿A dónde va el dinero?', 'Where does the money go?')}</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => set('incomeDestination', '__exit__')}
                    className={`flex-1 px-2 py-2 text-[11px] font-medium rounded-lg transition-all ${
                      form.incomeDestination === '__exit__' ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                    }`}>
                    ↗ {t('Sale del portafolio', 'Exits portfolio')}
                  </button>
                  <button type="button" onClick={() => set('incomeDestination', '')}
                    className={`flex-1 px-2 py-2 text-[11px] font-medium rounded-lg transition-all ${
                      form.incomeDestination !== '__exit__' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                    }`}>
                    🔄 {t('Queda en el portafolio', 'Stays in portfolio')}
                  </button>
                </div>
                {form.incomeDestination === '__exit__' && (
                  <p className="text-[9px] text-red-400/70">{t('El dinero sale completamente. Se registra como retiro.', 'Money leaves completely. Recorded as withdrawal.')}</p>
                )}
                {form.incomeDestination !== '__exit__' && (
                  <>
                    <select value={form.incomeDestination} onChange={(e) => set('incomeDestination', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white focus:outline-none focus:border-blue-500/50">
                      <option value="">{t('-- Selecciona cuenta destino --', '-- Select destination --')}</option>
                      {existingItems.filter((it) => it.id !== form.symbol).map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-[9px] text-emerald-400/70">{t('El dinero se mueve dentro del portafolio. No afecta el rendimiento.', 'Money moves within portfolio. Does not affect return.')}</p>
                  </>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Fecha de venta', 'Sale date')}</label>
                <input value={form.acquisitionDate} onChange={(e) => set('acquisitionDate', e.target.value)}
                  type="date"
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose}
                  className="flex-1 py-2.5 border border-[#1e2d45] text-slate-300 rounded-lg hover:bg-[#1a2540] transition-colors text-sm">
                  {t('Cancelar', 'Cancel')}
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-50 transition-colors text-sm font-medium">
                  {saving ? '...' : t('Registrar Venta', 'Record Sale')}
                </button>
              </div>
            </div>
          )}

          {/* === BUY MODE === */}
          {action === 'buy' && (<>
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
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Nombre', 'Name')}</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder={type === 'Stock' ? 'Apple Inc' : type === 'Crypto' ? 'Bitcoin' : 'Vanguard S&P 500'}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
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
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Precio de entrada', 'Entry price')} *</label>
                <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                  placeholder="150.00" type="number" step="any"
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
            </div>
          )}
          {isMarketAsset && (
            <p className="text-[10px] text-slate-600 -mt-2">
              {t('El precio actual se actualiza automáticamente del mercado.', 'Current price updates automatically from market data.')}
            </p>
          )}

          {/* Dividend info for market assets */}
          {isMarketAsset && divLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
              <div className="w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
              {t('Buscando dividendos...', 'Looking up dividends...')}
            </div>
          )}
          {isMarketAsset && divInfo && divInfo.hasDividend && (
            <div className="border border-blue-500/20 bg-blue-500/5 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-400 text-xs font-medium">💰 {t('Dividendo detectado', 'Dividend detected')}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-slate-500">{t('Rendimiento', 'Yield')}</p>
                  <p className="text-sm font-semibold text-emerald-400">{divInfo.dividendYield}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">{t('Frecuencia', 'Frequency')}</p>
                  <p className="text-sm font-semibold text-white capitalize">
                    {{ monthly: t('Mensual','Monthly'), quarterly: t('Trimestral','Quarterly'), semiannual: t('Semestral','Semiannual'), annual: t('Anual','Annual') }[divInfo.frequency] || divInfo.frequency}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500">{t('Próximo pago', 'Next payment')}</p>
                  <p className="text-sm font-semibold text-white">{divInfo.nextPaymentDate?.slice(5)}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 mb-1">{t('Meses de pago:', 'Payment months:')}</p>
                <div className="flex flex-wrap gap-1">
                  {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((label, i) => (
                    <span key={i} className={`px-1.5 py-0.5 text-[10px] rounded ${
                      divInfo.paymentMonths?.includes(i)
                        ? 'bg-blue-500/25 text-blue-400 border border-blue-500/40'
                        : 'bg-[#0b1120] text-slate-600 border border-[#1e2d45]'
                    }`}>{label}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 mb-1.5">{t('¿Qué hacer con los dividendos?', 'What to do with dividends?')}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => set('dividendAction', 'cash')}
                    className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all ${
                      form.dividendAction === 'cash' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                    }`}>💵 {t('Efectivo', 'Cash')}</button>
                  <button type="button" onClick={() => set('dividendAction', 'reinvest')}
                    className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all ${
                      form.dividendAction === 'reinvest' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                    }`}>🔄 {t('Reinvertir', 'Reinvest')}</button>
                </div>
                {form.dividendAction === 'cash' && (
                  <p className="text-[9px] text-slate-600 mt-1">
                    {t('Se depositan en tu cuenta cash del broker automáticamente.', 'Deposited to your broker cash account automatically.')}
                  </p>
                )}
                {form.dividendAction === 'reinvest' && (
                  <p className="text-[9px] text-slate-600 mt-1">
                    {t('Se compran más acciones automáticamente (DRIP).', 'More shares purchased automatically (DRIP).')}
                  </p>
                )}
              </div>
            </div>
          )}
          {isMarketAsset && divInfo && !divInfo.hasDividend && !divLoading && form.symbol && (
            <p className="text-[10px] text-slate-500 -mt-1">
              {t('Este activo no paga dividendos.', 'This asset does not pay dividends.')}
            </p>
          )}

          {/* Real estate */}
          {isProperty && (
            <>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Nombre / Descripción', 'Name / Description')} *</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)}
                  placeholder={t('Apartamento Centro Zona 10', 'Downtown Apartment')}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Valor de compra', 'Purchase value')} *</label>
                  <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                    placeholder="85000" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Valor actual estimado', 'Est. current value')}</label>
                  <input value={form.currentPrice} onChange={(e) => set('currentPrice', e.target.value)}
                    placeholder="95000" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
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
                  <input value={form.institution} onChange={(e) => {
                      set('institution', e.target.value)
                      const hint = detectCurrency(e.target.value)
                      if (hint && form.currency === 'USD') set('currency', hint)
                    }}
                    placeholder={t('BAM, BI, Banrural...', 'Chase, BoA...')}
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Nombre de cuenta', 'Account name')}</label>
                  <input value={form.name} onChange={(e) => set('name', e.target.value)}
                    placeholder={t('Cuenta de ahorro', 'Savings account')}
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Saldo actual', 'Current balance')} *</label>
                <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                  placeholder="5000" type="number" step="any"
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
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
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Monto invertido', 'Amount invested')} *</label>
                  <input value={form.purchasePrice} onChange={(e) => set('purchasePrice', e.target.value)}
                    placeholder="10000" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Valor actual', 'Current value')}</label>
                  <input value={form.currentPrice} onChange={(e) => set('currentPrice', e.target.value)}
                    placeholder="10800" type="number" step="any"
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
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
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">{t('Moneda', 'Currency')}</label>
                <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
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
                className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
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

              <div className="flex gap-1 mb-2">
                <button type="button" onClick={() => set('incomeMode', 'fixed')}
                  className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all ${
                    form.incomeMode === 'fixed' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                  }`}>{t('Monto fijo', 'Fixed amount')}</button>
                <button type="button" onClick={() => set('incomeMode', 'percent')}
                  className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all ${
                    form.incomeMode === 'percent' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                  }`}>{t('% del saldo', '% of balance')}</button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  {form.incomeMode === 'fixed' ? (
                    <>
                      <label className="text-[10px] text-slate-500 mb-1 block">{t('Monto por pago', 'Amount per payment')}</label>
                      <input value={form.incomeAmount} onChange={(e) => set('incomeAmount', e.target.value)}
                        placeholder={isProperty ? '800' : '48'} type="number" step="any"
                        className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                    </>
                  ) : (
                    <>
                      <label className="text-[10px] text-slate-500 mb-1 block">{t('Tasa anual %', 'Annual rate %')}</label>
                      <input value={form.incomeRate} onChange={(e) => set('incomeRate', e.target.value)}
                        placeholder="5.5" type="number" step="any"
                        className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                      <p className="text-[9px] text-slate-600 mt-0.5">{t('Se divide entre los meses seleccionados', 'Divided among selected months')}</p>
                    </>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">{t('Día de pago', 'Pay day')}</label>
                  <input value={form.incomePayDay} onChange={(e) => set('incomePayDay', e.target.value)}
                    placeholder="10" type="number" min="1" max="31"
                    className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
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
                          active ? 'bg-blue-500/25 text-blue-400 border border-blue-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45] hover:text-slate-300'
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
                  className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>

              {/* Destination accounts */}
              <div className="space-y-2 pt-2 border-t border-[#1e2d45]/50">
                <label className="text-[10px] text-cyan-400 font-medium">{t('¿A dónde van los pagos?', 'Where do payments go?')}</label>
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">
                    {isProperty ? t('Renta se deposita en:', 'Rent deposited to:') : t('Intereses/dividendos van a:', 'Interest/dividends go to:')}
                  </label>
                  {existingItems.length > 0 ? (
                    <select value={form.incomeDestination} onChange={(e) => set('incomeDestination', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white focus:outline-none focus:border-blue-500/50">
                      <option value="">{t('-- Selecciona cuenta --', '-- Select account --')}</option>
                      {existingItems.map((it) => (
                        <option key={it.id || it.symbol} value={it.id || it.symbol}>
                          {it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[10px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-1.5">
                      {t('Agrega primero una cuenta de banco o fondo para seleccionarla como destino.', 'Add a bank account or fund first to select it as destination.')}
                    </p>
                  )}
                </div>
                {form.capitalReturn && (
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">
                      {t('Capital devuelto va a:', 'Returned capital goes to:')}
                    </label>
                    {existingItems.length > 0 ? (
                      <select value={form.capitalDestination} onChange={(e) => set('capitalDestination', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white focus:outline-none focus:border-blue-500/50">
                        <option value="">{t('-- Selecciona cuenta --', '-- Select account --')}</option>
                        {existingItems.map((it) => (
                          <option key={it.id || it.symbol} value={it.id || it.symbol}>
                            {it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[10px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-1.5">
                        {t('Agrega primero una cuenta de banco.', 'Add a bank account first.')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Acquisition date */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              {isBank ? t('¿Cuándo abriste esta cuenta?', 'When did you open this account?')
                : isProperty ? t('¿Cuándo compraste este inmueble?', 'When did you buy this property?')
                : t('Fecha de compra', 'Purchase date')}
              {' '}<span className="text-amber-400">*</span>
            </label>
            <input value={form.acquisitionDate} onChange={(e) => set('acquisitionDate', e.target.value)}
              type="date"
              className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
            {!form.acquisitionDate && (
              <p className="text-[9px] text-amber-400/70 mt-1">{t('Sin fecha, el rendimiento no se calcula correctamente', 'Without a date, returns cannot be calculated correctly')}</p>
            )}
          </div>

          {/* New money toggle */}
          <div className="border border-[#1e2d45] rounded-lg p-3 space-y-2">
            <label className="text-xs text-slate-400 mb-2 block font-medium">{t('¿Es dinero nuevo?', 'Is this new money?')}</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setIsNewMoney(true)}
                className={`flex-1 px-2 py-2 text-[11px] font-medium rounded-lg transition-all ${
                  isNewMoney ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                }`}>
                💵 {t('Sí, dinero nuevo', 'Yes, new money')}
              </button>
              <button type="button" onClick={() => setIsNewMoney(false)}
                className={`flex-1 px-2 py-2 text-[11px] font-medium rounded-lg transition-all ${
                  !isNewMoney ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                }`}>
                🔄 {t('Ya estaba en el portafolio', 'Already in portfolio')}
              </button>
            </div>
            <p className="text-[9px] text-slate-600 mt-1">
              {isNewMoney
                ? t('Dinero que entra de afuera (salario, regalo, etc). No cuenta como rendimiento.', 'Money coming from outside (salary, gift, etc). Not counted as return.')
                : t('Dinero que ya estaba invertido en otro lado. No afecta el cálculo de rendimiento.', 'Money already invested elsewhere. Does not affect return calculation.')}
            </p>
            {!isNewMoney && existingItems.length > 0 && (
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{t('¿De qué cuenta sale el dinero?', 'Which account is the source?')}</label>
                <select value={form.capitalDestination} onChange={(e) => set('capitalDestination', e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#0b1120] border border-[#1e2d45] rounded text-sm text-white focus:outline-none focus:border-blue-500/50">
                  <option value="">{t('-- Selecciona origen --', '-- Select source --')}</option>
                  {existingItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name || it.symbol} {it.institution ? `(${it.institution})` : ''} - {it.currency}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-[#1e2d45] text-slate-300 rounded-lg hover:bg-[#1a2540] transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
              {saving ? '...' : t('Registrar', 'Register')}
            </button>
          </div>
          </>)}
        </form>
      </div>
    </div>
  )
}
