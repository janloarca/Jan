'use client'

import { useState, useMemo, Fragment, useCallback } from 'react'
import { getItemValue, getTypeCategory } from './utils'

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

export default function PatrimonioSpreadsheet({ items, lang, onEditItem, onUpdateItem, onAdd }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [expanded, setExpanded] = useState({})
  const [editingValue, setEditingValue] = useState(null)
  const [editDraft, setEditDraft] = useState('')

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
    const val = Math.abs(getItemValue(item))
    setEditDraft(val > 0 ? String(val) : '')
  }

  const commitEditValue = useCallback((item) => {
    const num = parseFloat(editDraft.replace(/[^0-9.\-]/g, ''))
    // Same ceiling as file imports (lib/validation MAX_PRICE).
    if (!isNaN(num) && num >= 0 && num <= 10_000_000 && onUpdateItem) {
      onUpdateItem(item.id, { currentPrice: num, quantity: 1 })
    }
    setEditingValue(null)
  }, [editDraft, onUpdateItem])

  if (patrimonioItems.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
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
              className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-colors flex items-center gap-1.5">
              {tmpl.icon} {tmpl.label}
            </button>
          ))}
        </div>
      )}
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Patrimonio Total', 'Total Estate')}</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">${fmt(grandTotal)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">{t('Bienes', 'Assets')}</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{patrimonioItems.length}</p>
        </div>
        {grouped.map(g => (
          <div key={g.key} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">{g.icon} {g.label}</p>
            <p className="text-lg font-bold text-slate-800 mt-1">${fmt(g.total)}</p>
          </div>
        ))}
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
        <p className="text-xs text-blue-600">
          {t('Los valores se pueden actualizar haciendo clic en el monto. Para bienes raíces y vehículos, te recomendamos actualizar el valor de mercado periódicamente.',
             'Values can be updated by clicking the amount. For real estate and vehicles, we recommend updating the market value periodically.')}
        </p>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
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
                  <tr className="bg-slate-50/70 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => toggleCategory(group.key)}>
                    <td className="px-4 py-2 text-sm font-semibold text-slate-700" colSpan={4}>
                      <span className="mr-1.5">{expanded[group.key] === false ? '▸' : '▾'}</span>
                      {group.icon} {group.label}
                      <span className="ml-2 text-xs font-normal text-slate-400">({group.items.length})</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-bold text-slate-700">${fmt(group.total)}</td>
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
                      <tr key={item.id || i} className="border-b border-slate-50 hover:bg-blue-50/30 transition-colors">
                        <td className="px-4 py-2.5 pl-8">
                          {onEditItem ? (
                            <button onClick={() => onEditItem(item)} className="text-sm font-medium text-slate-800 hover:text-blue-600 text-left transition-colors">
                              {item.name || item.symbol}
                            </button>
                          ) : (
                            <span className="text-sm font-medium text-slate-800">{item.name || item.symbol}</span>
                          )}
                          {item.acquisitionDate && (
                            <p className="text-xs text-slate-400 mt-0.5">{t('Adquirido', 'Acquired')}: {item.acquisitionDate}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-slate-500">{item.subtype || item.type}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs text-slate-500 max-w-[200px] truncate block">{location || '-'}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono text-sm text-slate-500">{cost > 0 ? `$${fmt(cost)}` : '-'}</span>
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
                                className="w-28 bg-white border-2 border-blue-400 rounded px-2 py-1 text-sm text-slate-900 text-right font-mono focus:outline-none"
                              />
                            </div>
                          ) : (
                            <span className="font-mono text-sm text-emerald-600 font-medium cursor-pointer hover:underline"
                              onClick={() => startEditValue(item)}>
                              ${fmt(value)}
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
                            <div className="w-10 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
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
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td className="px-4 py-3 text-sm font-bold text-slate-700" colSpan={4}>
                  {t('Total Patrimonio', 'Total Estate')}
                </td>
                <td className="px-3 py-3 text-right font-mono text-sm font-bold text-emerald-600">${fmt(grandTotal)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
