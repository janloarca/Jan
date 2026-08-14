'use client'

import { useState, useEffect, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { formatCurrency, getItemValue } from './utils'

// "¿Qué querés vender?": el paso que faltaba para que vender fuera alcanzable
// desde el dashboard. SellModal necesita un ítem concreto, y hasta ahora el
// ÚNICO camino para dárselo era el botón por fila dentro de la tabla de
// activos, así que quien no la abría no tenía forma de saber que la app
// registra ventas (feedback real de un usuario). Este picker no vende nada:
// solo elige la posición y se la entrega al SellModal de siempre.
//
// Elegibles: cantidad > 0 y que no sea una deuda. Mismo criterio que el botón
// de la tabla (onSellItem && item.quantity > 0), para que las dos entradas
// ofrezcan exactamente el mismo conjunto.
export default function SellPickerModal({ items = [], onPick, onClose, lang = 'es', baseCurrency = 'USD' }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => (lang === 'es' ? es : en)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const sellable = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items || [])
      .filter((it) => it && !it.isDebt && (Number(it.quantity) || 0) > 0)
      .filter((it) => !q || `${it.name || ''} ${it.symbol || ''} ${it.institution || ''}`.toLowerCase().includes(q))
      .map((it) => ({ ...it, _value: getItemValue(it) }))
      .sort((a, b) => b._value - a._value)
  }, [items, query])

  const total = (items || []).filter((it) => it && !it.isDebt && (Number(it.quantity) || 0) > 0).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('¿Qué querés vender?', 'What do you want to sell?')}
          </h2>
          <button type="button" onClick={onClose} className="text-xl leading-none px-1" style={{ color: 'var(--text-muted)' }} aria-label={t('Cerrar', 'Close')}>×</button>
        </div>
        <p className="text-caption mb-4" style={{ color: 'var(--text-muted)' }}>
          {t('Elegí la posición y en el siguiente paso escribís cantidad, precio y a dónde va el dinero.',
             'Pick the position; the next step asks for quantity, price and where the money goes.')}
        </p>

        {total > 6 && (
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Buscar por nombre, símbolo o institución', 'Search by name, symbol or institution')}
            className="w-full px-3 py-2 rounded-lg border text-body mb-3"
            style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--card-border)', color: 'var(--text-primary)' }} />
        )}

        {sellable.length === 0 ? (
          <p className="text-body py-6 text-center" style={{ color: 'var(--text-muted)' }}>
            {total === 0
              ? t('No tenés posiciones con cantidad para vender.', 'You have no positions with a quantity to sell.')
              : t('Ninguna posición coincide con tu búsqueda.', 'No position matches your search.')}
          </p>
        ) : (
          <div className="space-y-1.5">
            {sellable.map((it) => (
              <button key={it.id} type="button" onClick={() => onPick(it)}
                className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border text-left transition-colors hover:bg-theme-elevated"
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)' }}>
                <span className="min-w-0">
                  <span className="block text-body font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {it.name || it.symbol}
                  </span>
                  <span className="block text-micro truncate" style={{ color: 'var(--text-muted)' }}>
                    {[it.symbol, it.institution].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-body font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(it._value, baseCurrency)}
                  </span>
                  <span className="block text-micro font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {Number(it.quantity).toLocaleString(undefined, { maximumFractionDigits: 6 })} {t('unidades', 'units')}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
