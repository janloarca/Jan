'use client'
import AmountInput from '@/components/ui/AmountInput'
import { useEscClose } from '@/hooks/useEscClose'
import { parseRate } from '@/lib/numberParse'

import { useState } from 'react'
import { Info } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { solveDietzStartValue, accountKeyOfItem, heldFlatAccountValueUSD, formatDate } from '@/components/dashboard/utils'
import { hasRealObservationAt } from '@/lib/snapshotSelect'

// Return calibration, PER ACCOUNT: every broker app shows its own return, so a
// single % for the whole portfolio cannot represent accounts with different
// results (mixing them is what produced absurd readings like +200%). The user
// picks an account, types the return THAT broker shows (YTD and/or since
// inception) and we place a manual anchor snapshot whose value makes OUR
// Modified Dietz reproduce that percentage exactly (solveDietzStartValue),
// using only that account's current value and flows.
//
// The anchor is stored with _account:<key> so useDashboardData keeps it OUT of
// the portfolio NAV series and instead swaps it for the account's estimated
// share of the global anchor (combineAccountCalibrations). _source:'manual'
// keeps the convention that a later real IBKR import (priority 4) wins, and
// _calibrated:true marks it so the UI can badge it and "Quitar" can find it.
// "Todo el portafolio" keeps the original global behavior for single-account
// users and for calibrations saved before per-account existed.
// onSaved (FASE GQ4): fired once with how many periods were actually calibrated,
// and ONLY on a successful save — never on removing a calibration, which undoes
// work rather than completing it. The IBKR journey orchestrator listens so the
// step carries the user forward on its own instead of sitting on its success
// message with a primary button that still reads "Save".
export default function CalibrateReturnModal({ onClose, onSaved, preferredAccount = null, netWorth, transactions, convert, baseCurrency = 'USD', snapshots = [], accountSnapshots = [], items = [], saveSnapshot, deleteSnapshot, lang = 'es' }) {
  useEscClose(onClose)
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en
  const year = new Date().getUTCFullYear()
  const todayStr = new Date().toISOString().split('T')[0]

  // The eight windows, mirroring the chart's period tabs exactly (DAY, 1W,
  // MTD, 1M, 3M, YTD, 1Y, ALL). Each one becomes its own anchor: the % is
  // solved back into the account value at that date, so numbers typed once
  // give the curve that many real touch points instead of one. 'day' solves
  // yesterday's close (a "today" % measures against the prior close); 'all'
  // is last because it needs the opening date. FASE GI: every saved anchor
  // also records the exact MOMENT it was typed (_calibratedAt), so a % entered
  // at 9:00 stays anchored to 9:00 and everything measured after simply
  // accumulates on top of it.
  const shiftDays = (days) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    return d
  }
  const shiftMonths = (months) => {
    const d = new Date()
    d.setUTCMonth(d.getUTCMonth() - months)
    return d
  }
  const asDateStr = (d) => d.toISOString().split('T')[0]
  const monthStartStr = `${year}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-01`
  const PERIODS = [
    { kind: 'day', label: t('Hoy', 'Today'), startDate: asDateStr(shiftDays(1)), placeholder: '0.15' },
    { kind: '1w', label: '1W', startDate: asDateStr(shiftDays(7)), placeholder: '0.42' },
    { kind: 'mtd', label: 'MTD', startDate: monthStartStr, placeholder: '1.2' },
    { kind: '1m', label: '1M', startDate: asDateStr(shiftMonths(1)), placeholder: '1.8' },
    { kind: '3m', label: '3M', startDate: asDateStr(shiftMonths(3)), placeholder: '4.5' },
    { kind: 'ytd', label: 'YTD', startDate: `${year}-01-01`, placeholder: '8.61' },
    { kind: '1y', label: '1Y', startDate: asDateStr(shiftMonths(12)), placeholder: '14.2' },
    { kind: 'all', label: t('Desde el inicio', 'Since inception'), startDate: null, placeholder: '87.24' },
    // On the 1st of the month the MTD window has zero length (its anchor date
    // IS today): nothing to solve, hide the row for the day.
  ].filter((p) => !(p.kind === 'mtd' && monthStartStr === todayStr))
  const KIND_LABEL = Object.fromEntries(PERIODS.map((p) => [p.kind, p.label]))

  // Accounts detected from the portfolio items, in first-seen order.
  const accounts = (() => {
    const seen = new Map()
    for (const it of items || []) {
      const key = accountKeyOfItem(it)
      if (!key || seen.has(key)) continue
      seen.set(key, key === 'ibkr' ? 'Interactive Brokers' : (it.institution || '').trim().replace(/\s+/g, ' '))
    }
    return [...seen.entries()].map(([key, name]) => ({ key, name }))
  })()

  const [selected, setSelected] = useState(null)
  // FASE GQ5: opened from the IBKR journey, the account to calibrate is IBKR,
  // not whichever account happens to sort first (the user landed on step 4 of
  // an IBKR walkthrough and found "IDC" preselected, one wrong tap away from
  // filing broker percentages against the wrong account). Only honoured when
  // that account actually exists in the portfolio; a manual pick always wins.
  const preferredKey = preferredAccount && accounts.some((a) => a.key === preferredAccount)
    ? preferredAccount
    : null
  const selKey = selected || preferredKey || accounts[0]?.key || 'global'
  const isGlobal = selKey === 'global'

  // Calibrations already on file: global ones live in `snapshots`, per-account
  // ones arrive separately (they are not part of the NAV series).
  const globalCalibrated = (snapshots || []).filter((s) => s && s._calibrated && s.date)
  const accountCalibrated = (accountSnapshots || []).filter((s) => s && s._calibrated && s.date)
  const allCalibrated = [
    ...accountCalibrated.map((s) => ({ ...s, _label: s._accountName || s._account })),
    ...globalCalibrated.map((s) => ({ ...s, _label: t('Todo el portafolio', 'Whole portfolio') })),
  ]
  const calForSelected = (kind) => isGlobal
    ? globalCalibrated.some((s) => s._calibrationKind === kind)
    : accountCalibrated.some((s) => s._calibrationKind === kind && s._account === selKey)

  // Default inception date: earliest dated transaction or snapshot we know.
  const earliestKnown = (() => {
    const dates = []
    ;(transactions || []).forEach((tx) => { if (tx.date) dates.push(tx.date) })
    ;(snapshots || []).forEach((s) => { if (s && s.date && !s._calibrated) dates.push(s.date) })
    dates.sort()
    return dates[0] || ''
  })()

  const [pcts, setPcts] = useState({})
  const setPct = (kind, v) => setPcts((p) => ({ ...p, [kind]: v }))
  const [inceptionDate, setInceptionDate] = useState(earliestKnown)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  const toUSD = (valBase) => {
    if (!isFinite(valBase)) return null
    if (baseCurrency === 'USD' || !convert) return valBase
    return convert(valBase, baseCurrency, 'USD')
  }

  // Per-account end value and flows, in USD end to end (no double conversion):
  // - endValue: the account's current held-flat share, the exact same formula
  //   combineAccountCalibrations estimates, so solve and combination agree.
  // - flows: IBKR auto-imported cash flows for the IBKR account; manual flows
  //   linked (_linkedItemId) to one of the account's items for the rest.
  //   Unlinked flows cannot be attributed to an account and stay out.
  const accountItemIds = new Set((items || []).filter((it) => accountKeyOfItem(it) === selKey).map((it) => it.id))
  const accountEndUSD = isGlobal ? null : heldFlatAccountValueUSD(items, selKey, null, convert)
  const accountFlows = isGlobal ? (transactions || []) : (transactions || []).filter((tx) => (
    selKey === 'ibkr' ? tx._source === 'ibkr' : (tx._linkedItemId && accountItemIds.has(tx._linkedItemId))
  ))

  // Never clobber a real observation at the anchor date: si ese día ya está
  // guardado, la calibración no tiene nada que agregar. Aplica al portafolio
  // entero y a la cuenta de IBKR; las cuentas manuales no tienen historial
  // real propio, así que ahí la calibración es todo lo que hay.
  //
  // ⛔ FASE JW. Esta lista era literal (`'ibkr'` o `'daily'`) y dejaba fuera
  // 'backfill', que desde FASE GD/HN es la fuente de CASI TODOS los días
  // históricos, más 'manual', 'ibkr_quarterly' y los docs viejos sin `_source`.
  // Una calibración global escribe en el id PLANO de la fecha, así que sobre
  // uno de esos días hacía merge ENCIMA del doc real: pisaba `netWorthUSD`,
  // estampaba `_calibrated`/`_source:'manual'`, y dejaba el `totalActivosUSD`
  // viejo al lado — un solo doc afirmando dos totales distintos, y la fecha
  // congelada contra el backfill para siempre. El 1 de enero (o sea el ancla
  // del YTD, el caso más común de todos) caía justo ahí.
  //
  // La regla correcta no es una lista de fuentes sino la pregunta de fondo:
  // ¿hay ya una observación con valor en ese día? Una calibración propia no
  // cuenta (por eso `!s._calibrated`: recalibrar el mismo día sí se permite).
  const realSnapshotAt = (dateStr) => hasRealObservationAt(snapshots, dateStr)
  const guardedByRealData = isGlobal || selKey === 'ibkr'

  const save = async () => {
    setError('')
    setDoneMsg('')
    const filled = PERIODS
      // parseRate y NO parseQuantity: esa pisa los negativos en cero, y un
      // anio perdedor se teclea con signo. Tampoco parseAmount, que leeria
      // '7.500' como siete mil quinientos. Y el guard de '' se queda: vacio
      // significa "no calibrar este periodo", que no es lo mismo que 0%.
      .map((p) => ({ ...p, pct: (pcts[p.kind] ?? '').trim() === '' ? null : parseRate(pcts[p.kind]) }))
      .filter((p) => p.pct != null)
    if (filled.length === 0) {
      setError(t('Escribe al menos un porcentaje.', 'Fill in at least one percentage.'))
      return
    }
    if (filled.some((p) => !isFinite(p.pct))) {
      setError(t('Revisa los porcentajes: deben ser números (ej. 8.61 o -3.2).', 'Check the percentages: they must be numbers (e.g. 8.61 or -3.2).'))
      return
    }
    const wantsAll = filled.some((p) => p.kind === 'all')
    if (wantsAll && !inceptionDate) {
      setError(t('Para el retorno desde el inicio necesitas la fecha en que abriste la cuenta.', 'For the since-inception return you need the account opening date.'))
      return
    }
    if (wantsAll && inceptionDate >= todayStr) {
      setError(t('La fecha de inicio debe ser anterior a hoy.', 'The inception date must be before today.'))
      return
    }
    if (isGlobal && (!netWorth || netWorth <= 0)) {
      setError(t('No hay valor actual de la portafolio para calibrar.', 'There is no current portfolio value to calibrate against.'))
      return
    }
    if (!isGlobal && (!accountEndUSD || accountEndUSD <= 0)) {
      setError(t('Esta cuenta no tiene posiciones con valor actual para calibrar.', 'This account has no positions with current value to calibrate against.'))
      return
    }
    const endTs = Date.now()
    const jobs = []
    const skipped = []
    for (const p of filled) {
      const dateStr = p.kind === 'all' ? inceptionDate : p.startDate
      // A day the broker already reported needs no calibration: a solved value
      // would be a guess sitting on top of an observation.
      if (guardedByRealData && realSnapshotAt(dateStr)) { skipped.push(p.label); continue }
      jobs.push({
        kind: p.kind, label: p.label, targetPct: p.pct, dateStr,
        startTs: new Date(dateStr + 'T00:00:00Z').getTime(),
      })
    }
    if (jobs.length === 0) {
      setError(t(
        `Esas fechas ya tienen datos reales de tu broker (${skipped.join(', ')}): esos retornos ya salen de datos reales y no necesitan calibración.`,
        `Those dates already have real broker data (${skipped.join(', ')}): those returns already come from real data and need no calibration.`
      ))
      return
    }
    setSaving(true)
    try {
      const solved = []
      for (const job of jobs) {
        const res = isGlobal
          ? solveDietzStartValue({
            endValue: netWorth, startTs: job.startTs, endTs,
            transactions: accountFlows, convert, baseCurrency, targetPct: job.targetPct,
          })
          : solveDietzStartValue({
            endValue: accountEndUSD, startTs: job.startTs, endTs,
            transactions: accountFlows, convert, baseCurrency: 'USD', targetPct: job.targetPct,
          })
        if (res.error) {
          setError(t(
            `No se pudo cuadrar el ${job.label} con los flujos registrados de esta cuenta: el valor de arranque implícito no es válido. Revisa el % o registra tus depósitos y retiros primero.`,
            `Could not reconcile ${job.label} with this account's recorded flows: the implied start value is not valid. Check the % or record your deposits and withdrawals first.`
          ))
          setSaving(false)
          return
        }
        solved.push({ ...job, startValue: res.startValue })
      }
      const selName = isGlobal ? null : (accounts.find((a) => a.key === selKey)?.name || selKey)
      for (const s of solved) {
        // Global solves in base currency and converts to USD; per-account
        // already solved in USD.
        const netWorthUSD = isGlobal ? toUSD(s.startValue) : s.startValue
        if (netWorthUSD == null || !isFinite(netWorthUSD)) throw new Error('fx')
        await saveSnapshot({
          date: s.dateStr,
          netWorthUSD,
          // FASE JW: los dos totales, siempre. saveSnapshot fusiona, así que
          // escribir solo `netWorthUSD` dejaba vivo el `totalActivosUSD` de lo
          // que hubiera antes en esa fecha: un doc con dos totales distintos,
          // y cada consumidor eligiendo uno. Con el guard de arriba ya no debería
          // haber nada debajo, pero un doc tiene que ser consistente por sí solo.
          totalActivosUSD: netWorthUSD,
          _source: 'manual',
          _calibrated: true,
          _calibrationKind: s.kind,
          // The exact moment the % was typed (FASE GI). The solve already used
          // this instant as endTs, so the anchor is "true as of 9:00", and any
          // movement measured after simply accumulates on top. Future
          // consumers (flow inference, freshness display) read it from here.
          _calibratedAt: new Date().toISOString(),
          ...(isGlobal ? {} : { _account: selKey, _accountName: selName }),
        })
      }
      setDoneMsg(t(
        `Listo: ${solved.length} ${solved.length === 1 ? 'período calibrado' : 'períodos calibrados'}. Tu rendimiento ahora cuadra con tu broker.${skipped.length ? ` (${skipped.join(', ')} ya tenía dato real.)` : ''} Si después importas el historial real, esos datos reemplazan la calibración automáticamente.`,
        `Done: ${solved.length} ${solved.length === 1 ? 'period calibrated' : 'periods calibrated'}. Your return now matches your broker.${skipped.length ? ` (${skipped.join(', ')} already had real data.)` : ''} If you later import the real history, that data automatically replaces the calibration.`
      ))
      if (onSaved) onSaved(solved.length)
    } catch {
      setError(t('No se pudo guardar la calibración. Intenta de nuevo.', 'Could not save the calibration. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  const removeCalibration = async (snap) => {
    if (!deleteSnapshot) return
    setSaving(true)
    setError('')
    try {
      await deleteSnapshot(snap.id || snap.date)
      setDoneMsg(t('Calibración eliminada.', 'Calibration removed.'))
    } catch {
      setError(t('No se pudo eliminar. Intenta de nuevo.', 'Could not remove it. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-theme-base rounded-lg px-3 py-2 text-sm text-white border border-glass-border focus:border-slate-500 outline-none font-mono'
  const accountBtnCls = (active) => active
    ? 'px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors'
    : 'px-2.5 py-1 rounded-lg text-xs border border-glass-border transition-colors hover:bg-white/5'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 className="text-lg font-bold text-white">{t('Calibrar rendimiento', 'Calibrate return')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        <div className="p-6 space-y-4">
          {/* FASE IH: antes esta pantalla abría con dos párrafos largos
              siempre visibles (el "cómo funciona" y el aviso de precisión de
              FASE FX), o sea una pared de texto antes del primer campo: es lo
              que el usuario señaló en su captura. El resumen de una línea se
              queda a la vista y el detalle completo, palabra por palabra, vive
              detrás del botón "i" (mismo patrón que los pasos del viaje). */}
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--card-border)' }}>
            <button type="button" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-theme-elevated">
              <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                style={showHelp
                  ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff' }
                  : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                <Info size={12} />
              </span>
              <span className="text-xs flex-1 min-w-0" style={{ color: 'var(--text-secondary)' }}>
                {t('Copia los % que ves en tu broker y anclamos tu curva a ellos.',
                   'Copy the % your broker shows and we anchor your curve to them.')}
              </span>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{showHelp ? '▴' : '▾'}</span>
            </button>
            {showHelp && (
              <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid var(--card-border)' }}>
                <p className="text-xs leading-relaxed pt-2.5" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    'Cada broker muestra el rendimiento de SU cuenta, así que la calibración es por cuenta: elige la cuenta y escribe los porcentajes que ves en esa app (en IBKR: Performance & Reports, PortfolioAnalyst). Ajustamos el valor de arranque de esa cuenta para que el % quede exacto. La curva intermedia se estima y los trades históricos no se recuperan: para eso está la importación de historial.',
                    'Each broker shows the return of ITS account, so calibration is per account: pick the account and type the percentages you see in that app (in IBKR: Performance & Reports, PortfolioAnalyst). We adjust that account start value so the % is exact. The in-between curve is estimated and historical trades are not recovered: use history import for that.'
                  )}
                </p>
                {/* FASE FX. El solver reproduce un retorno MONEY-weighted (Dietz);
                    PortfolioAnalyst muestra TWR por defecto. Con flujos en el
                    período los dos números difieren y calibrar con el equivocado
                    corrompe el ancla, así que se pide el MWR explícitamente. */}
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    'Precisión: en IBKR, PortfolioAnalyst muestra TWR por defecto. Cambia "Performance Measure" a MWR antes de copiar: nuestro cálculo es money-weighted, igual que el MWR del broker. Si no hiciste depósitos ni retiros en el período, TWR y MWR coinciden y puedes copiar el que veas.',
                    'Precision: in IBKR, PortfolioAnalyst shows TWR by default. Switch "Performance Measure" to MWR before copying: our math is money-weighted, same as the broker\'s MWR. If you made no deposits or withdrawals in the period, TWR and MWR match and either number works.'
                  )}
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)' }}>
              <p className="text-sm" style={{ color: 'var(--alert-error-icon)' }}>{error}</p>
            </div>
          )}
          {doneMsg && (
            <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--alert-success-bg)', border: '1px solid var(--alert-success-border)' }}>
              <p className="text-sm" style={{ color: 'var(--accent-green)' }}>&#10003; {doneMsg}</p>
            </div>
          )}

          {allCalibrated.length > 0 && (
            <div className="p-3 rounded-lg space-y-2" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('Calibraciones activas', 'Active calibrations')}</p>
              {allCalibrated.map((s) => (
                <div key={s.id || s.date} className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {s._label} · {KIND_LABEL[s._calibrationKind] || s._calibrationKind || 'YTD'} · {formatDate(s.date)}
                  </span>
                  <button type="button" disabled={saving} onClick={() => removeCalibration(s)}
                    className="px-2 py-0.5 rounded transition-colors hover:bg-white/5"
                    style={{ color: 'var(--text-negative)' }}>
                    {t('Quitar', 'Remove')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Cuenta a calibrar', 'Account to calibrate')}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((a) => (
                <button key={a.key} type="button" onClick={() => setSelected(a.key)}
                  className={accountBtnCls(selKey === a.key)}
                  style={selKey === a.key
                    ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.2)', borderColor: 'rgba(37,99,235,0.5)' }
                    : { color: 'var(--text-secondary)' }}>
                  {a.name}
                </button>
              ))}
              <button type="button" onClick={() => setSelected('global')}
                className={accountBtnCls(isGlobal)}
                style={isGlobal
                  ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.2)', borderColor: 'rgba(37,99,235,0.5)' }
                  : { color: 'var(--text-secondary)' }}>
                {t('Todo el portafolio', 'Whole portfolio')}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Retornos que muestra tu broker hoy (%)', 'Returns your broker shows today (%)')}
            </label>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              {t('Llena los que veas. Cada uno ancla la curva en su fecha: mientras más pongas, menos se estima.',
                 'Fill in the ones you can see. Each one anchors the curve at its own date: the more you give, the less is estimated.')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PERIODS.map((p) => (
                <div key={p.kind}>
                  <span className="flex items-baseline gap-1 text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    {p.label}
                    {calForSelected(p.kind) && (
                      <span style={{ color: 'var(--accent-amber, #f59e0b)' }} title={t('Ya calibrado: se reemplaza', 'Already calibrated: will be replaced')}>&#9679;</span>
                    )}
                  </span>
                  <AmountInput value={pcts[p.kind] ?? ''}
                    onChange={(e) => setPct(p.kind, e.target.value)}
                    placeholder={p.placeholder} className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          {(pcts.all ?? '').trim() !== '' && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                {t('Fecha de apertura de la cuenta', 'Account opening date')}
              </label>
              <input type="date" value={inceptionDate} max={todayStr} onChange={(e) => setInceptionDate(e.target.value)} className={inputCls} />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg bg-theme-base text-slate-400 border-2 border-glass-border hover:border-slate-500 transition-all">
              {doneMsg ? t('Cerrar', 'Close') : t('Cancelar', 'Cancel')}
            </button>
            <button type="button" disabled={saving} onClick={save}
              className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg border-2 transition-all disabled:opacity-50"
              style={{ color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.2)', borderColor: 'rgba(37,99,235,0.5)' }}>
              {saving ? t('Guardando...', 'Saving...') : t('Guardar calibración', 'Save calibration')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
