'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getItemValue, getTypeCategory, TYPE_COLORS } from './utils'

const GROUP_COLORS = [
  '#3b82f6', '#34d399', '#f59e0b', '#a855f7', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
]

function worstRatio(row, rowArea, side) {
  if (side <= 0 || rowArea <= 0) return Infinity
  const len = rowArea / side
  let worst = 0
  for (const item of row) {
    const s = item.area / len
    const r = Math.max(len / s, s / len)
    if (r > worst) worst = r
  }
  return worst
}

function layoutSquarified(items, rect) {
  if (items.length === 0) return []
  if (items.length === 1) return [{ ...items[0], x: rect.x, y: rect.y, w: rect.w, h: rect.h }]
  if (rect.w <= 0 || rect.h <= 0) return []

  const isWide = rect.w >= rect.h
  const side = isWide ? rect.h : rect.w

  let row = [items[0]]
  let rowArea = items[0].area
  let splitIdx = 1
  let best = worstRatio(row, rowArea, side)

  for (let i = 1; i < items.length; i++) {
    const nextArea = rowArea + items[i].area
    const next = worstRatio([...row, items[i]], nextArea, side)
    if (next <= best) {
      row.push(items[i])
      rowArea = nextArea
      splitIdx = i + 1
      best = next
    } else break
  }

  const len = side > 0 ? rowArea / side : 0
  const results = []
  let pos = 0

  for (const item of row) {
    const s = len > 0 ? item.area / len : 0
    if (isWide) {
      results.push({ ...item, x: rect.x, y: rect.y + pos, w: len, h: s })
    } else {
      results.push({ ...item, x: rect.x + pos, y: rect.y, w: s, h: len })
    }
    pos += s
  }

  const rest = items.slice(splitIdx)
  if (rest.length > 0) {
    const nr = isWide
      ? { x: rect.x + len, y: rect.y, w: rect.w - len, h: rect.h }
      : { x: rect.x, y: rect.y + len, w: rect.w, h: rect.h - len }
    results.push(...layoutSquarified(rest, nr))
  }

  return results
}

function treemap(data, rect) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total <= 0) return []
  const area = rect.w * rect.h
  const normalized = data
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .map(d => ({ ...d, area: (d.value / total) * area }))
  return layoutSquarified(normalized, rect)
}

