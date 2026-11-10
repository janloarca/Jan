'use client'

// FASE RN. Carga rápida: varias posiciones de mercado en una sola pantalla
// (símbolo, tipo, cantidad y costo promedio por fila). Escribe EXACTAMENTE lo
// que escribe el alta normal para una posición de mercado nueva: el ítem, su
// lote con dueño y el DEPOSIT de apertura de "Dinero nuevo" vinculado al ítem.
// Las tres escrituras salen por los mismos props que usa AddAccountModal.
// Defaults: institución recordada, moneda USD, fecha de hoy, fuente "Dinero nuevo".

import { useState } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import AmountInput from '@/components/ui/AmountInput'
import BusyLabel from '@/components/ui/BusyLabel'
import { parseAmount, parseQuantity } from '@/lib/numberParse'
import { todayLocalISO } from '@/lib/localDate'
import { scopeTagFor } from '@/lib/scopeTag'
import { closeLabel } from '@/lib/closeLabel'

const INST_KEY = 'chispudo-quickadd-institution'
const emptyRow = () => ({ symbol: '', type: 'Stock', quantity: '', cost: '' })
const TYPES = [['Stock', 'Acción', 'Stock'], ['Fund', 'ETF o fondo', 'ETF / fund'], ['Crypto', 'Cripto', 'Crypto']]

