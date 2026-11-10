'use client'
import { useMemo } from 'react'
import { buildLotsAudit } from '@/lib/lotsAudit'
import ConfirmTap from '@/components/ui/ConfirmTap'

// Lectura por defecto. El único botón que escribe es "Ajustar lote" (dos toques):
// fija la cantidad del lote de UNA posición a la de la posición y le anota su
// dueño (itemId), para que las ventas futuras cierren ese lote.
export default function LotsAudit({ items, lots, lang, onFixLot }) {
  const es = lang === 'es'
  const rows = useMemo(() => buildLotsAudit(items, lots), [items, lots])
  const f = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 })
  if (!rows.length) return null
  return (
    <div className="card p-4 sm:p-5">
      <h3 className="card-title">{es ? 'Auditoría de lotes (solo lectura)' : 'Lots audit (read-only)'}</h3>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        {es ? 'Cantidad guardada por posición contra la suma de lotes abiertos del símbolo.' : 'Stored quantity per position vs. the sum of the symbol\'s open lots.'}
      </p>
      <div className="mt-3 space-y-3">
        {rows.map((g) => (
          <div key={g.symbol} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <div className="flex flex-wrap justify-between gap-x-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
              <span>{g.symbol}</span>
              <span className="tabular-nums">
                {es ? 'posiciones' : 'positions'} {f(g.qty)} · {es ? 'lotes abiertos' : 'open lots'} {f(g.openQty)} · {es ? 'diferencia' : 'gap'} {f(g.gap)}
              </span>
            </div>
            {g.positions.map((p) => (
              <div key={p.id} className="pl-3 tabular-nums">{p.institution || p.name}{p.date ? ` · ${p.date}` : ''}: {f(p.quantity)}
                {p.lotQty == null
                  ? ` · ${es ? 'sin lote que coincida' : 'no matching lot'}`
                  : ` · ${es ? 'lote' : 'lot'} ${f(p.lotQty)}${p.lotGap ? ` · ${es ? 'ajustar' : 'adjust'} ${f(p.lotGap)}` : ' ✓'}`}
                {onFixLot && p.lotId && p.lotGap ? (
                  <ConfirmTap
                    onConfirm={() => onFixLot(p.lotId, { quantity: p.quantity, itemId: p.id })}
                    className="ml-2 underline" style={{ color: 'var(--accent-blue)' }}
                    confirmContent={es ? `¿Fijar lote en ${f(p.quantity)}? Toca otra vez` : `Set lot to ${f(p.quantity)}? Tap again`}
                    confirmStyle={{ color: 'var(--text-negative)' }}
                  >{es ? 'Ajustar lote' : 'Fix lot'}</ConfirmTap>
                ) : null}
              </div>
            ))}
            {g.openLots.map((l) => (
              <div key={l.id} className="pl-3 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {es ? 'lote' : 'lot'} {f(l.quantity)} · {l.date || '-'} · {l.cost ?? '-'}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
