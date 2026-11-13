'use client'

import { useMemo } from 'react'
import { formatCurrency, formatDate, isMarketPriced } from './utils'
import { openLotsOfItem } from '@/lib/itemLots'

// FASE RY. Los lotes de compra abiertos de UNA posición. Vivía escrito dentro
// de AssetInfoModal (la ficha de la Hoja, FASE RW) y la ficha del tablero
// (AssetDetailModal) no los mostraba: el usuario veía los lotes de VOO en la
// auditoría de lotes y no al abrir VOO. Un solo componente para las dos
// fichas, para que no puedan volver a discrepar. Sin `lots` (caller viejo) no
// se afirma nada; misma regla de dueño que lib/itemLots.js.
export default function ItemLotsList({ item, lots, items = [], lang = 'es', className = 'mt-3' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const lotInfo = useMemo(() => (Array.isArray(lots) ? openLotsOfItem(item, lots, items) : null), [item, lots, items])
  if (!lotInfo || !item || item.isDebt) return null
  if (lotInfo.lots.length === 0 && !isMarketPriced(item)) return null
  const lotCur = item._originalCurrency || item.currency || 'USD'
  const fmtQty = (q) => Number(q).toLocaleString(lang === 'es' ? 'es' : 'en', { maximumFractionDigits: 8 })
  return (
    <div className={className} data-testid="asset-lots">
      <p className="text-caption mb-1" style={{ color: 'var(--text-muted)' }}>
        {t('Lotes de compra', 'Purchase lots')}{lotInfo.lots.length > 0 ? ` (${lotInfo.lots.length})` : ''}
      </p>
      {lotInfo.lots.length === 0 ? (
        <p className="text-micro" style={{ color: 'var(--text-muted)' }}>
          {lotInfo.sharedCount > 0
            ? t(`Hay ${lotInfo.sharedCount} lote(s) de este símbolo sin posición asignada, compartidos con otra posición igual: no se puede decir cuáles son de esta.`,
                `There are ${lotInfo.sharedCount} lot(s) of this symbol with no position assigned, shared with another identical position: it is not possible to say which are this one's.`)
            : t('Esta posición no tiene lotes de compra registrados: su historia se estima con la cantidad de hoy.',
                'This position has no purchase lots recorded: its history is estimated from today\'s quantity.')}
        </p>
      ) : (
        <ul className="text-body tabular-nums">
          {lotInfo.lots.map((l) => (
            <li key={l.id || `${l.acquisitionDate}-${l.quantity}-${l.costBasis}`} className="flex justify-between gap-3 py-1 border-t first:border-t-0" style={{ borderColor: 'var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{l.acquisitionDate ? formatDate(l.acquisitionDate) : t('Sin fecha', 'No date')}</span>
              <span className="text-right min-w-0 break-words" style={{ color: 'var(--text-primary)' }}>
                {fmtQty(l.quantity)} × {formatCurrency(Number(l.costBasis) || 0, lotCur)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {lotInfo.lots.length > 0 && Math.abs(lotInfo.totalQty - (Number(item.quantity) || 0)) > 1e-8 && (
        <p className="text-micro mt-1" style={{ color: 'var(--alert-warn-icon)' }}>
          {t(`Los lotes suman ${fmtQty(lotInfo.totalQty)} y la posición tiene ${fmtQty(Number(item.quantity) || 0)}.`,
             `Lots add up to ${fmtQty(lotInfo.totalQty)} and the position holds ${fmtQty(Number(item.quantity) || 0)}.`)}
        </p>
      )}
    </div>
  )
}
