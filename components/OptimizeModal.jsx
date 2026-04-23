'use client'

import { useState, useMemo } from 'react'

function generateQuestions(items, t) {
  const questions = []

  items.forEach((it) => {
    if (!it.acquisitionDate) {
      questions.push({
        id: `date_${it.id}`, item: it, type: 'missing_date',
        text: t(`¿Cuándo compraste ${it.name || it.symbol}?`, `When did you buy ${it.name || it.symbol}?`),
        field: 'acquisitionDate', inputType: 'date',
      })
    }
  })

  items.forEach((it) => {
    if (!it.institution && !/bank|banco/i.test(it.type || '')) {
      questions.push({
        id: `inst_${it.id}`, item: it, type: 'missing_institution',
        text: t(`¿En qué broker o banco tienes ${it.name || it.symbol}?`, `Which broker or bank holds ${it.name || it.symbol}?`),
        field: 'institution', inputType: 'text', placeholder: 'IBKR, Fidelity, BAM...',
      })
    }
  })

  items.forEach((it) => {
    if ((it.quantity || 0) <= 0 || ((it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)) <= 0) {
      questions.push({
        id: `zero_${it.id}`, item: it, type: 'zero_value',
        text: t(`${it.name || it.symbol} tiene valor $0. ¿Aún lo tienes?`, `${it.name || it.symbol} has $0 value. Do you still own it?`),
        field: '_action', inputType: 'confirm_delete',
      })
    }
  })

  const skipPrice = /bank|banco|inmueble|real.?estate|property/i
  items.forEach((it) => {
    if (skipPrice.test(it.type || '')) {
      const val = it.currentPrice || it.purchasePrice || 0
      if (val > 0) {
        questions.push({
          id: `bal_${it.id}`, item: it, type: 'update_balance',
          text: /inmueble|real.?estate|property/i.test(it.type || '')
            ? t(`¿Cuál es el valor actual de ${it.name || it.symbol}?`, `What's the current value of ${it.name || it.symbol}?`)
            : t(`¿Cuál es el saldo actual de ${it.name || it.symbol}?`, `What's the current balance of ${it.name || it.symbol}?`),
          field: 'currentPrice', inputType: 'number', currentVal: val,
        })
      }
    }
  })

  items.forEach((it) => {
    if (it.acquisitionDate) {
      const ageMonths = (Date.now() - new Date(it.acquisitionDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
      if (ageMonths > 24) {
        questions.push({
          id: `old_${it.id}`, item: it, type: 'still_active',
          text: t(
            `${it.name || it.symbol} lo compraste hace ${Math.round(ageMonths / 12)} años. ¿Sigue vigente?`,
            `${it.name || it.symbol} was bought ${Math.round(ageMonths / 12)} years ago. Still active?`
          ),
          field: '_action', inputType: 'confirm_keep',
        })
      }
    }
  })

  const shuffled = questions.sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 5)
}

export default function OptimizeModal({ items, onClose, onSave, onDelete, lang = 'es' }) {
  const t = (es, en) => lang === 'es' ? es : en
  const questions = useMemo(() => generateQuestions(items, t), [items])

  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState({})
  const [saved, setSaved] = useState({})

  if (questions.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-md w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-4xl mb-3">✅</div>
          <h3 className="text-lg font-bold text-white mb-2">{t('Todo en orden', 'All good')}</h3>
          <p className="text-sm text-slate-400 mb-4">{t('Tu portafolio tiene toda la información completa.', 'Your portfolio data is complete.')}</p>
          <button onClick={onClose} className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 text-sm font-medium">
            {t('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    )
  }

  const q = questions[step]
  const isLast = step >= questions.length - 1
  const isDone = step >= questions.length

  const handleSave = async () => {
    if (!q || saved[q.id]) return
    const val = answers[q.id]

    if (q.inputType === 'confirm_delete' && val === 'delete') {
      await onDelete(q.item.id)
    } else if (q.inputType === 'confirm_keep' && val === 'delete') {
      await onDelete(q.item.id)
    } else if (val && q.field && q.field !== '_action') {
      const updated = { ...q.item }
      if (q.inputType === 'number') {
        updated[q.field] = parseFloat(val) || 0
        if (q.field === 'currentPrice') updated.purchasePrice = updated.currentPrice
      } else {
        updated[q.field] = val
      }
      await onSave(updated)
    }

    setSaved((s) => ({ ...s, [q.id]: true }))
    if (!isLast) {
      setStep((s) => s + 1)
    } else {
      setStep(questions.length)
    }
  }

  if (isDone) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
        <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-md w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-4xl mb-3">🎉</div>
          <h3 className="text-lg font-bold text-white mb-2">{t('¡Listo!', 'Done!')}</h3>
          <p className="text-sm text-slate-400 mb-4">{t('Tu portafolio está más actualizado.', 'Your portfolio is more up to date.')}</p>
          <button onClick={onClose} className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 text-sm font-medium">
            {t('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45]">
          <div className="flex items-center gap-2">
            <span className="text-lg">✨</span>
            <h2 className="text-sm font-bold text-white">{t('Optimizar Información', 'Optimize Info')}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{step + 1} / {questions.length}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Progress bar */}
          <div className="w-full h-1 bg-[#1e2d45] rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
              style={{ width: `${((step + 1) / questions.length) * 100}%` }} />
          </div>

          {/* Asset context */}
          <div className="flex items-center gap-3 bg-[#0b1120] rounded-lg p-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-lg">
              {q.item.type === 'Stock' ? '📈' : q.item.type === 'Crypto' ? '₿' : q.item.type === 'Bank' ? '🏦' : q.item.type === 'Inmueble' ? '🏠' : '💼'}
            </div>
            <div>
              <p className="text-sm font-medium text-white">{q.item.name || q.item.symbol}</p>
              <p className="text-[10px] text-slate-500">
                {q.item.symbol} {q.item.institution ? `• ${q.item.institution}` : ''} {q.item.currency ? `• ${q.item.currency}` : ''}
              </p>
            </div>
          </div>

          {/* Question */}
          <p className="text-sm text-slate-300 font-medium">{q.text}</p>

          {/* Input */}
          {q.inputType === 'date' && (
            <input type="date" value={answers[q.id] || ''}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              className="w-full px-3 py-2.5 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50" />
          )}

          {q.inputType === 'text' && (
            <input type="text" value={answers[q.id] || ''} placeholder={q.placeholder || ''}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              className="w-full px-3 py-2.5 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
          )}

          {q.inputType === 'number' && (
            <div>
              {q.currentVal != null && (
                <p className="text-[10px] text-slate-500 mb-1">
                  {t('Valor actual registrado:', 'Current recorded value:')} {q.currentVal.toLocaleString()} {q.item.currency}
                </p>
              )}
              <input type="number" step="any" value={answers[q.id] ?? ''} placeholder={q.currentVal?.toString() || '0'}
                onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                className="w-full px-3 py-2.5 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
            </div>
          )}

          {q.inputType === 'confirm_delete' && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setAnswers({ ...answers, [q.id]: 'keep' })}
                className={`flex-1 px-3 py-2.5 text-xs font-medium rounded-lg transition-all ${
                  answers[q.id] === 'keep' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                }`}>{t('Sí, aún lo tengo', 'Yes, still own it')}</button>
              <button type="button" onClick={() => setAnswers({ ...answers, [q.id]: 'delete' })}
                className={`flex-1 px-3 py-2.5 text-xs font-medium rounded-lg transition-all ${
                  answers[q.id] === 'delete' ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                }`}>{t('No, eliminarlo', 'No, remove it')}</button>
            </div>
          )}

          {q.inputType === 'confirm_keep' && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setAnswers({ ...answers, [q.id]: 'keep' })}
                className={`flex-1 px-3 py-2.5 text-xs font-medium rounded-lg transition-all ${
                  answers[q.id] === 'keep' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                }`}>{t('Sí, sigue vigente', 'Yes, still active')}</button>
              <button type="button" onClick={() => setAnswers({ ...answers, [q.id]: 'delete' })}
                className={`flex-1 px-3 py-2.5 text-xs font-medium rounded-lg transition-all ${
                  answers[q.id] === 'delete' ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-[#0b1120] text-slate-500 border border-[#1e2d45]'
                }`}>{t('Ya no, eliminarlo', 'No longer, remove it')}</button>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { if (!isLast) setStep(s => s + 1); else setStep(questions.length) }}
              className="flex-1 py-2.5 border border-[#1e2d45] text-slate-400 rounded-lg hover:bg-[#1a2540] transition-colors text-sm">
              {t('Saltar', 'Skip')}
            </button>
            <button type="button" onClick={handleSave}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
              {isLast ? t('Guardar y terminar', 'Save & finish') : t('Guardar y siguiente', 'Save & next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
