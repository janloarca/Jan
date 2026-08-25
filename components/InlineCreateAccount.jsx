'use client'

import { useState } from 'react'
import { detectCurrency } from '@/lib/institutionCurrency'
import { currencyOptions } from '@/lib/currencies'
import AmountInput from '@/components/ui/AmountInput'
import { parseAmount } from '@/lib/numberParse'
import BusyLabel from '@/components/ui/BusyLabel'


const SUBTYPES = [
  { key: 'checking', es: 'Corriente', en: 'Checking' },
  { key: 'savings', es: 'Ahorro', en: 'Savings' },
  { key: 'cd', es: 'Plazo fijo', en: 'CD' },
]

// Inline form to create a destination (cash) account on the spot, so a user can
// route income to an account that doesn't exist yet without leaving the modal.
// `onCreate` must return the new item id (e.g. addItem). On success it calls
// `onCreated(id, item)` so the caller can select it as the destination.
// `sourceAcquisitionDate`: when this account is being created AS the income or
// capital destination of another item (VITALI's Fondo Líquido, say), it should
// exist from the SAME date that item does, not from today. Defaulting to today
// used to gate every historical reconstruction: the destination's effective
// acquisition date came out later than its first real payment, so the whole
// past (including the payment that already landed) got dropped from the
// spreadsheet — a real coupon the app had correctly tracked simply vanished
// from history because the account "hadn't been created yet" on that date.
export default function InlineCreateAccount({ onCreate, onCancel, onCreated, lang = 'es', defaultCurrency = 'USD', sourceAcquisitionDate = null }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [name, setName] = useState('')
  const [institution, setInstitution] = useState('')
  const [subtype, setSubtype] = useState('checking')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [currencyTouched, setCurrencyTouched] = useState(false)
  const [balance, setBalance] = useState('')
  const [acquisitionDate, setAcquisitionDate] = useState(sourceAcquisitionDate || new Date().toLocaleDateString('en-CA'))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const inputCls = 'w-full px-3 py-2 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg text-sm text-[var(--text-primary,white)] focus:outline-none focus:border-blue-500/50'

  const submit = async () => {
    if (busy) return
    const nm = name.trim()
    if (!nm) { setErr(t('Ingresa un nombre', 'Enter a name')); return }
    setErr('')
    setBusy(true)
    try {
      // parseAmount y no parseFloat: '12.500' son doce mil quinientos, y
      // parseFloat los leia como 12.5, mil veces menos y en silencio.
      const bal = parseAmount(balance)
      const inst = institution.trim()
      const newItem = {
        type: 'Bank',
        subtype,
        name: nm,
        symbol: `${(inst || nm).replace(/\s+/g, '-').toUpperCase().slice(0, 16)}-CASH`,
        institution: inst,
        currency,
        quantity: 1,
        purchasePrice: bal,
        currentPrice: bal,
        accountType: 'taxable',
        acquisitionDate,
      }
      const newId = await onCreate(newItem)
      if (!newId) throw new Error(t('No se pudo crear la cuenta', 'Could not create account'))
      onCreated(newId, newItem)
    } catch (e) {
      setErr(e.message || t('Error al crear', 'Create failed'))
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 p-3 rounded-lg border space-y-2.5"
      style={{ borderColor: 'rgba(37,99,235,0.4)', backgroundColor: 'rgba(37,99,235,0.06)' }}>
      <p className="text-xs font-medium" style={{ color: 'var(--accent-blue-soft, #60a5fa)' }}>
        {t('Nueva cuenta destino', 'New destination account')}
      </p>
      {err && <p className="text-xs" style={{ color: 'var(--text-negative, #f87171)' }}>{err}</p>}
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder={t('Nombre (ej. Cuenta líquida)', 'Name (e.g. Cash account)')} className={inputCls} autoFocus />
      <input value={institution} onChange={e => {
          setInstitution(e.target.value)
          if (!currencyTouched) { const hint = detectCurrency(e.target.value); if (hint) setCurrency(hint) }
        }}
        placeholder={t('Banco (ej. BAM, IBKR...)', 'Bank (e.g. Chase, IBKR...)')} className={inputCls} />
      <div>
        <span className="text-xs text-[var(--text-muted,#64748b)] mb-1 block">{t('Tipo de cuenta', 'Account type')}</span>
        <div className="flex gap-1.5">
          {SUBTYPES.map(s => (
            <button key={s.key} type="button" onClick={() => setSubtype(s.key)}
              className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
              style={subtype === s.key
                ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' }
                : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
              {lang === 'es' ? s.es : s.en}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <AmountInput value={balance} onChange={e => setBalance(e.target.value)}
          placeholder={t('Saldo de hoy (opcional)', 'Balance today (optional)')}
          className={inputCls} />
        <select value={currency} onChange={e => { setCurrency(e.target.value); setCurrencyTouched(true) }} className={inputCls}>
          {currencyOptions(currency).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {/* It said "saldo inicial", which invites a 0 or an opening figure. The
          engine treats this number as TODAY's balance: past income routed here
          is reconstructed as history WITHOUT being added on top, precisely so a
          coupon already sitting in the account is not counted twice. Asking for
          the wrong figure here is what leaves the account short or long. */}
      <p className="text-xs" style={{ color: 'var(--text-muted,#64748b)' }}>
        {t('El saldo que tiene hoy, ya con los pagos que hayas recibido. No se le vuelven a sumar.',
           'The balance it holds today, including payments already received. They are not added again.')}
      </p>
      {/* Shown whenever there's a balance to backdate OR a source item already
          fixed the date for us — an empty NEW account with no source has
          nothing for a wrong date to distort, so it stays hidden there.
          Without this the account always saved dated "today", so a balance
          that really arrived months ago (e.g. an income payout routed here)
          showed as flat $0 the whole history and only jumped at the very last
          point of the chart. */}
      {(parseAmount(balance) > 0 || sourceAcquisitionDate) && (
        <div>
          <span className="text-xs text-[var(--text-muted,#64748b)] mb-1 block">{t('¿Desde cuándo tiene ese saldo?', 'Since when does it hold that balance?')}</span>
          <input value={acquisitionDate} onChange={e => setAcquisitionDate(e.target.value)}
            type="date" max={new Date().toISOString().split('T')[0]} className={inputCls} />
          {sourceAcquisitionDate ? (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted,#64748b)' }}>
              {t('Prellenada con la fecha del activo que la usa: cámbiala si esta cuenta ya existía antes.', 'Prefilled with the date of the asset using it: change it if this account existed before that.')}
            </p>
          ) : (
            <p className="text-xs mt-1" style={{ color: 'var(--accent-orange)' }}>
              {t('Si ya tenía ese dinero desde antes, pon la fecha real: si no, el historial la muestra plana hasta hoy.', 'If it already had that money before, use the real date: otherwise the history shows it flat until today.')}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 py-1.5 text-xs rounded-lg border border-[var(--card-border,#38383A)] text-[var(--text-secondary,#cbd5e1)]">
          {t('Cancelar', 'Cancel')}
        </button>
        <button type="button" onClick={submit} disabled={busy}
          className="flex-1 py-1.5 text-xs rounded-lg font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent-blue-strong, #2563eb)' }}>
          {<BusyLabel busy={busy} lang={lang}>{t('Crear y usar', 'Create & use')}</BusyLabel>}
        </button>
      </div>
    </div>
  )
}
