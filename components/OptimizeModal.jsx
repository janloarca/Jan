'use client'

import { useState, useEffect, useMemo } from 'react'

const TYPE_ICONS = { Stock: '📈', Crypto: '₿', Fund: '💼', Inmueble: '🏠', Bank: '🏦', Inversion: '🏛' }
const CURRENCIES = ['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY']

const INSTITUTION_CURRENCY = {
  bi: 'GTQ', banrural: 'GTQ', bam: 'GTQ', industrial: 'GTQ', bantrab: 'GTQ',
  'g&t': 'GTQ', gyt: 'GTQ', ficohsa: 'GTQ', promerica: 'GTQ',
  banamex: 'MXN', banorte: 'MXN', azteca: 'MXN',
  bancolombia: 'COP', davivienda: 'COP', nequi: 'COP',
  bcp: 'PEN', interbank: 'PEN',
  itau: 'BRL', bradesco: 'BRL', nubank: 'BRL',
  'banco estado': 'CLP', bci: 'CLP',
  chase: 'USD', 'wells fargo': 'USD', citi: 'USD', schwab: 'USD',
  fidelity: 'USD', vanguard: 'USD', ibkr: 'USD',
  barclays: 'GBP', lloyds: 'GBP',
}

function detectCurrency(institution) {
  if (!institution) return null
  const lower = institution.toLowerCase().trim()
  for (const [key, cur] of Object.entries(INSTITUTION_CURRENCY)) {
    if (lower.includes(key) || lower === key) return cur
  }
  return null
}

function generateQuestions(items, t) {
  const questions = []
  const isBank = (it) => /bank|banco/i.test(it.type || '')
  const isProperty = (it) => /inmueble|real.?estate|property/i.test(it.type || '')
  const isInvestment = (it) => /inversion|inversión|bono|bond/i.test(it.type || '')
  const isMarket = (it) => /stock|crypto|fund|etf/i.test(it.type || '')

  items.forEach((it) => {
    const inst = (it.institution || '').toLowerCase()
    const suggested = detectCurrency(inst)
    const current = it.currency || 'USD'
    if (suggested && suggested !== current && (isBank(it) || isInvestment(it))) {
      questions.push({ id: `cur_${it.id}`, item: it, priority: 0, category: 'moneda',
        title: t(`¿${it.name || it.symbol} está en ${current}?`, `Is ${it.name || it.symbol} in ${current}?`),
        subtitle: t(`Detectamos que ${it.institution} normalmente usa ${suggested}. Verifica la moneda.`,
          `We detected ${it.institution} typically uses ${suggested}. Verify the currency.`),
        suggestedCurrency: suggested,
      })
    }
  })

  items.forEach((it) => {
    if (!it.acquisitionDate) {
      questions.push({ id: `date_${it.id}`, item: it, priority: 1, category: 'fecha',
        title: isBank(it)
          ? t('¿Cuándo abriste esta cuenta?', 'When did you open this account?')
          : isProperty(it)
          ? t('¿Cuándo compraste este inmueble?', 'When did you buy this property?')
          : t('¿Cuándo adquiriste este activo?', 'When did you acquire this asset?'),
        subtitle: t('Sin esta fecha, las gráficas de rendimiento no arrancan bien. El sistema asume que existió desde siempre.',
          'Without this date, performance charts start wrong. The system assumes it existed since the beginning.'),
      })
    }
  })

  items.forEach((it) => {
    if (!it.institution) {
      questions.push({ id: `inst_${it.id}`, item: it, priority: 2, category: 'institucion',
        title: t('¿Dónde está este activo?', 'Where is this asset held?'),
        subtitle: t('Saber la institución ayuda a organizar y detectar la moneda correcta.',
          'Knowing the institution helps organize and detect the correct currency.'),
      })
    }
  })

  items.forEach((it) => {
    if (isBank(it) || isProperty(it) || isInvestment(it)) {
      const updatedAt = it.updatedAt || it.createdAt
      const daysSinceUpdate = updatedAt ? Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000) : 999
      if (daysSinceUpdate > 30) {
        questions.push({ id: `bal_${it.id}`, item: it, priority: 3, category: 'saldo',
          title: isProperty(it)
            ? t('¿Cuánto vale este inmueble hoy?', 'What is this property worth today?')
            : isInvestment(it)
            ? t('¿Cuál es el valor actual de esta inversión?', 'What is the current value of this investment?')
            : t('¿Cuál es tu saldo actual?', 'What is your current balance?'),
          subtitle: daysSinceUpdate < 999
            ? t(`Último cambio hace ${daysSinceUpdate} días. Actualiza para mejorar la precisión.`,
                `Last changed ${daysSinceUpdate} days ago. Update to improve accuracy.`)
            : t('Mantener el saldo actualizado mejora la precisión.', 'Keeping the balance updated improves accuracy.'),
        })
      }
    }
  })

  items.forEach((it) => {
    if (isMarket(it) && it.incomeAmount > 0) {
      questions.push({ id: `div_${it.id}`, item: it, priority: 4, category: 'dividendo',
        title: t(`¿${it.name || it.symbol} te pagó dividendos recientemente?`, `Did ${it.name || it.symbol} pay dividends recently?`),
        subtitle: t('Confirma si recibiste el último pago programado.', 'Confirm if you received the last scheduled payment.'),
      })
    }
  })

  items.forEach((it) => {
    if ((isInvestment(it) || isBank(it)) && (it.incomeAmount > 0 || it.incomeRate > 0)) {
      questions.push({ id: `rate_${it.id}`, item: it, priority: 4, category: 'tasa',
        title: t('¿Cambió la tasa o el monto de intereses?', 'Did the interest rate or amount change?'),
        subtitle: t('Las tasas cambian. Mantén tus datos actualizados.', 'Rates change. Keep your data current.'),
      })
    }
  })

  items.forEach((it) => {
    const qty = it.quantity || 0
    const price = it.currentPrice || it.purchasePrice || 0
    if (qty <= 0 || price <= 0) {
      questions.push({ id: `zero_${it.id}`, item: it, priority: 1, category: 'cero',
        title: t('Este activo tiene valor $0', 'This asset has $0 value'),
        subtitle: t('¿Lo actualizamos o lo eliminamos?', 'Should we update or remove it?'),
      })
    }
  })

  questions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return Math.random() - 0.5
  })
  return questions.slice(0, 8)
}

