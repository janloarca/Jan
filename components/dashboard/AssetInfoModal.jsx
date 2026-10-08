'use client'

import { useMemo, useState } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { assetSummary } from '@/lib/assetSummary'
import { learnedRateSuggestion, applyPatch, dismissPatch } from '@/lib/learnedRate'
import { formatCurrency, categoryLabel, itemLabel } from './utils'
import { InfoTip } from '../ui/Tooltip'

// Ficha general de un activo, la que sale al tocar su nombre en la Hoja.
//
// Antes tocar el nombre abría directo el editor, que es una pantalla de
// formulario: para saber "¿cuánto puse y cuánto he ganado en esto?" había que
// abrir un formulario y calcular a mano. Ahora el nombre abre esta ficha y el
// editor queda a un botón ("Editar"), exactamente como se veía antes.
//
// ⛔ Solo lectura: las cifras salen de lib/assetSummary.js, que usa las
// funciones de la convención de rendimiento sin fórmula propia. Esta pantalla
// no calcula nada.
//
// Una fila "sin dato" dice "-" y no "0": que no se pueda medir un porcentaje
// (no hay capital invertido) es distinto de que haya rendido cero.
const Row = ({ label, children, tip }) => (
  <div className="flex items-baseline justify-between gap-3 py-2 border-t first:border-t-0" style={{ borderColor: 'var(--border-subtle)' }}>
    <span className="text-caption flex items-center gap-1 shrink-0" style={{ color: 'var(--text-muted)' }}>
      {label}{tip ? <InfoTip text={tip} /> : null}
    </span>
    <span className="text-body font-medium tabular-nums text-right min-w-0 break-words" style={{ color: 'var(--text-primary)' }}>{children}</span>
  </div>
)

