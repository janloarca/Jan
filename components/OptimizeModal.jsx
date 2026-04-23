'use client'

import { useState, useMemo } from 'react'

function generateQuestions(items, t) {
  const questions = []

  items.forEach((it) => {
    if (!it.acquisitionDate) {
      questions.push({
        id: `date_${it.id}`, item: it, priority: 1,
        title: t('Fecha de adquisición faltante', 'Missing acquisition date'),
        description: t('Sin fecha no podemos calcular rendimiento correctamente.', 'Without a date we cannot calculate returns correctly.'),
        fields: [
          { key: 'acquisitionDate', label: t('Fecha de compra', 'Purchase date'), type: 'date', current: '' },
        ],
      })
    }
  })

  items.forEach((it) => {
    if (!it.institution && !/bank|banco/i.test(it.type || '')) {
      questions.push({
        id: `inst_${it.id}`, item: it, priority: 2,
        title: t('Institución faltante', 'Missing institution'),
        description: t('¿En qué broker, banco o plataforma tienes este activo?', 'Which broker, bank or platform holds this asset?'),
        fields: [
          { key: 'institution', label: t('Institución', 'Institution'), type: 'text', current: '', placeholder: 'IBKR, Fidelity, BAM...' },
        ],
      })
    }
  })

  const skipPrice = /bank|banco|inmueble|real.?estate|property|inversion|inversión|bono|bond/i
  items.forEach((it) => {
    if (skipPrice.test(it.type || '')) {
      const val = it.currentPrice || it.purchasePrice || 0
      if (val > 0) {
        questions.push({
          id: `bal_${it.id}`, item: it, priority: 3,
          title: /inmueble|real.?estate|property/i.test(it.type || '')
            ? t('Verificar valor del inmueble', 'Verify property value')
            : /inversion|inversión|bono|bond/i.test(it.type || '')
            ? t('Verificar valor de inversión', 'Verify investment value')
            : t('Verificar saldo bancario', 'Verify bank balance'),
          description: t('¿Este saldo sigue siendo correcto?', 'Is this balance still correct?'),
          fields: [
            { key: 'currentPrice', label: t('Valor actual', 'Current value'), type: 'number', current: val },
          ],
        })
      }
    }
  })

  items.forEach((it) => {
    const qty = it.quantity || 0
    const price = it.currentPrice || it.purchasePrice || 0
    if (qty <= 0 || price <= 0) {
      questions.push({
        id: `zero_${it.id}`, item: it, priority: 1,
        title: t('Activo con valor $0', 'Asset with $0 value'),
        description: t('Este activo no tiene valor registrado. ¿Actualizas o lo eliminamos?', 'This asset has no recorded value. Update or remove?'),
        fields: [
          { key: 'quantity', label: t('Cantidad', 'Quantity'), type: 'number', current: qty },
          { key: 'purchasePrice', label: t('Precio', 'Price'), type: 'number', current: price },
        ],
        canDelete: true,
      })
    }
  })

  items.forEach((it) => {
    if (it.acquisitionDate) {
      const ageMonths = (Date.now() - new Date(it.acquisitionDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
      if (ageMonths > 24) {
        const val = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)
        questions.push({
          id: `old_${it.id}`, item: it, priority: 4,
          title: t(`Activo de hace ${Math.round(ageMonths / 12)} años`, `Asset from ${Math.round(ageMonths / 12)} years ago`),
          description: t('¿Los datos siguen siendo correctos?', 'Is the data still correct?'),
          fields: [
            { key: 'quantity', label: t('Cantidad', 'Quantity'), type: 'number', current: it.quantity || 0 },
            { key: 'purchasePrice', label: t('Precio compra', 'Buy price'), type: 'number', current: it.purchasePrice || 0 },
            { key: 'acquisitionDate', label: t('Fecha', 'Date'), type: 'date', current: it.acquisitionDate || '' },
          ],
          canDelete: true,
        })
      }
    }
  })

  questions.sort((a, b) => a.priority - b.priority)
  const shuffled = questions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return Math.random() - 0.5
  })
  return shuffled.slice(0, 5)
}

const TYPE_ICONS = { Stock: '📈', Crypto: '₿', Fund: '💼', Inmueble: '🏠', Bank: '🏦', Inversion: '🏛' }

