'use client'

import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { formatCurrency } from './utils'

// El desglose de UN mes de Ingresos Pasivos: qué fue (o qué viene) y de qué
// cuenta. Dos variantes sobre la misma forma:
//  · received: lo que ya entró ese mes, por activo (lo reinvertido aparte);
//  · coming: lo que se espera ese mes, por activo y con su día de pago.
// Los números salen de `lib/incomeBreakdown.js`, el MISMO motor que dibuja la
// barra del mes, así que el total de arriba y el de la barra no pueden diferir.
const TYPE_LABEL = {
  dividend: ['Dividendo', 'Dividend'],
  coupon: ['Cupón', 'Coupon'],
  interest: ['Interés', 'Interest'],
}

function dayOf(iso) {
  return iso ? Number(iso.slice(8, 10)) : null
}

function Row({ row, kind, monthName, month, lang, baseCurrency }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const typeLabel = (TYPE_LABEL[row.incomeType] || TYPE_LABEL.dividend)[lang === 'es' ? 0 : 1]
  const when = kind === 'coming'
    ? `${monthName(month)} ${row.day}`
    : row.dates.map((d) => `${monthName(month)} ${dayOf(d)}`).join(', ')
  const accent = kind === 'coming' ? 'var(--accent-blue)' : 'var(--accent-green)'
  return (
    <li className="py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--card-border)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body font-medium min-w-0 truncate" style={{ color: 'var(--text-primary)' }} title={row.label}>
          {row.label}
        </span>
        <span className="font-mono tabular-nums font-semibold shrink-0 whitespace-nowrap" style={{ color: accent }}>
          {formatCurrency(row.amount, baseCurrency)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-caption" style={{ color: 'var(--text-muted)' }}>
        <span>{typeLabel}</span>
        {when && <span>· {when}</span>}
        {kind === 'received' && row.count > 1 && <span>· {row.count} {t('pagos', 'payments')}</span>}
        {row.native && (
          <span>· {formatCurrency(row.native.amount, row.native.currency)}</span>
        )}
        {row.destLabel && <span>· {t('a', 'to')} {row.destLabel}</span>}
        {kind === 'coming' && row.reinvest && <span>· {t('se reinvierte', 'reinvested')}</span>}
      </div>
    </li>
  )
}

export default function IncomeMonthModal({ detail, onClose, lang = 'es', baseCurrency = 'USD', monthName }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => (lang === 'es' ? es : en)
  useEscClose(onClose)

  const { kind, bucket } = detail
  const rows = bucket.rows || []
  const total = kind === 'coming'
    ? rows.reduce((s, r) => s + r.amount, 0)
    : bucket.total
  const reinvestedRows = kind === 'received' ? (bucket.reinvestedRows || []) : []
  const title = `${monthName(bucket.month)} ${bucket.year}`

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <button type="button" onClick={onClose} className="text-xl leading-none px-1" style={{ color: 'var(--text-muted)' }} aria-label={t('Cerrar', 'Close')}>×</button>
        </div>
        <p className="text-caption mb-3" style={{ color: 'var(--text-muted)' }}>
          {kind === 'coming' ? t('Lo que se espera cobrar', 'What you expect to receive') : t('Lo que cobraste', 'What you received')}
        </p>

        <div className="rounded-lg p-3 border mb-3" style={{ backgroundColor: kind === 'coming' ? 'var(--alert-info-bg)' : 'var(--bg-tertiary)', borderColor: 'var(--card-border)' }}>
          <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Total', 'Total')}</span>
          <span className="text-h2 font-mono tabular-nums" style={{ color: kind === 'coming' ? 'var(--accent-blue)' : 'var(--accent-green)' }}>
            {formatCurrency(total, baseCurrency)}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-body py-4 text-center" style={{ color: 'var(--text-muted)' }}>
            {kind === 'coming'
              ? t('No hay pagos pendientes este mes.', 'No payments pending this month.')
              : t('No hubo pagos en efectivo este mes.', 'No cash payments this month.')}
          </p>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <Row key={`${r.id}-${i}`} row={r} kind={kind} month={bucket.month} monthName={monthName} lang={lang} baseCurrency={baseCurrency} />
            ))}
          </ul>
        )}

        {kind === 'coming' && bucket.paidCount > 0 && (
          <p className="text-caption mt-3" style={{ color: 'var(--text-muted)' }}>
            {t(`${bucket.paidCount} ya se cobró este mes y no se cuenta acá.`, `${bucket.paidCount} already paid this month and is not counted here.`)}
          </p>
        )}

        {reinvestedRows.length > 0 && (
          <div className="mt-4">
            <p className="text-caption font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
              {t('Reinvertido (no es efectivo)', 'Reinvested (not cash)')}
            </p>
            <ul>
              {reinvestedRows.map((r, i) => (
                <Row key={`re-${r.id}-${i}`} row={r} kind="received" month={bucket.month} monthName={monthName} lang={lang} baseCurrency={baseCurrency} />
              ))}
            </ul>
            <p className="text-caption mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('Se queda dentro de la cuenta; no cuenta en la barra ni en el YTD.', 'It stays inside the account; it is not counted in the bar or the YTD.')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
