'use client'

import { useState } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { solveDietzStartValue, accountKeyOfItem, heldFlatAccountValueUSD } from '@/components/dashboard/utils'

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
export default function CalibrateReturnModal({ onClose, netWorth, transactions, convert, baseCurrency = 'USD', snapshots = [], accountSnapshots = [], items = [], saveSnapshot, deleteSnapshot, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en
  const year = new Date().getUTCFullYear()
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
  const hasYtdCal = calForSelected('ytd')
  const hasAllCal = calForSelected('all')

  // Default inception date: earliest dated transaction or snapshot we know.
  const earliestKnown = (() => {
    const dates = []
    ;(transactions || []).forEach((tx) => { if (tx.date) dates.push(tx.date) })
    ;(snapshots || []).forEach((s) => { if (s && s.date && !s._calibrated) dates.push(s.date) })
    dates.sort()
    return dates[0] || ''
  })()

  const [ytdPct, setYtdPct] = useState('')
  const [allPct, setAllPct] = useState('')
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

  // Never clobber a real observation at the anchor date: if the broker or the
  // daily tracker already stored that day, calibration has nothing to add.
  // Applies to the whole portfolio and to the IBKR account; manual accounts
  // have no real per-account history, so calibration is all there is.
  const realSnapshotAt = (dateStr) =>
    (snapshots || []).find((s) => s && s.date === dateStr && !s._calibrated && (s._source === 'ibkr' || s._source === 'daily'))
  const guardedByRealData = isGlobal || selKey === 'ibkr'

  const save = async () => {
    setError('')
    setDoneMsg('')
    const ytd = ytdPct.trim() === '' ? null : parseFloat(ytdPct)
    const all = allPct.trim() === '' ? null : parseFloat(allPct)
    if (ytd == null && all == null) {
      setError(t('Escribe al menos uno de los dos porcentajes.', 'Fill in at least one of the two percentages.'))
      return
    }
    if ((ytd != null && !isFinite(ytd)) || (all != null && !isFinite(all))) {
      setError(t('Revisa los porcentajes: deben ser números (ej. 8.61 o -3.2).', 'Check the percentages: they must be numbers (e.g. 8.61 or -3.2).'))
      return
    }
    if (all != null && !inceptionDate) {
      setError(t('Para el retorno desde el inicio necesitas la fecha en que abriste la cuenta.', 'For the since-inception return you need the account opening date.'))
      return
    }
    if (all != null && inceptionDate >= todayStr) {
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
    if (ytd != null) {
      const dateStr = `${year}-01-01`
      if (guardedByRealData && realSnapshotAt(dateStr)) {
        setError(t('El 1 de enero ya tiene un dato real de tu broker: el YTD mostrado ya viene de datos reales y no necesita calibración.', 'January 1st already has real broker data: the displayed YTD already comes from real data and needs no calibration.'))
        return
      }
      jobs.push({ kind: 'ytd', targetPct: ytd, startTs: Date.UTC(year, 0, 1), dateStr })
    }
    if (all != null) {
      if (guardedByRealData && realSnapshotAt(inceptionDate)) {
        setError(t('La fecha de inicio ya tiene un dato real de tu broker: elige otra fecha o importa tu historial real.', 'The inception date already has real broker data: pick another date or import your real history.'))
        return
      }
      jobs.push({ kind: 'all', targetPct: all, startTs: new Date(inceptionDate + 'T00:00:00Z').getTime(), dateStr: inceptionDate })
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
            `No se pudo cuadrar el ${job.kind === 'ytd' ? 'YTD' : 'retorno desde el inicio'} con los flujos registrados de esta cuenta: el valor de arranque implícito no es válido. Revisa el % o registra tus depósitos y retiros primero.`,
            `Could not reconcile the ${job.kind === 'ytd' ? 'YTD' : 'since-inception return'} with this account's recorded flows: the implied start value is not valid. Check the % or record your deposits and withdrawals first.`
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
          ...(isGlobal ? {} : { _account: selKey, _accountName: selName }),
        })
      }
      setDoneMsg(t(
        'Listo: tu rendimiento ahora cuadra con tu broker. Si después importas el historial real, esos datos reemplazan la calibración automáticamente.',
        'Done: your return now matches your broker. If you later import the real history, that data automatically replaces the calibration.'
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
              'Cada broker muestra el rendimiento de SU cuenta, así que la calibración es por cuenta: elige la cuenta y escribe los porcentajes que ves en esa app (en IBKR: Performance & Reports, PortfolioAnalyst). Ajustamos el valor de arranque de esa cuenta para que el % quede exacto. La curva intermedia se estima y los trades históricos no se recuperan: para eso está la importación de historial.',
              'Each broker shows the return of ITS account, so calibration is per account: pick the account and type the percentages you see in that app (in IBKR: Performance & Reports, PortfolioAnalyst). We adjust that account start value so the % is exact. The in-between curve is estimated and historical trades are not recovered: use history import for that.'
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
                <div key={s.id || s.date} className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {s._label} · {s._calibrationKind === 'ytd' ? 'YTD' : t('Desde el inicio', 'Since inception')} · {s.date}
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
              {t('Retorno YTD (%)', 'YTD return (%)')}
              {hasYtdCal && <span className="ml-1" style={{ color: 'var(--accent-amber, #f59e0b)' }}>{t('(calibrado: se reemplaza)', '(calibrated: will be replaced)')}</span>}
            </label>
            <input type="number" step="any" value={ytdPct} onChange={(e) => setYtdPct(e.target.value)}
              placeholder={t('ej. 8.61', 'e.g. 8.61')} className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Retorno desde el inicio (%)', 'Since-inception return (%)')}
              {hasAllCal && <span className="ml-1" style={{ color: 'var(--accent-amber, #f59e0b)' }}>{t('(calibrado: se reemplaza)', '(calibrated: will be replaced)')}</span>}
            </label>
            <input type="number" step="any" value={allPct} onChange={(e) => setAllPct(e.target.value)}
              placeholder={t('ej. 87.24', 'e.g. 87.24')} className={inputCls} />
          </div>

          {allPct.trim() !== '' && (
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
