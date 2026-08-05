'use client'

import { useState } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { solveDietzStartValue, accountKeyOfItem, heldFlatAccountValueUSD, calibrationAnchorDate, calibrationCoveredByRealData } from '@/components/dashboard/utils'

// Return calibration, PER ACCOUNT: every broker app shows its own return, so a
// single % for the whole portfolio cannot represent accounts with different
// results (mixing them is what produced absurd readings like +200%). The user
// picks an account, types the returns THAT broker shows for whichever periods
// it knows (1W/MTD/1M/3M/YTD/1Y/since inception, all optional) and for each we
// place a manual anchor snapshot whose value makes OUR Modified Dietz
// reproduce that percentage exactly (solveDietzStartValue), using only that
// account's current value and flows.
//
// Every capture stores the typed % (targetPct), the capture date (capturedAt)
// and the portfolio value at capture (capturedEndValueUSD): the anchor stays
// fixed at its date while the displayed return rolls forward with the market,
// and later captures fill the blanks the user left. _source:'manual' keeps the
// convention that a later real IBKR import (priority 4) wins, and
// _calibrated:true keeps the doc OUT of the NAV series (useDashboardData
// filters it) so it feeds the estimated-curve fitting and the Dietz anchors
// without ever posing as a real observation. "Todo el portafolio" calibrates
// the whole portfolio for single-account users.
const KINDS = [
  { key: '1w', es: '1W', en: '1W' },
  { key: 'mtd', es: 'MTD', en: 'MTD' },
  { key: '1m', es: '1M', en: '1M' },
  { key: '3m', es: '3M', en: '3M' },
  { key: 'ytd', es: 'YTD', en: 'YTD' },
  { key: '1y', es: '1A', en: '1Y' },
  { key: 'all', es: 'Desde el inicio', en: 'Since inception' },
]
const KIND_LABEL = (kind, t) => {
  const k = KINDS.find((x) => x.key === kind)
  return k ? t(k.es, k.en) : (kind || '?')
}

