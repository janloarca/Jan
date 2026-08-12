'use client'

// FASE HV. Revisión del rendimiento que una cuenta líquida generó por su
// cuenta, deducido del saldo que el usuario tecleó menos todo lo que ya
// sabíamos que había entrado (lib/liquidYield.js; la spec, en
// lib/assetLogic/liquidFundYield.js).
//
// Mismo trato que los flujos inferidos de FASE DQ: cada fila es una PROPUESTA.
// Nada se escribe hasta que el usuario acepta, y descartar deja la pregunta
// contestada en vez de repetirla en cada carga.
//
// El saldo NUNCA se toca aquí, y es el punto entero: estos montos se dedujeron
// de ese saldo, así que sumárselos sería sumarle un número sacado de él mismo.

import { useState } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { formatCurrency, formatDate } from './utils'

export default function LiquidYieldModal({
  candidates = [], onClose, onAccept, onDismiss, lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  const [busyId, setBusyId] = useState(null)
  const [done, setDone] = useState(() => new Set())
  const [openId, setOpenId] = useState(null)

  const run = async (c, fn) => {
    setBusyId(c.id)
    try {
      await fn(c)
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
              {t('Rendimiento de tus cuentas líquidas', 'Yield on your liquid accounts')}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {t('Tu saldo vale más que todo lo que sabemos que entró. Ese sobrante solo pudo generarlo la cuenta.',
                 'Your balance is worth more than everything we know went in. Only the account itself could have produced that.')}
            </p>
          </div>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
            className="text-xl leading-none shrink-0" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto space-y-3">
          {pending.length === 0 && (
            <p className="text-body py-6 text-center" style={{ color: 'var(--text-muted)' }}>
              {candidates.length === 0
                ? t('No hay nada que revisar por ahora.', 'Nothing to review right now.')
                : t('Listo, revisaste todo.', 'Done, you reviewed them all.')}
            </p>
          )}

          {pending.map((c) => {
            const busy = busyId === c.id
            const cur = c.currency
            const negative = c.status === 'negative-residual'
            const flagged = c.status === 'implausible-rate'
            return (
              <div key={c.id} className="rounded-xl p-3.5" style={{ border: '1px solid var(--card-border)' }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-body font-medium truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {t('saldo al', 'balance as of')} {formatDate(c.asOf)}
                  </span>
                </div>

                {negative ? (
                  <>
                    <p className="text-body mb-3" style={{ color: 'var(--text-primary)' }}>
                      {t('Entró más de lo que hay: ', 'More went in than is there: ')}
                      <span className="font-mono">{formatCurrency(c.contributed, cur)}</span>
                      {t(' contra un saldo de ', ' against a balance of ')}
                      <span className="font-mono">{formatCurrency(c.finalBalance, cur)}</span>.
                    </p>
                    <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                      {t('Eso no es rendimiento negativo: lo más probable es que falte registrar un retiro. No se escribe nada hasta que lo revises.',
                         'That is not a negative yield: most likely a withdrawal is missing. Nothing is written until you check.')}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="rounded-lg px-3 py-2 mb-2 text-body space-y-1"
                      style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <span>{t('Ya sabíamos que entró', 'Already known to have gone in')}</span>
                        <span className="font-mono">{formatCurrency(c.contributed, cur)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                        <span>{t('Lo generó la cuenta', 'Produced by the account')}</span>
                        <span className="font-mono">{formatCurrency(c.interest, cur)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-1"
                        style={{ borderTop: '1px solid var(--card-border)' }}>
                        <span>{t('Tu saldo', 'Your balance')}</span>
                        <span className="font-mono">{formatCurrency(c.finalBalance, cur)}</span>
                      </div>
                    </div>

                    <p className="text-body mb-2" style={{ color: 'var(--text-secondary)' }}>
                      {t('Eso equivale a un ', 'That works out to a ')}
                      <span className="font-semibold" style={{ color: flagged ? 'var(--alert-warn-text)' : 'var(--accent-green)' }}>
                        {c.ratePct.toFixed(2)}%
                      </span>
                      {t(' anual, repartido en ', ' a year, spread over ')}{c.months.length}
                      {t(' meses: cada aporte empieza a rendir el día que entró.', ' months: each contribution starts earning the day it arrived.')}
                    </p>

                    {flagged && (
                      <p className="rounded-lg px-3 py-2 mb-2 text-[11px] leading-relaxed"
                        style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)', color: 'var(--alert-warn-text)' }}>
                        {c.declared
                          ? t(`Es mucho más de la tasa que configuraste (${c.declared.ratePct.toFixed(2)}%). Con esa tasa el rendimiento habría sido ${formatCurrency(c.declared.expectedInterest, cur)}, así que quedan ${formatCurrency(c.declared.unexplained, cur)} sin explicar: lo más probable es que falte registrar un depósito.`,
                               `That is far above the rate you configured (${c.declared.ratePct.toFixed(2)}%). At that rate the yield would have been ${formatCurrency(c.declared.expectedInterest, cur)}, leaving ${formatCurrency(c.declared.unexplained, cur)} unexplained: most likely a deposit is missing.`)
                          : t('Es una tasa muy alta para una cuenta líquida. Lo más probable es que falte registrar un depósito, no que la cuenta haya rendido tanto.',
                               'That is a very high rate for a liquid account. Most likely a deposit is missing, rather than the account having earned that much.')}
                      </p>
                    )}

                    <button type="button" onClick={() => setOpenId(openId === c.id ? null : c.id)}
                      className="text-xs mb-2" style={{ color: 'var(--accent-blue)' }}>
                      {openId === c.id ? t('Ocultar el detalle mes a mes', 'Hide the month by month') : t('Ver el detalle mes a mes', 'See the month by month')}
                    </button>

                    {openId === c.id && (
                      <div className="rounded-lg mb-2 max-h-40 overflow-y-auto text-xs"
                        style={{ border: '1px solid var(--card-border)' }}>
                        {c.months.map((m) => (
                          <div key={m.month} className="flex items-center justify-between px-3 py-1"
                            style={{ color: 'var(--text-secondary)' }}>
                            <span>{m.month}</span>
                            <span className="font-mono">{formatCurrency(m.amount, cur)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
                      {t('Tu saldo no se modifica: estos montos salieron de él. Lo que cambia es tu historial, que hasta ahora mostraba la cuenta sin rendir nada.',
                         'Your balance is not changed: these amounts came out of it. What changes is your history, which until now showed the account earning nothing.')}
                    </p>
                  </>
                )}

                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => run(c, onDismiss)}
                    className="flex-1 py-1.5 text-xs rounded-lg border disabled:opacity-50"
                    style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                    {negative ? t('Lo reviso después', 'I will check later') : t('No fue rendimiento', 'It was not yield')}
                  </button>
                  {!negative && (
                    <button type="button" disabled={busy} onClick={() => run(c, onAccept)}
                      className="flex-1 py-1.5 text-xs font-medium rounded-lg text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--accent-blue-strong, #2563eb)' }}>
                      {busy ? '...' : t('Sí, registrarlo', 'Yes, record it')}
                    </button>
                  )}
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
