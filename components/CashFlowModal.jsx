'use client'

import { useState } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

const CURRENCIES = ['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY']

export default function CashFlowModal({ onClose, onAddTransaction, lang = 'es', baseCurrency = 'USD' }) {
  const trapRef = useFocusTrap()
  const [flowType, setFlowType] = useState('DEPOSIT')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(baseCurrency)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const t = (es, en) => lang === 'es' ? es : en

  const handleSubmit = async (e) => {
    e.preventDefault()
    const num = parseFloat(amount)
    if (!num || num <= 0) return
    setSaving(true)
    setError('')
    try {
      await onAddTransaction({
        date,
        type: flowType,
        symbol: flowType === 'DEPOSIT' ? 'DEPOSIT' : 'WITHDRAWAL',
        description: description || (flowType === 'DEPOSIT' ? t('Depósito', 'Deposit') : t('Retiro', 'Withdrawal')),
        totalAmount: num,
        amount: num,
        currency,
        _source: 'manual_cashflow',
      })
      onClose()
    } catch (err) {
      console.error('CashFlow error:', err)
      setError(t('Error guardando. Intenta de nuevo.', 'Error saving. Please try again.'))
    }
    setSaving(false)
  }

  const inputCls = 'w-full px-3 py-2.5 bg-[#000000] border border-[#27272a] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={trapRef} className="bg-[#141416] border border-[#27272a] rounded-xl shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
          <h2 className="text-lg font-bold text-white">{t('Registrar Movimiento', 'Log Cash Flow')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setFlowType('DEPOSIT')}
              className={`flex-1 px-3 py-3 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${
                flowType === 'DEPOSIT'
                  ? 'border-2'
                  : 'bg-[#000000] text-slate-400 border-2 border-[#27272a] hover:border-slate-500'
              }`}
              style={flowType === 'DEPOSIT' ? { color: 'var(--accent-green)', backgroundColor: 'rgba(52,211,153,0.2)', borderColor: 'rgba(52,211,153,0.5)' } : undefined}>
              <span className="text-lg">+</span> {t('Depósito', 'Deposit')}
            </button>
            <button type="button" onClick={() => setFlowType('WITHDRAWAL')}
              className={`flex-1 px-3 py-3 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${
                flowType === 'WITHDRAWAL'
                  ? 'border-2'
                  : 'bg-[#000000] text-slate-400 border-2 border-[#27272a] hover:border-slate-500'
              }`}
              style={flowType === 'WITHDRAWAL' ? { color: 'var(--text-negative)', backgroundColor: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.5)' } : undefined}>
              <span className="text-lg">-</span> {t('Retiro', 'Withdrawal')}
            </button>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Monto', 'Amount')}</label>
            <div className="flex gap-2">
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="10000" step="any" min="0" autoFocus
                className={`${inputCls} flex-1 text-lg font-bold`} />
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="px-3 py-2.5 bg-[#000000] border border-[#27272a] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50 w-20">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Fecha', 'Date')}</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]} className={inputCls} />
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('Descripción (opcional)', 'Description (optional)')}</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder={flowType === 'DEPOSIT' ? t('Ej: Aporte mensual', 'E.g. Monthly contribution') : t('Ej: Gastos personales', 'E.g. Personal expenses')}
              className={inputCls} />
          </div>

          <div className="bg-[#000000] rounded-lg p-3 text-xs text-slate-400">
            {flowType === 'DEPOSIT'
              ? t('Un depósito indica dinero nuevo que entra a tu portafolio. Esto ajusta el cálculo de retornos para no confundir aportes con ganancias.',
                  'A deposit indicates new money entering your portfolio. This adjusts return calculations so contributions aren\'t confused with gains.')
              : t('Un retiro indica dinero que sale de tu portafolio. Esto ajusta el cálculo de retornos correctamente.',
                  'A withdrawal indicates money leaving your portfolio. This adjusts return calculations correctly.')}
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-[#27272a] text-slate-300 rounded-lg hover:bg-[#2C2C2E] transition-colors text-sm">
              {t('Cancelar', 'Cancel')}
            </button>
            <button type="submit" disabled={saving || !amount || parseFloat(amount) <= 0}
              className="flex-1 px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-40"
              style={{ backgroundColor: flowType === 'DEPOSIT' ? '#059669' : '#dc2626' }}>
              {saving ? '...' : t('Registrar', 'Log')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
