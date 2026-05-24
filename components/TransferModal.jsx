'use client'

import { useState, useEffect } from 'react'

export default function TransferModal({ onClose, onSave, onAddTransaction, existingItems = [], lang = 'es' }) {
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
      // Deduct from source
      const updatedFrom = { ...fromItem }
      if (isBank(fromItem)) {
        updatedFrom.currentPrice = (fromItem.currentPrice || fromItem.purchasePrice || 0) - amt
        updatedFrom.purchasePrice = updatedFrom.currentPrice
      } else {
        const price = fromItem.currentPrice || fromItem.purchasePrice || 1
        updatedFrom.quantity = (fromItem.quantity || 0) - amt / price
      }

      // Add to destination
      const updatedTo = { ...toItem }
      if (isBank(toItem)) {
        updatedTo.currentPrice = (toItem.currentPrice || toItem.purchasePrice || 0) + amt
        updatedTo.purchasePrice = updatedTo.currentPrice
      } else {
        const price = toItem.currentPrice || toItem.purchasePrice || 1
        updatedTo.quantity = (toItem.quantity || 0) + amt / price
      }

      await onSave(updatedFrom)
      await onSave(updatedTo)
      await onAddTransaction({
        type: 'TRANSFER',
        symbol: fromItem.symbol,
        description: `Transfer: ${fromItem.name} → ${toItem.name}`,
        date,
        totalAmount: amt,
        currency: fromItem.currency,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  const inputCls = 'w-full px-3 py-2 bg-[var(--input-bg,#0f172a)] border border-[var(--card-border,#334155)] rounded-lg text-sm text-[var(--text-primary,white)] focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
      <div className="bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#334155)]">
          <h2 id="transfer-modal-title" className="text-lg font-bold text-[var(--text-primary,white)]">{t('Transferencia', 'Transfer')}</h2>
          <button onClick={onClose} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-xl leading-none">&times;</button>
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
              className="flex-1 py-2.5 border border-[var(--card-border,#334155)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-[#283548] transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
              {saving ? '...' : t('Transferir', 'Transfer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
