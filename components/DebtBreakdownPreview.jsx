'use client'

// El desglose de una deuda MIENTRAS se configura (FASE LT), compartido por
// AddAccountModal y EditAccountModal: dos copias de estas frases es como una
// se queda atrás (la lección de InfoTip y lib/transferTx.js). Es un panel
// puramente informativo alimentado por lib/debtMath.js: no escribe nada y no
// toca ningún retorno.

import { debtBreakdown } from '@/lib/debtMath'

export default function DebtBreakdownPreview({ draft, balance, currency = 'USD', lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const bd = debtBreakdown(draft, { balance })
  if (!bd || !(bd.monthlyRate > 0)) return null
  const f = (v) => `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="rounded-lg px-3 py-2 text-xs space-y-1"
      style={{ backgroundColor: 'var(--bg-tertiary, rgba(127,127,127,0.06))', border: '1px solid var(--card-border)', color: 'var(--text-secondary)' }}>
      <p>
        {t('Interés del mes: ', "This month's interest: ")}
        <span className="font-medium">~{f(bd.monthlyInterest)}</span>
        {' '}({draft.interestRate}% {draft.ratePeriod === 'monthly' ? t('mensual', 'monthly') : t('anual', 'yearly')}
        {' '}{t('sobre', 'on')} {f(bd.balance)})
      </p>

      {bd.paymentTooSmall && (
        <p style={{ color: 'var(--alert-warn-icon)' }}>
          ⚠ {bd.scheme === 'revolving'
            ? t(`El pago mínimo (${f(bd.payment)}) no cubre ni el interés del mes: pagando solo eso, la deuda CRECE.`,
                `The minimum payment (${f(bd.payment)}) does not even cover monthly interest: paying only that, the debt GROWS.`)
            : t(`Tu pago de ${f(bd.payment)} no cubre ni el interés del mes (${f(bd.monthlyInterest)}): con ese pago la deuda nunca baja.`,
                `Your ${f(bd.payment)} payment does not even cover monthly interest (${f(bd.monthlyInterest)}): at that payment the debt never shrinks.`)}
        </p>
      )}

      {!bd.paymentTooSmall && bd.scheme === 'amortizing' && bd.payment > 0 && (
        <p>
          {bd.paymentDerived
            ? t(`Cuota estimada: ~${f(bd.payment)}`, `Estimated installment: ~${f(bd.payment)}`)
            : t(`De tu cuota de ${f(bd.payment)}`, `Of your ${f(bd.payment)} installment`)}
          {bd.split && (
            <> · {t('el primer mes', 'the first month')}: {f(bd.split.interest)} {t('interés', 'interest')} + {f(bd.split.principal)} {t('capital', 'principal')}</>
          )}
        </p>
      )}

      {!bd.paymentTooSmall && bd.scheme === 'interest_only' && (
        <p>
          {t(`Pagás ~${f(bd.monthlyInterest)}/mes de intereses y el capital (${f(bd.balance)}) aparte o al final.`,
             `You pay ~${f(bd.monthlyInterest)}/mo in interest, and the principal (${f(bd.balance)}) separately or at the end.`)}
        </p>
      )}

      {bd.totalToPay != null && (
        <p>
          {t('Total a pagar con intereses: ', 'Total to pay with interest: ')}
          <span className="font-medium">~{f(bd.totalToPay)}</span>
          {' '}({f(bd.totalInterestRemaining)} {t('de intereses', 'in interest')}
          {bd.months != null ? t(`, en ~${bd.months} meses`, `, over ~${bd.months} months`) : ''})
        </p>
      )}
    </div>
  )
}