export default function OptimizeModal({ items, onClose, onSave, onDelete, lang = 'es' }) {
  const t = (es, en) => lang === 'es' ? es : en
  const questions = useMemo(() => generateQuestions(items, t), [items])

  const [step, setStep] = useState(0)
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState(false)

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

  const isDone = step >= questions.length
  const q = !isDone ? questions[step] : null

  const getVal = (fieldKey) => {
    const editKey = `${q.id}_${fieldKey}`
    if (edits[editKey] !== undefined) return edits[editKey]
    const field = q.fields.find((f) => f.key === fieldKey)
    return field?.current ?? ''
  }

  const setVal = (fieldKey, value) => {
    setEdits({ ...edits, [`${q.id}_${fieldKey}`]: value })
  }

  const hasChanges = () => {
    if (!q) return false
    return q.fields.some((f) => {
      const editKey = `${q.id}_${f.key}`
      return edits[editKey] !== undefined && edits[editKey] !== '' && String(edits[editKey]) !== String(f.current)
    })
  }

  const handleSave = async () => {
    if (!q) return
    setSaving(true)
    try {
      const updated = { ...q.item }
      q.fields.forEach((f) => {
        const val = getVal(f.key)
        if (val === '' || val === undefined) return
        if (f.type === 'number') {
          updated[f.key] = parseFloat(val) || 0
          if (f.key === 'currentPrice') updated.purchasePrice = updated.currentPrice
        } else {
          updated[f.key] = val
        }
      })
      await onSave(updated)
    } catch {}
    setSaving(false)
    setStep((s) => s + 1)
  }

  const handleDelete = async () => {
    if (!q) return
    setSaving(true)
    try {
      await onDelete(q.item.id)
    } catch {}
    setSaving(false)
    setStep((s) => s + 1)
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

  const itemValue = (q.item.quantity || 0) * (q.item.currentPrice || q.item.purchasePrice || 0)

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
          <div className="w-full h-1 bg-[#1e2d45] rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
              style={{ width: `${((step + 1) / questions.length) * 100}%` }} />
          </div>

          {/* Asset card */}
          <div className="bg-[#0b1120] rounded-lg p-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-lg">
                {TYPE_ICONS[q.item.type] || '💼'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{q.item.name || q.item.symbol}</p>
                <p className="text-[10px] text-slate-500">
                  {q.item.symbol} {q.item.institution ? `• ${q.item.institution}` : ''} • {q.item.currency || 'USD'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-white">${itemValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-slate-500">{q.item.quantity || 0} × ${(q.item.currentPrice || q.item.purchasePrice || 0).toLocaleString()}</p>
              </div>
            </div>
            {q.item.acquisitionDate && (
              <p className="text-[10px] text-slate-500 mt-2 pt-2 border-t border-[#1e2d45]">
                {t('Comprado:', 'Bought:')} {q.item.acquisitionDate}
              </p>
            )}
          </div>

          {/* Question */}
          <div>
            <p className="text-sm font-medium text-white">{q.title}</p>
            <p className="text-xs text-slate-400 mt-0.5">{q.description}</p>
          </div>

          {/* Editable fields */}
          <div className="space-y-2">
            {q.fields.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-slate-500">{f.label}</label>
                  {f.current !== '' && f.current !== 0 && (
                    <span className="text-[10px] text-slate-600">
                      {t('Actual:', 'Current:')} {f.type === 'number' ? Number(f.current).toLocaleString() : f.current}
                    </span>
                  )}
                </div>
                <input
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  step={f.type === 'number' ? 'any' : undefined}
                  placeholder={f.placeholder || (f.current !== '' ? String(f.current) : '')}
                  value={getVal(f.key)}
                  onChange={(e) => setVal(f.key, e.target.value)}
                  className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            {q.canDelete && (
              <button type="button" onClick={handleDelete} disabled={saving}
                className="px-3 py-2.5 text-xs font-medium border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50">
                {t('Eliminar', 'Delete')}
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={() => setStep((s) => s + 1)}
              className="px-4 py-2.5 border border-[#1e2d45] text-slate-400 rounded-lg hover:bg-[#1a2540] transition-colors text-xs">
              {t('Saltar', 'Skip')}
            </button>
            <button type="button" onClick={handleSave} disabled={saving || !hasChanges()}
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-40 transition-colors text-xs font-medium">
              {saving ? '...' : step < questions.length - 1 ? t('Guardar →', 'Save →') : t('Guardar ✓', 'Save ✓')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