export default function OptimizeModal({ items, onClose, onSave, onDelete, lang = 'es' }) {
  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const questions = useMemo(() => generateQuestions(items, t), [items])
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  const initForm = (q) => {
    const it = q.item
    return {
      acquisitionDate: it.acquisitionDate || '',
      institution: it.institution || '',
      quantity: it.quantity?.toString() || '',
      purchasePrice: it.purchasePrice?.toString() || '',
      currentPrice: (it.currentPrice || it.purchasePrice || '').toString(),
      currency: q.category === 'moneda' && q.suggestedCurrency ? q.suggestedCurrency : (it.currency || 'USD'),
      incomeAmount: it.incomeAmount?.toString() || '',
      incomeRate: it.incomeRate?.toString() || '',
      incomeMode: it.incomeMode || 'fixed',
    }
  }

  if (questions.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl max-w-md w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-4xl mb-3">✅</div>
          <h3 className="text-lg font-bold text-white mb-2">{t('Todo en orden', 'All good')}</h3>
          <p className="text-sm text-slate-400 mb-4">{t('Tu portafolio tiene toda la información completa.', 'Your portfolio data is complete.')}</p>
          <button onClick={onClose} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 text-sm font-medium">{t('Cerrar', 'Close')}</button>
        </div>
      </div>
    )
  }

  const isDone = step >= questions.length
  const q = !isDone ? questions[step] : null

  if (!q && !isDone) return null

  const currentForm = form[step] || (q ? initForm(q) : {})
  const set = (k, v) => setForm({ ...form, [step]: { ...currentForm, [k]: v } })

  const isBankItem = /bank|banco/i.test(q?.item?.type || '')
  const isPropertyItem = /inmueble|real.?estate|property/i.test(q?.item?.type || '')
  const isInvestmentItem = /inversion|inversión|bono|bond/i.test(q?.item?.type || '')

  const handleSave = async () => {
    if (!q) return
    setSaving(true)
    try {
      const updated = { ...q.item }
      const f = currentForm
      if (f.acquisitionDate) updated.acquisitionDate = f.acquisitionDate
      if (f.institution) updated.institution = f.institution
      if (f.currency) updated.currency = f.currency
      if (f.quantity !== '' && f.quantity !== undefined) updated.quantity = parseFloat(f.quantity) || 0
      if (f.purchasePrice !== '' && f.purchasePrice !== undefined) updated.purchasePrice = parseFloat(f.purchasePrice) || 0
      if (f.currentPrice !== '' && f.currentPrice !== undefined) {
        updated.currentPrice = parseFloat(f.currentPrice) || 0
        if (isBankItem) updated.purchasePrice = updated.currentPrice
      }
      if (f.incomeMode) updated.incomeMode = f.incomeMode
      if (f.incomeAmount !== '' && f.incomeAmount !== undefined) updated.incomeAmount = parseFloat(f.incomeAmount) || 0
      if (f.incomeRate !== '' && f.incomeRate !== undefined) updated.incomeRate = parseFloat(f.incomeRate) || 0
      updated.updatedAt = new Date().toISOString()
      await onSave(updated)
    } catch {}
    setSaving(false)
    setStep((s) => s + 1)
  }

  const handleDelete = async () => {
    if (!q) return
    setSaving(true)
    try { await onDelete(q.item.id) } catch {}
    setSaving(false)
    setStep((s) => s + 1)
  }

  if (isDone) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl max-w-md w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-4xl mb-3">🎉</div>
          <h3 className="text-lg font-bold text-white mb-2">{t('¡Listo!', 'Done!')}</h3>
          <p className="text-sm text-slate-400 mb-4">{t('Tu portafolio está más actualizado.', 'Your portfolio is more up to date.')}</p>
          <button onClick={onClose} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 text-sm font-medium">{t('Cerrar', 'Close')}</button>
        </div>
      </div>
    )
  }

  const itemValue = isBankItem
    ? (q.item.currentPrice || q.item.purchasePrice || 0)
    : (q.item.quantity || 0) * (q.item.currentPrice || q.item.purchasePrice || 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
          <div className="flex items-center gap-2">
            <span className="text-lg">✨</span>
            <h2 className="text-sm font-bold text-white">{t('Optimizar', 'Optimize')}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{step + 1} / {questions.length}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="w-full h-1 bg-[#334155] rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all duration-300 rounded-full"
              style={{ width: `${((step + 1) / questions.length) * 100}%` }} />
          </div>

          {/* Asset card */}
          <div className="bg-[#0f172a] rounded-lg p-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-lg">
                {TYPE_ICONS[q.item.type] || '💼'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{q.item.name || q.item.symbol}</p>
                <p className="text-[10px] text-slate-500">
                  {q.item.symbol} {q.item.institution ? `• ${q.item.institution}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-white">
                  {itemValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} {q.item.currency || 'USD'}
                </p>
                {!isBankItem && <p className="text-[10px] text-slate-500">{q.item.quantity || 0} {t('unidades', 'units')}</p>}
                {q.item.acquisitionDate && <p className="text-[10px] text-slate-600">{q.item.acquisitionDate}</p>}
              </div>
            </div>

            {/* Inline currency selector on all cards */}
            {q.category !== 'moneda' && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[#334155]/50">
                <span className="text-[10px] text-slate-500">{t('Moneda:', 'Currency:')}</span>
                <select value={currentForm.currency} onChange={(e) => set('currency', e.target.value)}
                  className="px-2 py-0.5 bg-[#1e293b] border border-[#334155] rounded text-[11px] text-white focus:outline-none focus:border-blue-500/50">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-white">{q.title}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{q.subtitle}</p>
          </div>

          {/* === Category-specific fields === */}

          {q.category === 'moneda' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button type="button" onClick={() => set('currency', q.suggestedCurrency)}
                  className={`flex-1 px-3 py-3 rounded-lg border text-sm font-medium transition-all ${
                    currentForm.currency === q.suggestedCurrency
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                      : 'bg-[#0f172a] text-slate-400 border-[#334155] hover:border-slate-500'
                  }`}>
                  {q.suggestedCurrency}
                  <span className="block text-[10px] text-slate-500 mt-0.5">{t('Sugerido', 'Suggested')}</span>
                </button>
                <button type="button" onClick={() => set('currency', q.item.currency || 'USD')}
                  className={`flex-1 px-3 py-3 rounded-lg border text-sm font-medium transition-all ${
                    currentForm.currency === (q.item.currency || 'USD')
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                      : 'bg-[#0f172a] text-slate-400 border-[#334155] hover:border-slate-500'
                  }`}>
                  {q.item.currency || 'USD'}
                  <span className="block text-[10px] text-slate-500 mt-0.5">{t('Actual', 'Current')}</span>
                </button>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{t('O elige otra', 'Or choose another')}</label>
                <select value={currentForm.currency} onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}

          {q.category === 'fecha' && (
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">
                {isBankItem ? t('Fecha de apertura', 'Opening date')
                  : isPropertyItem ? t('Fecha de compra', 'Purchase date')
                  : t('Fecha de adquisición', 'Acquisition date')}
              </label>
              <input type="date" value={currentForm.acquisitionDate}
                onChange={(e) => set('acquisitionDate', e.target.value)}
                className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
            </div>
          )}

          {q.category === 'institucion' && (
            <div>
              <label className="text-[10px] text-slate-500 mb-1 block">{t('Institución / Broker / Banco', 'Institution / Broker / Bank')}</label>
              <input type="text" value={currentForm.institution} placeholder="IBKR, Fidelity, BAM, BI..."
                onChange={(e) => {
                  set('institution', e.target.value)
                  const hint = detectCurrency(e.target.value)
                  if (hint) set('currency', hint)
                }}
                className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
            </div>
          )}

          {q.category === 'saldo' && (
            <div className="space-y-2">
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-[10px] text-slate-500">
                    {isBankItem ? t('Saldo actual', 'Current balance') : t('Valor actual', 'Current value')}
                  </label>
                  <span className="text-[10px] text-slate-600">
                    {t('Registrado:', 'Recorded:')} {Number(q.item.currentPrice || q.item.purchasePrice || 0).toLocaleString()} {currentForm.currency}
                  </span>
                </div>
                <input type="number" step="any" value={currentForm.currentPrice}
                  onChange={(e) => set('currentPrice', e.target.value)}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
              </div>
            </div>
          )}

          {q.category === 'dividendo' && (
            <div className="space-y-3">
              <div className="bg-[#0f172a] rounded-lg p-3 border border-[#334155]/50">
                <p className="text-[10px] text-slate-500 mb-1">{t('Dividendo registrado', 'Recorded dividend')}</p>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-emerald-400">
                    ${(q.item.incomeAmount || 0).toFixed(2)} / {t('pago', 'payment')}
                  </span>
                  {q.item.dividendYield > 0 && (
                    <span className="text-xs text-slate-400">({q.item.dividendYield}% {t('anual', 'annual')})</span>
                  )}
                </div>
                {q.item.incomeFrequency && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    {{ monthly: t('Mensual','Monthly'), quarterly: t('Trimestral','Quarterly'), semiannual: t('Semestral','Semiannual'), annual: t('Anual','Annual') }[q.item.incomeFrequency] || q.item.incomeFrequency}
                  </p>
                )}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">{t('Nuevo monto por pago (si cambió)', 'New amount per payment (if changed)')}</label>
                <input type="number" step="any" value={currentForm.incomeAmount}
                  placeholder={(q.item.incomeAmount || 0).toString()}
                  onChange={(e) => set('incomeAmount', e.target.value)}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
            </div>
          )}

          {q.category === 'tasa' && (
            <div className="space-y-3">
              <div className="bg-[#0f172a] rounded-lg p-3 border border-[#334155]/50">
                <p className="text-[10px] text-slate-500 mb-1">{t('Configuración actual', 'Current setting')}</p>
                {q.item.incomeMode === 'percent' ? (
                  <span className="text-sm font-semibold text-emerald-400">{q.item.incomeRate || 0}% {t('anual', 'annual')}</span>
                ) : (
                  <span className="text-sm font-semibold text-emerald-400">${(q.item.incomeAmount || 0).toFixed(2)} / {t('pago', 'payment')}</span>
                )}
              </div>
              <div className="flex gap-1 mb-1">
                <button type="button" onClick={() => set('incomeMode', 'fixed')}
                  className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all ${
                    currentForm.incomeMode === 'fixed' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0f172a] text-slate-500 border border-[#334155]'
                  }`}>{t('Monto fijo', 'Fixed amount')}</button>
                <button type="button" onClick={() => set('incomeMode', 'percent')}
                  className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded transition-all ${
                    currentForm.incomeMode === 'percent' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0f172a] text-slate-500 border border-[#334155]'
                  }`}>{t('% anual', '% annual')}</button>
              </div>
              {currentForm.incomeMode === 'fixed' ? (
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">{t('Monto por pago', 'Amount per payment')}</label>
                  <input type="number" step="any" value={currentForm.incomeAmount}
                    placeholder={(q.item.incomeAmount || 0).toString()}
                    onChange={(e) => set('incomeAmount', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
              ) : (
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">{t('Tasa anual %', 'Annual rate %')}</label>
                  <input type="number" step="any" value={currentForm.incomeRate}
                    placeholder={(q.item.incomeRate || 0).toString()}
                    onChange={(e) => set('incomeRate', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
              )}
            </div>
          )}

          {q.category === 'cero' && (
            <div className="space-y-2">
              {!isBankItem ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">{t('Cantidad', 'Quantity')}</label>
                    <input type="number" step="any" value={currentForm.quantity}
                      onChange={(e) => set('quantity', e.target.value)}
                      className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 mb-1 block">{t('Precio', 'Price')}</label>
                    <input type="number" step="any" value={currentForm.purchasePrice}
                      onChange={(e) => set('purchasePrice', e.target.value)}
                      className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] text-slate-500 mb-1 block">{t('Saldo actual', 'Current balance')}</label>
                  <input type="number" step="any" value={currentForm.currentPrice}
                    onChange={(e) => set('currentPrice', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50" />
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {q.category === 'cero' && (
              <button type="button" onClick={handleDelete} disabled={saving}
                className="px-3 py-2.5 text-xs font-medium border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50">
                {t('Eliminar', 'Delete')}
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={() => setStep((s) => s + 1)}
              className="px-4 py-2.5 border border-[#334155] text-slate-400 rounded-lg hover:bg-[#283548] transition-colors text-xs">
              {t('Sin cambios →', 'No changes →')}
            </button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-xs font-medium">
              {saving ? '...' : t('Guardar →', 'Save →')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
