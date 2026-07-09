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

export default function AccountReviewModal({ items, onClose, onEditItem, lang, transactions, findings = [], globalScore = 100 }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [index, setIndex] = useState(0)
  const [reviewed, setReviewed] = useState({})

  const sorted = useMemo(() =>
    [...items].sort((a, b) => Math.abs(getItemValue(b)) - Math.abs(getItemValue(a))),
    [items]
  )

  // Findings come from the shared data-completeness engine (lib/dataCompleteness)
  // so this wizard and the "Chispu te sugiere" card always agree.
  const findingsByItem = useMemo(() => {
    const m = new Map()
    for (const f of findings) {
      if (!f.itemId) continue
      if (!m.has(f.itemId)) m.set(f.itemId, [])
      m.get(f.itemId).push(f)
    }
    return m
  }, [findings])

  const dataQuality = useMemo(() => {
    const total = sorted.length
    const complete = sorted.filter(it => !(findingsByItem.get(it.id)?.length)).length
    return { complete, total, pct: globalScore }
  }, [sorted, findingsByItem, globalScore])

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

  const itemFindings = findingsByItem.get(item.id) || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Progress bar */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">
              {index + 1} / {totalCount} — {reviewedCount} {t('revisados', 'reviewed')}
            </span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">&times;</button>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300" style={{ backgroundColor: '#3b82f6' }}
              style={{ width: `${((index + 1) / totalCount) * 100}%` }} />
          </div>

          <div className="mt-2 flex items-center justify-between px-2 py-1.5 rounded-lg text-xs"
            style={dataQuality.pct === 100
              ? { backgroundColor: '#ecfdf5', color: '#059669' }
              : dataQuality.pct >= 60
                ? { backgroundColor: '#fffbeb', color: '#d97706' }
                : { backgroundColor: '#fef2f2', color: '#dc2626' }
            }>
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
                {reviewed[item.id] && <span className="text-xs" style={{ color: 'var(--accent-green)' }}>&#10003;</span>}
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black font-mono tabular-nums" style={{ color: val < 0 ? '#dc2626' : '#0f172a' }}>
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
                const sym = (item.symbol || item.name || '').toUpperCase()
                const dividendsReceived = (transactions || [])
                  .filter(tx => (tx.type || '').toUpperCase() === 'DIVIDEND' && (tx.symbol || '').toUpperCase() === sym)
                  .reduce((s, tx) => s + (tx.totalAmount || tx.amount || 0), 0)
                const entryFee = item.entryFee || 0
                const mgmtFee = item.managementFee || 0
                const mgmtFeeAmt = item.managementFeeType === 'fixed' ? mgmtFee : cost * (mgmtFee / 100)
                const expenseAmt = cost * ((item.expenseRatio || 0) / 100)
                const totalFees = entryFee + mgmtFeeAmt + expenseAmt
                const totalReturn = pnl + dividendsReceived - totalFees
                const totalReturnPct = cost > 0 ? (totalReturn / cost) * 100 : 0
                return (
                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-400">{t('Retorno total', 'Total return')}</p>
                        <p className="text-lg font-bold" style={{ color: totalReturn >= 0 ? '#059669' : '#dc2626' }}>
                          {totalReturn >= 0 ? '+' : ''}{formatCurrency(totalReturn)} ({totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(1)}%)
                        </p>
                      </div>
                    </div>
                    {(dividendsReceived > 0 || totalFees > 0) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                        <span>{t('Precio', 'Price')}: {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}</span>
                        {dividendsReceived > 0 && (
                          <span style={{ color: 'var(--accent-green)' }} title={
                            (transactions || [])
                              .filter(tx => (tx.type || '').toUpperCase() === 'DIVIDEND' && (tx.symbol || '').toUpperCase() === sym)
                              .map(tx => `${tx.date}: $${(tx.totalAmount || tx.amount || 0).toFixed(2)}`)
                              .join('\n')
                          }>
                            {t('Dividendos', 'Dividends')}: +{formatCurrency(dividendsReceived)}
                            <span className="ml-1" style={{ color: 'var(--accent-green)' }}>
                              ({(transactions || []).filter(tx => (tx.type || '').toUpperCase() === 'DIVIDEND' && (tx.symbol || '').toUpperCase() === sym).length}x)
                            </span>
                          </span>
                        )}
                        {totalFees > 0 && <span style={{ color: 'var(--text-negative)' }}>{t('Costos', 'Fees')}: -{formatCurrency(totalFees)}</span>}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Data-gap findings for this item (shared engine) */}
          {itemFindings.length > 0 && (
            <div className="rounded-lg p-3 mb-4" style={{ backgroundColor: '#fffbeb', borderWidth: '1px', borderStyle: 'solid', borderColor: '#fde68a' }}>
              <p className="text-xs font-medium" style={{ color: '#b45309' }}>{t('Chispu detectó:', 'Chispu detected:')}</p>
              <ul className="mt-1 space-y-1">
                {itemFindings.map(f => (
                  <li key={f.id} className="text-xs" style={{ color: '#d97706' }}>
                    · {lang === 'es' ? f.textEs : f.textEn}
                  </li>
                ))}
              </ul>
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
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg hover:opacity-90 transition-colors"
            style={{ color: 'var(--accent-blue-strong)', borderWidth: '1px', borderStyle: 'solid', borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }}>
            {t('Editar', 'Edit')}
          </button>
          <button onClick={markReviewed}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg hover:opacity-90 transition-colors"
            style={{ color: '#ffffff', backgroundColor: '#059669' }}>
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
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-slate-700 font-medium">{value}</p>
    </div>
  )
}