export default function AssetInfoModal({ item, items = [], transactions = [], convert, baseCurrency = 'USD', lang = 'es', observations, currentMonthKey, onUpdateItem, onClose, onEdit }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  useEscClose(onClose)

  const s = useMemo(
    () => assetSummary(item, { transactions, items, convert, baseCurrency }),
    [item, items, transactions, convert, baseCurrency],
  )
  // FASE QC: la tasa que los saldos corregidos en la Hoja dicen que la cuenta
  // rinde. Solo se SUGIERE: aplicarla o descartarla es un toque del usuario.
  const learned = useMemo(
    () => learnedRateSuggestion({ item, observations, items, transactions, convert, currentMonthKey }),
    [item, observations, items, transactions, convert, currentMonthKey],
  )
  const [rateBusy, setRateBusy] = useState(false)
  const [rateError, setRateError] = useState(false)
  const settleRate = async (patch) => {
    if (!onUpdateItem || !item?.id) return
    setRateBusy(true); setRateError(false)
    try { await onUpdateItem(item.id, patch) } catch { setRateError(true) }
    setRateBusy(false)
  }
  if (!s) return null

  const money = (v) => formatCurrency(v, s.currency)
  const gainUp = s.gain != null && s.gain >= 0
  const gainColor = s.gain == null ? 'var(--text-primary)' : (gainUp ? 'var(--accent-green)' : 'var(--text-negative)')
  const sign = (v) => (v > 0 ? '+' : '')
  const dash = '-'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-label={itemLabel(item)}
        className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{itemLabel(item)}</h2>
            <p className="text-micro truncate" style={{ color: 'var(--text-muted)' }}>
              {[categoryLabel(s.category, lang), item.symbol && item.symbol !== itemLabel(item) ? item.symbol : null, s.institution].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-xl leading-none px-1" style={{ color: 'var(--text-muted)' }} aria-label={t('Cerrar', 'Close')}>×</button>
        </div>

        <div className="mt-3">
          {s.isDebt ? (
            <Row label={t('Saldo de la deuda', 'Debt balance')}>{money(s.balance)}</Row>
          ) : (
            <>
              <Row label={t('Invertido', 'Invested')}
                tip={t('Todo el efectivo que puso de tu bolsillo, comisión de entrada incluida, sin contar el ingreso que otros activos le depositaron.',
                       'All the cash you put in, entry fee included, not counting income other assets deposited into it.')}>
                {money(s.invested)}
              </Row>
              <Row label={t('Saldo total', 'Total balance')}>{money(s.balance)}</Row>
              <Row label={t('Rendimientos', 'Returns')}
                tip={t('Lo que el activo hizo (valor menos lo que costó él solo) más los pagos que generó. Es la misma cuenta de Asignación de Activos.',
                       'What the asset did (value minus what it alone cost) plus the payments it generated. Same math as Asset Allocation.')}>
                <span style={{ color: gainColor }}>
                  {s.gain > 0 ? '▲ ' : s.gain < 0 ? '▼ ' : ''}{sign(s.gain)}{money(s.gain)}
                  {s.gainPct != null && <span className="text-caption font-normal"> ({sign(s.gainPct)}{s.gainPct.toFixed(2)}%)</span>}
                </span>
              </Row>
              <Row label={t('Saldo ÷ invertido', 'Balance ÷ invested')}
                tip={t('Cuántas veces el saldo actual cubre lo que pusiste. 1.00x es empatar.',
                       'How many times today\'s balance covers what you put in. 1.00x is break-even.')}>
                {s.multiple != null ? `${s.multiple.toFixed(2)}x` : dash}
              </Row>
              {s.ownYield > 0 && (
                <Row label={t('Rendimiento reinvertido', 'Reinvested yield')}
                  tip={t('Interés que esta cuenta ganó y dejó dentro de su propio saldo. Ya está incluido en el saldo total.',
                         'Interest this account earned and kept inside its own balance. Already included in the total balance.')}>
                  {money(s.ownYield)}
                </Row>
              )}
            </>
          )}
          <Row label={t('Sector', 'Sector')}>{s.sector || dash}</Row>
          <Row label={t('Ubicación', 'Location')}>{s.location || dash}</Row>
        </div>

        {learned && onUpdateItem && (
          <div className="mt-3 rounded-xl p-3" style={{ border: '1px solid var(--card-border)', background: 'var(--bg-tertiary)' }}>
            <p className="text-body font-medium" style={{ color: 'var(--text-primary)' }}>
              {t('Tasa que parece rendir: ', 'Rate it seems to earn: ')}{learned.ratePct.toFixed(2)}%
              {learned.declaredPct != null && (
                <span className="text-caption font-normal" style={{ color: 'var(--text-muted)' }}>
                  {t(` (declaraste ${learned.declaredPct}%)`, ` (you set ${learned.declaredPct}%)`)}
                </span>
              )}
            </p>
            <p className="text-micro mt-1" style={{ color: 'var(--text-muted)' }}>
              {t(
                `Sale de ${learned.used} meses de saldos que corregiste en la Hoja, sin contar lo que metiste o sacaste. Es un promedio de lo que pasó, no una promesa.`,
                `From ${learned.used} months of balances you corrected in the Sheet, not counting what you put in or took out. It is an average of what happened, not a promise.`,
              )}
              {learned.ignored.length > 0 && t(` Se dejaron fuera ${learned.ignored.length} mes(es) que no parecen rendimiento.`, ` ${learned.ignored.length} month(s) that don't look like yield were left out.`)}
            </p>
            {!learned.canApply && (
              <p className="text-micro mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('Esta cuenta no tiene una tasa fija declarada, así que no se cambia nada sola: si quieres usarla, edítala.', 'This account has no fixed rate set, so nothing changes by itself: edit it if you want to use it.')}
              </p>
            )}
            {rateError && <p className="text-micro mt-1" style={{ color: 'var(--text-negative)' }}>{t('No se pudo guardar. Intenta de nuevo.', 'Could not save. Try again.')}</p>}
            <div className="flex gap-2 mt-2">
              {learned.canApply && (
                <button type="button" disabled={rateBusy} onClick={() => settleRate(applyPatch(learned))}
                  className="btn-primary min-h-[36px] px-3 py-1.5 rounded-lg text-caption font-medium">
                  {t(`Usar ${learned.ratePct.toFixed(2)}%`, `Use ${learned.ratePct.toFixed(2)}%`)}
                </button>
              )}
              <button type="button" disabled={rateBusy} onClick={() => settleRate(dismissPatch(learned))}
                className="btn-secondary min-h-[36px] px-3 py-1.5 rounded-lg text-caption font-medium">
                {t('No, gracias', 'No thanks')}
              </button>
            </div>
          </div>
        )}

        <p className="text-micro mt-3" style={{ color: 'var(--text-muted)' }}>
          {t(`Cifras en ${s.currency}.`, `Figures in ${s.currency}.`)}
        </p>

        <div className="flex gap-2 mt-4">
          {onEdit && (
            <button type="button" onClick={() => onEdit(item)} className="btn-primary flex-1 min-h-[40px] px-4 py-2 rounded-xl text-body font-medium">
              {t('Editar', 'Edit')}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary min-h-[40px] px-4 py-2 rounded-xl text-body font-medium">
            {t('Cerrar', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}
