'use client'

import { useState } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { solveDietzStartValue, accountKeyOfItem, heldFlatAccountValueUSD, calibrationAnchorDate, calibrationCoveredByRealData, dedupeCalibrations } from '@/components/dashboard/utils'

// Return calibration with SEVEN optional periods (1W, MTD, 1M, 3M, YTD, 1Y,
// since inception), per account OR whole portfolio. The user types the return
// THEIR broker's app shows for each period and leaves blank the ones they
// don't know: any single filled period is enough to save, and the rest can be
// completed later (each calibration stores its capturedAt + typed % so the
// history is auditable). For every filled period we solve the start value that
// makes OUR Modified Dietz reproduce that percentage exactly
// (solveDietzStartValue) and pin it as a calibrated anchor on the period's
// start date. The anchor stays fixed on that date and the displayed % rolls
// forward with the market through the live end value.
//
// Anchors are stored with _calibrated:true so they NEVER enter the NAV series
// (useDashboardData filters them out): they constrain the ESTIMATED curve
// (the chart fits its projected prefix through them) and the returns math,
// but they are not real data — they don't open the real-data region, the
// drawdown zone or the firstRealTs banner. A later real IBKR import covering
// the same stretch always wins.
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
  const kindLabel = (k) => (PERIODS.find((p) => p.kind === k)?.label) || k

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

  // Calibrations already on file (global + per-account, deduped per anchor).
  const cals = dedupeCalibrations((calibrations || []).filter((s) => s && s._calibrated && s.date))
  const allCalibrated = [
    ...cals.filter((s) => s._account).map((s) => ({ ...s, _label: s._accountName || s._account })),
    ...cals.filter((s) => !s._account).map((s) => ({ ...s, _label: t('Todo el portafolio', 'Whole portfolio') })),
  ]
  const calForSelected = (kind) => cals.some((s) => s._calibrationKind === kind && (isGlobal ? !s._account : s._account === selKey))

  // Default inception date: earliest dated transaction or snapshot we know.
  const earliestKnown = (() => {
    const dates = []
    ;(transactions || []).forEach((tx) => { if (tx.date) dates.push(tx.date) })
    ;(snapshots || []).forEach((s) => { if (s && s.date) dates.push(s.date) })
    dates.sort()
    return dates[0] || ''
  })()

  const [pcts, setPcts] = useState({})
  const [inceptionDate, setInceptionDate] = useState(earliestKnown)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')

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

  // Periods already covered by REAL data need no calibration: when the anchor
  // date sits on or after the first real broker/daily observation, that whole
  // stretch is measured from real data and an anchor would only fight it.
  // Applies to the whole portfolio and to the IBKR account; manual accounts
  // have no real per-account history, so calibration is all there is. A
  // covered period is SKIPPED with a note, never aborting the rest.
  const realDates = (snapshots || [])
    .filter((s) => s && s.date && (s._source === 'ibkr' || s._source === 'daily'))
    .map((s) => s.date)
  const guardedByRealData = isGlobal || selKey === 'ibkr'

  const save = async () => {
    setError('')
    setDoneMsg('')
    const filled = []
    for (const p of PERIODS) {
      const raw = (pcts[p.kind] || '').trim()
      if (raw === '') continue
      const val = parseFloat(raw)
      if (!isFinite(val)) {
        setError(t('Revisa los porcentajes: deben ser números (ej. 8.61 o -3.2).', 'Check the percentages: they must be numbers (e.g. 8.61 or -3.2).'))
        return
      }
      filled.push({ kind: p.kind, targetPct: val })
    }
    if (filled.length === 0) {
      setError(t('Escribe al menos un porcentaje para guardar.', 'Fill in at least one percentage to save.'))
      return
    }
    if (filled.some((f) => f.kind === 'all')) {
      if (!inceptionDate) {
        setError(t('Para el retorno desde el inicio necesitas la fecha en que abriste la cuenta.', 'For the since-inception return you need the account opening date.'))
        return
      }
      if (inceptionDate >= todayStr) {
        setError(t('La fecha de inicio debe ser anterior a hoy.', 'The inception date must be before today.'))
        return
      }
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
    for (const f of filled) {
      const anchorDate = calibrationAnchorDate(f.kind, todayStr, inceptionDate)
      if (!anchorDate) {
        setError(t('Para el retorno desde el inicio necesitas la fecha en que abriste la cuenta.', 'For the since-inception return you need the account opening date.'))
        return
      }
      if (guardedByRealData && calibrationCoveredByRealData(anchorDate, realDates)) {
        skipped.push(kindLabel(f.kind))
        continue
      }
      const [yy, mm, dd] = anchorDate.split('-').map(Number)
      jobs.push({ ...f, dateStr: anchorDate, startTs: Date.UTC(yy, mm - 1, dd) })
    }
    if (jobs.length === 0) {
      setError(t(
        `Los períodos que escribiste ya están cubiertos por datos reales de tu broker (${skipped.join(', ')}): esos tramos ya se miden con datos reales y no necesitan calibración.`,
        `The periods you filled are already covered by real broker data (${skipped.join(', ')}): those stretches are already measured from real data and need no calibration.`
      ))
      return
    }
    setSaving(true)
    try {
      const endUSD = isGlobal ? toUSD(netWorth) : accountEndUSD
      if (endUSD == null || !isFinite(endUSD)) throw new Error('fx')
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
            `No se pudo cuadrar el retorno ${kindLabel(job.kind)} con los flujos registrados de esta cuenta: el valor de arranque implícito no es válido. Revisa el % o registra tus depósitos y retiros primero.`,
            `Could not reconcile the ${kindLabel(job.kind)} return with this account's recorded flows: the implied start value is not valid. Check the % or record your deposits and withdrawals first.`
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
          _source: 'manual',
          _calibrated: true,
          _calibrationKind: s.kind,
          targetPct: s.targetPct,
          capturedAt: todayStr,
          capturedEndValueUSD: endUSD,
          ...(isGlobal ? {} : { _account: selKey, _accountName: selName }),
        })
      }
      const skipNote = skipped.length > 0
        ? (lang === 'es'
          ? ` Se saltaron los períodos ya cubiertos por datos reales: ${skipped.join(', ')}.`
          : ` Skipped periods already covered by real data: ${skipped.join(', ')}.`)
        : ''
      setDoneMsg(t(
        'Listo: tu rendimiento ahora cuadra con tu broker. La calibración queda fija en su fecha y el % se mueve con el mercado; si después importas el historial real, esos datos reemplazan la calibración automáticamente.',
        'Done: your return now matches your broker. The calibration stays pinned to its date and the % moves with the market; if you later import the real history, that data automatically replaces the calibration.'
      ) + skipNote)
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
              'Type the returns your broker app shows for each period (in IBKR: Performance & Reports, PortfolioAnalyst). Leave blank the ones you do not know: you can complete them anytime. We adjust the estimated curve so it matches your numbers and your real data; from your last real datapoint, the market leads.'
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

          {allCalibrated.length > 0 && (
            <div className="p-3 rounded-lg space-y-2" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('Calibraciones activas', 'Active calibrations')}</p>
              {allCalibrated.map((s) => (
                <div key={s.id || `${s.date}|${s._calibrationKind || 'cal'}|${s._account || 'global'}`} className="flex items-center justify-between text-xs gap-2">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {s._label} · {kindLabel(s._calibrationKind)} · {s.date}
                    {s.targetPct != null && isFinite(s.targetPct) && ` · ${s.targetPct > 0 ? '+' : ''}${s.targetPct}%`}
                    {s.capturedAt && ` · ${t('capturado', 'captured')} ${s.capturedAt}`}
                  </span>
                  <button type="button" disabled={saving} onClick={() => removeCalibration(s)}
                    className="px-2 py-0.5 rounded transition-colors hover:bg-white/5 shrink-0"
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

          <div className="grid grid-cols-2 gap-3">
            {PERIODS.map((p) => (
              <div key={p.kind}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {p.label} (%)
                  {calForSelected(p.kind) && <span className="ml-1" style={{ color: 'var(--accent-amber, #f59e0b)' }}>{t('(se reemplaza)', '(replaced)')}</span>}
                </label>
                <input type="number" step="any" value={pcts[p.kind] || ''}
                  onChange={(e) => setPcts((prev) => ({ ...prev, [p.kind]: e.target.value }))}
                  placeholder={t('ej. 8.61', 'e.g. 8.61')} className={inputCls} />
              </div>
            ))}
          </div>

          {(pcts.all || '').trim() !== '' && (
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
