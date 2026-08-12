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

const KIND_LABEL = {
  deposit: ['Depósito', 'Deposit'],
  withdrawal: ['Retiro', 'Withdrawal'],
  income: ['Pago recibido', 'Payment received'],
  sale: ['Venta acreditada', 'Sale credited'],
  'transfer-in': ['Transferencia entrante', 'Transfer in'],
  'transfer-out': ['Transferencia saliente', 'Transfer out'],
}

// Lo que el motor contó, fila por fila. Existe para que un veredicto se pueda
// CONTRASTAR contra el historial en pantalla en vez de tener que deducirlo de
// dos totales: si un retiro que el usuario ve en su lista no aparece acá, ya
// sabemos que el problema es cómo quedó archivado ese movimiento, y si aparece,
// lo que falta es otro movimiento distinto.
function Movements({ list, cur, t, total }) {
  if (!list || list.length === 0) return null
  return (
    <div className="rounded-lg mb-3 max-h-48 overflow-y-auto text-xs"
      style={{ border: '1px solid var(--card-border)' }}>
      {list.map((m, i) => (
        <div key={m.txId || i} className="flex items-center justify-between gap-2 px-3 py-1.5"
          style={{ color: 'var(--text-secondary)' }}>
          <span className="truncate">
            {formatDate(new Date(m.ts).toISOString().slice(0, 10))}
            {' · '}
            {t(...(KIND_LABEL[m.kind] || [m.kind, m.kind]))}
          </span>
          <span className="font-mono shrink-0" style={{ color: m.amount < 0 ? 'var(--text-negative)' : 'var(--text-primary)' }}>
            {m.amount < 0 ? '-' : '+'}{formatCurrency(Math.abs(m.amount), cur)}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 font-medium"
        style={{ color: 'var(--text-primary)', borderTop: '1px solid var(--card-border)' }}>
        <span>{t('Total que contamos', 'Total we counted')}</span>
        <span className="font-mono">{formatCurrency(total, cur)}</span>
      </div>
    </div>
  )
}

export default function LiquidYieldModal({
  candidates = [], onClose, onAccept, onDismiss, onRegisterMissing, onOpenAccount, lang = 'es',
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
            // Sin tasa resuelta no hay nada que registrar. Hoy el memo que
            // arma los candidatos ya filtra esos casos, pero el modal no puede
            // depender de eso: leer `.toFixed` de un null tumba la pantalla
            // entera, y un candidato de más es un cambio de una línea en el
            // caller. Se muestran igual los movimientos, que es lo útil.
            const nothingToRecord = !negative && (c.ratePct == null || !c.months || c.months.length === 0)
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
                      {t('Eso no es rendimiento negativo: falta un movimiento por registrar. Abajo está exactamente lo que contamos, para que veas cuál falta. No se escribe nada hasta que lo revises.',
                         'That is not a negative yield: a movement is missing. Below is exactly what we counted, so you can see which one. Nothing is written until you check.')}
                    </p>
                    <Movements list={c.contributions} cur={cur} t={t} total={c.contributed} />
                    {/* FASE HV6. El desglose deja de ser solo un informe. Mirando
                        la lista solo hay dos desenlaces, y cada uno tiene su
                        botón: falta una salida (se registra, con el monto ya
                        calculado) o sobra una fila (se borra, en la pantalla de
                        la cuenta, que es la única que sabe revertir el crédito
                        que ese pago movió). */}
                    <div className="flex gap-2 mb-3">
                      {onRegisterMissing && (
                        <button type="button" onClick={() => onRegisterMissing(c)}
                          className="flex-1 py-1.5 text-xs font-medium rounded-lg text-white"
                          style={{ backgroundColor: 'var(--accent-blue-strong, #2563eb)' }}>
                          {t(`Registrar el retiro de ${formatCurrency(Math.abs(c.interest), cur)}`,
                             `Record the ${formatCurrency(Math.abs(c.interest), cur)} withdrawal`)}
                        </button>
                      )}
                      {onOpenAccount && (
                        <button type="button" onClick={() => onOpenAccount(c)}
                          className="flex-1 py-1.5 text-xs rounded-lg border"
                          style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                          {t('Sobra una fila: corregirla', 'A row is wrong: fix it')}
                        </button>
                      )}
                    </div>
                  </>
                ) : nothingToRecord ? (
                  <>
                    <p className="text-body mb-2" style={{ color: 'var(--text-primary)' }}>
                      {t('Los movimientos explican tu saldo completo: no hay rendimiento que registrar.',
                         'Your movements explain the whole balance: there is no yield to record.')}
                    </p>
                    <Movements list={c.contributions} cur={cur} t={t} total={c.contributed} />
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
                      {openId === c.id ? t('Ocultar el detalle', 'Hide the detail') : t('Ver el detalle', 'See the detail')}
                    </button>

                    {openId === c.id && (
                      <>
                        <p className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                          {t('Lo que contamos como que entró:', 'What we counted as going in:')}
                        </p>
                        <Movements list={c.contributions} cur={cur} t={t} total={c.contributed} />
                        <p className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                          {t('Cómo se reparte el rendimiento:', 'How the yield is spread:')}
                        </p>
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
                      </>
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
                  {!negative && !nothingToRecord && (
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
