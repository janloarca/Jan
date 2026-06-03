'use client'

import { useState } from 'react'
import { CATEGORY_COLORS } from '@/lib/financeCategories'

export default function FinanceTransactionList({ transactions, onDelete, lang = 'es' }) {
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const t = (es, en) => lang === 'es' ? es : en

  const filtered = transactions
    .filter(tx => filter === 'ALL' || tx.type === filter)
    .filter(tx => {
      if (!search) return true
      const q = search.toLowerCase()
      return (tx.description || '').toLowerCase().includes(q) ||
        (tx.category || '').toLowerCase().includes(q)
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const fmt = (v) => v.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-white">{t('Transacciones', 'Transactions')}</h3>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex bg-[#000000] rounded-lg border border-[#38383A] text-xs">
            {[
              { key: 'ALL', label: t('Todos', 'All') },
              { key: 'INCOME', label: t('Ingresos', 'Income') },
              { key: 'EXPENSE', label: t('Gastos', 'Expenses') },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 transition-colors ${filter === f.key ? 'bg-blue-600 text-white rounded-lg' : 'text-slate-400 hover:text-white'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Buscar...', 'Search...')}
            className="px-3 py-1.5 bg-[#000000] border border-[#38383A] rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 w-full sm:w-36"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-6">{t('Sin transacciones', 'No transactions')}</p>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-[#38383A] sticky top-0 bg-[#1C1C1E]">
                <th className="text-left py-2 px-2">{t('Fecha', 'Date')}</th>
                <th className="text-left py-2 px-2">{t('Descripción', 'Description')}</th>
                <th className="text-left py-2 px-2">{t('Categoría', 'Category')}</th>
                <th className="text-right py-2 px-2">{t('Monto', 'Amount')}</th>
                <th className="text-center py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx, i) => (
                <tr key={tx.id || i} className="border-b border-[#38383A]/50 hover:bg-[#2C2C2E]">
                  <td className="py-2 px-2 text-slate-400 whitespace-nowrap">{tx.date}</td>
                  <td className="py-2 px-2 text-white max-w-[200px] truncate">{tx.description || '-'}</td>
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[tx.category] || '#64748b' }} />
                      <span className="text-slate-300">{tx.category}</span>
                    </span>
                  </td>
                  <td className={`py-2 px-2 text-right font-medium font-mono tabular-nums whitespace-nowrap ${tx.type === 'INCOME' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {tx.type === 'INCOME' ? '+' : '-'}Q{fmt(tx.amount)}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {onDelete && (
                      <button onClick={() => onDelete(tx.id)} className="text-slate-600 hover:text-red-400 transition-colors">
                        &times;
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
