'use client'

import { useState, useId, useCallback, useMemo } from 'react'
import { Plus } from 'lucide-react'
import AmountInput from '@/components/ui/AmountInput'
import { parseAmount } from '@/lib/numberParse'
import { todayLocalISO } from '@/lib/localDate'
import { categorizeExpense } from '@/lib/expenseCategorize'
import BusyLabel from '@/components/ui/BusyLabel'

// Anotar un gasto a mano, sin abrir nada.
//
// El camino viejo era: tocar "+ Agregar", esperar el modal, llenar cinco campos,
// guardar, y el modal se cierra. Para la segunda compra del día, todo otra vez.
// Acá la fila vive SIEMPRE visible arriba de la lista del mes: se teclea el
// monto, se teclea qué fue, Enter. Tres cosas que lo hacen rápido de verdad:
//
//  1. LA CATEGORÍA SE SUGIERE SOLA mientras se escribe la descripción, con el
//     MISMO clasificador que usan el atajo del teléfono, el correo y los
//     estados de cuenta (`categorizeExpense` + las reglas que el usuario ya
//     enseñó). No es un clasificador nuevo: es el que ya sabe que "uber" es
//     Transporte y que "FINCA FELIZ" es lo que vos le enseñaste.
//  2. UNA SUGERENCIA NO PISA UNA ELECCIÓN. En cuanto se toca el selector, la
//     fila deja de re-sugerir: lo que el usuario eligió manda, que es la misma
//     regla que `_categorySetByUser` fija del lado de los datos.
//  3. AL GUARDAR NO SE RESETEA TODO. Se limpian monto y descripción; tipo,
//     categoría y fecha se quedan. Anotar cinco gastos del súper seguidos es el
//     caso real, y volver a elegir todo cada vez es lo que hacía que nadie
//     usara la captura manual.
//
// El modal completo NO desaparece: sigue detrás de "Agregar" para el caso con
// moneda distinta o una fecha lejana. Esto cubre el 90% que es de hoy y en
// quetzales.

const FIELD = 'rounded-lg border px-2.5 py-2 text-xs min-h-[38px]'
const FIELD_STYLE = {
  backgroundColor: 'var(--bg-tertiary)',
  borderColor: 'var(--card-border)',
  color: 'var(--text-primary)',
}

