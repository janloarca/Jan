'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatDate } from './utils'

export default function RecentTransactions({ transactions, lang, onExportCSV }) {
  const [showAll, setShowAll] = useState(false)
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [dateRange, setDateRange] = useState('all')

  const all = useMemo(() => {
    let reversed = [...(transactions || [])].reverse()

    if (dateRange !== 'all') {
      const now = new Date()
      const cutoff = new Date()
      if (dateRange === '7d') cutoff.setDate(now.getDate() - 7)
      else if (dateRange === '30d') cutoff.setDate(now.getDate() - 30)
      else if (dateRange === '90d') cutoff.setDate(now.getDate() - 90)
      else if (dateRange === 'ytd') cutoff.setMonth(0, 1)
      reversed = reversed.filter((tx) => tx.date && new Date(tx.date) >= cutoff)
    }

    if (typeFilter === 'ALL') return reversed
    return reversed.filter((tx) => (tx.type || '').toUpperCase() === typeFilter)
  }, [transactions, typeFilter, dateRange])

  const monthlySummary = useMemo(() => {
    if (!transactions || transactions.length === 0) return null
    const months = {}
    transactions.forEach((tx) => {
      if (!tx.date) return
      const key = tx.date.slice(0, 7)
      if (!months[key]) months[key] = { inflow: 0, outflow: 0, count: 0 }
      months[key].count++
      const t = (tx.type || '').toUpperCase()
      const amt = tx.totalAmount || 0
      if (t === 'BUY' || t === 'DEPOSIT') months[key].inflow += amt
      else if (t === 'SELL' || t === 'WITHDRAWAL') months[key].outflow += amt
      else if (t === 'DIVIDEND') months[key].inflow += amt
    })
    const sorted = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3)
    return sorted.map(([month, data]) => ({ month, ...data, net: data.inflow - data.outflow }))
  }, [transactions])

  const display = showAll ? all : all.slice(0, 5)

  const filterOptions = [
    { key: 'ALL', icon: '○', label: lang === 'es' ? 'Todos' : 'All', color: 'blue' },
    { key: 'BUY', icon: '↗', label: lang === 'es' ? 'Compras' : 'Buys', color: 'blue' },
    { key: 'SELL', icon: '↘', label: lang === 'es' ? 'Ventas' : 'Sells', color: 'slate' },
    { key: 'DIVIDEND', icon: '$', label: lang === 'es' ? 'Dividendos' : 'Dividends', color: 'emerald' },
    { key: 'DEPOSIT', icon: '+', label: lang === 'es' ? 'Depósitos' : 'Deposits', color: 'slate' },
    { key: 'WITHDRAWAL', icon: '−', label: lang === 'es' ? 'Retiros' : 'Withdrawals', color: 'slate' },
  ]

  const typeBadgeStyle = (type) => {
    const t = (type || '').toUpperCase()
    const success = { backgroundColor: 'var(--alert-success-bg)', color: 'var(--alert-success-icon)' }
    const error = { backgroundColor: 'var(--alert-error-bg)', color: 'var(--alert-error-icon)' }
    const warn = { backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }
    const neutral = { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }
    if (t === 'BUY') return success
    if (t === 'SELL') return error
    if (t === 'DIVIDEND') return warn
    if (t === 'DEPOSIT') return success
    if (t === 'WITHDRAWAL') return error
    return neutral
  }

  const typeIcon = (type) => {
    const t = (type || '').toUpperCase()
    if (t === 'BUY') return '↗'
    if (t === 'SELL') return '↘'
    if (t === 'DIVIDEND') return '$'
    if (t === 'DEPOSIT') return '+'
    if (t === 'WITHDRAWAL') return '−'
    return '·'
  }

  const txCount = (key) => {
    if (key === 'ALL') return transactions?.length || 0
    return (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === key).length
  }

  return (
    <div className="bg-theme-card rounded-2xl border border-glass-border p-5 card-primary">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-white">
          {lang === 'es' ? 'Transacciones' : 'Transactions'}
        </h3>
        {onExportCSV && transactions && transactions.length > 0 && (
          <button onClick={onExportCSV} className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition-colors" aria-label="Export CSV">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            CSV
          </button>
        )}
      </div>

      {/* Visual filter tabs — outline when inactive, soft indigo wash when active */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mb-4">
        {filterOptions.map((opt) => {
          const count = txCount(opt.key)
          const isActive = typeFilter === opt.key
          const activeStyle = {
            backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)',
            borderColor: 'color-mix(in srgb, var(--accent-blue) 35%, transparent)',
            color: 'var(--accent-blue)',
          }
          const inactiveStyle = { backgroundColor: 'transparent', borderColor: 'var(--card-border)', color: 'var(--text-muted)' }
          return (
            <button key={opt.key} onClick={() => { setTypeFilter(opt.key); setShowAll(false) }}
              className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-[10px] transition-all text-center border hover:bg-theme-elevated"
              style={isActive ? activeStyle : inactiveStyle}>
              <span className="text-base">{opt.icon}</span>
              <span className="text-xs font-medium">{opt.label}</span>
              {count > 0 && <span className="text-sm font-bold" style={{ color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)' }}>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-1.5 mb-4">
        <span className="text-xs text-slate-600 mr-1">{lang === 'es' ? 'Periodo:' : 'Period:'}</span>
        {[
          { key: 'all', label: lang === 'es' ? 'Todo' : 'All' },
          { key: '7d', label: '7d' },
          { key: '30d', label: '30d' },
          { key: '90d', label: '90d' },
          { key: 'ytd', label: 'YTD' },
        ].map((opt) => (
          <button key={opt.key} onClick={() => { setDateRange(opt.key); setShowAll(false) }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors"
            style={dateRange === opt.key
              ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 35%, transparent)', color: 'var(--accent-blue)' }
              : { backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--text-muted)' }}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Monthly summary */}
      {monthlySummary && monthlySummary.length > 0 && dateRange === 'all' && typeFilter === 'ALL' && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          {monthlySummary.map((m) => (
            <div key={m.month} className="bg-theme-base rounded-lg p-2.5 border border-glass-border/50 text-center">
              <div className="text-xs text-slate-500 mb-1">{m.month}</div>
              <div className="text-xs font-semibold font-mono tabular-nums" style={{ color: m.net >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                {m.net >= 0 ? '+' : ''}{formatCurrency(m.net)}
              </div>
              <div className="text-xs text-slate-600">{m.count} txs</div>
            </div>
          ))}
        </div>
      )}

      {display.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-slate-500 text-sm">
            {typeFilter !== 'ALL'
              ? (lang === 'es' ? 'Sin transacciones de este tipo.' : 'No transactions of this type.')
              : (lang === 'es' ? 'Sin transacciones registradas.' : 'No transactions recorded.')}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-0">
            {display.map((tx, i) => (
              <div key={tx.id || i} className="flex items-center justify-between py-3 border-b border-glass-border/30 last:border-0 hover:bg-theme-elevated/30 transition-colors -mx-2 px-2 rounded">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={typeBadgeStyle(tx.type)}>
                    {typeIcon(tx.type)}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{tx.symbol || tx.description || '-'}</span>
                      <span className="px-1.5 py-0.5 rounded text-xs font-bold uppercase" style={typeBadgeStyle(tx.type)}>
                        {tx.type || 'TX'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">{formatDate(tx.date)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium font-mono tabular-nums" style={{ color:
                    (tx.type || '').toUpperCase() === 'SELL' || (tx.type || '').toUpperCase() === 'WITHDRAWAL'
                      ? 'var(--text-negative)' : 'var(--accent-green)'
                  }}>
                    {formatCurrency(tx.totalAmount ?? 0)}
                  </span>
                  {tx.quantity > 0 && (
                    <div className="text-xs text-slate-500 font-mono tabular-nums">
                      {tx.quantity} x {formatCurrency(tx.pricePerUnit || 0)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {all.length > 5 && (
            <button onClick={() => setShowAll(!showAll)}
              className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-emerald-400 border border-glass-border/50 rounded-lg hover:bg-theme-elevated transition-colors">
              {showAll
                ? (lang === 'es' ? 'Mostrar menos' : 'Show less')
                : (lang === 'es' ? `Ver todas (${all.length})` : `View all (${all.length})`)}
            </button>
          )}
        </>
      )}
    </div>
  )
}
