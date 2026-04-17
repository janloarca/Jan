'use client'

import { formatCurrency, formatDate } from './utils'

export default function RecentTransactions({ transactions, lang }) {
  const recent = [...(transactions || [])].reverse().slice(0, 5)

  const typeBadge = (type) => {
    const t = (type || '').toUpperCase()
    if (t === 'BUY') return 'bg-emerald-500/20 text-emerald-400'
    if (t === 'SELL') return 'bg-red-500/20 text-red-400'
    if (t === 'DIVIDEND') return 'bg-emerald-500/20 text-emerald-300'
    if (t === 'DEPOSIT') return 'bg-blue-500/20 text-blue-400'
    return 'bg-slate-500/20 text-slate-400'
  }

  return (
    <div className="bg-[#131c2e] rounded-xl border border-[#1e2d45] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-white">Recent Transactions</h3>
        {transactions.length > 5 && (
          <button className="text-xs text-emerald-400 hover:text-emerald-300">
            View all ({transactions.length})
          </button>
        )}
      </div>
      {recent.length === 0 ? (
        <div className="text-center text-slate-500 py-8 text-sm">
          {lang === 'es' ? 'Sin transacciones registradas.' : 'No transactions recorded.'}
        </div>
      ) : (
        <div className="space-y-0">
          {recent.map((tx, i) => (
            <div key={tx.id || i} className="flex items-center justify-between py-3 border-b border-[#1e2d45]/50 last:border-0">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${typeBadge(tx.type)}`}>
                  {tx.type || 'TX'}
                </span>
                <span className="text-sm text-white">{tx.symbol || tx.description || '-'}</span>
              </div>
              <div className="text-right">
                <span className="text-sm text-white font-medium">
                  USD {(tx.totalAmount ?? tx.amount ?? tx.pricePerUnit ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
                <span className="text-[10px] text-slate-500 ml-3">{formatDate(tx.date)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
