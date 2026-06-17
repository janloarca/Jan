'use client'

import { useState } from 'react'

const CURRENCIES = ['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY']

// Inline form to create a destination (cash) account on the spot, so a user can
// route income to an account that doesn't exist yet without leaving the modal.
// `onCreate` must return the new item id (e.g. addItem). On success it calls
// `onCreated(id, item)` so the caller can select it as the destination.
export default function InlineCreateAccount({ onCreate, onCancel, onCreated, lang = 'es', defaultCurrency = 'USD' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [name, setName] = useState('')
  const [institution, setInstitution] = useState('')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [balance, setBalance] = useState('')
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
      const bal = parseFloat(balance) || 0
      const inst = institution.trim()
      const newItem = {
        type: 'Bank',
        subtype: 'checking',
        name: nm,
        symbol: `${(inst || nm).replace(/\s+/g, '-').toUpperCase().slice(0, 16)}-CASH`,
        institution: inst,
        currency,
        quantity: 1,
        purchasePrice: bal,
        currentPrice: bal,
        accountType: 'taxable',
        acquisitionDate: new Date().toLocaleDateString('en-CA'),
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
    <div className="mt-2 p-3 rounded-lg border space-y-2"
      style={{ borderColor: 'rgba(59,130,246,0.4)', backgroundColor: 'rgba(59,130,246,0.06)' }}>
      <p className="text-xs font-medium" style={{ color: 'var(--accent-blue-soft, #60a5fa)' }}>
        {t('Nueva cuenta destino', 'New destination account')}
      </p>
      {err && <p className="text-xs" style={{ color: 'var(--text-negative, #f87171)' }}>{err}</p>}
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder={t('Nombre (ej. Cuenta Y)', 'Name (e.g. Account Y)')} className={inputCls} autoFocus />
      <div className="grid grid-cols-2 gap-2">
        <input value={institution} onChange={e => setInstitution(e.target.value)}
          placeholder={t('Banco (opcional)', 'Bank (optional)')} className={inputCls} />
        <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls}>
          {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <input value={balance} onChange={e => setBalance(e.target.value)}
        placeholder={t('Saldo inicial (opcional)', 'Initial balance (optional)')}
        type="number" step="any" className={inputCls} />
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 py-1.5 text-xs rounded-lg border border-[var(--card-border,#38383A)] text-[var(--text-secondary,#cbd5e1)]">
          {t('Cancelar', 'Cancel')}
        </button>
        <button type="button" onClick={submit} disabled={busy}
          className="flex-1 py-1.5 text-xs rounded-lg font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent-blue-strong, #2563eb)' }}>
          {busy ? '...' : t('Crear y usar', 'Create & use')}
        </button>
      </div>
    </div>
  )
}