export default function CalibrateReturnModal({ onClose, netWorth, transactions, convert, baseCurrency = 'USD', snapshots = [], calibrations = [], items = [], saveSnapshot, deleteSnapshot, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en
  const todayStr = new Date().toISOString().split('T')[0]

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

  // Calibrations already on file (global and per-account). They live outside
  // the NAV series now, so they arrive in their own prop.
  const allCalibrated = (calibrations || [])
    .filter((s) => s && s._calibrated && s.date)
    .map((s) => ({ ...s, _label: s._account ? (s._accountName || s._account) : t('Todo el portafolio', 'Whole portfolio') }))
  const calForSelected = (kind) => allCalibrated.some((s) =>
    s._calibrationKind === kind && (isGlobal ? !s._account : s._account === selKey))

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

  // Real data wins: a period whose anchor date is already covered by real
  // broker/daily snapshots has nothing to calibrate (that stretch is real, not
  // estimated). Applies to the whole portfolio and to the IBKR account; manual
  // accounts have no real per-account history, so calibration is all there is.
  // `snapshots` arrives pre-filtered to REAL observations (calibrations live
  // in their own prop), so every doc here is usable evidence.
  const guardedByRealData = isGlobal || selKey === 'ibkr'
  const coveredByRealData = (anchorDate) => calibrationCoveredByRealData(anchorDate, snapshots, guardedByRealData)

  const setKindValue = (kind, v) => setValues((prev) => ({ ...prev, [kind]: v }))

  const save = async () => {
    setError('')
    setDoneMsg('')
    const filled = []
    for (const k of KINDS) {
      const raw = (values[k.key] || '').trim()
      if (raw === '') continue
      const pct = parseFloat(raw)
      if (!isFinite(pct)) {
        setError(t('Revisa los porcentajes: deben ser números (ej. 8.61 o -3.2).', 'Check the percentages: they must be numbers (e.g. 8.61 or -3.2).'))
        return
      }
      filled.push({ kind: k.key, label: t(k.es, k.en), targetPct: pct })
    }
    if (filled.length === 0) {
      setError(t('Escribe al menos un porcentaje.', 'Fill in at least one percentage.'))
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
      const dateStr = calibrationAnchorDate(f.kind, todayStr, inceptionDate)
      if (!dateStr || dateStr >= todayStr) {
        skipped.push({ label: f.label, reason: t('ese período aún no tiene días que medir', 'that period has no days to measure yet') })
        continue
      }
      if (coveredByRealData(dateStr)) {
        skipped.push({ label: f.label, reason: t('ese tramo ya lo cubren tus datos reales', 'that stretch is already covered by your real data') })
        continue
      }
      jobs.push({
        ...f,
        dateStr,
        startTs: Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)),
      })
    }
    if (jobs.length === 0) {
      setError(skipped.length > 0
        ? `${t('No se guardó nada:', 'Nothing was saved:')} ${skipped.map((s) => `${s.label} (${s.reason})`).join('; ')}.`
        : t('No se guardó nada.', 'Nothing was saved.'))
      return
    }

    setSaving(true)
    const failed = []
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
        if (res.error) { failed.push(job.label); continue }
        solved.push({ ...job, startValue: res.startValue })
      }
      const selName = isGlobal ? null : (accounts.find((a) => a.key === selKey)?.name || selKey)
      const endUSD = isGlobal ? toUSD(netWorth) : accountEndUSD
      for (const s of solved) {
        // Global solves in base currency and converts to USD; per-account
        // already solved in USD.
        const netWorthUSD = isGlobal ? toUSD(s.startValue) : s.startValue
        if (netWorthUSD == null || !isFinite(netWorthUSD)) { failed.push(s.label); continue }
        await saveSnapshot({
          date: s.dateStr,
          netWorthUSD,
          _source: 'manual',
          _calibrated: true,
          _calibrationKind: s.kind,
          targetPct: s.targetPct,
          capturedAt: todayStr,
          capturedEndValueUSD: endUSD != null && isFinite(endUSD) ? endUSD : undefined,
          ...(isGlobal ? {} : { _account: selKey, _accountName: selName }),
        })
      }
      const notes = []
      if (skipped.length > 0) notes.push(`${t('Omitidos:', 'Skipped:')} ${skipped.map((s) => `${s.label} (${s.reason})`).join('; ')}`)
      if (failed.length > 0) {
        notes.push(`${t('No cuadraron con los flujos registrados:', 'Could not be reconciled with the recorded flows:')} ${failed.join(', ')}`)
      }
      if (solved.length === 0) {
        setError(t(
          'No se pudo cuadrar ningún período con los flujos registrados de esta cuenta: el valor de arranque implícito no es válido. Revisa los % o registra tus depósitos y retiros primero.',
          'Could not reconcile any period with this account\'s recorded flows: the implied start value is not valid. Check the % or record your deposits and withdrawals first.'
        ))
        return
      }
      setDoneMsg(`${t(
        'Listo: tu rendimiento ahora cuadra con tu broker. Si después importas el historial real, esos datos reemplazan la calibración automáticamente.',
        'Done: your return now matches your broker. If you later import the real history, that data automatically replaces the calibration.'
      )}${notes.length > 0 ? ` ${notes.join('. ')}.` : ''}`)
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
              'Escribe los rendimientos que muestra la app de tu broker para cada período. Deja en blanco los que no sepas: puedes completarlos cuando quieras. Ajustamos la curva estimada para que cuadre con tus números y con tus datos reales; desde tu último dato real manda el mercado.',
              'Type the returns your broker app shows for each period. Leave blank the ones you do not know: you can fill them in anytime. We adjust the estimated curve so it matches your numbers and your real data; from your last real datapoint onward, the market rules.'
            )}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t(
              'La calibración es por cuenta porque cada broker muestra el rendimiento de SU cuenta (en IBKR: Performance & Reports, PortfolioAnalyst). El % queda fijo en su fecha y se mueve con el mercado día a día.',
              'Calibration is per account because each broker shows the return of ITS account (in IBKR: Performance & Reports, PortfolioAnalyst). The % stays pinned to its date and moves with the market day by day.'
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
                <div key={s.id || `${s.date}-${s._account || 'global'}-${s._calibrationKind || 'cal'}`} className="flex items-center justify-between text-xs gap-2">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {s._label} · {KIND_LABEL(s._calibrationKind, t)} · {s.date}
                    {s.targetPct != null && isFinite(s.targetPct) && (
                      <span style={{ color: 'var(--text-muted)' }}> · {s.targetPct}%{s.capturedAt ? ` ${t('el', 'on')} ${s.capturedAt}` : ''}</span>
                    )}
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
            {KINDS.filter((k) => k.key !== 'all').map((k) => (
              <div key={k.key}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                  {t(k.es, k.en)} (%)
                  {calForSelected(k.key) && (
                    <span className="ml-1" style={{ color: 'var(--accent-amber, #f59e0b)' }}>{t('(se reemplaza)', '(replaced)')}</span>
                  )}
                </label>
                <input type="number" step="any" value={values[k.key] || ''} onChange={(e) => setKindValue(k.key, e.target.value)}
                  placeholder={t('ej. 8.61', 'e.g. 8.61')} className={inputCls} />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Desde el inicio (%)', 'Since inception (%)')}
              {calForSelected('all') && (
                <span className="ml-1" style={{ color: 'var(--accent-amber, #f59e0b)' }}>{t('(se reemplaza)', '(replaced)')}</span>
              )}
            </label>
            <input type="number" step="any" value={values.all || ''} onChange={(e) => setKindValue('all', e.target.value)}
              placeholder={t('ej. 87.24', 'e.g. 87.24')} className={inputCls} />
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
