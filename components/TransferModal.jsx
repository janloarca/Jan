'use client'

import { useState, useEffect } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { buildTransferTransaction } from '@/lib/transferTx'
import { accountValue, debitFields, creditFields, DUST } from '@/lib/transferFields'
import { parseAmount, parseQuantity } from '@/lib/numberParse'
import { liquiditySortScore, isMarketPriced } from '@/components/dashboard/utils'
import { roundQty } from '@/lib/lotClose'
import BusyLabel from '@/components/ui/BusyLabel'
import { todayLocalISO } from '@/lib/localDate'

export default function TransferModal({ onClose, onTransfer, onAddTransaction, existingItems = [], convert, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  // ⛔ Reemplaza el `toTouched` booleano de antes. La sugerencia de tipo de
  // cambio SOLO andaba en una dirección (Monto → "¿Cuánto llegó?"); al revés,
  // corregir el monto recibido no recalculaba Monto. `lastEdited` dice cuál de
  // los dos lados es el ANCLA (lo que el usuario tecleó de verdad) y cuál es
  // la SUGERENCIA en vivo (lo que se deriva del ancla con la tasa de la app).
  // Comprar acciones con efectivo (más abajo) generaliza el mismo mecanismo:
  // ahí el ancla del lado "to" no es un campo suelto, es `cantidad × precio`.
  const [lastEdited, setLastEdited] = useState('from')
  // Comprar acciones/cripto con efectivo: cantidad y precio EXACTOS, en vez de
  // derivar la cantidad de `monto ÷ precio de mercado de hoy` (lo que hacía
  // `creditFields` para cualquier destino de mercado, sin dejar rastro de la
  // compra: ni lote, ni precio real pagado, así que el usuario terminaba
  // reconciliando a mano en Excel después).
  const [shares, setShares] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
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

  useEscClose(onClose)

  // Un pasivo NO puede ser ninguno de los dos lados de una transferencia.
  // Como origen no tiene saldo que mover, y como destino el crédito le SUBÍA la
  // magnitud de la deuda en vez de pagarla, o sea el camino estaba al revés.
  // Pagar un préstamo tiene su propio flujo (Movimiento → Pago de deuda), que
  // sí baja el saldo del préstamo y el efectivo a la vez.
  //
  // Ordenados por liquidez (bancos primero, deuda nunca llega acá, alternativos
  // al final): `liquiditySortScore` es la MISMA regla que ya usa la tabla de
  // Patrimonio, así que "qué tan líquido es esto" no puede decir una cosa ahí y
  // otra acá.
  const assets = existingItems.filter((i) => !i.isDebt).sort((a, b) => liquiditySortScore(a) - liquiditySortScore(b))
  const hasDebts = existingItems.some((i) => i.isDebt)
  const fromItem = assets.find((i) => i.id === fromId)
  const toItem = assets.find((i) => i.id === toId)
  const sourceValue = fromItem ? getValue(fromItem) : 0
  const toIsMarket = !!toItem && isMarketPriced(toItem)

  const fromCurrency = fromItem?.currency || 'USD'
  const toCurrency = toItem?.currency || fromCurrency
  const crossCurrency = !!(fromItem && toItem) && String(fromCurrency).toUpperCase() !== String(toCurrency).toUpperCase()

  // Comprar acciones: cambiar de destino resiembra cantidad/precio, nunca al
  // revés. El precio arranca en la cotización VIVA del propio ítem (en SU
  // moneda: `existingItems` acá es `reversalItems`, no `enrichedItems`, así que
  // `currentPrice` no viene convertido a la moneda base) y queda editable,
  // porque el usuario puede haber pagado un precio distinto al de hoy.
  //
  // Deps solo en `toId` A PROPÓSITO: un refresco de precios en vivo NO debe
  // pisar lo que el usuario ya tecleó, solo el ACTO de elegir un destino nuevo.
  useEffect(() => {
    const dest = assets.find((i) => i.id === toId)
    if (dest && isMarketPriced(dest)) {
      setShares('')
      setUnitPrice(dest.currentPrice > 0 ? String(dest.currentPrice) : '')
      setLastEdited('to')
    } else {
      setShares('')
      setUnitPrice('')
      setLastEdited('from')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toId])

  // La tasa de la app es una SUGERENCIA, jamás la verdad: el banco le pone su
  // propio spread, así que el número real solo lo sabe quien hizo la operación.
  // Mismo helper para las dos direcciones (antes solo existía origen→destino).
  const fx = (val, from, to) => {
    if (!isFinite(val) || val <= 0) return null
    if (String(from).toUpperCase() === String(to).toUpperCase()) return val
    if (typeof convert !== 'function') return null
    const out = convert(val, from, to)
    return isFinite(out) && out > 0 ? out : null
  }

  const literalFrom = parseAmount(amount)
  const literalFromOk = isFinite(literalFrom) && literalFrom > 0
  const literalTo = parseAmount(toAmount)
  const literalToOk = isFinite(literalTo) && literalTo > 0

  const sharesNum = parseQuantity(shares)
  const unitPriceNum = parseAmount(unitPrice)
  // ⛔ Comprando acciones, esto SIEMPRE es el ancla del lado destino: nunca se
  // deriva de Monto (no hay forma de partir un monto en cantidad × precio sin
  // adivinar cuál de los dos cambió).
  const marketToValue = toIsMarket && sharesNum > 0 && unitPriceNum > 0 ? sharesNum * unitPriceNum : null

  // Cuánto llega al destino, en SU moneda.
  const toValue = toIsMarket
    ? marketToValue
    : (crossCurrency
        ? (lastEdited === 'to' ? (literalToOk ? literalTo : null) : (literalFromOk ? fx(literalFrom, fromCurrency, toCurrency) : null))
        : (literalFromOk ? literalFrom : null))

  // Cuánto sale del origen, en SU moneda. Comprando acciones, Monto sigue
  // pudiéndose corregir a mano (ej. una comisión que se sumó al retiro) sin que
  // eso mueva la cantidad ni el precio ya tecleados.
  const fromValue = (toIsMarket || crossCurrency)
    ? (lastEdited === 'from'
        ? (literalFromOk ? literalFrom : null)
        : (toValue != null ? fx(toValue, toCurrency, fromCurrency) : null))
    : (literalFromOk ? literalFrom : null)

  const impliedRate = (crossCurrency && fromValue != null && toValue != null && toValue > 0)
    ? fromValue / toValue
    : null

  const money = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const formatOption = (item) =>
    `${item.name} (${item.institution || '-'}) - ${item.currency || 'USD'} ${money(getValue(item))}`

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!fromItem || !toItem) { setError(t('Selecciona origen y destino.', 'Select source and destination.')); return }
    if (!date) { setError(t('Elige la fecha de la transferencia.', 'Pick the transfer date.')); return }

    if (toIsMarket) {
      if (!(sharesNum > 0)) { setError(t('Ingresa la cantidad comprada.', 'Enter the quantity purchased.')); return }
      if (!(unitPriceNum > 0)) { setError(t('Ingresa el precio por unidad.', 'Enter the price per unit.')); return }
    }

    const amt = fromValue
    if (!amt || amt <= 0) { setError(t('Ingresa un monto mayor a 0.', 'Enter an amount greater than 0.')); return }
    // Medio centavo de tolerancia: "Todo" llena el saldo REDONDEADO a centavos
    // (que es el que se muestra), así que un saldo de 482.007 produciría 482.01
    // y sin la tolerancia el botón se bloquearía a sí mismo.
    if (amt > sourceValue + DUST) { setError(t('Monto excede el saldo disponible.', 'Amount exceeds available balance.')); return }
    if (!toIsMarket && crossCurrency && !toValue) {
      setError(t('Indica cuánto llegó a la cuenta destino.', 'Enter how much arrived in the destination account.'))
      return
    }

    setSaving(true)
    setError('')
    try {
      const fromFields = debitFields(fromItem, amt)
      let toFields
      let newLot
      let transaction

      if (toIsMarket) {
        // La cantidad comprada se suma tal cual; el precio de mercado (`getItemPrice`)
        // no lo toca esta pantalla, lo maneja `useMarketPrices` en vivo. El costo real
        // pagado vive en el LOTE, no en el ítem.
        toFields = { quantity: roundQty((Number(toItem.quantity) || 0) + sharesNum) }
        newLot = {
          symbol: (toItem.symbol || '').toUpperCase(),
          quantity: sharesNum,
          costBasis: unitPriceNum,
          currency: toCurrency,
          acquisitionDate: date,
          institution: toItem.institution || '',
          itemId: toItem.id,
        }
        transaction = buildTransferTransaction({
          fromItem, toItem, amount: amt,
          toAmount: crossCurrency ? marketToValue : null,
          date, source: 'manual_transfer',
          description: t(
            `Compra: ${sharesNum} ${toItem.symbol || toItem.name} @ ${toCurrency} ${money(unitPriceNum)}`,
            `Buy: ${sharesNum} ${toItem.symbol || toItem.name} @ ${toCurrency} ${money(unitPriceNum)}`
          ),
        })
      } else {
        const credited = crossCurrency ? toValue : amt
        toFields = creditFields(toItem, credited)
        transaction = buildTransferTransaction({
          fromItem, toItem, amount: amt, toAmount: crossCurrency ? credited : null,
          date, source: 'manual_transfer',
        })
      }

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

      // Single atomic batch: both balances + the transaction record (+ el lote
      // nuevo, si se compró algo) commit together.
      await onTransfer({
        fromId: fromItem.id, fromFields,
        toId: toItem.id, toFields,
        // Shared builder (lib/transferTx.js): this screen used to assemble the
        // record itself and left out the two account ids every consumer of a
        // TRANSFER row keys on, so transfers made here were invisible in both
        // accounts. See that file for the full list of what broke.
        transaction,
        ...(newLot ? { newLot } : {}),
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
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
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
                  <button type="button" onClick={() => { setLastEdited('from'); setAmount((Math.round(sourceValue * 100) / 100).toFixed(2)) }}
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
                12.5, o sea mil veces menos, en silencio.

                Cuando NO es el lado ancla (comprando acciones, o con la
                sugerencia de FX viva), el valor mostrado es la sugerencia en
                vivo: tocar el campo lo vuelve el ancla al instante. */}
            <input
              value={(toIsMarket || crossCurrency) ? (lastEdited === 'from' ? amount : (fromValue != null ? fromValue.toFixed(2) : '')) : amount}
              onChange={(e) => { setLastEdited('from'); setAmount(e.target.value) }}
              type="text" inputMode="decimal" placeholder="0.00" className={inputCls} />
            {(toIsMarket || crossCurrency) && lastEdited !== 'from' && (fromValue != null) && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('sugerido según el precio ingresado', 'suggested from the amount entered')}
              </p>
            )}
          </div>

          {/* Comprar acciones/cripto con efectivo: la cantidad y el precio
              exactos, no una derivación de monto ÷ precio de hoy. */}
          {toIsMarket && (
            <div className="rounded-lg p-3 border" style={{ borderColor: 'var(--card-border)', backgroundColor: 'var(--bg-card-hover)' }}>
              <label className={labelCls}>{t('Cantidad comprada', 'Quantity purchased')}</label>
              <input
                value={shares}
                onChange={(e) => { setLastEdited('to'); setShares(e.target.value) }}
                type="text" inputMode="decimal" placeholder="0" className={inputCls} />
              <label className={labelCls + ' mt-2'}>{t('Precio por unidad', 'Price per unit')} ({toCurrency})</label>
              <input
                value={unitPrice}
                onChange={(e) => { setLastEdited('to'); setUnitPrice(e.target.value) }}
                type="text" inputMode="decimal" placeholder="0.00" className={inputCls} />
              {marketToValue != null && (
                <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {t('Total', 'Total')}: {toCurrency} {money(marketToValue)}
                </p>
              )}
              {impliedRate != null && (
                <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {t('Tasa implícita', 'Implied rate')}: 1 {toCurrency} = {impliedRate.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {fromCurrency}
                </p>
              )}
            </div>
          )}

          {/* Solo cuando las monedas difieren Y el destino no es de mercado
              (ahí ya está el cuadro de arriba). Con la misma moneda no hay
              nada que preguntar y un campo de más sería ruido. */}
          {!toIsMarket && crossCurrency && (
            <div className="rounded-lg p-3 border" style={{ borderColor: 'var(--alert-warn-border)', backgroundColor: 'var(--alert-warn-bg)' }}>
              <label className={labelCls}>
                {t(`¿Cuánto llegó en ${toCurrency}?`, `How much arrived in ${toCurrency}?`)}
              </label>
              <input
                value={lastEdited === 'to' ? toAmount : (toValue != null ? toValue.toFixed(2) : '')}
                onChange={(e) => { setLastEdited('to'); setToAmount(e.target.value) }}
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
                  {lastEdited !== 'to' && ` · ${t('sugerida', 'suggested')}`}
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