export default function QuickAddRow({
  onAdd, categories = [], rules = [], month, year, lang = 'es', onOpenFull,
}) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const today = todayLocalISO()

  // El mes que la pantalla está MOSTRANDO. Anotar un gasto mirando julio con la
  // fecha en hoy (agosto) lo archivaba en un mes que no estás viendo: la fila
  // "no aparecía". Comparación por PREFIJO de texto, nunca new Date().
  const viewingKey = (Number.isInteger(month) && Number.isInteger(year))
    ? `${year}-${String(month + 1).padStart(2, '0')}`
    : null
  const defaultDate = (viewingKey && !today.startsWith(viewingKey)) ? `${viewingKey}-01` : today

  const [type, setType] = useState('EXPENSE')
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [picked, setPicked] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Por id y no por ref: `AmountInput` es una función simple, no un
  // `forwardRef`, así que un `ref` encima quedaría en null sin decir nada.
  const amountId = `${useId()}-amount`

  const options = useMemo(
    () => categories.filter((c) => c.type === type),
    [categories, type]
  )

  // La sugerencia solo aplica al GASTO: del lado del ingreso el clasificador de
  // comercios no tiene nada que decir (no hay comercio que reconocer), así que
  // inventar una categoría ahí sería adivinar.
  const suggested = useMemo(() => {
    if (type !== 'EXPENSE' || !desc.trim()) return null
    const hit = categorizeExpense(desc, { rules })
    return hit.confidence === 'unknown' ? null : hit.category
  }, [type, desc, rules])

  const fallback = type === 'INCOME' ? 'Otros Ingresos' : 'Otros Gastos'
  const category = picked || suggested || fallback
  const usingSuggestion = !picked && !!suggested

  const reset = useCallback(() => {
    setAmount('')
    setDesc('')
    setError('')
    // `picked` se conserva SOLO si el usuario lo eligió a mano; una sugerencia
    // pertenece a la descripción que se acaba de borrar.
    if (typeof document !== 'undefined') document.getElementById(amountId)?.focus()
  }, [amountId])

  const submit = useCallback(async () => {
    setError('')
    // parseAmount('') devuelve 0, no NaN, así que el guard de campo vacío tiene
    // que ser explícito o un blanco y un cero se verían iguales.
    if (!amount || parseAmount(amount) <= 0) {
      setError(t('Falta el monto', 'Amount missing'))
      return
    }
    if (!date) {
      setError(t('Falta la fecha', 'Date missing'))
      return
    }
    setSaving(true)
    const ok = await onAdd({
      type,
      amount: parseAmount(amount),
      category,
      description: desc.trim(),
      date,
      currency: 'GTQ',
      source: 'manual',
      // Lo que el usuario eligió a mano nunca lo puede pisar el re-leído
      // masivo; una categoría que solo SUGIRIÓ la máquina sí es re-clasificable.
      ...(picked ? { _categorySetByUser: true } : {}),
    })
    setSaving(false)
    if (ok === false) {
      setError(t('No se pudo guardar', 'Could not save'))
      return
    }
    reset()
  }, [amount, date, type, category, desc, picked, onAdd, reset, t])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !saving) { e.preventDefault(); submit() }
  }

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Gasto o ingreso, en un solo control de dos estados: el 90% de lo que
            se anota a mano es un gasto, así que arranca ahí. */}
        <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid var(--card-border)' }}>
          {[
            { key: 'EXPENSE', label: '−', title: t('Gasto', 'Expense') },
            { key: 'INCOME', label: '+', title: t('Ingreso', 'Income') },
          ].map((o) => {
            const on = type === o.key
            return (
              <button
                key={o.key}
                type="button"
                title={o.title}
                aria-pressed={on}
                onClick={() => { setType(o.key); setPicked(null) }}
                className="px-3 min-h-[36px] text-sm font-bold transition-colors"
                style={on
                  ? { backgroundColor: o.key === 'INCOME' ? 'var(--accent-green)' : 'var(--text-negative)', color: '#ffffff' }
                  : { color: 'var(--text-muted)' }}
              >
                {o.label}
              </button>
            )
          })}
        </div>

        <AmountInput
          id={amountId}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('Monto', 'Amount')}
          aria-label={t('Monto', 'Amount')}
          className={`${FIELD} w-24 font-mono tabular-nums`}
          style={FIELD_STYLE}
        />

        <input
          type="text"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('¿Qué fue?', 'What was it?')}
          aria-label={t('Descripción', 'Description')}
          className={`${FIELD} flex-1 min-w-[8rem]`}
          style={FIELD_STYLE}
        />

        <select
          value={category}
          onChange={(e) => setPicked(e.target.value)}
          aria-label={t('Categoría', 'Category')}
          className={`${FIELD} max-w-[10rem]`}
          style={{
            ...FIELD_STYLE,
            // Una sugerencia se ve DISTINTA de una elección: el borde de acento
            // dice "esto lo puso la app, cámbialo si no es".
            borderColor: usingSuggestion ? 'var(--accent-blue)' : 'var(--card-border)',
          }}
        >
          {/* La categoría vigente siempre está en la lista aunque esté
              escondida del selector: si no, el `value` no resolvería y el
              navegador mostraría la primera opción, que es otra categoría. */}
          {!options.some((c) => c.key === category) && (
            <option value={category}>{category}</option>
          )}
          {options.map((c) => (
            <option key={c.key} value={c.key}>{lang === 'es' ? c.label : c.labelEn}</option>
          ))}
        </select>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Fecha', 'Date')}
          className={`${FIELD} w-[9.5rem]`}
          style={FIELD_STYLE}
        />

        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1 px-3 min-h-[38px] rounded-lg text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
        >
          <BusyLabel busy={saving} lang={lang}>
            <Plus size={13} aria-hidden="true" /> {t('Anotar', 'Log')}
          </BusyLabel>
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 mt-1.5">
        <span className="text-[10px]" style={{ color: error ? 'var(--text-negative)' : 'var(--text-muted)' }}>
          {error || (usingSuggestion
            ? t('Categoría sugerida por la descripción', 'Category suggested from the description')
            : t('Enter para anotar', 'Press Enter to log'))}
        </span>
        {onOpenFull && (
          <button type="button" onClick={onOpenFull}
            className="text-[10px] underline shrink-0" style={{ color: 'var(--text-muted)' }}>
            {t('Otra moneda u otra fecha', 'Another currency or date')}
          </button>
        )}
      </div>
    </div>
  )
}
