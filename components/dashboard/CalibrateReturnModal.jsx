'use client'

import { useState } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { solveDietzStartValue } from '@/components/dashboard/utils'

// Return calibration: the user types the return their broker shows (YTD and/or
// since inception) and we place a manual anchor snapshot whose value makes OUR
// Modified Dietz reproduce that percentage exactly (solveDietzStartValue).
// The anchor is _source:'manual' (priority 3) so a later real IBKR import
// (priority 4) overwrites it automatically, and _calibrated:true marks it so
// the UI can badge it and "Quitar calibración" can find it.
export default function CalibrateReturnModal({ onClose, netWorth, transactions, convert, baseCurrency = 'USD', snapshots = [], saveSnapshot, deleteSnapshot, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en
  const year = new Date().getUTCFullYear()
  const todayStr = new Date().toISOString().split('T')[0]

  const calibrated = (snapshots || []).filter((s) => s && s._calibrated && s.date)
  const hasYtdCal = calibrated.some((s) => s._calibrationKind === 'ytd')
  const hasAllCal = calibrated.some((s) => s._calibrationKind === 'all')

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

  // Never clobber a real observation at the anchor date: if the broker or the
  // daily tracker already stored that day, calibration has nothing to add.
  const realSnapshotAt = (dateStr) =>
    (snapshots || []).find((s) => s && s.date === dateStr && !s._calibrated && (s._source === 'ibkr' || s._source === 'daily'))

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
    if (!netWorth || netWorth <= 0) {
      setError(t('No hay valor actual de la portafolio para calibrar.', 'There is no current portfolio value to calibrate against.'))
      return
    }
    const endTs = Date.now()
    const jobs = []
    if (ytd != null) {
      const dateStr = `${year}-01-01`
      if (realSnapshotAt(dateStr)) {
        setError(t('El 1 de enero ya tiene un dato real de tu broker: el YTD mostrado ya viene de datos reales y no necesita calibración.', 'January 1st already has real broker data: the displayed YTD already comes from real data and needs no calibration.'))
        return
      }
      jobs.push({ kind: 'ytd', targetPct: ytd, startTs: Date.UTC(year, 0, 1), dateStr })
    }
    if (all != null) {
      if (realSnapshotAt(inceptionDate)) {
        setError(t('La fecha de inicio ya tiene un dato real de tu broker: elige otra fecha o importa tu historial real.', 'The inception date already has real broker data: pick another date or import your real history.'))
        return
      }
      jobs.push({ kind: 'all', targetPct: all, startTs: new Date(inceptionDate + 'T00:00:00Z').getTime(), dateStr: inceptionDate })
    }
    setSaving(true)
    try {
      const solved = []
      for (const job of jobs) {
        const res = solveDietzStartValue({
          endValue: netWorth, startTs: job.startTs, endTs,
          transactions, convert, baseCurrency, targetPct: job.targetPct,
        })
        if (res.error) {
          setError(t(
            `No se pudo cuadrar el ${job.kind === 'ytd' ? 'YTD' : 'retorno desde el inicio'} con los flujos registrados: el valor de arranque implícito no es válido. Revisa el % o registra tus depósitos y retiros primero.`,
            `Could not reconcile the ${job.kind === 'ytd' ? 'YTD' : 'since-inception return'} with the recorded flows: the implied start value is not valid. Check the % or record your deposits and withdrawals first.`
          ))
          setSaving(false)
          return
        }
        solved.push({ ...job, startValue: res.startValue })
      }
      for (const s of solved) {
        const netWorthUSD = toUSD(s.startValue)
        if (netWorthUSD == null || !isFinite(netWorthUSD)) throw new Error('fx')
        await saveSnapshot({
          date: s.dateStr,
          netWorthUSD,
          _source: 'manual',
          _calibrated: true,
          _calibrationKind: s.kind,
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
              'Escribe los porcentajes que ves en tu broker (en IBKR: Performance & Reports, PortfolioAnalyst). Ajustamos el valor de arranque para que el % quede exacto. La curva entre ese punto y hoy se estima y los trades históricos no se recuperan: para eso está la importación de historial.',
              'Type the percentages you see in your broker (in IBKR: Performance & Reports, PortfolioAnalyst). We adjust the start value so the % is exact. The curve between that point and today is estimated and historical trades are not recovered: use history import for that.'
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

          {calibrated.length > 0 && (
            <div className="p-3 rounded-lg space-y-2" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('Calibraciones activas', 'Active calibrations')}</p>
              {calibrated.map((s) => (
                <div key={s.id || s.date} className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {s._calibrationKind === 'ytd' ? 'YTD' : t('Desde el inicio', 'Since inception')} · {s.date}
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
