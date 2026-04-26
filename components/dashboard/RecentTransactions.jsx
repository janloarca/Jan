'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatDate } from './utils'

export default function RecentTransactions({ transactions, lang }) {
  const [showAll, setShowAll] = useState(false)
  const all = useMemo(() => [...(transactions || [])].reverse(), [transactions])
  const display = showAll ? all : all.slice(0, 5)

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

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-white">
          {lang === 'es' ? 'Transacciones Recientes' : 'Recent Transactions'}
        </h3>
        <span className="text-xs text-slate-500">{transactions?.length || 0} total</span>
      </div>
      {display.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-3xl mb-2 opacity-30">📋</div>
          <p className="text-slate-500 text-sm">
            {lang === 'es' ? 'Sin transacciones registradas.' : 'No transactions recorded.'}
          </p>
          <p className="text-slate-600 text-xs mt-1">
            {lang === 'es' ? 'Registra compras, ventas y dividendos.' : 'Record buys, sells, and dividends.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-0">
            {display.map((tx, i) => (
              <div key={tx.id || i} className="flex items-center justify-between py-3 border-b border-[#1e2d45]/30 last:border-0 hover:bg-[#1a2540]/30 transition-colors -mx-2 px-2 rounded">
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
                      {tx.quantity} × {formatCurrency(tx.pricePerUnit || 0)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {all.length > 5 && (
            <button onClick={() => setShowAll(!showAll)}
              className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-emerald-400 border border-[#1e2d45]/50 rounded-lg hover:bg-[#1a2540] transition-colors">
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
