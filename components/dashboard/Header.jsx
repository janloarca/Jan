'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

export default function Header({ user, lang, setLang, onImport, onSignOut, onRefresh, onSettings, pricesLoading, pendingCount, onOptimize, existingItems, onQuickAdd }) {
  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  const t = (es, en) => lang === 'es' ? es : en
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [qaAsset, setQaAsset] = useState('')
  const [qaQty, setQaQty] = useState('')
  const [qaPrice, setQaPrice] = useState('')
  const [qaSaving, setQaSaving] = useState(false)
  const qaRef = useRef(null)

  useEffect(() => {
    if (!showQuickAdd) return
    function handleClickOutside(e) {
      if (qaRef.current && !qaRef.current.contains(e.target)) setShowQuickAdd(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showQuickAdd])

  const selectedItem = existingItems?.find((it) => it.id === qaAsset)

  useEffect(() => {
    if (selectedItem) {
      setQaPrice((selectedItem.currentPrice || selectedItem.purchasePrice || '').toString())
    }
  }, [qaAsset, selectedItem])

  const handleQuickSubmit = useCallback(async () => {
    if (!selectedItem || !qaQty) return
    setQaSaving(true)
    try {
      await onQuickAdd(selectedItem, parseFloat(qaQty), parseFloat(qaPrice) || 0)
      setShowQuickAdd(false)
      setQaAsset('')
      setQaQty('')
      setQaPrice('')
    } catch {}
    setQaSaving(false)
  }, [selectedItem, qaQty, qaPrice, onQuickAdd])

  return (
    <header className="border-b border-[#334155] sticky top-0 z-20 bg-[#0f172a]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-xl">⚡</span>
            <div>
              <h1 className="text-base font-bold text-blue-400 leading-tight">Chispudo</h1>
              <p className="text-[9px] text-slate-500 hidden sm:block leading-none">
                {lang === 'es' ? 'Control financiero' : 'Financial control'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-[10px] text-slate-500 hidden lg:block">{today}</span>

            {/* Quick-add button */}
            {onQuickAdd && existingItems?.length > 0 && (
              <button onClick={() => setShowQuickAdd(!showQuickAdd)}
                className={`px-2 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  showQuickAdd ? 'bg-blue-500 text-white' : 'text-blue-400 border border-blue-400/30 hover:bg-blue-400/10'
                }`}
                title={t('Transacción rápida', 'Quick transaction')}>
                +
              </button>
            )}

            {/* Pending badge */}
            {pendingCount > 0 && onOptimize && (
              <button onClick={onOptimize}
                className="relative px-2 py-1.5 text-xs text-amber-400 border border-amber-400/30 rounded-lg hover:bg-amber-400/10 transition-colors"
                title={t('Datos pendientes', 'Pending data')}>
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 text-[9px] font-bold text-white rounded-full flex items-center justify-center">
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
                {t('Revisar', 'Review')}
              </button>
            )}

            <button onClick={onRefresh} disabled={pricesLoading}
              className="px-2 py-1.5 text-xs text-blue-400 border border-blue-400/30 rounded-lg hover:bg-blue-400/10 transition-colors disabled:opacity-50">
              <span className={pricesLoading ? 'animate-spin inline-block' : ''}>↻</span>
            </button>
            <button onClick={setLang}
              className="px-2 py-1.5 text-xs text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#283548] transition-colors font-medium">
              {lang === 'en' ? 'ES' : 'EN'}
            </button>
            <button onClick={onImport}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors">
              {lang === 'es' ? 'Importar' : 'Import'}
            </button>
            <button onClick={onSettings}
              className="px-2 py-1.5 text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#283548] hover:text-white transition-colors"
              title={lang === 'es' ? 'Configuracion' : 'Settings'}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button onClick={onSignOut}
              className="px-2 py-1.5 text-xs text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#283548] transition-colors">
              {lang === 'es' ? 'Salir' : 'Log out'}
            </button>
          </div>
        </div>
      </div>

      {/* Quick-add dropdown */}
      {showQuickAdd && existingItems?.length > 0 && (
        <div ref={qaRef} className="border-t border-[#334155] bg-[#1e293b]/95 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5">
            <div className="flex items-center gap-2">
              <select value={qaAsset} onChange={(e) => setQaAsset(e.target.value)}
                className="flex-1 max-w-[200px] px-2.5 py-1.5 bg-[#0f172a] border border-[#334155] rounded-lg text-xs text-white focus:outline-none focus:border-blue-500/50">
                <option value="">{t('-- Activo --', '-- Asset --')}</option>
                {existingItems.map((it) => (
                  <option key={it.id} value={it.id}>{it.symbol} - {it.name || it.symbol}</option>
                ))}
              </select>
              <input value={qaQty} onChange={(e) => setQaQty(e.target.value)}
                placeholder={t('Cant.', 'Qty')} type="number" step="any"
                className="w-20 px-2.5 py-1.5 bg-[#0f172a] border border-[#334155] rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              <span className="text-slate-600 text-xs">@</span>
              <input value={qaPrice} onChange={(e) => setQaPrice(e.target.value)}
                placeholder={t('Precio', 'Price')} type="number" step="any"
                className="w-24 px-2.5 py-1.5 bg-[#0f172a] border border-[#334155] rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              <button onClick={handleQuickSubmit} disabled={!qaAsset || !qaQty || qaSaving}
                className="px-4 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-500 disabled:opacity-40 transition-colors">
                {qaSaving ? '...' : t('Comprar', 'Buy')}
              </button>
              <button onClick={() => setShowQuickAdd(false)}
                className="px-2 py-1.5 text-slate-500 hover:text-white text-xs transition-colors">
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
