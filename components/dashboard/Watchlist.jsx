'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { formatCurrency } from './utils'
import { authFetch, safeJson } from '@/lib/authFetch'

export default function Watchlist({ lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [items, setItems] = useState([])
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [priceError, setPriceError] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('chispudo-watchlist')
      if (saved) setItems(JSON.parse(saved))
    } catch {}
  }, [])

  const save = useCallback((list) => {
    setItems(list)
    localStorage.setItem('chispudo-watchlist', JSON.stringify(list))
  }, [])

  const handleSearch = useCallback((q) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const res = await authFetch(`/api/prices/search?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data = await safeJson(res) || {}
          setResults((data.results || []).slice(0, 6))
        } else {
          setSearchError(t('Error buscando', 'Search failed'))
        }
      } catch {
        setSearchError(t('Error de red', 'Network error'))
      }
      setSearching(false)
    }, 400)
  }, [])

  const addSymbol = (result) => {
    if (items.some((it) => it.symbol === result.symbol)) return
    save([...items, { symbol: result.symbol, name: result.name, addedAt: new Date().toISOString() }])
    setAdding(false)
    setQuery('')
    setResults([])
  }

  const removeSymbol = (symbol) => {
    save(items.filter((it) => it.symbol !== symbol))
  }

  const [prices, setPrices] = useState({})
  useEffect(() => {
    if (items.length === 0) return
    const symbols = items.map((it) => ({ symbol: it.symbol, type: '' }))
    setPriceError(false)
    authFetch('/api/prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: symbols }),
    }).then((r) => r.ok ? safeJson(r) : null)
      .then((data) => { if (data?.prices) setPrices(data.prices); else setPriceError(true) })
      .catch(() => { setPriceError(true) })
  }, [items])

  if (items.length === 0 && !adding) {
    return (
      <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            {t('WATCHLIST', 'WATCHLIST')}
          </h3>
          <button onClick={() => setAdding(true)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            + {t('Agregar', 'Add')}
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-2">{t('Monitorea activos que te interesan', 'Track assets you\'re interested in')}</p>
      </div>
    )
  }

  return (
    <div className="bg-theme-card/80 rounded-xl border border-glass-border/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-slate-500" />
          {t('WATCHLIST', 'WATCHLIST')}
        </h3>
        <button onClick={() => setAdding(!adding)}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
          {adding ? t('Cancelar', 'Cancel') : `+ ${t('Agregar', 'Add')}`}
        </button>
      </div>

      {adding && (
        <div className="mb-3">
          <input type="text" value={query} onChange={(e) => handleSearch(e.target.value)}
            placeholder={t('Buscar símbolo...', 'Search symbol...')}
            autoFocus
            className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
          {searching && <p className="text-xs text-slate-600 mt-1 animate-pulse">{t('Buscando...', 'Searching...')}</p>}
          {searchError && <p className="text-xs text-red-400 mt-1">{searchError}</p>}
          {results.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {results.map((r) => (
                <button key={r.symbol} onClick={() => addSymbol(r)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs bg-theme-base hover:bg-[#1a2744] rounded-lg transition-colors text-left">
                  <span className="text-white font-medium">{r.symbol}</span>
                  <span className="text-slate-500 truncate ml-2">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {priceError && <p className="text-xs text-red-400/70 mb-1">{t('No se pudieron cargar los precios', 'Could not load prices')}</p>}
      <div className="space-y-1.5">
        {items.map((it) => {
          const pd = prices[it.symbol] || prices[it.symbol?.toUpperCase()]
          return (
            <div key={it.symbol} className="flex items-center justify-between py-1.5 group">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-white font-medium">{it.symbol}</span>
                <span className="text-xs text-slate-500 truncate">{it.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {pd && (
                  <>
                    <span className="text-xs text-white font-medium">{formatCurrency(pd.price)}</span>
                    {pd.change7d != null && isFinite(pd.change7d) && (
                      <span className="text-xs font-medium" style={{ color: pd.change7d >= 0 ? '#34d399' : '#f87171' }}>
                        {pd.change7d >= 0 ? '+' : ''}{pd.change7d.toFixed(1)}%
                      </span>
                    )}
                  </>
                )}
                <button onClick={() => removeSymbol(it.symbol)}
                  className="text-xs text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">×</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
