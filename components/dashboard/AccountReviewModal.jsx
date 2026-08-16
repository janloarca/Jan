'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
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

const SEV_WEIGHT = { high: 3, medium: 2, low: 1 }

export default function AccountReviewModal({ items: allItems, onClose, onEditItem, onOpenCashflow, onConfirmDistinct, onApplySuggestion, lang, transactions, findings = [], startItemId = null, onlyWithFindings = false, institutionFilter = null }) {
  const t = (es, en) => lang === 'es' ? es : en
  const trapRef = useFocusTrap()
  const [reviewed, setReviewed] = useState({})
  const [applied, setApplied] = useState(() => new Set())

  // "Revisar por institución" scope: everything else about the wizard (order,
  // findings, progress count) stays untouched, it just walks a narrower list —
  // the whole point being "fix everything IDC holds" instead of hopping
  // between VITALI and Fondo Líquido one modal at a time.
  const items = useMemo(
    () => (institutionFilter ? allItems.filter((it) => (it.institution || '') === institutionFilter) : allItems),
    [allItems, institutionFilter]
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

  // Guided mode ("let Chispu recommend"): only the accounts that actually have
  // gaps, worst first, so the wizard is a to-do list instead of a tour of
  // everything you own. Falls back to the full list when nothing is missing,
  // otherwise the modal would open onto an empty state.
  const sorted = useMemo(() => {
    const byValue = (a, b) => Math.abs(getItemValue(b)) - Math.abs(getItemValue(a))
    if (!onlyWithFindings) return [...items].sort(byValue)
    const gapped = items.filter((it) => (findingsByItem.get(it.id) || []).length > 0)
    if (gapped.length === 0) return [...items].sort(byValue)
    const weight = (it) => (findingsByItem.get(it.id) || []).reduce((s, f) => s + (SEV_WEIGHT[f.severity] || 1), 0)
    return gapped.sort((a, b) => (weight(b) - weight(a)) || byValue(a, b))
  }, [items, onlyWithFindings, findingsByItem])

  const [index, setIndex] = useState(() => {
    if (!startItemId) return 0
    const at = items.findIndex((it) => it.id === startItemId)
    return at >= 0 ? at : 0
  })
  // The initial index above is computed against `items`; re-anchor it once the
  // real (sorted/filtered) order is known so "review THIS account" lands on it.
  useEffect(() => {
    if (!startItemId) return
    const at = sorted.findIndex((it) => it.id === startItemId)
    if (at >= 0) setIndex(at)
  }, [startItemId, sorted])

  // Count-based (N of M items without findings) so both numbers in the strip
  // agree — the value-weighted globalScore lives in the dashboard card.
  const dataQuality = useMemo(() => {
    const total = sorted.length
    const complete = sorted.filter(it => !(findingsByItem.get(it.id)?.length)).length
    return { complete, total, pct: total > 0 ? Math.round((complete / total) * 100) : 100 }
  }, [sorted, findingsByItem])

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

  // Same "cashflow" action ChispuSuggestions already offers on the dashboard —
  // wired here too so the guided/per-institution review flow can resolve a
  // finding (e.g. "confirm this is new money") without the user having to
  // remember to close this modal and go find that button elsewhere.
  const handleResolve = (f) => {
    if (f.action?.kind === 'cashflow' && onOpenCashflow) {
      onClose()
      onOpenCashflow(f.action.prefill || { flowType: 'DEPOSIT', origin: 'external', linkedId: item.id, alreadyReflected: true })
    } else {
      handleEdit()
    }
  }

  // Grounded in real data already on file (a past transaction, the account's
  // own createdAt) — never a guess. See lib/dataCompleteness.js. Stays
  // in this wizard (doesn't advance/close) so the next finding on the same
  // account, if any, is still right there.
  const applySuggestion = (f) => {
    if (!f.suggestion || !onApplySuggestion) return
    onApplySuggestion(item.id, f.suggestion.patch)
    setApplied((p) => new Set(p).add(f.id))
  }

  const itemFindings = findingsByItem.get(item.id) || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={trapRef} className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Progress bar */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">
              {index + 1} / {totalCount} · {reviewedCount} {t('revisados', 'reviewed')}
            </span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">&times;</button>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300"
              style={{ backgroundColor: 'var(--accent-blue)', width: `${((index + 1) / totalCount) * 100}%` }} />
          </div>

          <div className="mt-2 flex items-center justify-between px-2 py-1.5 rounded-lg text-xs"
            style={dataQuality.pct === 100
              ? { backgroundColor: '#ecfdf5', color: '#059669' }
              : dataQuality.pct >= 60
                ? { backgroundColor: '#fffbeb', color: '#d97706' }
                : { backgroundColor: '#fef2f2', color: '#dc2626' }
            }>
            <span>{dataQuality.complete}/{dataQuality.total} {t('completos', 'complete')}</span>
            <span className="font-semibold">{dataQuality.pct}% {t('completos', 'complete')}</span>
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
              <p className="text-2xl font-bold font-mono tabular-nums" style={{ color: val < 0 ? '#dc2626' : '#0f172a' }}>
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
            {item.incomeRate && <DetailRow label={t('Tasa de interés', 'Interest rate')} value={`${item.incomeRate}%`} />}
            {item.managementFee && <DetailRow label={t('Comisión gestión', 'Mgmt fee')} value={`${item.managementFee}%`} />}
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
              <ul className="mt-1.5 space-y-1.5">
                {itemFindings.map(f => (
                  <li key={f.id} className="text-xs" style={{ color: '#d97706' }}>
                    <div className="flex items-start justify-between gap-2">
                      <span>· {lang === 'es' ? f.textEs : f.textEn}</span>
                      <span className="shrink-0 flex items-center gap-2">
                        {f.suggestion && onApplySuggestion && !applied.has(f.id) && (
                          <button type="button" onClick={() => applySuggestion(f)}
                            className="underline font-semibold" style={{ color: '#b45309' }}>
                            {t('Usar esto', 'Use this')}
                          </button>
                        )}
                        {applied.has(f.id) && (
                          <span style={{ color: 'var(--accent-green)' }}>✓ {t('Aplicado', 'Applied')}</span>
                        )}
                        {f.action?.kind === 'cashflow' && !applied.has(f.id) && (
                          <button type="button" onClick={() => handleResolve(f)}
                            className="underline font-medium" style={{ color: '#b45309' }}>
                            {t('Resolver', 'Resolve')}
                          </button>
                        )}
                        {/* Same permanent answer ChispuSuggestions offers: stamps
                            _dupConfirmedDistinct on both items so this exact pair
                            stops asking anywhere, not just in this modal. */}
                        {f.code === 'dup-suspect' && f.action?.itemIds?.length > 1 && onConfirmDistinct && !applied.has(f.id) && (
                          <button type="button" onClick={() => onConfirmDistinct(f)}
                            className="underline font-medium" style={{ color: '#b45309' }}>
                            {t('No son iguales', 'Not the same')}
                          </button>
                        )}
                      </span>
                    </div>
                    {/* Grounded in real data already on file — never invented. */}
                    {f.suggestion && !applied.has(f.id) && (
                      <p className="mt-0.5" style={{ color: '#b45309' }}>
                        💡 {lang === 'es' ? f.suggestion.textEs : f.suggestion.textEn}
                      </p>
                    )}
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
          <button onClick={goPrev} disabled={index === 0} aria-label={t('Anterior', 'Previous')}
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
