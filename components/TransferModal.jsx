'use client'

import { useState, useEffect } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

export default function TransferModal({ onClose, onTransfer, onAddTransaction, existingItems = [], lang = 'es' }) {
  const trapRef = useFocusTrap()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const t = (es, en) => lang === 'es' ? es : en
  const isBank = (item) => /bank|banco|cash/i.test(item.type)
  const getValue = (item) => isBank(item)
    ? (item.currentPrice || item.purchasePrice || 0)
    : (item.quantity || 0) * (item.currentPrice || item.purchasePrice || 0)

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const fromItem = existingItems.find((i) => i.id === fromId)
  const toItem = existingItems.find((i) => i.id === toId)
  const sourceValue = fromItem ? getValue(fromItem) : 0

  const formatOption = (item) =>
    `${item.name} (${item.institution || '—'}) - ${item.currency} ${getValue(item).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amt = parseFloat(amount)
    if (!fromItem || !toItem) { setError(t('Selecciona origen y destino.', 'Select source and destination.')); return }
    if (!amt || amt <= 0) { setError(t('Ingresa un monto mayor a 0.', 'Enter an amount greater than 0.')); return }
    if (amt > sourceValue) { setError(t('Monto excede el saldo disponible.', 'Amount exceeds available balance.')); return }

    setSaving(true)
    setError('')
    try {
      // Compute only the fields that change on each side
      let fromFields, toFields
      if (isBank(fromItem)) {
        const newBal = (fromItem.currentPrice || fromItem.purchasePrice || 0) - amt
        fromFields = { currentPrice: newBal, purchasePrice: newBal }
      } else {
        const price = fromItem.currentPrice || fromItem.purchasePrice || 1
        fromFields = { quantity: (fromItem.quantity || 0) - amt / price }
      }
      if (isBank(toItem)) {
        const newBal = (toItem.currentPrice || toItem.purchasePrice || 0) + amt
        toFields = { currentPrice: newBal, purchasePrice: newBal }
      } else {
        const price = toItem.currentPrice || toItem.purchasePrice || 1
        toFields = { quantity: (toItem.quantity || 0) + amt / price }
      }

      // Single atomic batch: both balances + the transaction record commit together
      await onTransfer({
        fromId: fromItem.id, fromFields,
        toId: toItem.id, toFields,
        transaction: {
          type: 'TRANSFER',
          symbol: fromItem.symbol,
          description: `Transfer: ${fromItem.name} → ${toItem.name}`,
          date,
          totalAmount: amt,
          currency: fromItem.currency,
        },
      })
      onAddTransaction?.()
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const inputCls = 'w-full px-3 py-2 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg text-sm text-[var(--text-primary,white)] focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#38383A)]">
          <h2 id="transfer-modal-title" className="text-lg font-bold text-[var(--text-primary,white)]">{t('Transferencia', 'Transfer')}</h2>
          <button onClick={onClose} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-xl leading-none" aria-label="Close">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          <div>
            <label className={labelCls}>{t('Origen', 'From')}</label>
            <select value={fromId} onChange={(e) => { setFromId(e.target.value); if (e.target.value === toId) setToId('') }} className={inputCls}>
              <option value="">{t('Seleccionar...', 'Select...')}</option>
              {existingItems.map((item) => (
                <option key={item.id} value={item.id}>{formatOption(item)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>{t('Destino', 'To')}</label>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={inputCls}>
              <option value="">{t('Seleccionar...', 'Select...')}</option>
              {existingItems.filter((i) => i.id !== fromId).map((item) => (
                <option key={item.id} value={item.id}>{formatOption(item)}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls + ' !mb-0'}>{t('Monto', 'Amount')}</label>
              <div className="flex items-center gap-2">
                {fromItem && (
                  <span className="text-xs text-[var(--text-secondary,#94a3b8)]">
                    {t('Disponible', 'Available')}: {fromItem.currency} {sourceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
                {fromItem && isBank(fromItem) && (
                  <button type="button" onClick={() => setAmount(sourceValue.toString())}
                    className="text-xs text-blue-400 hover:text-blue-300">
                    {t('Todo', 'All')}
                  </button>
                )}
              </div>
            </div>
            <input value={amount} onChange={(e) => setAmount(e.target.value)}
              type="number" step="any" min="0" placeholder="0.00" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>{t('Fecha', 'Date')}</label>
            <input value={date} onChange={(e) => setDate(e.target.value)}
              type="date" className={inputCls} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-[var(--card-border,#38383A)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-theme-elevated transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium" style={{ color: '#ffffff' }}>
              {saving ? '...' : t('Transferir', 'Transfer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