export default function PortfolioMap({ items, lang }) {
  const [groupBy, setGroupBy] = useState('institution')
  const [selected, setSelected] = useState(null)

  const t = (es, en) => lang === 'es' ? es : en

  const groups = useMemo(() => {
    const byGroup = {}
    let total = 0
    items.forEach(it => {
      if (it.isDebt) return
      const val = getItemValue(it)
      if (val <= 0) return
      let key
      if (groupBy === 'institution') {
        key = it.institution || t('Sin institución', 'No institution')
      } else if (groupBy === 'type') {
        key = getTypeCategory(it.type)
      } else {
        key = it._originalCurrency || it.currency || 'USD'
      }
      if (!byGroup[key]) byGroup[key] = { items: [], value: 0 }
      byGroup[key].items.push(it)
      byGroup[key].value += val
      total += val
    })
    return Object.entries(byGroup)
      .map(([name, data], i) => ({
        name,
        value: data.value,
        pct: total > 0 ? (data.value / total) * 100 : 0,
        items: data.items.sort((a, b) => getItemValue(b) - getItemValue(a)),
        color: groupBy === 'type'
          ? (TYPE_COLORS[name]?.bg || GROUP_COLORS[i % GROUP_COLORS.length])
          : GROUP_COLORS[i % GROUP_COLORS.length],
      }))
      .filter(g => g.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [items, groupBy, lang])

  const totalValue = useMemo(() =>
    items.filter(it => !it.isDebt).reduce((s, it) => s + Math.max(0, getItemValue(it)), 0),
    [items]
  )

  const layout = useMemo(() => treemap(groups, { x: 0, y: 0, w: 100, h: 100 }), [groups])

  const selectedGroup = selected ? groups.find(g => g.name === selected) : null

  if (items.length === 0 || totalValue <= 0) return null

  const views = [
    { key: 'institution', label: t('Institución', 'Institution') },
    { key: 'type', label: t('Tipo', 'Type') },
    { key: 'currency', label: t('Moneda', 'Currency') },
  ]

  return (
    <div className="bg-theme-card rounded-2xl border border-glass-border p-5 card-primary">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          {t('MAPA DEL PORTAFOLIO', 'PORTFOLIO MAP')}
        </h3>
        <span className="text-xs text-slate-500">{formatCurrency(totalValue)}</span>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        {views.map(v => (
          <button key={v.key} onClick={() => { setGroupBy(v.key); setSelected(null) }}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              groupBy !== v.key ? 'border hover:bg-theme-elevated' : ''
            }`}
            style={groupBy === v.key
              ? { backgroundColor: '#475569', color: '#ffffff' }
              : { color: 'var(--text-secondary)', borderColor: 'rgba(71,85,105,0.5)' }
            }>
            {v.label}
          </button>
        ))}
      </div>

      {/* Treemap */}
      <div className="relative w-full rounded-xl overflow-hidden" style={{ paddingBottom: '50%' }}>
        <div className="absolute inset-0">
          {layout.map(rect => {
            const isSel = selected === rect.name
            const wide = rect.w > 14
            const tall = rect.h > 18

            return (
              <div
                key={rect.name}
                className={`absolute transition-all duration-150 cursor-pointer ${isSel ? 'z-10' : ''}`}
                style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`, padding: '1.5px' }}
                onClick={() => setSelected(isSel ? null : rect.name)}
              >
                <div
                  className={`w-full h-full rounded-lg p-2 flex flex-col justify-between overflow-hidden transition-all ${
                    isSel ? 'ring-2 ring-white/40' : 'hover:brightness-125'
                  }`}
                  style={{ backgroundColor: `${rect.color}${isSel ? '35' : '20'}`, border: `1px solid ${rect.color}40` }}
                >
                  <div className="min-w-0">
                    {wide && <p className="text-xs font-semibold text-white truncate leading-tight">{rect.name}</p>}
                    {wide && tall && <p className="text-xs text-slate-400 leading-tight">{rect.pct.toFixed(1)}%</p>}
                  </div>
                  {tall && (
                    <div className="min-w-0">
                      <p className={`font-bold text-white leading-tight ${wide ? 'text-sm' : 'text-xs'}`}>
                        {formatCurrency(rect.value)}
                      </p>
                      {wide && rect.h > 40 && (
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {rect.items.slice(0, 5).map(it => it.symbol || (it.name || '').split(' ')[0]).join(' · ')}
                        </p>
                      )}
                    </div>
                  )}
                  {!wide && !tall && (
                    <p className="text-xs text-white/70 truncate text-center">{rect.name.slice(0, 6)}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3">
        {groups.map(g => (
          <button key={g.name} onClick={() => setSelected(selected === g.name ? null : g.name)}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: selected === g.name ? '#ffffff' : '#64748b' }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
            <span className="truncate max-w-[100px]">{g.name}</span>
            <span style={{ color: '#475569' }}>{g.pct.toFixed(0)}%</span>
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {selectedGroup && (
        <div className="mt-3 p-3 bg-theme-base rounded-xl border border-glass-border/50 animate-in fade-in duration-200">
          <div className="flex items-center justify-between mb-2.5">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedGroup.color }} />
              {selectedGroup.name}
            </h4>
            <div className="text-right">
              <span className="text-xs text-slate-400">{selectedGroup.pct.toFixed(1)}%</span>
              <span className="text-xs text-slate-500 ml-2">{formatCurrency(selectedGroup.value)}</span>
            </div>
          </div>
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {selectedGroup.items.map((item, i) => {
              const val = getItemValue(item)
              const pctOfGroup = selectedGroup.value > 0 ? (val / selectedGroup.value) * 100 : 0
              const cat = getTypeCategory(item.type)
              const clr = TYPE_COLORS[cat]?.bg || '#6366f1'
              const hasRet = item.currentPrice != null && item.purchasePrice > 0
              const retPct = hasRet ? ((item.currentPrice - item.purchasePrice) / item.purchasePrice) * 100 : null

              return (
                <div key={item.id || i} className="flex items-center gap-2.5 py-1.5 border-b border-glass-border/20 last:border-0">
                  <div className="w-1 h-7 rounded-full shrink-0" style={{ backgroundColor: clr }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-white truncate">{item.name || item.symbol}</span>
                      {item.symbol && item.name && (
                        <span className="text-xs text-slate-600 shrink-0">{item.symbol}</span>
                      )}
                    </div>
                    <div className="w-full h-1 bg-slate-700/30 rounded-full overflow-hidden mt-1">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pctOfGroup}%`, backgroundColor: clr }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium text-white">{formatCurrency(val)}</p>
                    {retPct != null && (
                      <p className="text-xs" style={{ color: retPct >= 0 ? '#34d399' : '#f87171' }}>
                        {retPct >= 0 ? '+' : ''}{retPct.toFixed(1)}%
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
