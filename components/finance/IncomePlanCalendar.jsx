'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Plus, Repeat, Trash2 } from 'lucide-react'
import { InfoTip } from '@/components/ui/Tooltip'
import { currencyOptions } from '@/lib/currencies'
import {
  normalizePlan, expandPlan, planTotalsByMonth, realIncomeByMonth, firstPlannedMonth,
  moveChip, upsertChip, removeChip, newChipId, serializePlan,
  REPEAT_MONTHLY, REPEAT_ONCE, PLAN_CURRENCY,
} from '@/lib/incomePlan'

// El tablero de ingresos del año: cuánto esperás que entre cada mes, y con qué
// podés jugar a moverlo.
//
// El plan NO es tu historial. Vive en su propio doc y ningún motor de Flujo lo
// lee, así que planear diciembre nunca puede inflar tu ahorro ni tu resumen
// mensual. Los meses ya cerrados no se planean: ahí se muestra lo que de verdad
// entró, tomado de tus transacciones.
//
// Dos tipos de cuadrito y la distinción es la que hace útil la pantalla: el
// salario fijo se repite solo en todos los meses y se edita una vez; el ingreso
// variable vive en un mes y se ARRASTRA de un mes a otro, que es el juego.

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MONTHS_LONG_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Antes de este mínimo no se decide nada: los primeros píxeles de un toque son
// ruido. Mismo criterio (y mismo número) que el bloqueo de dirección del
// pull-to-refresh.
const DRAG_START_PX = 6

