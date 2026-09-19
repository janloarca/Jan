'use client'

import { useMemo, useState, useCallback } from 'react'
import { Tags } from 'lucide-react'
import { unclassifiedMerchants } from '@/lib/unclassifiedMerchants'
import { suggestCategoryForLabel, isKnownCategory } from '@/lib/merchantLabels'
import { FINANCE_CATEGORIES, categoryLabel, isTransferCategory } from '@/lib/financeCategories'

// Un clic clasifica TODAS las filas de ese comercio (pasadas y, vía la regla
// aprendida, futuras). El campo de texto deja describir el lugar en las
// palabras del usuario ("mecánico") y la sugerencia traduce eso a categoría:
// el mismo camino que ya existe fila por fila en la lista, solo que agrupado
// por comercio y ordenado por dinero. Ver lib/unclassifiedMerchants.js para
// qué filas entran (solo lo que clasificó una máquina y sigue en "no supe").
export default function UnclassifiedTriage({
  transactions = [], convert = null, onApply = null, lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const triage = useMemo(
    () => unclassifiedMerchants(transactions, { convert }),
    [transactions, convert]
  )
  // Por comercio: la categoría elegida y la etiqueta libre.
  const [drafts, setDrafts] = useState({})
  const [busyKey, setBusyKey] = useState(null)

  // Clasificar una compra como "transferencia" la sacaría de los totales: esas
  // dos categorías se asignan por evidencia (neteo) o a mano en la fila, nunca
  // desde un triage masivo.
  const options = useMemo(
    () => FINANCE_CATEGORIES.EXPENSE.filter((c) => c !== 'Otros Gastos' && !isTransferCategory(c)),
    []
  )

  const setDraft = useCallback((key, patch) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }, [])

  const handleLabelChange = useCallback((key, label) => {
    const suggestion = suggestCategoryForLabel(label)
    setDrafts((prev) => {
      const cur = prev[key] || {}
      return {
        ...prev,
        [key]: {
          ...cur,
          label,
          // La sugerencia solo llena un select que el usuario no ha tocado:
          // una elección explícita nunca se pisa.
          category: cur.categoryTouched ? cur.category : (suggestion?.category || cur.category || ''),
        },
      }
    })
  }, [])

  const handleApply = useCallback(async (row) => {
    const draft = drafts[row.key] || {}
    const category = draft.category
    if (!category || !isKnownCategory(category, 'EXPENSE') || !onApply) return
    setBusyKey(row.key)
    try {
      await onApply(row, category, (draft.label || '').trim() || null)
    } finally {
      setBusyKey(null)
    }
  }, [drafts, onApply])

  if (triage.rows.length === 0) return null

  // Medio centavo de tolerancia: los dos totales salen del mismo recorrido, así
  // que solo pueden diferir por redondeo de conversión.
  const coversAll = Math.abs((triage.totalAll || 0) - (triage.coveredTotal || 0)) < 0.005
  const fmt = (v) => `Q${Math.abs(v || 0).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="card p-4 sm:p-5">
      <h3 className="card-title mb-1">
        <Tags size={14} aria-hidden="true" style={{ color: 'var(--accent-blue)' }} />
        {t('COMERCIOS SIN CLASIFICAR', 'UNCLASSIFIED MERCHANTS')}
      </h3>
      {/* El encabezado honesto: cuánto cubre lo que se muestra, de cuánto hay.
          Cuando lo cubre TODO, decir "Q440.30 de los Q440.30" es repetir la
          misma cifra dos veces y se lee como una plantilla a medio llenar: ahí
          la frase dice que no queda nada afuera, que es la información. */}
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        {coversAll
          ? t(`${triage.rows.length} ${triage.rows.length === 1 ? 'comercio explica' : 'comercios explican'} TODO lo que hay en "Otros Gastos" (${fmt(triage.totalAll)}). Clasificar uno arregla todas sus filas, pasadas y futuras.`,
               `${triage.rows.length} ${triage.rows.length === 1 ? 'merchant accounts' : 'merchants account'} for everything sitting in "Other" (${fmt(triage.totalAll)}). Classifying one fixes all its rows, past and future.`)
          : t(`${triage.rows.length} ${triage.rows.length === 1 ? 'comercio cubre' : 'comercios cubren'} ${fmt(triage.coveredTotal)} de los ${fmt(triage.totalAll)} en "Otros Gastos". Clasificar uno arregla todas sus filas, pasadas y futuras.`,
               `${triage.rows.length} ${triage.rows.length === 1 ? 'merchant covers' : 'merchants cover'} ${fmt(triage.coveredTotal)} of the ${fmt(triage.totalAll)} sitting in "Other". Classifying one fixes all its rows, past and future.`)}
        {triage.moreCount > 0 && ' ' + t(`Quedan ${triage.moreCount} más, en la lista de movimientos.`, `${triage.moreCount} more remain, in the transaction list.`)}
      </p>

      <div className="space-y-3">
        {triage.rows.map((row) => {
          const draft = drafts[row.key] || {}
          const canApply = !!draft.category && busyKey !== row.key
          return (
            <div key={row.key} className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: 'var(--bg-card-hover)', borderColor: 'var(--card-border)' }}>
              <div className="flex items-center justify-between gap-2 text-xs mb-2">
                <span className="truncate font-medium min-w-0" style={{ color: 'var(--text-secondary)' }}>{row.merchant}</span>
                <span className="font-mono tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {row.count} {t(row.count === 1 ? 'mov.' : 'movs.', row.count === 1 ? 'txn' : 'txns')} · {fmt(row.total)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={draft.label || ''}
                  onChange={(e) => handleLabelChange(row.key, e.target.value)}
                  placeholder={t('¿Qué es? (ej. mecánico)', 'What is it? (e.g. mechanic)')}
                  className="flex-1 min-w-[130px] px-2.5 py-1.5 rounded-lg border text-xs"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)', color: 'var(--text-primary)' }}
                />
                <select
                  value={draft.category || ''}
                  onChange={(e) => setDraft(row.key, { category: e.target.value, categoryTouched: true })}
                  className="px-2 py-1.5 rounded-lg border text-xs"
                  style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)', color: 'var(--text-primary)' }}
                >
                  <option value="">{t('Categoría…', 'Category…')}</option>
                  {options.map((c) => <option key={c} value={c}>{categoryLabel(c, lang)}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => handleApply(row)}
                  disabled={!canApply}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
                  style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
                >
                  {busyKey === row.key ? '…' : t('Aplicar', 'Apply')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
