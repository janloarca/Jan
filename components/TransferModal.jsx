'use client'

import { useState, useEffect } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { buildTransferTransaction } from '@/lib/transferTx'
import { accountValue, debitFields, creditFields, DUST } from '@/lib/transferFields'
import { parseAmount } from '@/lib/numberParse'
import BusyLabel from '@/components/ui/BusyLabel'
import { todayLocalISO } from '@/lib/localDate'

export default function TransferModal({ onClose, onTransfer, onAddTransaction, existingItems = [], convert, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [toTouched, setToTouched] = useState(false)
  const [date, setDate] = useState(todayLocalISO())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // El comprobante de lo que la app ACABA de escribir. Una transferencia que se
  // cierra sola no deja ninguna evidencia, así que "lo hice y sigue igual" no
  // se puede distinguir de "la app calculó mal", de "escribió bien y el tablero
  // muestra un número viejo" ni de "el teléfono sigue en el bundle anterior".
  // Es la misma lección del botón "Reparar ahora" (FASE HP): si el resultado no
  // se ve, cada reporte cuesta una ronda de diagnóstico.
  const [receipt, setReceipt] = useState(null)

  const t = (es, en) => lang === 'es' ? es : en
  // La regla de "esto es una cuenta de saldo" y el cálculo de los campos viven
  // en lib/transferFields.js, compartidos con CashFlowModal: acá había una
  // copia ANGOSTA que dejaba a una "Cuenta Monetaria" del lado equivocado.
  const getValue = accountValue

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  // Un pasivo NO puede ser ninguno de los dos lados de una transferencia.
  // Como origen no tiene saldo que mover, y como destino el crédito le SUBÍA la
  // magnitud de la deuda en vez de pagarla, o sea el camino estaba al revés.
  // Pagar un préstamo tiene su propio flujo (Movimiento → Pago de deuda), que
  // sí baja el saldo del préstamo y el efectivo a la vez.
  const assets = existingItems.filter((i) => !i.isDebt)
  const hasDebts = existingItems.some((i) => i.isDebt)
  const fromItem = assets.find((i) => i.id === fromId)
  const toItem = assets.find((i) => i.id === toId)
  const sourceValue = fromItem ? getValue(fromItem) : 0

  // ⛔ Una transferencia entre monedas tiene DOS montos.
  //
  // El usuario movió Q2,500 a una cuenta en dólares y la app le acreditó
  // $2,500: esta pantalla restaba `amt` del origen y sumaba el MISMO `amt` al
  // destino, sin mirar la moneda de ninguno de los dos.
  //
  // Se pregunta CUÁNTO LLEGÓ, no la tasa (decisión del usuario): eso es lo que
  // se lee directo del estado de cuenta, sin hacer ninguna cuenta. La tasa se
  // deriva y se muestra para revisarla.
  const fromCurrency = fromItem?.currency || 'USD'
  const toCurrency = toItem?.currency || fromCurrency
  const crossCurrency = !!(fromItem && toItem) && String(fromCurrency).toUpperCase() !== String(toCurrency).toUpperCase()

  // La tasa de la app es una SUGERENCIA, jamás la verdad: el banco le pone su
  // propio spread, así que el número real solo lo sabe quien hizo la operación.
  const suggested = (() => {
    const amt = parseAmount(amount)
    if (!crossCurrency || !isFinite(amt) || amt <= 0 || typeof convert !== 'function') return null
    const out = convert(amt, fromCurrency, toCurrency)
    return isFinite(out) && out > 0 ? out : null
  })()

  const receivedRaw = toTouched ? parseAmount(toAmount) : (suggested ?? parseAmount(toAmount))
  const received = isFinite(receivedRaw) && receivedRaw > 0 ? receivedRaw : null
  const impliedRate = (() => {
    const amt = parseAmount(amount)
    if (!crossCurrency || !received || !isFinite(amt) || amt <= 0) return null
    return amt / received
  })()

  const money = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const formatOption = (item) =>
    `${item.name} (${item.institution || '-'}) - ${item.currency || 'USD'} ${money(getValue(item))}`

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amt = parseAmount(amount)
    if (!fromItem || !toItem) { setError(t('Selecciona origen y destino.', 'Select source and destination.')); return }
    if (!amt || amt <= 0) { setError(t('Ingresa un monto mayor a 0.', 'Enter an amount greater than 0.')); return }
    if (!date) { setError(t('Elige la fecha de la transferencia.', 'Pick the transfer date.')); return }
    // Medio centavo de tolerancia: "Todo" llena el saldo REDONDEADO a centavos
    // (que es el que se muestra), así que un saldo de 482.007 produciría 482.01
    // y sin la tolerancia el botón se bloquearía a sí mismo.
    if (amt > sourceValue + DUST) { setError(t('Monto excede el saldo disponible.', 'Amount exceeds available balance.')); return }
    if (crossCurrency && !received) {
      setError(t('Indica cuánto llegó a la cuenta destino.', 'Enter how much arrived in the destination account.'))
      return
    }

    setSaving(true)
    setError('')
    try {
      // Compute only the fields that change on each side
      // Cada lado usa el monto de SU moneda: lo que salió para el origen, lo
      // que entró para el destino. Con la misma moneda son el mismo número.
      const credited = crossCurrency ? received : amt
      const fromFields = debitFields(fromItem, amt)
      const toFields = creditFields(toItem, credited)
      // Nunca en silencio: sin campos que escribir, `strip(null)` deja un `{}`
      // y Firestore acepta un update vacío como no-op. Desde afuera eso es
      // exactamente el bug que esta pantalla tenía ("el destino sube y el
      // origen no baja"), así que se dice en vez de escribirlo.
      if (!fromFields || !toFields) {
        setSaving(false)
        setError(t('Una de las dos cuentas no tiene un valor con el que trabajar. Revisa su saldo o su precio antes de transferir.',
                   'One of the two accounts has no usable value. Check its balance or price before transferring.'))
        return
      }

      // Single atomic batch: both balances + the transaction record commit together
      await onTransfer({
        fromId: fromItem.id, fromFields,
        toId: toItem.id, toFields,
        // Shared builder (lib/transferTx.js): this screen used to assemble the
        // record itself and left out the two account ids every consumer of a
        // TRANSFER row keys on, so transfers made here were invisible in both
        // accounts. See that file for the full list of what broke.
        transaction: buildTransferTransaction({
          fromItem, toItem, amount: amt, toAmount: crossCurrency ? received : null,
          date, source: 'manual_transfer',
        }),
      })
      onAddTransaction?.()
      // Los valores DESPUÉS se leen con `accountValue`, o sea con la misma
      // función con la que el tablero suma esa cuenta: si el comprobante y el
      // tablero no coinciden, el problema está en el display y no en el
      // cálculo, y eso se ve en una sola captura.
      setReceipt({
        from: { name: fromItem.name, currency: fromCurrency, before: sourceValue, after: accountValue({ ...fromItem, ...fromFields }) },
        to: { name: toItem.name, currency: toCurrency, before: getValue(toItem), after: accountValue({ ...toItem, ...toFields }) },
        build: (typeof window !== 'undefined' && window.__CHISPU_BUILD) || '',
      })
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
        {receipt ? (
          <div className="p-6 space-y-3">
            <p className="text-sm" style={{ color: 'var(--accent-green)' }}>
              {t('Listo. Esto es lo que quedó guardado:', 'Done. This is what was saved:')}
            </p>
            {[receipt.from, receipt.to].map((side, i) => (
              <div key={i} className="rounded-lg p-3" style={{ backgroundColor: 'var(--bg-card-hover)' }}>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{side.name}</p>
                <p className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>
                  {side.currency || 'USD'} {money(side.before)} → {money(side.after)}
                </p>
              </div>
            ))}
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {t('Si el tablero no muestra estos mismos números, tomá una captura de esta pantalla: dice exactamente qué se guardó.',
                 'If the dashboard does not show these same numbers, screenshot this: it says exactly what was saved.')}
              {receipt.build ? ` (${String(receipt.build).slice(0, 8)})` : ''}
            </p>
            <button type="button" onClick={onClose}
              className="w-full py-2.5 bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium" style={{ color: '#ffffff' }}>
              {t('Cerrar', 'Close')}
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-3">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          <div>
            <label className={labelCls}>{t('Origen', 'From')}</label>
            <select value={fromId} onChange={(e) => { setFromId(e.target.value); if (e.target.value === toId) setToId('') }} className={inputCls}>
              <option value="">{t('Seleccionar...', 'Select...')}</option>
              {assets.map((item) => (
                <option key={item.id} value={item.id}>{formatOption(item)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>{t('Destino', 'To')}</label>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={inputCls}>
              <option value="">{t('Seleccionar...', 'Select...')}</option>
              {assets.filter((i) => i.id !== fromId).map((item) => (
                <option key={item.id} value={item.id}>{formatOption(item)}</option>
              ))}
            </select>
            {hasDebts && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('Para abonar a un préstamo usa Movimiento → Pago de deuda: eso sí baja su saldo.',
                   'To pay down a loan use Movement → Loan payment: that one actually lowers its balance.')}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls + ' !mb-0'}>{t('Monto', 'Amount')}</label>
              <div className="flex items-center gap-2">
                {fromItem && (
                  <span className="text-xs text-[var(--text-secondary,#94a3b8)]">
                    {t('Disponible', 'Available')}: {fromItem.currency || 'USD'} {money(sourceValue)}
                  </span>
                )}
                {/* Para CUALQUIER tipo de cuenta, no solo las de banco: en un
                    fondo había que teclear el monto a mano, y si el número que
                    uno tiene en la cabeza no coincide al centavo con el
                    guardado queda un residuo colgado. */}
                {fromItem && sourceValue > 0 && (
                  <button type="button" onClick={() => setAmount((Math.round(sourceValue * 100) / 100).toFixed(2))}
                    className="text-xs text-blue-400 hover:text-blue-300">
                    {t('Todo', 'All')}
                  </button>
                )}
              </div>
            </div>
            {/* type="text" y NO type="number": con teclado en español el
                separador decimal es COMA, y un input numérico devuelve '' ante
                lo que no puede parsear, o sea el campo se vacía tecla por tecla
                (la lección de FASE KV). Y el monto se lee con parseAmount, que
                entiende las dos convenciones: `parseFloat('12.500')` devolvía
                12.5, o sea mil veces menos, en silencio. */}
            <input value={amount} onChange={(e) => setAmount(e.target.value)}
              type="text" inputMode="decimal" placeholder="0.00" className={inputCls} />
          </div>

          {/* Solo cuando las monedas difieren. Con la misma moneda no hay
              nada que preguntar y un campo de más sería ruido. */}
          {crossCurrency && (
            <div className="rounded-lg p-3 border" style={{ borderColor: 'var(--alert-warn-border)', backgroundColor: 'var(--alert-warn-bg)' }}>
              <label className={labelCls}>
                {t(`¿Cuánto llegó en ${toCurrency}?`, `How much arrived in ${toCurrency}?`)}
              </label>
              <input
                value={toTouched ? toAmount : (suggested != null ? suggested.toFixed(2) : '')}
                onChange={(e) => { setToTouched(true); setToAmount(e.target.value) }}
                type="text" inputMode="decimal" placeholder="0.00" className={inputCls} />
              <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {t(
                  'Tu banco usa su propia tasa, no la del mercado. Pon el monto EXACTO que te acreditaron: es el único dato cierto.',
                  'Your bank uses its own rate, not the market one. Enter the EXACT amount credited: it is the only certain figure.'
                )}
              </p>
              {impliedRate != null && (
                <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {t('Tasa implícita', 'Implied rate')}: 1 {toCurrency} = {impliedRate.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {fromCurrency}
                  {!toTouched && ` · ${t('sugerida', 'suggested')}`}
                </p>
              )}
            </div>
          )}

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
              {<BusyLabel busy={saving} lang={lang}>{t('Transferir', 'Transfer')}</BusyLabel>}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  )
}
