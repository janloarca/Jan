'use client'

import { useState } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { solveDietzStartValue, accountKeyOfItem, heldFlatAccountValueUSD, calibrationAnchorDate, calibrationKindOf, calibrationCoveredByRealData } from '@/components/dashboard/utils'

// Return calibration with SEVEN optional periods (1W, MTD, 1M, 3M, YTD, 1Y,
// since inception), per account or for the whole portfolio. Every broker app
// shows its own returns, so the user types the percentages THAT app shows and
// leaves blank the ones they do not know: any single one is enough to save,
// and the blanks can be filled in later (each save stores the typed %, the
// capture date and the end value at capture, so the history is auditable).
//
// For each filled period we place an anchor snapshot whose value makes OUR
// Modified Dietz reproduce the typed percentage exactly (solveDietzStartValue)
// at the period's start date (calibrationAnchorDate). The anchor rolls
// forward: it stays fixed at its date and the displayed % moves with the
// market because the Dietz end value is live.
//
// Anchors are stored with _calibrated:true (+ _account:<key> when per-account)
// so useDashboardData keeps them OUT of the NAV series: they constrain the
// ESTIMATED prefix of the growth chart (fitSeriesToAnchors) and the Dietz
// badges, but they are never real data (no firstRealTs, no banner, no
// drawdown region). _source:'manual' keeps the convention that a later real
// IBKR import wins. Calibrations whose anchor date is already covered by real
// broker data are skipped with an informational note, never aborting the rest.
export default function CalibrateReturnModal({ onClose, netWorth, transactions, convert, baseCurrency = 'USD', snapshots = [], calibrations = [], items = [], saveSnapshot, deleteSnapshot, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en
  const todayStr = new Date().toISOString().split('T')[0]

  const PERIODS = [
    { kind: '1w', label: '1W' },
    { kind: 'mtd', label: 'MTD' },
    { kind: '1m', label: '1M' },
    { kind: '3m', label: '3M' },
    { kind: 'ytd', label: 'YTD' },
    { kind: '1y', label: t('1A', '1Y') },
    { kind: 'all', label: t('Desde el inicio', 'Since inception') },
  ]
  const KIND_LABELS = Object.fromEntries(PERIODS.map((p) => [p.kind, p.label]))

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
  const selKey = selected || accounts[0]?.key || 'global'
  const isGlobal = selKey === 'global'

  // Calibrations already on file (global + per-account) arrive via the
  // `calibrations` prop: they live outside the NAV series now.
  const allCalibrated = (calibrations || [])
    .filter((s) => s && s._calibrated && s.date)
    .map((s) => ({
      ...s,
      _label: s._account ? (s._accountName || s._account) : t('Todo el portafolio', 'Whole portfolio'),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const calForSelected = (kind) => allCalibrated.some((s) =>
    calibrationKindOf(s) === kind && (isGlobal ? !s._account : s._account === selKey))

  // Default inception date: earliest dated transaction or real snapshot we know.
  const earliestKnown = (() => {
    const dates = []
    ;(transactions || []).forEach((tx) => { if (tx.date) dates.push(tx.date) })
    ;(snapshots || []).forEach((s) => { if (s && s.date) dates.push(s.date) })
    dates.sort()
    return dates[0] || ''
  })()

  const [values, setValues] = useState({})
  const [inceptionDate, setInceptionDate] = useState(earliestKnown)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')
  const [skipped, setSkipped] = useState([])

  const setValue = (kind, v) => setValues((prev) => ({ ...prev, [kind]: v }))

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

  // Never clobber a real observation: periods whose anchor date is already
  // covered by real broker data (an ibkr/daily snapshot that day, or any date
  // at/after the first real datapoint) need no calibration: that stretch is
  // already measured by real data. Applies to the whole portfolio and to the
  // IBKR account; manual accounts have no real per-account history.
  const firstRealDate = (snapshots || [])
    .filter((s) => s && s.date && (s._source === 'ibkr' || s._source === 'daily'))
    .map((s) => s.date)
    .sort()[0] || null
  const guardedByRealData = isGlobal || selKey === 'ibkr'

  const save = async () => {
    setError('')
    setDoneMsg('')
    setSkipped([])
    const entries = PERIODS
      .map((p) => ({ ...p, raw: (values[p.kind] || '').trim() }))
      .filter((e) => e.raw !== '')
    if (entries.length === 0) {
      setError(t('Escribe al menos un porcentaje. Puedes dejar en blanco los que no sepas.', 'Fill in at least one percentage. You can leave blank the ones you do not know.'))
      return
    }
    for (const e of entries) {
      e.targetPct = parseFloat(e.raw)
      if (!isFinite(e.targetPct)) {
        setError(t('Revisa los porcentajes: deben ser números (ej. 8.61 o -3.2).', 'Check the percentages: they must be numbers (e.g. 8.61 or -3.2).'))
        return
      }
    }
    const wantsAll = entries.some((e) => e.kind === 'all')
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
    const skippedNotes = []
    const jobs = []
    for (const e of entries) {
      const dateStr = calibrationAnchorDate(e.kind, todayStr, inceptionDate)
      if (!dateStr) continue
      if (dateStr >= todayStr) {
        skippedNotes.push(t(`${e.label}: el período empieza hoy, aún no hay días que medir.`, `${e.label}: the period starts today, there are no days to measure yet.`))
        continue
      }
      if (guardedByRealData && calibrationCoveredByRealData(dateStr, snapshots)) {
        skippedNotes.push(t(
          `${e.label}: ese tramo ya lo cubren tus datos reales (${firstRealDate} en adelante), no necesita calibración.`,
          `${e.label}: that stretch is already covered by your real data (${firstRealDate} onwards), it needs no calibration.`
        ))
        continue
      }
      jobs.push({ kind: e.kind, label: e.label, targetPct: e.targetPct, dateStr, startTs: new Date(dateStr + 'T00:00:00Z').getTime() })
    }
    if (jobs.length === 0) {
      setSkipped(skippedNotes)
      if (skippedNotes.length === 0) setError(t('No hay ningún período válido para guardar.', 'There is no valid period to save.'))
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
            `No se pudo cuadrar el retorno ${job.label} con los flujos registrados de esta cuenta: el valor de arranque implícito no es válido. Revisa el % o registra tus depósitos y retiros primero.`,
            `Could not reconcile the ${job.label} return with this account's recorded flows: the implied start value is not valid. Check the % or record your deposits and withdrawals first.`
          ))
          setSaving(false)
          return
        }
        solved.push({ ...job, startValue: res.startValue })
      }
      const selName = isGlobal ? null : (accounts.find((a) => a.key === selKey)?.name || selKey)
      const capturedEndValueUSD = isGlobal ? toUSD(netWorth) : accountEndUSD
      for (const s of solved) {
        // Global solves in base currency and converts to USD; per-account
        // already solved in USD.
        const netWorthUSD = isGlobal ? toUSD(s.startValue) : s.startValue
        if (netWorthUSD == null || !isFinite(netWorthUSD)) throw new Error('fx')
        await saveSnapshot({
          date: s.dateStr,
          netWorthUSD,
          _source: 'manual',
          _calibrated: true,
          _calibrationKind: s.kind,
          targetPct: s.targetPct,
          capturedAt: todayStr,
          capturedEndValueUSD: capturedEndValueUSD != null && isFinite(capturedEndValueUSD) ? capturedEndValueUSD : undefined,
          ...(isGlobal ? {} : { _account: selKey, _accountName: selName }),
        })
        // Clean up a legacy calibration of the same window: globals saved
        // before the redesign used the plain date id (colliding with the NAV
        // series) and carry no kind/targetPct.
        if (isGlobal) {
          const legacy = allCalibrated.find((c) => !c._account && c.id && c.id === c.date
            && c.date === s.dateStr && calibrationKindOf(c) === s.kind)
          if (legacy && deleteSnapshot) await deleteSnapshot(legacy.id)
        }
      }
      setSkipped(skippedNotes)
      setDoneMsg(t(
        'Listo: tu rendimiento ahora cuadra con tu broker. La calibración queda fija en su fecha y el % se mueve con el mercado; si después importas el historial real, esos datos reemplazan la calibración automáticamente.',
        'Done: your return now matches your broker. The calibration stays pinned at its date and the % moves with the market; if you later import the real history, that data automatically replaces the calibration.'
      ))
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 className="text-lg font-bold text-white">{t('Calibrar rendimiento', 'Calibrate return')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t(
              'Escribe los rendimientos que muestra la app de tu broker para cada período (en IBKR: Performance & Reports, PortfolioAnalyst). Deja en blanco los que no sepas: puedes completarlos cuando quieras. Ajustamos la curva estimada para que cuadre con tus números y con tus datos reales; desde tu último dato real manda el mercado.',
              'Type the returns your broker app shows for each period (in IBKR: Performance & Reports, PortfolioAnalyst). Leave blank the ones you do not know: you can complete them anytime. We adjust the estimated curve so it matches your numbers and your real data; from your last real datapoint onwards, the market rules.'
            )}
          </p>

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
          {skipped.length > 0 && (
            <div className="p-3 rounded-lg space-y-1" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)' }}>
              {skipped.map((note, i) => (
                <p key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>{note}</p>
              ))}
            </div>
          )}

          {allCalibrated.length > 0 && (
            <div className="p-3 rounded-lg space-y-2" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('Calibraciones activas', 'Active calibrations')}</p>
              {allCalibrated.map((s) => {
                const kind = calibrationKindOf(s)
                return (
                  <div key={s.id || `${s.date}-${s._account || 'global'}`} className="flex items-center justify-between text-xs gap-2">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {s._label} · {KIND_LABELS[kind] || kind} · {s.date}
                      {s.targetPct != null && ` · ${s.targetPct}%`}
                      {s.capturedAt && ` · ${t('capturada', 'captured')} ${s.capturedAt}`}
                    </span>
                    <button type="button" disabled={saving} onClick={() => removeCalibration(s)}
                      className="px-2 py-0.5 rounded transition-colors hover:bg-white/5 shrink-0"
                      style={{ color: 'var(--text-negative)' }}>
                      {t('Quitar', 'Remove')}
                    </button>
                  </div>
                )
              })}
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

          <div className="grid grid-cols-2 gap-3">
            {PERIODS.map((p) => (
              <div key={p.kind} className={p.kind === 'all' ? 'col-span-2' : ''}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {p.label} (%)
                  {calForSelected(p.kind) && <span className="ml-1" style={{ color: 'var(--accent-amber, #f59e0b)' }}>{t('(calibrado)', '(calibrated)')}</span>}
                </label>
                <input type="number" step="any" value={values[p.kind] || ''} onChange={(e) => setValue(p.kind, e.target.value)}
                  placeholder={t('ej. 8.61', 'e.g. 8.61')} className={inputCls} />
              </div>
            ))}
          </div>

          {(values.all || '').trim() !== '' && (
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
