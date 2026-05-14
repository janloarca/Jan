'use client'

import { useState } from 'react'
import { formatCurrency } from './utils'

export default function PriceAlerts({ alerts, items, onAddAlert, onDeleteAlert, lang }) {
  const [showForm, setShowForm] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [targetPrice, setTargetPrice] = useState('')
  const [direction, setDirection] = useState('above')

  const t = (es, en) => lang === 'es' ? es : en

  const handleAdd = () => {
    if (!symbol.trim() || !targetPrice) return
    onAddAlert({
      symbol: symbol.trim().toUpperCase(),
      targetPrice: parseFloat(targetPrice),
      direction,
      currency: 'USD',
    })
    setSymbol('')
    setTargetPrice('')
    setShowForm(false)
  }

  const symbolOptions = [...new Set((items || []).filter((it) => it.symbol).map((it) => it.symbol.toUpperCase()))]

  const activeAlerts = (alerts || []).filter((a) => !a.triggered)
  const triggeredAlerts = (alerts || []).filter((a) => a.triggered)

  return (
    <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-5 card-primary">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-white flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {t('Alertas de precio', 'Price Alerts')}
        </h3>
        <button onClick={() => setShowForm(!showForm)}
          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
          {showForm ? t('Cancelar', 'Cancel') : '+ ' + t('Nueva', 'New')}
        </button>
      </div>

      {showForm && (
        <div className="bg-[#0f172a] rounded-lg p-3 mb-3 border border-[#334155]/50 space-y-2">
          <div className="flex gap-2">
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}
              className="flex-1 bg-[#1e293b] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white">
              <option value="">{t('Seleccionar...', 'Select...')}</option>
              {symbolOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}
              className="bg-[#1e293b] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white">
              <option value="above">{t('Mayor que', 'Above')}</option>
              <option value="below">{t('Menor que', 'Below')}</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input type="number" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)}
              placeholder={t('Precio objetivo', 'Target price')} step="0.01"
              className="flex-1 bg-[#1e293b] border border-[#334155] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500" />
            <button onClick={handleAdd} disabled={!symbol || !targetPrice}
              className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-500 disabled:opacity-40 transition-colors">
              {t('Crear', 'Create')}
            </button>
          </div>
        </div>
      )}

      {activeAlerts.length === 0 && triggeredAlerts.length === 0 && !showForm && (
        <p className="text-sm text-slate-500 text-center py-4">
          {t('Sin alertas configuradas.', 'No alerts set.')}
        </p>
      )}

      {activeAlerts.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {activeAlerts.map((alert) => (
            <div key={alert.id} className="flex items-center justify-between py-2 px-2.5 rounded-lg bg-[#0f172a]/50 border border-[#334155]/30">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-sm text-white font-medium">{alert.symbol}</span>
                <span className="text-xs text-slate-500">
                  {alert.direction === 'above' ? '>' : '<'} {formatCurrency(alert.targetPrice, alert.currency)}
                </span>
              </div>
              <button onClick={() => onDeleteAlert(alert.id)} className="text-slate-500 hover:text-red-400 text-xs transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {triggeredAlerts.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs text-slate-600 uppercase tracking-wider">{t('Activadas', 'Triggered')}</span>
          {triggeredAlerts.map((alert) => (
            <div key={alert.id} className="flex items-center justify-between py-2 px-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm text-emerald-300 font-medium">{alert.symbol}</span>
                <span className="text-xs text-slate-500">
                  {alert.direction === 'above' ? '>' : '<'} {formatCurrency(alert.targetPrice, alert.currency)}
                </span>
              </div>
              <button onClick={() => onDeleteAlert(alert.id)} className="text-slate-500 hover:text-red-400 text-xs transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
