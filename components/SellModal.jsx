'use client'

import { useState, useEffect } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

const QTY_EPSILON = 0.0001
const BANK_RE = /bank|banco|cash|saving|checking|cuenta|ahorro|efectivo/i

// Sale figures must be in the item's ORIGINAL currency (the one its lots' costBasis
// is stored in) so realizedGain stays consistent. Enriched items carry _original*
// (raw price/currency); for base-currency items these equal the converted fields,
// so the common case is unchanged.
const origPriceOf = (it) => it._originalPrice ?? it.currentPrice ?? it._originalPurchasePrice ?? it.purchasePrice ?? 0

export default function SellModal({ item, onClose, onExecuteSale, onSold, existingItems = [], lang = 'es', convert }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en
  const today = new Date().toISOString().split('T')[0]
  const origCur = item._originalCurrency || item.currency || 'USD'

  const [quantity, setQuantity] = useState('')
  const [salePrice, setSalePrice] = useState((origPriceOf(item) || '').toString())
  const [saleDate, setSaleDate] = useState(today)
  const [destination, setDestination] = useState('__exit__')
  const [destinationId, setDestinationId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const totalValue = (item.quantity || 0) * origPriceOf(item)
  const qtySell = parseFloat(quantity) || 0
  const price = parseFloat(salePrice) || 0
  const proceeds = Math.round(qtySell * price * 100) / 100
  const otherItems = existingItems.filter((it) => it.id !== item.id)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (qtySell <= 0) { setError(t('Ingresa una cantidad valida', 'Enter a valid quantity')); return }
    if (qtySell > (item.quantity || 0) + QTY_EPSILON) { setError(t('No puedes vender mas de lo que tienes', 'Cannot sell more than you own')); return }
    if (price <= 0) { setError(t('Ingresa un precio de venta valido', 'Enter a valid sale price')); return }

    setSaving(true)
    try {
      // Build the source item update
      const newQty = (item.quantity || 0) - qtySell
      const itemFields = newQty <= QTY_EPSILON
        ? { quantity: 0, currentPrice: 0, purchasePrice: 0, saleDate, salePrice: price, soldFully: true }
        : { quantity: newQty }

      // SELL transaction (+ WITHDRAWAL if the money leaves the portfolio).
      // _linkedItemId ties it to the sold asset; _destinationItemId (set below
      // for '__stay__') records WHERE the proceeds landed so history and the
      // completeness engine can follow the money.
      const transactions = [{
        type: 'SELL',
        symbol: item.symbol || '',
        description: `${t('Venta', 'Sale')} ${qtySell} ${item.name || item.symbol} @ ${price}`,
        date: saleDate,
        totalAmount: proceeds,
        currency: origCur,
        _linkedItemId: item.id,
      }]

      let destId, destFields, destLot
      if (destination === '__exit__') {
        transactions.push({
          type: 'WITHDRAWAL',
          symbol: item.symbol || '',
          description: `${t('Retiro', 'Withdrawal')} - ${item.name || item.symbol}`,
          date: saleDate,
          totalAmount: proceeds,
          currency: origCur,
          _linkedItemId: item.id,
          _origin: 'external',
        })
      } else if (destination === '__stay__' && destinationId) {
        const dest = existingItems.find((it) => it.id === destinationId)
        if (dest) {
          // Proceeds are in the SOLD asset's currency; the destination stores raw
          // values in ITS OWN currency — convert before crediting, or a USD sale
          // into a GTQ account credits ~7.8× less than reality.
          const destCur = dest._originalCurrency || dest.currency || origCur
          const proceedsInDest = (convert && destCur !== origCur)
            ? convert(proceeds, origCur, destCur)
            : proceeds
          transactions[0]._destinationItemId = dest.id
          if (BANK_RE.test(dest.type || '')) {
            const newBal = origPriceOf(dest) + proceedsInDest
            destId = dest.id
            destFields = { currentPrice: newBal, purchasePrice: newBal }
          } else {
            // Buying more of a market asset with the proceeds: bump quantity AND
            // create a matching lot so lots stay consistent with item.quantity
            // (otherwise FIFO/cost-basis breaks per the lots model). Use the dest's
            // ORIGINAL price/currency so the new lot's costBasis matches the lots
            // convention.
            const destPrice = origPriceOf(dest) || 1
            const addQty = proceedsInDest / destPrice
            destId = dest.id
            destFields = { quantity: (dest.quantity || 0) + addQty }
            destLot = {
              symbol: (dest.symbol || '').toUpperCase(),
              quantity: addQty,
              costBasis: destPrice,
              acquisitionDate: saleDate,
              institution: dest.institution || '',
              currency: dest._originalCurrency || dest.currency || origCur,
            }
          }
        }
      }

      // Single atomic transaction: source qty + SELL/WITHDRAWAL txs +
      // destination credit + destination lot + source-lot FIFO close all commit
      // together. Nothing can partially apply.
      await onExecuteSale({
        itemId: item.id,
        itemFields,
        transactions,
        destId,
        destFields,
        destLot,
        lotClose: item.symbol
          ? { symbol: item.symbol.toUpperCase(), qty: qtySell, price, date: saleDate, institution: item.institution || '' }
          : null,
      })

      onSold?.()
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const inputCls = 'w-full px-3 py-2 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg text-sm text-[var(--text-primary,white)] placeholder-slate-600 focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sell-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#38383A)]">
          <h2 id="sell-modal-title" className="text-lg font-bold text-[var(--text-primary,white)]">{t('Vender', 'Sell')} {item.symbol}</h2>
          <button onClick={onClose} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          {/* Current position (read-only) */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-[var(--input-bg,#000000)] rounded-lg">
            <div className="text-center">
              <p className={labelCls}>{t('Cantidad', 'Quantity')}</p>
              <p className="text-sm font-semibold text-[var(--text-primary,white)]">{item.quantity ?? 0}</p>
            </div>
            <div className="text-center">
              <p className={labelCls}>{t('Precio actual', 'Current price')}</p>
              <p className="text-sm font-semibold text-[var(--text-primary,white)]">
                {origPriceOf(item).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="text-center">
              <p className={labelCls}>{t('Valor total', 'Total value')}</p>
              <p className="text-sm font-semibold text-emerald-400">
                {origCur} {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Quantity to sell */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls}>{t('Cantidad a vender', 'Quantity to sell')}</label>
              <button type="button" onClick={() => setQuantity((item.quantity || 0).toString())}
                className="text-xs text-red-400 hover:text-red-300 transition-colors">{t('Vender todo', 'Sell all')}</button>
            </div>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)}
              type="number" step="any" min="0" max={item.quantity || 0}
              placeholder={`${t('Max', 'Max')}: ${item.quantity || 0}`} className={inputCls} />
          </div>

          {/* Sale price */}
          <div>
            <label className={labelCls}>{t('Precio de venta', 'Sale price')}</label>
            <input value={salePrice} onChange={(e) => setSalePrice(e.target.value)}
              type="number" step="any" min="0" placeholder="0.00" className={inputCls} />
          </div>

          {/* Proceeds preview */}
          {qtySell > 0 && price > 0 && (
            <p className="text-xs text-emerald-400 -mt-2">
              {t('Monto de venta', 'Sale proceeds')}: {origCur} {proceeds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}

          {/* Sale date */}
          <div>
            <label className={labelCls}>{t('Fecha de venta', 'Sale date')}</label>
            <input value={saleDate} onChange={(e) => setSaleDate(e.target.value)} type="date" className={inputCls} />
          </div>

          {/* Where does the money go? */}
          <div className="border border-[var(--card-border,#38383A)] rounded-lg p-3 space-y-2">
            <label className="text-xs text-[var(--text-secondary,#94a3b8)] font-medium">
              {t('A donde va el dinero?', 'Where does the money go?')}
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDestination('__exit__')}
                className={`flex-1 px-2 py-2 text-xs font-medium rounded-lg transition-all border ${
                  destination !== '__exit__'
                    ? 'bg-[var(--input-bg,#000000)] text-[var(--text-secondary,#94a3b8)] border-[var(--card-border,#38383A)]'
                    : ''
                }`}
                style={destination === '__exit__' ? { color: 'var(--text-negative)', backgroundColor: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.4)' } : undefined}>{t('Sale del portafolio', 'Exits portfolio')}</button>
              <button type="button" onClick={() => setDestination('__stay__')}
                className={`flex-1 px-2 py-2 text-xs font-medium rounded-lg transition-all border ${
                  destination !== '__stay__'
                    ? 'bg-[var(--input-bg,#000000)] text-[var(--text-secondary,#94a3b8)] border-[var(--card-border,#38383A)]'
                    : ''
                }`}
                style={destination === '__stay__' ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(59,130,246,0.2)', borderColor: 'rgba(59,130,246,0.4)' } : undefined}>{t('Queda en el portafolio', 'Stays in portfolio')}</button>
            </div>
            {destination === '__exit__' && (
              <p className="text-xs text-red-400/70">
                {t('El dinero sale completamente. Se registra como retiro.', 'Money leaves completely. Recorded as withdrawal.')}
              </p>
            )}
            {destination === '__stay__' && (
              <>
                <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className={inputCls}>
                  <option value="">{t('-- Selecciona cuenta destino --', '-- Select destination --')}</option>
                  {otherItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-emerald-400/70">
                  {t('El dinero se mueve dentro del portafolio. No afecta el rendimiento.', 'Money moves within portfolio. Does not affect return.')}
                </p>
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-[var(--card-border,#38383A)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-theme-elevated transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-red-600 rounded-lg hover:bg-red-500 disabled:opacity-50 transition-colors text-sm font-medium" style={{ color: '#ffffff' }}>
              {saving ? '...' : t('Confirmar Venta', 'Confirm Sale')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
