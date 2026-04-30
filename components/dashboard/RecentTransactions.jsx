'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatDate } from './utils'

export default function RecentTransactions({ transactions, lang }) {
  const [showAll, setShowAll] = useState(false)
  const [typeFilter, setTypeFilter] = useState('ALL')
  const all = useMemo(() => {
    const reversed = [...(transactions || [])].reverse()
    if (typeFilter === 'ALL') return reversed
    return reversed.filter((tx) => (tx.type || '').toUpperCase() === typeFilter)
  }, [transactions, typeFilter])
  const display = showAll ? all : all.slice(0, 5)

  const filterOptions = [
    { key: 'ALL', icon: '○', label: lang === 'es' ? 'Todos' : 'All', color: 'blue' },
    { key: 'BUY', icon: '↗', label: lang === 'es' ? 'Compras' : 'Buys', color: 'emerald' },
    { key: 'SELL', icon: '↘', label: lang === 'es' ? 'Ventas' : 'Sells', color: 'red' },
    { key: 'DIVIDEND', icon: '$', label: lang === 'es' ? 'Dividendos' : 'Dividends', color: 'emerald' },
    { key: 'DEPOSIT', icon: '+', label: lang === 'es' ? 'Depósitos' : 'Deposits', color: 'blue' },
    { key: 'WITHDRAWAL', icon: '−', label: lang === 'es' ? 'Retiros' : 'Withdrawals', color: 'amber' },
  ]

  const typeBadge = (type) => {
    const t = (type || '').toUpperCase()
    if (t === 'BUY') return 'bg-emerald-500/20 text-emerald-400'
    if (t === 'SELL') return 'bg-red-500/20 text-red-400'
    if (t === 'DIVIDEND') return 'bg-emerald-500/15 text-emerald-300'
    if (t === 'DEPOSIT') return 'bg-blue-500/20 text-blue-400'
    if (t === 'WITHDRAWAL') return 'bg-amber-500/20 text-amber-400'
    return 'bg-slate-500/20 text-slate-400'
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
    <div className="bg-[#1e293b] rounded-xl border border-[#334155] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-white">
          {lang === 'es' ? 'Transacciones' : 'Transactions'}
        </h3>
      </div>

      {/* Visual filter tabs */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mb-4">
        {filterOptions.map((opt) => {
          const count = txCount(opt.key)
          const isActive = typeFilter === opt.key
          const activeColors = {
            blue: 'bg-blue-500/15 border-blue-500/30 text-blue-400',
            emerald: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
            red: 'bg-red-500/15 border-red-500/30 text-red-400',
            amber: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          }
          return (
            <button key={opt.key} onClick={() => { setTypeFilter(opt.key); setShowAll(false) }}
              className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-all text-center border ${
                isActive
                  ? activeColors[opt.color]
                  : 'bg-[#0f172a]/50 border-transparent text-slate-500 hover:text-slate-300 hover:bg-[#283548]'
              }`}>
              <span className="text-sm font-bold">{opt.icon}</span>
              <span className="text-[9px] font-medium">{opt.label}</span>
              {count > 0 && <span className="text-[8px] opacity-60">{count}</span>}
            </button>
          )
        })}
      </div>

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
              <div key={tx.id || i} className="flex items-center justify-between py-3 border-b border-[#334155]/30 last:border-0 hover:bg-[#283548]/30 transition-colors -mx-2 px-2 rounded">
                <div className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${typeBadge(tx.type)}`}>
                    {typeIcon(tx.type)}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{tx.symbol || tx.description || '-'}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${typeBadge(tx.type)}`}>
                        {tx.type || 'TX'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500">{formatDate(tx.date)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-medium ${
                    (tx.type || '').toUpperCase() === 'SELL' || (tx.type || '').toUpperCase() === 'WITHDRAWAL'
                      ? 'text-red-400' : 'text-emerald-400'
                  }`}>
                    {formatCurrency(tx.totalAmount ?? 0)}
                  </span>
                  {tx.quantity > 0 && (
                    <div className="text-[10px] text-slate-500">
                      {tx.quantity} x {formatCurrency(tx.pricePerUnit || 0)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {all.length > 5 && (
            <button onClick={() => setShowAll(!showAll)}
              className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-emerald-400 border border-[#334155]/50 rounded-lg hover:bg-[#283548] transition-colors">
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
