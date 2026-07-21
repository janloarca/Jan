'use client'

// Repeating date+amount rows for capturing HOW an account reached its value
// ("Dec 2024: +10,000 · Feb 2025: +5,000 …"). Pure controlled component: the
// parent owns `rows` and decides what to do with them on submit.
//
// Sum semantics: rows explain the total, they don't add to it. For balance
// assets the sum may fall SHORT of the total (the difference is growth); it
// may never exceed it. Share-based assets require an exact sum (shares don't
// grow on their own), which the parent requests via `requireExact`.

const fmtNum = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

export default function TimelineEditor({ rows, onChange, total, currency = 'USD', requireExact = false, lang = 'es' }) {
  const t = (es, en) => lang === 'es' ? es : en
  const today = new Date().toISOString().split('T')[0]

  const sum = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const totalNum = Number(total) || 0
  const remainder = totalNum - sum
  const overshoot = remainder < -Math.max(totalNum * 0.005, 0.01)
  const short = remainder > Math.max(totalNum * 0.005, 0.01)

  const setRow = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => onChange([...rows, { date: today, amount: '' }])
  const removeRow = (i) => onChange(rows.filter((_, j) => j !== i))
  const fillRemainder = () => {
    if (!(remainder > 0) || rows.length === 0) return
    const last = rows.length - 1
    const lastAmt = parseFloat(rows[last].amount) || 0
    setRow(last, { amount: String(Math.round((lastAmt + remainder) * 100) / 100) })
  }

  // Mirrors AddAccountModal's inputCls tokens so timeline rows read like every
  // other field in the modal (same bg, border, padding) in both themes.
  const inputCls = 'w-full min-w-0 px-3 py-2 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg text-sm text-[var(--text-primary,white)] placeholder-[var(--text-muted,#475569)] focus:outline-none focus:border-blue-500/50'

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input type="date" value={row.date} max={today}
            onChange={(e) => setRow(i, { date: e.target.value })}
            className={`${inputCls} flex-1`} aria-label={t(`Fecha del aporte ${i + 1}`, `Contribution ${i + 1} date`)} />
          <input type="number" value={row.amount} step="any" min="0" placeholder="10000"
            onChange={(e) => setRow(i, { amount: e.target.value })}
            className={`${inputCls} flex-1 text-right font-mono`} aria-label={t(`Monto del aporte ${i + 1}`, `Contribution ${i + 1} amount`)} />
          <button type="button" onClick={() => removeRow(i)} disabled={rows.length <= 1}
            className="shrink-0 w-8 h-8 rounded-lg text-sm disabled:opacity-30"
            style={{ color: 'var(--text-negative)', border: '1px solid color-mix(in srgb, var(--text-negative) 25%, transparent)' }}
            aria-label={t('Quitar aporte', 'Remove contribution')}>
            ✕
          </button>
        </div>
      ))}

      <button type="button" onClick={addRow}
        className="w-full px-3 py-2 rounded-lg text-xs font-medium border border-dashed transition-colors"
        style={{ color: 'var(--accent-blue)', borderColor: 'rgba(108,122,255,0.35)' }}>
        + {t('Agregar aporte', 'Add contribution')}
      </button>

      {totalNum > 0 && (
        <div className="text-xs rounded-lg p-2.5 space-y-1"
          style={overshoot
            ? { backgroundColor: 'var(--alert-error-bg)', border: '1px solid var(--alert-error-border)' }
            : { backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)' }}>
          <p style={{ color: overshoot ? 'var(--alert-error-icon)' : 'var(--text-secondary)' }}>
            {t('Suman', 'They add up to')} {currency} {fmtNum(sum)} {t('de', 'of')} {currency} {fmtNum(totalNum)}
            {short && <>: {t('faltan', 'missing')} {currency} {fmtNum(remainder)}</>}
            {overshoot && <>: {t('se pasan por', 'over by')} {currency} {fmtNum(-remainder)}</>}
          </p>
          {short && (
            requireExact ? (
              <button type="button" onClick={fillRemainder} className="underline" style={{ color: 'var(--accent-blue)' }}>
                {t('Completar en la última fila', 'Fill into the last row')}
              </button>
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>
                {t(`La diferencia (${currency} ${fmtNum(remainder)}) se contará como crecimiento de la inversión.`,
                   `The difference (${currency} ${fmtNum(remainder)}) will count as investment growth.`)}
                {' '}
                <button type="button" onClick={fillRemainder} className="underline" style={{ color: 'var(--accent-blue)' }}>
                  {t('O complétala en la última fila', 'Or fill it into the last row')}
                </button>
              </p>
            )
          )}
          {overshoot && (
            <p style={{ color: 'var(--alert-error-icon)' }}>
              {t('Los aportes no pueden superar el valor total.', 'Contributions cannot exceed the total value.')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// Validation helper for parents: returns an error string or null.
export function validateTimelineRows(rows, total, { requireExact = false, lang = 'es' } = {}) {
  const t = (es, en) => lang === 'es' ? es : en
  const today = new Date().toISOString().split('T')[0]
  const clean = rows.filter((r) => (parseFloat(r.amount) || 0) > 0 && r.date)
  if (clean.length === 0) return t('Agrega al menos un aporte con fecha y monto.', 'Add at least one dated contribution.')
  if (clean.some((r) => r.date > today)) return t('Las fechas no pueden ser futuras.', 'Dates cannot be in the future.')
  const sum = clean.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const totalNum = Number(total) || 0
  const tol = Math.max(totalNum * 0.005, 0.01)
  if (sum - totalNum > tol) return t('Los aportes superan el valor total.', 'Contributions exceed the total value.')
  if (requireExact && Math.abs(sum - totalNum) > tol) {
    return t('Para este activo los aportes deben sumar exactamente el valor total.', 'For this asset, contributions must add up exactly to the total value.')
  }
  return null
}
