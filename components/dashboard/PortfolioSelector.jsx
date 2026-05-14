'use client'

import { useState } from 'react'

export default function PortfolioSelector({ portfolios, activePortfolio, onSelect, onAdd, onDelete, lang }) {
  const [showMenu, setShowMenu] = useState(false)
  const [newName, setNewName] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const t = (es, en) => lang === 'es' ? es : en
  const allLabel = t('Todos', 'All')
  const current = activePortfolio === '__all__'
    ? allLabel
    : (portfolios || []).find((p) => p.id === activePortfolio)?.name || allLabel

  const handleAdd = () => {
    if (!newName.trim()) return
    onAdd({ name: newName.trim(), icon: '💼' })
    setNewName('')
    setShowAdd(false)
  }

  return (
    <div className="relative">
      <button onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-300 hover:text-white bg-[#0f172a]/50 border border-[#334155]/50 rounded-lg transition-colors">
        <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        {current}
        <svg className="w-3 h-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setShowMenu(false); setShowAdd(false) }} />
          <div className="absolute top-full left-0 mt-1 w-56 bg-[#1e293b] border border-[#334155] rounded-xl shadow-xl z-50 overflow-hidden">
            <button onClick={() => { onSelect('__all__'); setShowMenu(false) }}
              className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                activePortfolio === '__all__' ? 'bg-blue-500/10 text-blue-400' : 'text-slate-300 hover:bg-[#283548]'
              }`}>
              <span>📊</span> {allLabel}
            </button>

            {(portfolios || []).map((p) => (
              <div key={p.id} className="flex items-center group">
                <button onClick={() => { onSelect(p.id); setShowMenu(false) }}
                  className={`flex-1 flex items-center gap-2 px-4 py-2.5 text-sm text-left transition-colors ${
                    activePortfolio === p.id ? 'bg-blue-500/10 text-blue-400' : 'text-slate-300 hover:bg-[#283548]'
                  }`}>
                  <span>{p.icon || '💼'}</span> {p.name}
                </button>
                {!p.isDefault && onDelete && (
                  <button onClick={() => onDelete(p.id)}
                    className="px-2 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}

            <div className="border-t border-[#334155]">
              {showAdd ? (
                <div className="p-2 flex gap-1.5">
                  <input value={newName} onChange={(e) => setNewName(e.target.value)}
                    placeholder={t('Nombre...', 'Name...')} autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    className="flex-1 px-2 py-1.5 text-xs bg-[#0f172a] border border-[#334155] rounded text-white placeholder-slate-600" />
                  <button onClick={handleAdd} className="px-2 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-500">
                    {t('Ok', 'Ok')}
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowAdd(true)}
                  className="w-full px-4 py-2.5 text-sm text-slate-500 hover:text-emerald-400 hover:bg-[#283548] text-left transition-colors">
                  + {t('Nuevo portfolio', 'New portfolio')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
