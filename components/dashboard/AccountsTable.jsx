'use client'

import { useState, useMemo, useEffect } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, getItemValue, getItemPrice, getBaseCurrency, getMaturityInfo, formatHoldingPeriod, getEffectiveYield } from './utils'

export default function AccountsTable({ items, lang, onDeleteItem, onEditItem, onViewItem, onSellItem, onQuickBuy }) {
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('value')
  const [showAll, setShowAll] = useState(false)
  const [breakdown, setBreakdown] = useState(null)
  const [dismissWarning, setDismissWarning] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  useEffect(() => { setShowAll(false); setSelected(new Set()); setConfirmBulkDelete(false) }, [filter, search])

  const counts = useMemo(() => {
    const c = { all: items.length, stocks: 0, crypto: 0, bonds: 0, funds: 0, banks: 0, realestate: 0, alternatives: 0, debts: 0 }
    items.forEach((it) => {
      const cat = getTypeCategory(it.type)
      if (c[cat] !== undefined) c[cat]++
    })
    return c
  }, [items])

  const missingDate = useMemo(() => items.filter((it) => !it.acquisitionDate && !it.createdAt).length, [items])

  const filtered = useMemo(() => {
    let list = filter === 'all' ? items : items.filter((it) => getTypeCategory(it.type) === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((it) =>
        (it.name || '').toLowerCase().includes(q) ||
        (it.symbol || '').toLowerCase().includes(q) ||
        (it.institution || '').toLowerCase().includes(q) ||
        (it.type || '').toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      const va = getItemValue(a)
      const vb = getItemValue(b)
      let cmp
      if (sortBy === 'name') {
        cmp = (a.name || a.symbol || '').localeCompare(b.name || b.symbol || '')
      } else {
        cmp = sortBy === 'value' ? vb - va : va - vb
      }
      return cmp !== 0 ? cmp : (a.id || '').localeCompare(b.id || '')
    })
  }, [items, filter, sortBy, search])

  const totalValue = useMemo(() => items.reduce((s, it) => s + getItemValue(it), 0), [items])
  const displayItems = showAll ? filtered : filtered.slice(0, 10)

  const breakdownData = useMemo(() => {
    if (!breakdown) return null
    const groups = {}
    let total = 0
    items.forEach((it) => {
      const key = breakdown === 'type' ? (it.type || 'Other') : (it.institution || (lang === 'es' ? 'Sin institución' : 'No institution'))
      const val = getItemValue(it)
      if (!groups[key]) groups[key] = { count: 0, value: 0 }
      groups[key].count++
      groups[key].value += val
      total += val
    })
    return Object.entries(groups)
      .map(([name, d]) => ({ name, ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
  }, [items, breakdown, lang])

  const tabs = [
    { key: 'all', icon: '🔵', label: lang === 'es' ? `Todos (${counts.all})` : `All (${counts.all})` },
    { key: 'stocks', icon: '📈', label: `Stocks (${counts.stocks})` },
    { key: 'crypto', icon: '₿', label: `Crypto (${counts.crypto})` },
    { key: 'bonds', icon: '🏛', label: lang === 'es' ? `Instrumentos (${counts.bonds})` : `Instruments (${counts.bonds})` },
    { key: 'funds', icon: '💼', label: `Funds (${counts.funds})` },
    ...(counts.banks > 0 ? [{ key: 'banks', icon: '🏦', label: lang === 'es' ? `Bancos (${counts.banks})` : `Banks (${counts.banks})` }] : []),
    ...(counts.realestate > 0 ? [{ key: 'realestate', icon: '🏠', label: lang === 'es' ? `Inmuebles (${counts.realestate})` : `Real Estate (${counts.realestate})` }] : []),
    ...(counts.alternatives > 0 ? [{ key: 'alternatives', icon: '🔮', label: lang === 'es' ? `Alternativos (${counts.alternatives})` : `Alternatives (${counts.alternatives})` }] : []),
    ...(counts.debts > 0 ? [{ key: 'debts', icon: '💳', label: lang === 'es' ? `Deudas (${counts.debts})` : `Debts (${counts.debts})` }] : []),
  ]

  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="bg-theme-card rounded-2xl border border-glass-border p-5 card-primary">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-white">
          {t('Cuentas e Instrumentos', 'Accounts & Instruments')}
        </h3>
        <span className="text-xs text-slate-500">Total: {formatCurrency(totalValue)}</span>
      </div>

      {/* Warning banner */}
      {missingDate > 0 && !dismissWarning && (
        <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(245,158,11,0.2)' }}>
          <span className="text-xs" style={{ color: '#fbbf24' }}>
            ⚠ {missingDate} {t('activo(s) sin fecha de adquisición', 'asset(s) missing acquisition date')}
          </span>
          <button onClick={() => setDismissWarning(true)} className="text-sm ml-2 hover:opacity-80" style={{ color: 'rgba(245,158,11,0.6)' }}>×</button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-3">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={`px-3 py-2.5 sm:py-1.5 text-xs font-medium rounded-full transition-colors border ${
              filter === tab.key
                ? ''
                : 'hover:bg-theme-elevated'
            }`}
            style={filter === tab.key
              ? { backgroundColor: 'rgba(108,122,255,0.2)', color: 'var(--accent-blue)', borderColor: 'rgba(108,122,255,0.3)' }
              : { color: 'var(--text-secondary)', borderColor: 'rgba(71,85,105,0.5)' }
            }>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {items.length > 5 && (
        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Buscar por nombre, símbolo o institución...', 'Search by name, symbol, or institution...')}
            className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
          />
        </div>
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(108,122,255,0.1)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(108,122,255,0.2)' }}>
          <span className="text-xs font-medium" style={{ color: 'var(--accent-blue)' }}>{selected.size} {t('seleccionado(s)', 'selected')}</span>
          <div className="flex-1" />
          <button onClick={() => {
            const selectedItems = items.filter((it) => selected.has(it.id))
            const rows = [[t('Símbolo','Symbol'), t('Nombre','Name'), t('Tipo','Type'), t('Cant.','Qty'), t('Precio','Price'), t('Valor','Value')].join(',')]
            selectedItems.forEach((it) => {
              const val = getItemValue(it)
              const price = getItemPrice(it)
              rows.push([it.symbol || '', it.name || '', it.type || '', it.quantity || 0, isFinite(price) ? price.toFixed(2) : '0.00', isFinite(val) ? val.toFixed(2) : '0.00'].join(','))
            })
            const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `selected-${new Date().toISOString().split('T')[0]}.csv`
            a.click()
          }}
            className="text-xs px-2 py-1 rounded border hover:opacity-80"
            style={{ color: 'var(--accent-blue)', borderColor: 'rgba(108,122,255,0.3)' }}>
            {t('Exportar CSV', 'Export CSV')}
          </button>
          <button onClick={async () => {
            if (!confirmBulkDelete) { setConfirmBulkDelete(true); return }
            for (const id of selected) { await onDeleteItem(id) }
            setSelected(new Set())
            setConfirmBulkDelete(false)
          }}
            className="text-xs px-2 py-1 rounded border transition-colors"
            style={confirmBulkDelete
              ? { backgroundColor: '#dc2626', color: '#ffffff', borderColor: '#dc2626' }
              : { color: 'var(--text-negative)', borderColor: 'rgba(239,68,68,0.3)' }
            }>
            {confirmBulkDelete ? t('Confirmar', 'Confirm') : t('Eliminar', 'Delete')}
          </button>
          <button onClick={() => { setSelected(new Set()); setConfirmBulkDelete(false) }}
            className="text-xs text-slate-500 hover:text-slate-300 px-1">×</button>
        </div>
      )}

      {/* Breakdown toggles */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-slate-500">{t('Desglose:', 'Breakdown:')}</span>
        {[
          { key: 'type', label: t('Por tipo', 'By type') },
          { key: 'institution', label: t('Por institución', 'By institution') },
        ].map((opt) => (
          <button key={opt.key} onClick={() => setBreakdown(breakdown === opt.key ? null : opt.key)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              breakdown === opt.key
                ? ''
                : 'border hover:bg-theme-elevated'
            }`}
            style={breakdown === opt.key
              ? { backgroundColor: '#475569', color: '#ffffff' }
              : { color: 'var(--text-secondary)', borderColor: 'rgba(71,85,105,0.5)' }
            }>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Breakdown summary */}
      {breakdownData && (
        <div className="mb-4 p-3 bg-theme-base rounded-lg border border-glass-border/50">
          <div className="space-y-1.5">
            {breakdownData.map((row) => (
              <div key={row.name} className="flex items-center gap-3">
                <span className="text-xs text-white font-medium w-32 truncate">{row.name}</span>
                <div className="flex-1 h-1.5 bg-slate-700/30 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${row.pct}%`, backgroundColor: 'rgba(52,211,153,0.6)' }} />
                </div>
                <span className="text-xs text-slate-400 w-8">{row.pct.toFixed(0)}%</span>
                <span className="text-xs text-slate-300 w-14 text-right">{formatCurrency(row.value)}</span>
                <span className="text-xs text-slate-500 w-4 text-right">{row.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-8 text-sm">
          {t('Sin posiciones en esta categoría.', 'No holdings in this category.')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-glass-border">
                <th className="w-8 py-2">
                  <input type="checkbox"
                    checked={displayItems.length > 0 && displayItems.every((it) => selected.has(it.id))}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set([...selected, ...displayItems.map((it) => it.id)]))
                      else setSelected(new Set([...selected].filter((id) => !displayItems.some((it) => it.id === id))))
                    }}
                    className="w-3.5 h-3.5 accent-blue-500 cursor-pointer" />
                </th>
                <th className="text-left py-2 font-medium cursor-pointer hover:text-slate-300" onClick={() => setSortBy('name')}>
                  {t('Instrumento', 'Instrument')} {sortBy === 'name' ? '↕' : ''}
                </th>
                <th className="text-center py-2 font-medium">% Port.</th>
                <th className="text-right py-2 font-medium hidden sm:table-cell">{t('Precio', 'Price')}</th>
                <th className="text-right py-2 font-medium hidden sm:table-cell">{t('Costo', 'Avg Cost')}</th>
                <th className="text-center py-2 font-medium hidden sm:table-cell">P&L</th>
                <th className="text-right py-2 font-medium cursor-pointer hover:text-slate-300"
                  onClick={() => setSortBy(sortBy === 'value' ? 'value-asc' : 'value')}>
                  {t('Valor $', 'Value $')} {sortBy === 'value' ? '▼' : sortBy === 'value-asc' ? '▲' : ''}
                </th>
                <th className="text-center py-2 font-medium hidden sm:table-cell">{t('Compra', 'Bought')}</th>
                <th className="text-center py-2 font-medium hidden sm:table-cell">{t('Duración', 'Duration')}</th>
                <th className="text-center py-2 font-medium hidden sm:table-cell">{t('Yield', 'Yield')}</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item) => {
                const cat = getTypeCategory(item.type)
                const colors = TYPE_COLORS[cat] || TYPE_COLORS.other
                const value = getItemValue(item)
                const pctPort = totalValue > 0 ? (value / totalValue) * 100 : 0
                const abbr = (item.symbol || '??').slice(0, 4).toUpperCase()

                // Balance-style accounts (banks: quantity=1, price=the balance) have
                // no meaningful unit price, 7d move or price-based P&L — the "price"
                // IS the balance and currentPrice always equals purchasePrice.
                const isBalanceStyle = cat === 'banks'
                const hasReturn = !isBalanceStyle && item.currentPrice != null && item.purchasePrice > 0
                const retPct = hasReturn ? ((item.currentPrice - item.purchasePrice) / item.purchasePrice) * 100 : null
                const retAbs = hasReturn ? (item.currentPrice - item.purchasePrice) * (item.quantity || 0) : null

                return (
                  <tr key={item.id || item.symbol} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 60px', ...(selected.has(item.id) ? { backgroundColor: 'rgba(108,122,255,0.05)' } : {}) }} className="border-b border-glass-border/30 hover:bg-theme-elevated/50 transition-colors group">
                    <td className="py-4 w-8">
                      <input type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(item.id)
                          else { next.delete(item.id); setConfirmBulkDelete(false) }
                          setSelected(next)
                        }}
                        className="w-3.5 h-3.5 accent-blue-500 cursor-pointer" />
                    </td>
                    <td className="py-4">
                      <div className="flex items-center gap-0">
                        {/* Left color bar */}
                        <div className="w-1 h-12 rounded-full mr-3 shrink-0" style={{ backgroundColor: colors.bg }} />
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ backgroundColor: colors.bg + '22', color: colors.bg }}>
                          {abbr}
                        </div>
                        <div className="min-w-0 ml-3">
                          <div className="text-white font-medium text-sm truncate flex items-center gap-2">
                            {item.name || item.symbol}
                            {!isBalanceStyle && item.change7d != null && (
                              <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                                style={item.change7d >= 0
                                  ? { backgroundColor: 'rgba(52,211,153,0.15)', color: 'var(--accent-green)' }
                                  : { backgroundColor: 'rgba(239,68,68,0.15)', color: 'var(--text-negative)' }
                                }>
                                {item.change7d >= 0 ? '▲' : '▼'}{Math.abs(item.change7d).toFixed(1)}% 7d
                              </span>
                            )}
                          </div>
                          <div className="text-slate-500 text-xs">
                            {/* "1 @ $12,000" read as a unit price for bank accounts —
                                the number is the balance, so label it as such. */}
                            {isBalanceStyle
                              ? <>{item.institution ? `${item.institution} · ` : ''}{lang === 'es' ? 'Saldo' : 'Balance'} {formatCurrency(getItemPrice(item), item.currency)}</>
                              : <>{item.institution ? `${item.institution} · ` : ''}{item.quantity?.toLocaleString(undefined, { maximumFractionDigits: item.type === 'Crypto' ? 8 : 4 })} @ {formatCurrency(getItemPrice(item), item.currency)}</>}
                            {item.currency && item.currency !== getBaseCurrency() && (
                              <span className="ml-1 text-xs px-1 py-0.5 rounded bg-slate-700 text-slate-400">{item.currency}</span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {item.isIlliquid && (
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}>
                                {lang === 'es' ? 'Ilíquido' : 'Illiquid'}
                              </span>
                            )}
                            {item.custodyType && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                                {item.custodyType === 'self_custody' ? '🔐 Self' : item.custodyType === 'defi_protocol' ? '🌐 DeFi' : '🏦 Custody'}
                              </span>
                            )}
                            {(() => {
                              const mat = getMaturityInfo(item)
                              if (!mat) return null
                              const matStyle = mat.color === 'red'
                                ? { backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--text-negative)' }
                                : mat.color === 'amber'
                                  ? { backgroundColor: 'rgba(245,158,11,0.1)', color: '#fbbf24' }
                                  : { backgroundColor: 'rgba(52,211,153,0.1)', color: 'var(--accent-green)' }
                              return <span className="text-xs px-1.5 py-0.5 rounded" style={matStyle}>{mat.expired ? '⚠' : '⏱'} {mat.label}</span>
                            })()}
                            {item.rateType === 'variable' && item.rateMin > 0 && (
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(108,122,255,0.1)', color: 'var(--accent-blue)' }}>
                                {item.rateMin}-{item.rateMax}%
                              </span>
                            )}
                            {item.dividendAction === 'reinvest' ? (
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(108,122,255,0.1)', color: 'rgba(139,150,255,0.8)' }} title={t('Los pagos se reinvierten en este activo', 'Payments reinvest into this asset')}>
                                🔄 {t('Reinvierte', 'Reinvests')}
                              </span>
                            ) : item.incomeDestination ? (
                              <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(52,211,153,0.1)', color: 'rgba(74,222,128,0.7)' }} title={t('Destino de ingresos', 'Income destination')}>
                                → {(() => { const dest = items.find(it => it.id === item.incomeDestination); return dest ? (dest.name || dest.symbol || '').slice(0, 15) : '?' })()}
                              </span>
                            ) : null}
                            {item.subtype && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/30 text-slate-500">
                                {item.subtype}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-center py-3">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-14 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(pctPort, 100)}%`, backgroundColor: colors.bg }} />
                        </div>
                        <span className="text-slate-400 text-xs w-8 font-mono tabular-nums">{pctPort.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="text-right py-3 hidden sm:table-cell">
                      {getItemPrice(item) > 0 ? (
                        <div>
                          <span className="text-white text-sm font-medium font-mono tabular-nums">{formatCurrency(getItemPrice(item), item.currency)}</span>
                          {item.change7d != null && (
                            <div className="text-xs font-mono tabular-nums" style={{ color: item.change7d >= 0 ? '#34d399' : '#f87171' }}>
                              {item.change7d >= 0 ? '+' : ''}{item.change7d.toFixed(1)}%
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="text-right py-3 hidden sm:table-cell">
                      {item.purchasePrice > 0 ? (
                        <span className="text-slate-400 text-xs font-mono tabular-nums">{formatCurrency(item.purchasePrice)}</span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="text-center py-3 hidden sm:table-cell">
                      {retPct != null ? (
                        <div>
                          <span className="text-xs font-medium font-mono tabular-nums" style={{ color: retPct >= 0 ? '#34d399' : '#f87171' }}>
                            {retPct >= 0 ? '+' : ''}{formatCurrency(retAbs)}
                          </span>
                          <div className="text-xs font-mono tabular-nums" style={{ color: retPct >= 0 ? 'rgba(52,211,153,0.7)' : 'rgba(239,68,68,0.7)' }}>
                            {retPct >= 0 ? '+' : ''}{retPct.toFixed(1)}%
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="text-right py-3">
                      <span className="font-medium font-mono tabular-nums cursor-pointer hover:underline"
                        style={{ color: value < 0 ? '#f87171' : '#34d399' }}
                        onClick={() => onViewItem && onViewItem(item)}>
                        {formatCurrency(Math.abs(value))}{value < 0 && <span className="ml-1 text-xs px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--text-negative)' }}>{t('Deuda','Debt')}</span>}
                      </span>
                    </td>
                    <td className="text-center py-3 hidden sm:table-cell">
                      {item.acquisitionDate ? (
                        <span className="text-slate-400 text-xs">{new Date(item.acquisitionDate).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', year: '2-digit' })}</span>
                      ) : (
                        <span className="text-slate-700">-</span>
                      )}
                    </td>
                    <td className="text-center py-3 hidden sm:table-cell">
                      <span className="text-slate-400 text-xs">{formatHoldingPeriod(item.acquisitionDate, lang)}</span>
                    </td>
                    <td className="text-center py-3 hidden sm:table-cell">
                      {(() => {
                        const y = getEffectiveYield(item)
                        return y != null ? (
                          <span className="text-xs" style={{ color: 'var(--accent-blue)' }}>{y.toFixed(1)}%</span>
                        ) : (
                          <span className="text-slate-700">-</span>
                        )
                      })()}
                    </td>
                    <td className="text-right py-3 w-24">
                      <div className="flex items-center justify-end gap-0">
                        {onQuickBuy && (
                          <button onClick={() => onQuickBuy(item)}
                            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-sm font-bold transition-colors hover:opacity-80"
                            style={{ color: 'rgba(108,122,255,0.6)' }}
                            title={t('Comprar más', 'Buy more')} aria-label={t('Comprar más', 'Buy more')}>
                            +
                          </button>
                        )}
                        {onViewItem && (
                          <button onClick={() => onViewItem(item)}
                            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-600 hover:text-cyan-400 text-xs transition-colors" title={t('Ver detalle', 'View detail')} aria-label={t('Ver detalle', 'View detail')}>
                            📊
                          </button>
                        )}
                        {onSellItem && item.quantity > 0 && (
                          <button onClick={() => onSellItem(item)}
                            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-600 hover:text-amber-400 text-xs transition-colors" title={t('Vender', 'Sell')} aria-label={t('Vender', 'Sell')}>
                            💰
                          </button>
                        )}
                        {onEditItem && (
                          <button onClick={() => onEditItem(item)}
                            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-600 hover:text-emerald-400 text-xs transition-colors" title={t('Editar', 'Edit')} aria-label={t('Editar', 'Edit')}>
                            ✏️
                          </button>
                        )}
                        {onDeleteItem && (
                          <button onClick={() => onDeleteItem(item.id)}
                            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-slate-600 hover:text-red-400 text-sm transition-colors" title={t('Eliminar', 'Delete')} aria-label={t('Eliminar', 'Delete')}>
                            ×
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length > 10 && (
            <button onClick={() => setShowAll(!showAll)}
              className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-emerald-400 border border-glass-border/50 rounded-lg hover:bg-theme-elevated transition-colors">
              {showAll
                ? t('Mostrar menos', 'Show less')
                : t(`Ver todos (${filtered.length})`, `View all (${filtered.length})`)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
