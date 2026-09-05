'use client'

import { useState, useMemo, Fragment, useCallback } from 'react'
import { getItemValue, getTypeCategory, formatDate, currencySymbol } from './utils'
import { parseAmount } from '@/lib/numberParse'

const PATRIMONIO_CATEGORIES = ['realestate', 'alternatives', 'other']

const CATEGORY_LABELS = {
  realestate: { es: 'Bienes Raíces', en: 'Real Estate' },
  vehicles: { es: 'Vehículos', en: 'Vehicles' },
  alternatives: { es: 'Alternativos & Coleccionables', en: 'Alternatives & Collectibles' },
  other: { es: 'Otros Bienes', en: 'Other Assets' },
}

const CATEGORY_ICONS = {
  realestate: '🏠',
  vehicles: '🚗',
  alternatives: '🎨',
  other: '📦',
}

function fmt(val) {
  return Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function isPatrimonioItem(item) {
  const cat = getTypeCategory(item)
  if (cat === 'realestate') return true
  if (cat === 'alternatives') {
    const sub = item.subtype || ''
    if (/collectible|art|jewelry|vehicle|auto|car|watch|wine/i.test(sub)) return true
    if (/collectible|art|jewelry|vehicle|auto|car|watch|wine|físico|fisico|tangible/i.test(item.type)) return true
    if (/collectible|coleccionable|arte|joya|reloj|vino|auto|carro|vehículo|vehiculo/i.test(item.name)) return true
  }
  if (/vehicle|auto|car|carro|vehículo|vehiculo/i.test(item.type || '')) return true
  if (/vehicle|auto|car|carro|vehículo|vehiculo/i.test(item.subtype || '')) return true
  if (item.isIlliquid) return true
  const name = (item.name || '').toLowerCase()
  if (/propiedad|property|apartamento|apartment|casa|house|terreno|land|local|oficina|office|bodega|warehouse/i.test(name)) return true
  if (/auto |carro |coche |truck|camioneta|moto|motorcycle/i.test(name)) return true
  if (/rolex|watch|reloj|joya|jewelry|art |arte |cuadro|painting|vino|wine|collectible|coleccion/i.test(name)) return true
  return false
}

function categorizePatrimonio(item) {
  const cat = getTypeCategory(item)
  if (cat === 'realestate') return 'realestate'
  const combined = `${item.type} ${item.subtype} ${item.name}`.toLowerCase()
  if (/vehicle|auto|car|carro|vehículo|vehiculo|truck|camioneta|moto|motorcycle|coche/i.test(combined)) return 'vehicles'
  if (/collectible|coleccion|art|arte|watch|reloj|joya|jewelry|wine|vino|painting|cuadro/i.test(combined)) return 'alternatives'
  return 'other'
}

export default function PatrimonioSpreadsheet({ items, lang, onEditItem, onUpdateItem, onAdd, convert, baseCurrency }) {
  const t = (es, en) => lang === 'es' ? es : en
  // Estas cifras vienen en moneda BASE (los items llegan enriquecidos), y la
  // pestaña las rotulaba con un "$" fijo: con base GTQ, toda la pantalla
  // presentaba quetzales como dolares. Se conservan los cero decimales, que son
  // deliberados para montos de esta escala.
  const money = (val) => `${currencySymbol(baseCurrency)}${fmt(val)}`
  const [expanded, setExpanded] = useState({})
  const [editingValue, setEditingValue] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  // Un valor rechazado tiene que DECIRSE (ver commitEditValue): se limpia al
  // abrir la siguiente edición o al guardar una buena.
  const [rejectMsg, setRejectMsg] = useState('')

  const patrimonioItems = useMemo(() => {
    if (!items) return []
    return items.filter(it => !it.isDebt && !it.isReceivable && isPatrimonioItem(it))
  }, [items])

  const grouped = useMemo(() => {
    const groups = {}
    for (const item of patrimonioItems) {
      const cat = categorizePatrimonio(item)
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    }
    const order = ['realestate', 'vehicles', 'alternatives', 'other']
    return order.filter(k => groups[k]?.length > 0).map(k => ({
      key: k,
      label: CATEGORY_LABELS[k]?.[lang] || k,
      icon: CATEGORY_ICONS[k] || '📦',
      items: groups[k],
      total: groups[k].reduce((s, it) => s + Math.abs(getItemValue(it)), 0),
    }))
  }, [patrimonioItems, lang])

  const grandTotal = useMemo(() => patrimonioItems.reduce((s, it) => s + Math.abs(getItemValue(it)), 0), [patrimonioItems])

  const toggleCategory = (key) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const startEditValue = (item) => {
    setEditingValue(item.id)
    setRejectMsg('')
    const val = Math.abs(getItemValue(item))
    setEditDraft(val > 0 ? String(val) : '')
  }

  const commitEditValue = useCallback((item) => {
    // parseAmount y NO el regex ingenuo: `parseFloat('12.500,00'.replace(...))`
    // daba 12.5 — mil veces menos, con cara de guardado (la clase de bug que la
    // cabecera de lib/numberParse.js documenta, y que ya se sacó de la otra
    // Hoja en FASE JA).
    // El guard de vacío/garbage es aparte porque parseAmount devuelve 0 tanto
    // para '' como para texto ilegible: sin él, cerrar una celda sin tocar (o
    // con basura) escribiría un cero encima del valor. Un CERO tecleado a
    // propósito ("0") sí se acepta, igual que siempre.
    const raw = editDraft.trim()
    const num = parseAmount(raw)
    const isExplicitZero = /^0([.,]0*)?$/.test(raw)
    // Same ceiling as file imports (lib/validation MAX_PRICE).
    if (raw !== '' && isFinite(num) && (num > 0 || isExplicitZero) && num <= 10_000_000 && onUpdateItem) {
      // ⛔ La celda MUESTRA en moneda base (`getItemValue` sobre un item ya
      // enriquecido: su `currentPrice` viene convertido, el crudo vive en
      // `_originalPrice`) y `currentPrice` se GUARDA crudo, así que escribir el
      // número tal cual lo re-convierte en la siguiente carga. Con base USD y
      // una propiedad en quetzales, abrir la celda y dar Enter sin tocar nada
      // dejaba Q1,000,000 guardado como Q130,000: la edición no era necesaria,
      // bastaba con abrirla. Es el bug XOCHI (FASE EK) en la pestaña que aquella
      // pasada no tocó.
      const cur = item._originalCurrency || item.currency || 'USD'
      const base = baseCurrency || 'USD'
      let price = num
      if (convert && cur !== base) {
        const out = convert(num, base, cur)
        // Sin tasa, `convert` devuelve el monto CRUDO: ahí se rehúsa en vez de
        // guardar un número en la moneda equivocada.
        if (!Number.isFinite(out) || out === num) {
          setRejectMsg(t(
            `No hay tipo de cambio ${base}→${cur} en este momento. Intentá de nuevo en unos segundos.`,
            `No ${base}→${cur} exchange rate right now. Try again in a few seconds.`
          ))
          setEditingValue(null)
          return
        }
        price = out
      }
      // La cantidad solo se normaliza cuando la guardada NO SIRVE: forzar 1
      // sobre un bien con cantidad legítima le cambia el Costo (cantidad x
      // precio de compra) sin que nadie haya editado esa columna.
      // FASE OA. La celda MUESTRA cantidad x precio (getItemValue), asi que lo
      // que se teclea es el TOTAL y el precio que se guarda es POR UNIDAD:
      // sobre un bien con cantidad 5, escribir el total en `currentPrice`
      // multiplicaba el valor por 5 en la siguiente lectura (5,000 tecleados
      // se leian 25,000). Con cantidad 1 (el caso comun) no cambia nada.
      const qty = Number(item.quantity)
      const usableQty = Number.isFinite(qty) && qty > 0 ? qty : 1
      const patch = { currentPrice: price / usableQty }
      if (!Number.isFinite(qty) || qty <= 0) patch.quantity = 1
      onUpdateItem(item.id, patch)
      setRejectMsg('')
    } else if (raw !== '') {
      // Un valor rechazado se descartaba EN SILENCIO: la celda se cerraba y el
      // número viejo seguía ahí, indistinguible de un guardado (la lección de
      // handleValueReject en PortfolioSpreadsheet).
      const label = item.name || item.symbol
      setRejectMsg(lang === 'es'
        ? `${label}: ese valor no se pudo leer. Usá solo números positivos, hasta 10,000,000.`
        : `${label}: could not read that value. Use positive numbers only, up to 10,000,000.`)
    }
    setEditingValue(null)
  }, [editDraft, onUpdateItem, lang, convert, baseCurrency])

  // FASE ME: igual que DebtSpreadsheet, esta vista era `bg-white` + grises de tema
  // claro fijos con clases remapeadas encima: en tema oscuro (el default) las
  // etiquetas de las tarjetas de resumen median 1.12:1 (números grandes sin decir
  // de qué son). Migrada a `.card` y tokens. El verde de los VALORES se quitó a
  // propósito: una valuación no es una ganancia (el verde queda solo en la
  // columna Ganancia, que sí lo es).
  if (patrimonioItems.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-400 text-sm">{t('No tienes bienes patrimoniales registrados.', 'No estate assets recorded.')}</p>
        <p className="text-slate-300 text-xs mt-2">
          {t('Agrega propiedades, vehículos, coleccionables u otros bienes desde el dashboard.',
             'Add properties, vehicles, collectibles or other assets from the dashboard.')}
        </p>
      </div>
    )
  }

  const quickAddTemplates = [
    { label: t('Propiedad', 'Property'), icon: '🏠', defaults: { type: 'RealEstate', subtype: 'property' } },
    { label: t('Vehículo', 'Vehicle'), icon: '🚗', defaults: { type: 'Alternative', subtype: 'vehicle' } },
    { label: t('Coleccionable', 'Collectible'), icon: '🎨', defaults: { type: 'Alternative', subtype: 'collectible' } },
    { label: t('Otro bien', 'Other asset'), icon: '📦', defaults: { type: 'Other' } },
  ]

  return (
    <div className="space-y-4">
      {onAdd && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">{t('Agregar:', 'Add:')}</span>
          {quickAddTemplates.map(tmpl => (
            <button key={tmpl.label} onClick={() => onAdd(tmpl.defaults)}
              className="px-3 py-1.5 text-xs font-medium bg-theme-card border border-glass-border rounded-lg hover:bg-theme-elevated transition-colors flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              {tmpl.icon} {tmpl.label}
            </button>
          ))}
        </div>
      )}
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Patrimonio Total', 'Total Estate')}</p>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{money(grandTotal)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Bienes', 'Assets')}</p>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{patrimonioItems.length}</p>
        </div>
        {grouped.map(g => (
          <div key={g.key} className="card p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">{g.icon} {g.label}</p>
            <p className="text-lg font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{money(g.total)}</p>
          </div>
        ))}
      </div>

      {/* Info box */}
      <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)' }}>
        <p className="text-xs text-blue-600">
          {t('Los valores se pueden actualizar haciendo clic en el monto. Para bienes raíces y vehículos, te recomendamos actualizar el valor de mercado periódicamente.',
             'Values can be updated by clicking the amount. For real estate and vehicles, we recommend updating the market value periodically.')}
        </p>
      </div>

      {rejectMsg && (
        <div role="alert" className="rounded-xl p-3 text-xs flex items-center justify-between gap-2"
          style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)', color: 'var(--alert-warn-icon)' }}>
          <span>{rejectMsg}</span>
          <button onClick={() => setRejectMsg('')} className="shrink-0 font-semibold" aria-label={t('Cerrar aviso', 'Dismiss')}>&times;</button>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-theme-tertiary border-b border-glass-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Bien', 'Asset')}</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Categoría', 'Category')}</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Ubicación/Detalle', 'Location/Detail')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Costo', 'Cost')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Valor Actual', 'Current Value')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('Ganancia', 'Gain')}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('% Total', '% Total')}</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(group => (
                <Fragment key={group.key}>
                  <tr className="cursor-pointer hover:bg-theme-tertiary transition-colors" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-tertiary) 70%, transparent)' }} onClick={() => toggleCategory(group.key)}>
                    <td className="px-4 py-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }} colSpan={4}>
                      <span className="mr-1.5">{expanded[group.key] === false ? '▸' : '▾'}</span>
                      {group.icon} {group.label}
                      <span className="ml-2 text-xs font-normal text-slate-400">({group.items.length})</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{money(group.total)}</td>
                    <td></td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                      {grandTotal > 0 ? ((group.total / grandTotal) * 100).toFixed(1) + '%' : '-'}
                    </td>
                  </tr>
                  {expanded[group.key] !== false && group.items.map((item, i) => {
                    const value = Math.abs(getItemValue(item))
                    const cost = (item.quantity || 1) * (item.purchasePrice || 0)
                    const gain = cost > 0 ? value - cost : 0
                    const gainPct = cost > 0 ? (gain / cost) * 100 : 0
                    const pct = grandTotal > 0 ? (value / grandTotal) * 100 : 0
                    const location = item.institution || item.custodyDetails || item.notes || ''
                    const isEditing = editingValue === item.id

                    return (
                      <tr key={item.id || i} className="border-b border-glass-border hover:bg-theme-tertiary transition-colors">
                        <td className="px-4 py-2.5 pl-8">
                          {onEditItem ? (
                            <button onClick={() => onEditItem(item)} className="text-sm font-medium text-left transition-colors hover:underline" style={{ color: 'var(--text-primary)' }}>
                              {item.name || item.symbol}
                            </button>
                          ) : (
                            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.name || item.symbol}</span>
                          )}
                          {item.acquisitionDate && (
                            <p className="text-xs text-slate-400 mt-0.5">{t('Adquirido', 'Acquired')}: {formatDate(item.acquisitionDate)}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-slate-500">{item.subtype || item.type}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-slate-500 max-w-[200px] truncate block">{location || '-'}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono text-sm text-slate-500">{cost > 0 ? money(cost) : '-'}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {isEditing ? (
                            <div className="flex justify-end">
                              <input
                                autoFocus
                                type="text"
                                value={editDraft}
                                onChange={e => setEditDraft(e.target.value)}
                                onBlur={() => commitEditValue(item)}
                                onKeyDown={e => { if (e.key === 'Enter') commitEditValue(item); if (e.key === 'Escape') setEditingValue(null) }}
                                className="w-28 border-2 border-blue-400 rounded px-2 py-1 text-sm text-right font-mono focus:outline-none"
                                style={{ backgroundColor: 'var(--input-bg, #2C2C2E)', color: 'var(--text-primary)' }}
                              />
                            </div>
                          ) : (
                            <span className="font-mono text-sm font-medium cursor-pointer hover:underline" style={{ color: 'var(--text-primary)' }}
                              onClick={() => startEditValue(item)}>
                              {money(value)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {cost > 0 ? (
                            <span className="font-mono text-sm" style={{ color: gain >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                              {gain >= 0 ? '+' : ''}{gainPct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-10 h-1.5 bg-theme-tertiary rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ backgroundColor: 'var(--accent-blue)', width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className="font-mono text-xs text-slate-400">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-theme-tertiary border-t-2 border-glass-border">
                <td className="px-4 py-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }} colSpan={4}>
                  {t('Total Patrimonio', 'Total Estate')}
                </td>
                <td className="px-3 py-3 text-right font-mono text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{money(grandTotal)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
