'use client'
import AmountInput from '@/components/ui/AmountInput'
import { parseAmount } from '@/lib/numberParse'

import { useState } from 'react'
import { formatCurrency } from './utils'

// Backend already existed end-to-end (Firestore alerts + checkPriceAlerts firing
// browser notifications in useDashboardData) but there was no UI to create one —
// per-symbol price alerts were invisible even though the plumbing worked.
// onClose: presente solo cuando esto vive DENTRO del modal de alertas (dejó de
// ser una card del overview, FASE IC). Con él aparece la × del encabezado y,
// si todavía no hay ninguna alerta, se abre directo en el formulario: quien
// entró por el botón "Alertas de precio" ya dijo a qué venía.
export default function PriceAlerts({ items, alerts, marketPrices, addAlert, deleteAlert, lang, onClose = null }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [adding, setAdding] = useState(!!onClose && (alerts || []).length === 0)
  const [symbol, setSymbol] = useState('')
  const [direction, setDirection] = useState('above')
  const [targetPrice, setTargetPrice] = useState('')
  const [saving, setSaving] = useState(false)

  const symbolOptions = [...new Set(
    (items || []).map((it) => (it.symbol || '').toUpperCase()).filter(Boolean)
  )].sort()

  const list = alerts || []

  const submit = async (e) => {
    e.preventDefault()
    const sym = symbol.trim().toUpperCase()
    const price = parseAmount(targetPrice)
    if (!sym || !isFinite(price) || price <= 0) return
    setSaving(true)
    try {
      await addAlert({ symbol: sym, direction, targetPrice: price })
      setSymbol('')
      setTargetPrice('')
      setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  if (list.length === 0 && !adding) {
    return (
      <div className="bg-theme-card/80 rounded-2xl border border-glass-border/50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="card-title">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            {t('ALERTAS DE PRECIO', 'PRICE ALERTS')}
          </h3>
          <span className="flex items-center gap-3">
            <button onClick={() => setAdding(true)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              + {t('Agregar', 'Add')}
            </button>
            {onClose && (
              <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }} aria-label={t('Cerrar', 'Close')}>×</button>
            )}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          {t('Te avisamos cuando un activo cruce el precio que elijas', "We'll notify you when an asset crosses a price you choose")}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-theme-card/80 rounded-2xl border border-glass-border/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full bg-slate-500" />
          {t('ALERTAS DE PRECIO', 'PRICE ALERTS')}
        </h3>
        <span className="flex items-center gap-3">
          <button onClick={() => setAdding(!adding)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            {adding ? t('Cancelar', 'Cancel') : `+ ${t('Agregar', 'Add')}`}
          </button>
          {onClose && (
            <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--text-muted)' }} aria-label={t('Cerrar', 'Close')}>×</button>
          )}
        </span>
      </div>

      {adding && (
        <form onSubmit={submit} className="mb-3 space-y-2">
          <div className="flex gap-2">
            <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value)}
              placeholder={t('Símbolo', 'Symbol')} autoFocus list="price-alert-symbols"
              className="flex-1 min-w-0 px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
            <datalist id="price-alert-symbols">
              {symbolOptions.map((s) => <option key={s} value={s} />)}
            </datalist>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}
              className="px-2 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
              <option value="above">{t('sube de', 'goes above')}</option>
              <option value="below">{t('baja de', 'goes below')}</option>
            </select>
          </div>
          <div className="flex gap-2">
            <AmountInput value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)}
              placeholder={t('Precio objetivo', 'Target price')}
              className="flex-1 min-w-0 px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
            <button type="submit" disabled={saving}
              className="px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
              {t('Crear', 'Create')}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-1.5">
        {list.length === 0 && !adding && (
          <p className="text-xs text-slate-600">{t('Sin alertas todavía', 'No alerts yet')}</p>
        )}
        {list.map((a) => {
          const sym = (a.symbol || '').toUpperCase()
          const current = marketPrices?.[sym]?.price
          return (
            <div key={a.id} className="flex items-center justify-between py-1.5 group">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-xs shrink-0 ${a.triggered ? 'opacity-40' : ''}`}>
                  {a.triggered ? '🔔' : (a.direction === 'above' ? '📈' : '📉')}
                </span>
                <span className={`text-xs text-white font-medium ${a.triggered ? 'opacity-40' : ''}`}>{sym}</span>
                <span className="text-xs text-slate-500 truncate">
                  {a.direction === 'above'
                    ? t('sube de', 'above')
                    : t('baja de', 'below')} {formatCurrency(a.targetPrice)}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {current != null && isFinite(current) && (
                  <span className="text-xs text-slate-600">{formatCurrency(current)}</span>
                )}
                <button onClick={() => deleteAlert(a.id)}
                  className="text-xs text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">×</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
