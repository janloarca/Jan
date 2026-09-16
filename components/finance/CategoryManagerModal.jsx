'use client'

import { useState, useMemo, useCallback } from 'react'
import { Plus, Eye, EyeOff, Trash2, ChevronLeft } from 'lucide-react'
import { useEscClose } from '@/hooks/useEscClose'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import BusyLabel from '@/components/ui/BusyLabel'
import {
  resolveCategoryModel, groupsFor, categoryNameProblem, normalizeCategoryKey,
  withCustomCategory, withCategoryOverride, withoutCustomCategory,
  canDeleteCustomCategory, isBuiltinCategory,
} from '@/lib/financeCategoryModel'

// Cambiar y agregar categorías.
//
// ⛔ LO QUE ESTA PANTALLA NO PUEDE HACER, Y POR QUÉ SE DICE EN VOZ ALTA EN VEZ
// DE SOLO DESHABILITAR UN BOTÓN: el string en español de una categoría de
// fábrica ES la llave guardada en cada transacción y la que los parsers de los
// bancos siguen escribiendo. Renombrarla rompería todo lo ya registrado. Así
// que una de fábrica se puede RE-ROTULAR (cambia lo que se ve, la llave no),
// mover de grupo, marcar fija o variable y esconder del selector; lo que no se
// puede es borrarla ni cambiarle la llave.
//
// Esconder NUNCA esconde datos: una fila que ya usa esa categoría se sigue
// viendo con su rótulo. Solo desaparece de los selectores, que es lo que uno de
// verdad quiere cuando una categoría no aplica a su vida.

const FIELD = 'rounded-lg border px-2.5 py-2 text-xs w-full min-h-[38px]'
const FIELD_STYLE = {
  backgroundColor: 'var(--bg-tertiary)',
  borderColor: 'var(--card-border)',
  color: 'var(--text-primary)',
}

