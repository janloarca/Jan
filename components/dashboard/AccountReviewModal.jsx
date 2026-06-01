'use client'

import { useState, useMemo, useCallback } from 'react'
import { getItemValue, getTypeCategory, formatCurrency } from './utils'

const CATEGORY_LABELS = {
  banks: { es: 'Banco', en: 'Bank' },
  funds: { es: 'Fondo', en: 'Fund' },
  stocks: { es: 'Acción', en: 'Stock' },
  crypto: { es: 'Crypto', en: 'Crypto' },
  alternatives: { es: 'Alternativo', en: 'Alternative' },
  bonds: { es: 'Bono', en: 'Bond' },
  realestate: { es: 'Inmueble', en: 'Real Estate' },
  debts: { es: 'Pasivo', en: 'Liability' },
  other: { es: 'Otro', en: 'Other' },
}

export default function AccountReviewModal({ items, onClose, onEditItem, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [index, setIndex] = useState(0)
  const [reviewed, setReviewed] = useState({})

  const sorted = useMemo(() =>
    [...items].sort((a, b) => Math.abs(getItemValue(b)) - Math.abs(getItemValue(a))),
    [items]
  )

  const dataQuality = useMemo(() => {
    let complete = 0
    const issues = []
    sorted.forEach(it => {
      const missing = []
      if (!it.purchasePrice && !it.currentPrice) missing.push('price')
      if (!it.acquisitionDate) missing.push('date')
      if (!it.institution) missing.push('institution')
      if (missing.length === 0) complete++
      else issues.push({ id: it.id, name: it.name || it.symbol, missing })
    })
    return { complete, total: sorted.length, pct: sorted.length > 0 ? Math.round((complete / sorted.length) * 100) : 100, issues }
  }, [sorted])

  const item = sorted[index]
  if (!item) return null

  const val = getItemValue(item)
  const cat = getTypeCategory(item.type)
  const catLabel = CATEGORY_LABELS[cat]?.[lang] || cat
  const reviewedCount = Object.keys(reviewed).length
  const totalCount = sorted.length

  const markReviewed = () => {
    setReviewed(p => ({ ...p, [item.id]: true }))
    if (index < sorted.length - 1) setIndex(index + 1)
  }

  const goNext = () => { if (index < sorted.length - 1) setIndex(index + 1) }
  const goPrev = () => { if (index > 0) setIndex(index - 1) }

  const handleEdit = () => {
    if (onEditItem) onEditItem(item)
  }

  const missingFields = []
  if (!item.acquisitionDate) missingFields.push(t('Fecha de compra', 'Purchase date'))
  if (!item.institution) missingFields.push(t('Institución', 'Institution'))
  if (!item.purchasePrice && !item.currentPrice) missingFields.push(t('Precio', 'Price'))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Progress bar */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">
              {index + 1} / {totalCount} — {reviewedCount} {t('revisados', 'reviewed')}
            </span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${((index + 1) / totalCount) * 100}%` }} />
          </div>

          <div className={`mt-2 flex items-center justify-between px-2 py-1.5 rounded-lg text-xs ${dataQuality.pct === 100 ? 'bg-emerald-50 text-emerald-600' : dataQuality.pct >= 60 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
            <span>{dataQuality.complete}/{dataQuality.total} {t('completos', 'complete')}</span>
            <span className="font-semibold">{dataQuality.pct}% {t('calidad', 'quality')}</span>
          </div>
        </div>

        {/* Account card */}
        <div className="px-6 py-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{item.name || item.symbol}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{catLabel}</span>
                {item.institution && <span className="text-xs text-slate-400">{item.institution}</span>}
                {reviewed[item.id] && <span className="text-xs text-emerald-500">&#10003;</span>}
              </div>
            </div>
            <div className="text-right">
              <p className={`text-2xl font-black font-mono tabular-nums ${val < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {formatCurrency(val)}
              </p>
              <p className="text-xs text-slate-400">{item.currency || 'USD'}</p>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <DetailRow label={t('Tipo', 'Type')} value={item.type} />
            <DetailRow label={t('Moneda', 'Currency')} value={item.currency || 'USD'} />
            <DetailRow label={t('Cantidad', 'Quantity')} value={item.quantity?.toLocaleString(undefined, { maximumFractionDigits: 4 }) || '-'} />
            <DetailRow label={t('Precio compra', 'Buy price')} value={item.purchasePrice ? `$${item.purchasePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'} />
            <DetailRow label={t('Precio actual', 'Current price')} value={item.currentPrice ? `$${item.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'} />
            <DetailRow label={t('Fecha compra', 'Buy date')} value={item.acquisitionDate || '-'} />
            {item.maturityDate && <DetailRow label={t('Vencimiento', 'Maturity')} value={item.maturityDate} />}
            {item.incomeRate && <DetailRow label={t('Rendimiento', 'Yield')} value={`${item.incomeRate}%`} />}
            {item.managementFee && <DetailRow label={t('Mgmt fee', 'Mgmt fee')} value={`${item.managementFee}%`} />}
            {item.entryFee && <DetailRow label={t('Costo entrada', 'Entry fee')} value={`$${item.entryFee}`} />}
          </div>

          {/* P&L */}
          {item.purchasePrice > 0 && item.currentPrice > 0 && (
            <div className="bg-slate-50 rounded-lg p-3 mb-4">
              {(() => {
                const cost = (item.quantity || 1) * item.purchasePrice
                const current = (item.quantity || 1) * item.currentPrice
                const pnl = current - cost
                const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0
                const entryFee = item.entryFee || 0
                const totalFees = entryFee
                const netPnl = pnl - totalFees
                const netPnlPct = cost > 0 ? (netPnl / (cost + entryFee)) * 100 : 0
                return (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-400">{t('Retorno', 'Return')}</p>
                      <p className={`text-lg font-bold ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
                      </p>
                    </div>
                    {entryFee > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-slate-400">{t('Neto de fees', 'Net of fees')}</p>
                        <p className={`text-sm font-semibold ${netPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {netPnl >= 0 ? '+' : ''}{formatCurrency(netPnl)} ({netPnlPct >= 0 ? '+' : ''}{netPnlPct.toFixed(1)}%)
                        </p>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Missing fields warning */}
          {missingFields.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-amber-700 font-medium">{t('Datos faltantes:', 'Missing data:')}</p>
              <p className="text-xs text-amber-600 mt-0.5">{missingFields.join(', ')}</p>
            </div>
          )}

          {/* Notes */}
          {item.notes && (
            <div className="bg-slate-50 rounded-lg p-3 mb-4">
              <p className="text-xs text-slate-400 mb-1">{t('Notas', 'Notes')}</p>
              <p className="text-sm text-slate-700">{item.notes}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-5 flex items-center gap-2">
          <button onClick={goPrev} disabled={index === 0}
            className="px-4 py-2.5 text-sm font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            &#8592;
          </button>
          <button onClick={handleEdit}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-blue-600 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
            {t('Editar', 'Edit')}
          </button>
          <button onClick={markReviewed}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors">
            {index < sorted.length - 1 ? t('OK, siguiente', 'OK, next') : t('Listo', 'Done')} &#8594;
          </button>
          {index === sorted.length - 1 && reviewedCount >= totalCount - 1 && (
            <button onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
              {t('Cerrar', 'Close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-slate-700 font-medium">{value}</p>
    </div>
  )
}
