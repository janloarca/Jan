'use client'

// Review queue for lib/inferredFlows.js: gaps in the quarterly-transcribed
// history whose value change is too big to be pure market movement, given
// this account's OWN realized volatility. Each row is a CANDIDATE, never
// written on its own — the user accepts (writes a real DEPOSIT/WITHDRAWAL,
// dated at the gap's midpoint), edits the amount first, or dismisses it
// ("that really was just a good/bad quarter"). Either way the gap is marked
// reviewed and stops resurfacing.

import { useState } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { formatCurrency, formatDate } from './utils'
import BusyLabel from '@/components/ui/BusyLabel'

export default function InferredFlowsModal({
  candidates = [], reconciliation = null, onClose, onAccept, onDismiss, lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  const [busyId, setBusyId] = useState(null)
  const [edits, setEdits] = useState({}) // id -> amount override (string)
  const [done, setDone] = useState(() => new Set())

  const accept = async (c) => {
    setBusyId(c.id)
    try {
      const overridden = edits[c.id]
      const amount = overridden != null && overridden !== '' ? parseFloat(overridden) : c.amount
      await onAccept({ ...c, amount: isFinite(amount) && amount > 0 ? amount : c.amount })
      setDone((s) => new Set(s).add(c.id))
    } finally {
      setBusyId(null)
    }
  }

  const dismiss = async (c) => {
    setBusyId(c.id)
    try {
      await onDismiss(c)
      setDone((s) => new Set(s).add(c.id))
    } finally {
      setBusyId(null)
    }
  }

  const pending = candidates.filter((c) => !done.has(c.id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={trapRef} className="rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}>

        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('Posibles movimientos sin explicar', 'Possible unexplained movements')}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {t('Entre dos trimestres transcritos, el valor cambió más de lo que el mercado por sí solo explicaría para esta cuenta.',
                 'Between two transcribed quarters, the value changed more than the market alone would explain for this account.')}
            </p>
          </div>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
            className="text-xl leading-none shrink-0" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto space-y-3">
          {/* FASE GJ: the global reconciliation against the screenshot's own
              lifetime Net Deposits & Withdrawals. Shown whenever the summary
              was transcribed, so the user sees WHY these amounts close (or by
              how much they miss). */}
          {reconciliation && pending.length > 0 && (
            <div className="rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed"
              style={{ backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)', color: 'var(--text-secondary)' }}>
              {t('Cuadre con tu captura de PortfolioAnalyst: ', 'Reconciliation with your PortfolioAnalyst screenshot: ')}
              {t('depósitos netos de por vida ', 'lifetime net deposits ')}
              <span className="font-mono">{formatCurrency(reconciliation.lifetimeNetUSD, 'USD')}</span>
              {t(', ya registrados ', ', already on file ')}
              <span className="font-mono">{formatCurrency(reconciliation.knownNetUSD, 'USD')}</span>
              {t(', por explicar ', ', left to explain ')}
              <span className="font-mono">{formatCurrency(reconciliation.residualUSD, 'USD')}</span>.
              {reconciliation.scaledBy != null
                ? t(' Los montos estimados se ajustaron para que el total cierre; revisalos igual.', ' Estimated amounts were adjusted so the total closes; still review them.')
                : reconciliation.mismatchUSD !== 0
                  ? `${t(' Estos candidatos no cierran por ', ' These candidates miss by ')}${formatCurrency(Math.abs(reconciliation.mismatchUSD), 'USD')}${t(': revisá montos o si falta transcribir algún trimestre.', ': check the amounts or whether a quarter is missing from the transcription.')}`
                  : t(' Estos candidatos cierran con ese total.', ' These candidates close against that total.')}
            </div>
          )}
          {pending.length === 0 && (
            <p className="text-body py-6 text-center" style={{ color: 'var(--text-muted)' }}>
              {candidates.length === 0
                ? t('No hay huecos que revisar por ahora.', 'Nothing to review right now.')
                : t('Listo, revisaste todos.', 'Done, you reviewed them all.')}
            </p>
          )}
          {pending.map((c) => {
            const busy = busyId === c.id
            return (
              <div key={c.id} className="rounded-xl p-3.5" style={{ border: '1px solid var(--card-border)' }}>
                <div className="flex items-center justify-between text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  <span>{formatDate(c.fromDate)} → {formatDate(c.toDate)}</span>
                  <span className="font-mono">{formatCurrency(c.startVal, 'USD')} → {formatCurrency(c.endVal, 'USD')}</span>
                </div>
                <p className="text-body mb-2 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--text-primary)' }}>
                  <span>
                    {c.source === 'photo'
                      ? (c.type === 'DEPOSIT' ? t('Depósito marcado en tu captura, de aproximadamente', 'Deposit flagged in your screenshot, of approximately') : t('Retiro marcado en tu captura, de aproximadamente', 'Withdrawal flagged in your screenshot, of approximately'))
                      : (c.type === 'DEPOSIT' ? t('Posible depósito de aproximadamente', 'Possible deposit of approximately') : t('Posible retiro de aproximadamente', 'Possible withdrawal of approximately'))}
                  </span>
                  {c.source === 'photo' && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' }}>
                      {c.amountFromPhoto
                        ? t('monto leído de la barra de Cash Flows', 'amount read off the Cash Flows bar')
                        : t('de tu captura', 'from your screenshot')}
                    </span>
                  )}
                  {c.adjustedToLifetimeNet && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}>
                      {t('ajustado al neto de por vida', 'adjusted to lifetime net')}
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>USD</span>
                  <input
                    value={edits[c.id] ?? c.amount}
                    onChange={(e) => setEdits((v) => ({ ...v, [c.id]: e.target.value }))}
                    inputMode="decimal"
                    className="flex-1 px-3 py-1.5 rounded-lg text-sm font-mono"
                    style={{ backgroundColor: 'var(--input-bg, #000)', border: '1px solid var(--card-border, #38383A)', color: 'var(--text-primary, white)' }} />
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {t('el', 'on')} {formatDate(c.midDate)}
                  </span>
                </div>
                <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                  {t('La fecha exacta no se puede saber con solo el total del trimestre: se anota a la mitad del período.',
                     'The exact date cannot be known from just the quarter total: it is dated at the midpoint.')}
                </p>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => dismiss(c)}
                    className="flex-1 py-1.5 text-xs rounded-lg border disabled:opacity-50" style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                    {t('No fue un movimiento real', 'Not a real movement')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => accept(c)}
                    className="flex-1 py-1.5 text-xs font-medium rounded-lg text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent-blue-strong, #2563eb)' }}>
                    {<BusyLabel busy={busy} lang={lang}>{t('Sí, registrarlo', 'Yes, record it')}</BusyLabel>}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--card-border)' }}>
          <button type="button" onClick={onClose}
            className="w-full py-2 text-body rounded-lg border" style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
            {t('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}