function fmt(v, currency, lang) {
  const n = Math.round((Number(v) || 0) * 100) / 100
  try {
    return new Intl.NumberFormat(lang === 'es' ? 'es-GT' : 'en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

export default function IncomePlanCalendar({
  plan: rawPlan, onSave, financeTransactions = [], convert, lang = 'es',
  today = new Date(), currency = PLAN_CURRENCY,
}) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const months = lang === 'es' ? MONTHS_ES : MONTHS_EN
  const monthsLong = lang === 'es' ? MONTHS_LONG_ES : MONTHS_LONG_EN
  const year = today.getUTCFullYear()

  // Estado local para que arrastrar responda en el frame del dedo: guardar es
  // asíncrono y esperar el round-trip de Firestore para pintar el cuadrito en
  // su mes nuevo se sentiría trabado.
  const rawSig = JSON.stringify(rawPlan || null)
  const [plan, setPlan] = useState(() => normalizePlan(rawPlan, year))
  useEffect(() => { setPlan(normalizePlan(JSON.parse(rawSig), year)) }, [rawSig, year])

  const apply = useCallback((next) => {
    setPlan(next)
    if (typeof onSave === 'function') onSave(serializePlan(next))
  }, [onSave])

  const fromMonth = firstPlannedMonth(year, today)
  const perMonth = useMemo(() => expandPlan(plan, fromMonth), [plan, fromMonth])
  const totals = useMemo(() => planTotalsByMonth(plan, { fromMonth, convert, to: currency }), [plan, fromMonth, convert, currency])
  const real = useMemo(() => realIncomeByMonth(financeTransactions, year, { convert, to: currency }), [financeTransactions, year, convert, currency])

  // Una sola escala para las doce barras: si cada mes se midiera contra sí
  // mismo, dos montos distintos se dibujarían del mismo alto.
  const maxBar = Math.max(...totals, ...real.slice(0, fromMonth), 1)
  const plannedTotal = totals.reduce((a, b) => a + b, 0)

  const [editing, setEditing] = useState(null)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)

  const onPointerDown = useCallback((e, chip, month) => {
    if (chip.repeat !== REPEAT_ONCE) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    dragRef.current = { id: chip.id, from: month, x0: e.clientX, y0: e.clientY, moved: false, pointerId: e.pointerId }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* el navegador ya lo tiene */ }
  }, [])

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!d.moved && Math.hypot(dx, dy) < DRAG_START_PX) return
    d.moved = true
    // El mes de destino sale de lo que hay DEBAJO del dedo. El fantasma que se
    // arrastra lleva pointer-events:none justo para no taparse a sí mismo.
    const under = typeof document !== 'undefined' ? document.elementFromPoint(e.clientX, e.clientY) : null
    const cell = under?.closest?.('[data-month-cell]')
    const over = cell ? Number(cell.getAttribute('data-month-cell')) : null
    d.over = Number.isFinite(over) && over >= fromMonth ? over : null
    setDrag({ id: d.id, x: e.clientX, y: e.clientY, over: d.over })
  }, [fromMonth])

  const onPointerUp = useCallback((e, chip, month) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d || d.pointerId !== e.pointerId) return
    // Un toque que no se movió no es un arrastre fallido: es un toque, y abre
    // la edición. Así el mismo cuadrito sirve para las dos cosas.
    if (!d.moved) { setEditing({ ...chip, _month: month }); return }
    if (d.over != null && d.over !== month) apply(moveChip(plan, d.id, d.over))
  }, [apply, plan])

  const openNew = useCallback((month) => {
    setEditing({
      id: newChipId(Date.now(), (plan.chips || []).length),
      label: '', amount: '', currency, repeat: REPEAT_ONCE, month, _month: month, _isNew: true,
    })
  }, [plan, currency])

  const saveChip = useCallback((draft) => {
    const amount = Number(draft.amount)
    if (!Number.isFinite(amount) || amount <= 0) return
    const chip = draft.repeat === REPEAT_MONTHLY
      ? { id: draft.id, label: draft.label, amount, currency: draft.currency, repeat: REPEAT_MONTHLY, startMonth: draft._isNew ? Math.max(fromMonth, 0) : draft.startMonth, skip: draft.skip || [] }
      : { id: draft.id, label: draft.label, amount, currency: draft.currency, repeat: REPEAT_ONCE, month: draft.month != null ? draft.month : Math.max(draft._month ?? 0, fromMonth) }
    apply(upsertChip(plan, chip))
    setEditing(null)
  }, [apply, plan, fromMonth])

  const deleteChip = useCallback((draft, scope) => {
    apply(removeChip(plan, draft.id, scope === 'month' ? { month: draft._month } : {}))
    setEditing(null)
  }, [apply, plan])

  const noPlannableMonths = fromMonth >= 12

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
          {t(`Plan de ingresos ${year}`, `${year} income plan`)}
          <InfoTip text={t(
            'Lo que esperás que entre cada mes. Es un plan, no tu historial: no suma a los totales del mes, ni a tu ahorro, ni a los correos. Los meses ya cerrados muestran lo que de verdad entró.',
            'What you expect to come in each month. It is a plan, not your record: it never adds to your monthly totals, savings, or emails. Closed months show what actually came in.'
          )} />
        </h3>
        <span className="text-sm font-bold font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
          {fmt(plannedTotal, currency, lang)}
        </span>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        {t('Planeado de aquí a diciembre. Arrastrá un ingreso variable a otro mes para jugar con el calendario.',
           'Planned from here to December. Drag a one-off income to another month to play with the calendar.')}
      </p>

      {/* Las doce barras del año: lo real de los meses cerrados y lo planeado
          de aquí en adelante, en una sola escala. */}
      <div className="flex items-end gap-1 h-16 mb-4" aria-hidden="true">
        {months.map((m, i) => {
          const past = i < fromMonth
          const value = past ? real[i] : totals[i]
          const h = value > 0 ? (value / maxBar) * 100 : 0
          return (
            <div key={m} className="flex-1 flex flex-col items-center justify-end h-full">
              <div className="w-full rounded-t transition-all" style={{
                height: value > 0 ? `${Math.max(h, 6)}%` : '3px',
                backgroundColor: value > 0 ? (past ? 'var(--text-muted)' : 'var(--accent-blue)') : 'var(--bg-tertiary)',
              }} />
              <span className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{m}</span>
            </div>
          )
        })}
      </div>

      {noPlannableMonths ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('Este año ya cerró: el plan arranca en enero del año que viene.', 'This year is closed: the plan starts next January.')}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
          {months.map((m, i) => {
            const past = i < fromMonth
            const isOver = drag?.over === i
            return (
              <div
                key={m}
                data-month-cell={i}
                // Un mes cerrado no se planea, así que no necesita alto para
                // cuadritos: se queda en una línea. Sin esto, siete meses
                // vacíos se comían media tarjeta antes de llegar a lo editable.
                // `self-start` en los cerrados: en una grilla, la fila toma el alto
                // del más alto, así que sin esto un mes cerrado se estira al
                // tamaño del mes planeado que le toque al lado.
                className={`rounded-lg border px-2 transition-colors ${past ? 'py-1.5 self-start' : 'py-2 min-h-[92px] flex flex-col'}`}
                style={{
                  borderColor: isOver ? 'var(--accent-blue)' : 'var(--card-border)',
                  backgroundColor: isOver ? 'var(--alert-info-bg)' : 'transparent',
                }}
              >
                <div className={`flex items-baseline justify-between gap-1 ${past ? '' : 'mb-1.5'}`}>
                  <span className="text-[11px] font-medium flex items-baseline gap-1 min-w-0" style={{ color: past ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                    <span className="truncate">{months[i]}</span>
                    {past && <span className="text-[9px] shrink-0">{t('real', 'actual')}</span>}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums shrink-0" style={{ color: past ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                    {fmt(past ? real[i] : totals[i], currency, lang)}
                  </span>
                </div>

                {past ? null : (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {perMonth[i].map((chip) => {
                        const movable = chip.repeat === REPEAT_ONCE
                        return (
                          <button
                            key={chip.id}
                            type="button"
                            data-ptr-ignore={movable ? '' : undefined}
                            data-chip={chip.id}
                            onPointerDown={(e) => onPointerDown(e, chip, i)}
                            onPointerMove={movable ? onPointerMove : undefined}
                            onPointerUp={(e) => (movable ? onPointerUp(e, chip, i) : setEditing({ ...chip, _month: i }))}
                            onPointerCancel={() => { dragRef.current = null; setDrag(null) }}
                            className="text-left rounded-md px-1.5 py-1 border text-[10px] leading-tight max-w-full"
                            style={{
                              touchAction: movable ? 'none' : undefined,
                              cursor: movable ? 'grab' : 'pointer',
                              borderColor: 'var(--card-border)',
                              backgroundColor: 'var(--bg-card-hover)',
                              opacity: drag?.id === chip.id ? 0.35 : 1,
                            }}
                            title={chip.repeat === REPEAT_MONTHLY
                              ? t('Se repite todos los meses. Tocá para editarlo en todos.', 'Repeats every month. Tap to edit it everywhere.')
                              : t('Tocá para editar, arrastrá para mover de mes.', 'Tap to edit, drag to move months.')}
                          >
                            <span className="flex items-center gap-1 font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                              {chip.repeat === REPEAT_MONTHLY && <Repeat size={9} style={{ color: 'var(--accent-blue)' }} aria-hidden="true" />}
                              <span className="truncate">{chip.label || t('Ingreso', 'Income')}</span>
                            </span>
                            <span className="block font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {fmt(chip.amount, chip.currency, lang)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => openNew(i)}
                      className="mt-auto pt-1 flex items-center gap-1 text-[10px] hover:underline self-start"
                      style={{ color: 'var(--accent-blue)' }}
                      aria-label={t(`Agregar ingreso a ${monthsLong[i]}`, `Add income to ${monthsLong[i]}`)}
                    >
                      <Plus size={10} aria-hidden="true" /> {t('Agregar', 'Add')}
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* El fantasma que sigue al dedo. pointer-events:none para que
          elementFromPoint vea la celda de abajo y no a sí mismo. */}
      {drag && (
        <div className="fixed z-[70] pointer-events-none rounded-md px-2 py-1 border text-[10px] shadow-lg"
          style={{ left: drag.x + 8, top: drag.y - 12, borderColor: 'var(--accent-blue)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>
          {t('Mover a…', 'Move to…')}
        </div>
      )}

      {editing && (
        <ChipEditor
          draft={editing}
          lang={lang}
          monthsLong={monthsLong}
          fromMonth={fromMonth}
          onChange={setEditing}
          onSave={saveChip}
          onDelete={deleteChip}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ChipEditor({ draft, lang, monthsLong, fromMonth, onChange, onSave, onDelete, onClose }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const set = (patch) => onChange({ ...draft, ...patch })
  const valid = Number(draft.amount) > 0
  const isMonthly = draft.repeat === REPEAT_MONTHLY

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const labelCls = 'block text-xs mb-1'
  const labelStyle = { color: 'var(--text-secondary)' }
  const inputCls = 'w-full px-3 py-2 rounded-lg border text-sm'
  const inputStyle = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)', color: 'var(--text-primary)' }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="chip-editor-title"
      onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div className="modal-glass max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-glass-border">
          <h2 id="chip-editor-title" className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
            {draft._isNew ? t('Nuevo ingreso', 'New income') : t('Editar ingreso', 'Edit income')}
          </h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--text-secondary)' }} aria-label={t('Cerrar', 'Close')}>&times;</button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className={labelCls} style={labelStyle} htmlFor="chip-label">{t('Nombre', 'Name')}</label>
            <input id="chip-label" className={inputCls} style={inputStyle} value={draft.label || ''}
              onChange={(e) => set({ label: e.target.value })} placeholder={t('Salario, cátedra, bono…', 'Salary, teaching, bonus…')} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className={labelCls} style={labelStyle} htmlFor="chip-amount">{t('Monto', 'Amount')}</label>
              <input id="chip-amount" type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} style={inputStyle}
                value={draft.amount} onChange={(e) => set({ amount: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle} htmlFor="chip-currency">{t('Moneda', 'Currency')}</label>
              <select id="chip-currency" className={inputCls} style={inputStyle} value={draft.currency}
                onChange={(e) => set({ currency: e.target.value })}>
                {currencyOptions(draft.currency).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <span className={labelCls} style={labelStyle}>{t('¿Cada cuánto?', 'How often?')}</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: REPEAT_MONTHLY, label: t('Todos los meses', 'Every month'), hint: t('Se edita una vez y cambia en todos', 'Edit once, changes everywhere') },
                { key: REPEAT_ONCE, label: t('Solo un mes', 'One month only'), hint: t('Se puede arrastrar de mes a mes', 'Can be dragged between months') },
              ].map((opt) => {
                const active = draft.repeat === opt.key
                return (
                  // Al cambiar de tipo hay que rellenar el campo que el otro
                  // tipo no tiene. Sin esto, pasar un mensual a "solo un mes"
                  // lo dejaba sin mes: caía a enero, que ya pasó, y el cuadrito
                  // desaparecía de la pantalla sin que nadie lo borrara.
                  <button key={opt.key} type="button" onClick={() => set(
                    opt.key === REPEAT_ONCE
                      ? { repeat: opt.key, month: draft.month != null ? draft.month : Math.max(draft._month ?? 0, fromMonth) }
                      : { repeat: opt.key, startMonth: draft.startMonth != null ? draft.startMonth : Math.max(draft._month ?? 0, fromMonth), skip: draft.skip || [] }
                  )}
                    aria-pressed={active}
                    className="text-left rounded-lg border px-2.5 py-2 text-xs transition-colors"
                    style={{
                      borderColor: active ? 'var(--accent-blue)' : 'var(--card-border)',
                      backgroundColor: active ? 'var(--alert-info-bg)' : 'transparent',
                      color: 'var(--text-primary)',
                    }}>
                    <span className="block font-medium">{opt.label}</span>
                    <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{opt.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {!isMonthly && (
            <div>
              <label className={labelCls} style={labelStyle} htmlFor="chip-month">{t('Mes', 'Month')}</label>
              <select id="chip-month" className={inputCls} style={inputStyle} value={draft.month}
                onChange={(e) => set({ month: Number(e.target.value) })}>
                {monthsLong.map((m, i) => (i >= fromMonth ? <option key={m} value={i}>{m}</option> : null))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-glass-border">
          {draft._isNew ? <span /> : (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onDelete(draft, 'all')}
                className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg" style={{ color: 'var(--alert-error-icon)' }}>
                <Trash2 size={12} aria-hidden="true" /> {t('Borrar', 'Delete')}
              </button>
              {isMonthly && (
                <button type="button" onClick={() => onDelete(draft, 'month')}
                  className="text-xs px-2 py-1.5 rounded-lg" style={{ color: 'var(--text-secondary)' }}>
                  {t('Quitar de este mes', 'Remove from this month')}
                </button>
              )}
            </div>
          )}
          <button type="button" onClick={() => onSave(draft)} disabled={!valid}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent-blue)', color: '#FFFFFF' }}>
            {t('Guardar', 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}