export default function QuickAddModal({ onClose, onAdd, onAddLot, onAddTransaction, onImport, activePortfolio, activeEntity = 'default', lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  useEscClose(onClose)
  const [institution, setInstitution] = useState(() => {
    try { return localStorage.getItem(INST_KEY) || '' } catch { return '' }
  })
  const [rows, setRows] = useState([emptyRow(), emptyRow(), emptyRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(0)

  const setRow = (i, k, v) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const filled = rows.filter((r) => r.symbol.trim() || r.quantity || r.cost)
  const inputCls = 'w-full px-2 py-1.5 rounded-lg text-sm border bg-[var(--input-bg,#000)] border-[var(--card-border)] text-[var(--text-primary)] focus:outline-none'

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!institution.trim()) { setError(t('Escribe la institución (broker o exchange).', 'Enter the institution (broker or exchange).')); return }
    if (filled.length === 0) { setError(t('Llena al menos una fila.', 'Fill in at least one row.')); return }
    const parsed = []
    for (const [n, r] of filled.entries()) {
      const symbol = r.symbol.trim().toUpperCase()
      const qty = parseQuantity(r.quantity)
      const price = parseAmount(r.cost)
      const rawCost = String(r.cost ?? '').trim()
      if (!symbol || /\s/.test(symbol)) { setError(t(`Fila ${n + 1}: escribe el símbolo (por ejemplo VOO).`, `Row ${n + 1}: enter the symbol (for example VOO).`)); return }
      if (!(qty > 0)) { setError(t(`Fila ${n + 1}: la cantidad debe ser mayor a 0.`, `Row ${n + 1}: quantity must be greater than 0.`)); return }
      if (!/\d/.test(rawCost) || price < 0) { setError(t(`Fila ${n + 1}: escribe el costo promedio por unidad (0 si fue un regalo).`, `Row ${n + 1}: enter the average cost per unit (0 for a gift).`)); return }
      parsed.push({ symbol, type: r.type, qty, price })
    }
    setSaving(true)
    const date = todayLocalISO()
    const inst = institution.trim()
    let ok = 0
    try {
      for (const p of parsed) {
        const item = {
          type: p.type, currency: 'USD', institution: inst, acquisitionDate: date, accountType: 'taxable',
          symbol: p.symbol, name: p.symbol, quantity: p.qty, purchasePrice: p.price,
          ...scopeTagFor(activePortfolio, activeEntity),
        }
        const itemId = await onAdd(item)
        if (onAddLot && p.price > 0) {
          await onAddLot({
            symbol: p.symbol, quantity: p.qty, costBasis: p.price, currency: 'USD', acquisitionDate: date,
            institution: inst, ...(itemId ? { itemId } : {}), ...scopeTagFor(activePortfolio, 'default'),
          })
        }
        const total = Math.round(p.qty * p.price * 100) / 100
        if (onAddTransaction && total > 0) {
          await onAddTransaction({
            type: 'DEPOSIT', symbol: p.symbol,
            description: `${p.symbol} - ${t('Dinero nuevo', 'New money')}`,
            date, totalAmount: total, currency: 'USD',
            ...(itemId ? { _linkedItemId: itemId } : {}),
            ...scopeTagFor('__all__', activeEntity),
            _source: 'manual_new_account',
          })
        }
        ok += 1
        setDone(ok)
      }
      try { localStorage.setItem(INST_KEY, inst) } catch {}
      onClose()
    } catch (err) {
      setError(t(`Se guardaron ${ok} de ${parsed.length}. Falló: ${err.message}. Quita las filas ya guardadas y reintenta.`, `Saved ${ok} of ${parsed.length}. Failed: ${err.message}. Remove the saved rows and retry.`))
      setRows((cur) => cur.filter((_, idx) => idx >= ok))
    }
    setSaving(false)
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="quickadd-title">
      <div ref={trapRef} className="modal-glass max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--card-border)]">
          <h2 id="quickadd-title" className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t('Carga rápida', 'Quick add')}</h2>
          <button onClick={onClose} aria-label={closeLabel()} className="text-xl leading-none" style={{ color: 'var(--text-secondary)' }}>&times;</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('Una fila por posición: símbolo, cantidad y costo promedio por unidad. Se guardan como dinero nuevo, en USD, con la fecha de hoy. Después puedes completar el resto.', 'One row per position: symbol, quantity and average cost per unit. Saved as new money, in USD, dated today. You can complete the rest later.')}
          </p>
          {error && <div role="alert" className="p-3 rounded-lg text-sm" style={{ color: 'var(--text-negative)', backgroundColor: 'color-mix(in srgb, var(--text-negative) 10%, transparent)' }}>{error}</div>}
          <label className="text-xs block" style={{ color: 'var(--text-secondary)' }}>{t('Institución (se recuerda)', 'Institution (remembered)')}
            <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Interactive Brokers, Binance..." className={inputCls + ' mt-1'} />
          </label>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_5.5rem] sm:grid-cols-[1fr_7rem_1fr_1fr] gap-2">
                <input aria-label={t('Símbolo', 'Symbol')} value={r.symbol} onChange={(e) => setRow(i, 'symbol', e.target.value)} placeholder="VOO" className={inputCls + ' uppercase'} />
                <select aria-label={t('Tipo', 'Type')} value={r.type} onChange={(e) => setRow(i, 'type', e.target.value)} className={inputCls}>
                  {TYPES.map(([k, es, en]) => <option key={k} value={k}>{t(es, en)}</option>)}
                </select>
                <AmountInput aria-label={t('Cantidad', 'Quantity')} value={r.quantity} onChange={(e) => setRow(i, 'quantity', e.target.value)} placeholder={t('Cantidad', 'Quantity')} className={inputCls} />
                <AmountInput aria-label={t('Costo promedio', 'Average cost')} value={r.cost} onChange={(e) => setRow(i, 'cost', e.target.value)} placeholder={t('Costo prom.', 'Avg cost')} className={inputCls} />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setRows((cur) => [...cur, emptyRow()])} className="text-xs underline" style={{ color: 'var(--accent-blue)' }}>
            {t('+ Agregar otra fila', '+ Add another row')}
          </button>
          <div className="flex items-center justify-between gap-3 pt-2">
            {onImport ? (
              <button type="button" onClick={onImport} className="text-xs underline" style={{ color: 'var(--text-muted)' }}>
                {t('¿Tienes un archivo? Importar CSV o Excel', 'Have a file? Import CSV or Excel')}
              </button>
            ) : <span />}
            <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
              <BusyLabel busy={saving} lang={lang}>{saving ? `${done}/${filled.length}` : t(`Registrar ${filled.length || ''}`.trim(), `Save ${filled.length || ''}`.trim())}</BusyLabel>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
