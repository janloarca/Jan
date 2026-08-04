'use client'

import { useState } from 'react'
import { CATEGORY_COLORS, FINANCE_CATEGORIES } from '@/lib/financeCategories'

export default function FinanceTransactionList({ transactions, onDelete, onRecategorize, lang = 'es' }) {
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  // Row whose category select is open. Editing inline (rather than in a modal)
  // matters here: correcting an auto-captured category is the gesture that
  // teaches the classifier, so it has to be one click away.
  const [editing, setEditing] = useState(null)
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
    <div className="bg-theme-card border border-glass-border rounded-xl p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-white">{t('Transacciones', 'Transactions')}</h3>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex bg-theme-base rounded-lg border border-glass-border text-xs">
            {[
              { key: 'ALL', label: t('Todos', 'All') },
              { key: 'INCOME', label: t('Ingresos', 'Income') },
              { key: 'EXPENSE', label: t('Gastos', 'Expenses') },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className="px-3 py-1.5 transition-colors rounded-lg"
                style={filter === f.key ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff' } : { color: 'var(--text-secondary)' }}>
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Buscar...', 'Search...')}
            className="px-3 py-1.5 bg-theme-base border border-glass-border rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 w-full sm:w-36"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-6">{t('Sin transacciones', 'No transactions')}</p>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-glass-border sticky top-0 bg-theme-card">
                <th className="text-left py-2 px-2">{t('Fecha', 'Date')}</th>
                <th className="text-left py-2 px-2">{t('Descripción', 'Description')}</th>
                <th className="text-left py-2 px-2">{t('Categoría', 'Category')}</th>
                <th className="text-right py-2 px-2">{t('Monto', 'Amount')}</th>
                <th className="text-center py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx, i) => (
                <tr key={tx.id || i} className="border-b border-glass-border/50 hover:bg-theme-elevated">
                  <td className="py-2 px-2 text-slate-400 whitespace-nowrap">{tx.date}</td>
                  <td className="py-2 px-2 text-white max-w-[200px] truncate">
                    {String(tx._source || '').startsWith('auto_') && (
                      <span title={t('Capturado automáticamente', 'Captured automatically')} className="mr-1">⚡</span>
                    )}
                    {tx.description || '-'}
                    {tx.location && <span className="text-slate-600"> · {tx.location}</span>}
                  </td>
                  <td className="py-2 px-2">
                    {onRecategorize && editing === (tx.id || i) ? (
                      <select
                        autoFocus
                        defaultValue={tx.category}
                        onBlur={() => setEditing(null)}
                        onChange={(e) => { onRecategorize(tx, e.target.value); setEditing(null) }}
                        className="px-1.5 py-1 bg-theme-base border border-glass-border rounded-md text-xs text-white focus:outline-none">
                        {(tx.type === 'INCOME' ? FINANCE_CATEGORIES.INCOME : FINANCE_CATEGORIES.EXPENSE).map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => onRecategorize && setEditing(tx.id || i)}
                        disabled={!onRecategorize}
                        title={onRecategorize ? t('Cambiar categoría', 'Change category') : undefined}
                        className="inline-flex items-center gap-1 rounded-md px-1 -mx-1 transition-colors disabled:cursor-default hover:bg-theme-elevated">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[tx.category] || '#64748b' }} />
                        <span className="text-slate-300">{tx.category}</span>
                        {tx._needsReview && (
                          <span title={t('Revisa la categoría', 'Check the category')} style={{ color: '#f59e0b' }}>?</span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right font-medium font-mono tabular-nums whitespace-nowrap"
                    style={{ color: tx.type === 'INCOME' ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                    {tx.type === 'INCOME' ? '+' : '-'}Q{fmt(tx.amount)}
                  </td>
                  <td className="py-2 px-2 text-center">
                    {onDelete && (
                      <button onClick={() => { if (confirm(lang === 'es' ? '¿Eliminar esta transacción?' : 'Delete this transaction?')) onDelete(tx.id) }} className="text-slate-600 hover:text-red-400 transition-colors">
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