export default function CategoryManagerModal({
  config, onSave, transactions = [], lang = 'es', onClose,
}) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  useEscClose(onClose)

  const [draft, setDraft] = useState(() => config || { custom: [], overrides: [] })
  const [side, setSide] = useState('EXPENSE')
  const [editing, setEditing] = useState(null)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const model = useMemo(() => resolveCategoryModel(draft), [draft])
  const list = side === 'INCOME' ? model.income : model.expense
  const groups = useMemo(() => groupsFor(side), [side])

  // Cuántas filas usa cada categoría: es lo que decide si una custom se puede
  // borrar, y de paso le dice al usuario qué está por esconder.
  const useCount = useMemo(() => {
    const m = {}
    for (const tx of transactions || []) {
      if (tx?.category) m[tx.category] = (m[tx.category] || 0) + 1
    }
    return m
  }, [transactions])

  const entry = editing ? model.entry(editing) : null

  const patch = useCallback((key, p) => {
    setDraft((d) => withCategoryOverride(d, key, p))
  }, [])

  const addNew = useCallback(() => {
    setError('')
    const problem = categoryNameProblem(newName, { model, type: side })
    if (problem) {
      setError(problem === 'empty' ? t('Escribe un nombre', 'Type a name')
        : problem === 'builtin' ? t('Ya existe una categoría de fábrica con ese nombre', 'A built-in category already has that name')
          : t('Ya tienes una categoría con ese nombre', 'You already have a category with that name'))
      return
    }
    const key = normalizeCategoryKey(newName)
    setDraft((d) => withCustomCategory(d, { name: key, type: side, group: null }))
    setNewName('')
    setEditing(key)
  }, [newName, model, side, t])

  const removeCustom = useCallback((key) => {
    setDraft((d) => withoutCustomCategory(d, key))
    setEditing(null)
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await onSave(model.config)
      onClose()
    } catch {
      setSaving(false)
      setError(t('No se pudo guardar', 'Could not save'))
    }
  }, [onSave, model.config, onClose, t])

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="cat-mgr-title">
      <div className="modal-glass max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {entry && (
              <button onClick={() => setEditing(null)} aria-label={t('Volver', 'Back')}
                className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 id="cat-mgr-title" className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              {entry ? (lang === 'es' ? entry.label : entry.labelEn) : t('Categorías', 'Categories')}
            </h2>
          </div>
          <button onClick={onClose} className="text-xl shrink-0" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {!entry && (
            <>
              <SegmentedTabs
                value={side}
                onChange={(v) => { setSide(v); setEditing(null); setError('') }}
                tabs={[
                  { key: 'EXPENSE', label: t('Gastos', 'Expenses') },
                  { key: 'INCOME', label: t('Ingresos', 'Income') },
                ]}
                deps={[lang]}
                ariaLabel={t('Lado', 'Side')}
                className="mb-3"
              />

              <ul className="space-y-1">
                {list.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => setEditing(c.key)}
                      className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-2 -mx-2 transition-colors hover:bg-theme-elevated"
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs truncate"
                          style={{ color: c.hidden ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                          {lang === 'es' ? c.label : c.labelEn}
                        </span>
                        <span className="block text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {lang === 'es' ? c.groupLabel : c.groupLabelEn}
                          {c.type === 'EXPENSE' && ` · ${c.fixed ? t('fijo', 'fixed') : t('variable', 'variable')}`}
                          {c.custom && ` · ${t('tuya', 'yours')}`}
                        </span>
                      </span>
                      {c.hidden && <EyeOff size={13} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />}
                      <span className="text-[10px] font-mono tabular-nums shrink-0 w-8 text-right" style={{ color: 'var(--text-muted)' }}>
                        {useCount[c.key] || ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => { setNewName(e.target.value); setError('') }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNew() } }}
                    placeholder={t('Nueva categoría', 'New category')}
                    aria-label={t('Nombre de la categoría nueva', 'New category name')}
                    className={FIELD}
                    style={FIELD_STYLE}
                  />
                  <button type="button" onClick={addNew}
                    className="inline-flex items-center gap-1 px-3 min-h-[38px] rounded-lg text-xs font-medium shrink-0 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
                    <Plus size={13} aria-hidden="true" /> {t('Agregar', 'Add')}
                  </button>
                </div>
              </div>
            </>
          )}

          {entry && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t('Cómo la quieres ver', 'What to call it')}
                </label>
                <input
                  type="text"
                  value={entry.renamed ? entry.label : ''}
                  placeholder={entry.key}
                  onChange={(e) => patch(entry.key, { label: e.target.value })}
                  className={FIELD}
                  style={FIELD_STYLE}
                />
                {isBuiltinCategory(entry.key) && (
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t(`Se guarda como "${entry.key}". Cambiar el nombre visible no toca lo ya registrado.`,
                       `Stored as "${entry.key}". Changing the visible name does not touch what is already recorded.`)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t('Grupo', 'Group')}
                </label>
                <select value={entry.groupKey} onChange={(e) => patch(entry.key, { group: e.target.value })}
                  className={FIELD} style={FIELD_STYLE}>
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>{lang === 'es' ? g.label : (g.labelEn || g.label)}</option>
                  ))}
                </select>
              </div>

              {entry.type === 'EXPENSE' && (
                <div>
                  <label className="block text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                    {t('En el estado del mes', 'In the month statement')}
                  </label>
                  <SegmentedTabs
                    value={entry.fixed ? 'fixed' : 'variable'}
                    onChange={(v) => patch(entry.key, { fixed: v === 'fixed' })}
                    tabs={[
                      { key: 'fixed', label: t('Compromiso', 'Committed') },
                      { key: 'variable', label: t('Discrecional', 'Discretionary') },
                    ]}
                    deps={[lang, entry.key]}
                    ariaLabel={t('Tipo de gasto', 'Kind of cost')}
                  />
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t('Un compromiso llega igual quieras o no. Lo discrecional es lo que sí puedes mover este mes.',
                       'A commitment arrives whether you want it or not. Discretionary is what you can actually move this month.')}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="button" onClick={() => patch(entry.key, { hidden: !entry.hidden })}
                  className="inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-lg border text-xs transition-colors hover:bg-theme-elevated"
                  style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
                  {entry.hidden ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
                  {entry.hidden ? t('Volver a ofrecerla', 'Offer it again') : t('Esconder del selector', 'Hide from picker')}
                </button>

                {entry.custom && (
                  canDeleteCustomCategory(entry.key, transactions) ? (
                    <button type="button" onClick={() => removeCustom(entry.key)}
                      className="inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-lg border text-xs transition-colors"
                      style={{ color: 'var(--text-negative)', borderColor: 'var(--card-border)' }}>
                      <Trash2 size={13} aria-hidden="true" /> {t('Borrar', 'Delete')}
                    </button>
                  ) : (
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {t(`La usan ${useCount[entry.key]} movimientos, así que no se puede borrar. Escóndela.`,
                         `${useCount[entry.key]} movements use it, so it cannot be deleted. Hide it instead.`)}
                    </span>
                  )
                )}
              </div>

              {entry.hidden && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {t('Escondida solo del selector: los movimientos que ya la usan se siguen viendo igual.',
                     'Hidden from the picker only: movements already using it still show up.')}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-glass-border shrink-0">
          <span className="text-[10px]" style={{ color: error ? 'var(--text-negative)' : 'var(--text-muted)' }}>
            {error || t('Los cambios se aplican al guardar', 'Changes apply when you save')}
          </span>
          <button type="button" onClick={save} disabled={saving}
            className="px-4 min-h-[36px] rounded-lg text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
            <BusyLabel busy={saving} lang={lang}>{t('Guardar', 'Save')}</BusyLabel>
          </button>
        </div>
      </div>
    </div>
  )
}
