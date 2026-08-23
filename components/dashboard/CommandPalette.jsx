'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { formatCurrency, getTypeCategory, TYPE_ICONS } from './utils'
import Icon from '@/components/ui/Icon'

const ACTIONS = [
  { id: 'add', icon: 'Plus', labelEs: 'Agregar posición', labelEn: 'Add position', shortcut: 'N' },
  { id: 'import', icon: 'Upload', labelEs: 'Importar archivo', labelEn: 'Import file', shortcut: 'I' },
  { id: 'export', icon: 'Download', labelEs: 'Exportar Excel', labelEn: 'Export Excel', shortcut: 'E' },
  { id: 'report', icon: 'FileText', labelEs: 'Generar reporte PDF', labelEn: 'Generate PDF report' },
  { id: 'transfer', icon: 'ArrowLeftRight', labelEs: 'Transferir entre cuentas', labelEn: 'Transfer between accounts' },
  { id: 'settings', icon: 'Settings', labelEs: 'Configuración', labelEn: 'Settings', shortcut: ',' },
  { id: 'ibkr', icon: 'RefreshCw', labelEs: 'Sincronizar IBKR', labelEn: 'Sync IBKR' },
  { id: 'refresh', icon: 'RefreshCw', labelEs: 'Actualizar precios', labelEn: 'Refresh prices', shortcut: 'R' },
  { id: 'theme', icon: 'Sun', labelEs: 'Cambiar tema', labelEn: 'Toggle theme' },
  { id: 'lang', icon: 'Globe', labelEs: 'Switch to English', labelEn: 'Cambiar a Español' },
  // La puerta permanente al tour. Antes se auto-abría una sola vez en la vida
  // y después quedaba inalcanzable para siempre; acá lo encuentra cualquiera
  // que lo busque, sin agregar un control visible más a la pantalla.
  { id: 'tour', icon: 'Zap', labelEs: '¿Cómo funciona?', labelEn: 'How does it work?' },
]

export default function CommandPalette({ open, onClose, items, lang, onAction }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    const out = []

    if (q.length > 0) {
      const matchedItems = (items || []).filter((it) => {
        const name = (it.name || '').toLowerCase()
        const sym = (it.symbol || '').toLowerCase()
        const inst = (it.institution || '').toLowerCase()
        return name.includes(q) || sym.includes(q) || inst.includes(q)
      }).slice(0, 8)

      matchedItems.forEach((it) => {
        const cat = getTypeCategory(it)
        const icon = TYPE_ICONS[cat] || '📦'
        const value = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)
        out.push({
          type: 'item',
          id: `item-${it.id}`,
          icon,
          label: `${it.name || it.symbol}${it.symbol ? ` (${it.symbol})` : ''}`,
          detail: `${it.institution || it.type} · ${formatCurrency(value)}`,
          data: it,
        })
      })
    }

    ACTIONS.forEach((a) => {
      const label = lang === 'es' ? a.labelEs : a.labelEn
      if (q.length === 0 || label.toLowerCase().includes(q)) {
        out.push({
          type: 'action',
          id: a.id,
          icon: a.icon,
          label,
          shortcut: a.shortcut,
        })
      }
    })

    return out
  }, [query, items, lang])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  const execute = useCallback((result) => {
    if (!result) return
    onClose()
    if (result.type === 'item') {
      onAction('viewItem', result.data)
    } else {
      onAction(result.id)
    }
  }, [onClose, onAction])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      execute(results[selectedIdx])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [results, selectedIdx, execute, onClose])

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div className="modal-glass w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-glass-border">
          <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={lang === 'es' ? 'Buscar posición o acción...' : 'Search position or action...'}
            className="flex-1 bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none"
          />
          <kbd className="hidden sm:inline-block text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">
              {lang === 'es' ? 'Sin resultados' : 'No results'}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => execute(r)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === selectedIdx ? '' : 'hover:bg-theme-elevated'
              }`}
              style={i === selectedIdx
                ? { backgroundColor: 'rgba(37,99,235,0.2)', color: '#ffffff' }
                : { color: 'var(--text-muted)' }
              }
            >
              <span className="w-6 text-center shrink-0 flex items-center justify-center"><Icon name={r.icon} size={16} className="text-slate-400" /></span>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{r.label}</div>
                {r.detail && <div className="text-xs text-slate-500 truncate">{r.detail}</div>}
              </div>
              {r.shortcut && (
                <kbd className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 shrink-0">
                  ⌘{r.shortcut}
                </kbd>
              )}
              {r.type === 'item' && (
                <span className="text-xs text-slate-500 shrink-0">→</span>
              )}
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-glass-border flex items-center gap-4 text-xs text-slate-600">
          <span>↑↓ {lang === 'es' ? 'navegar' : 'navigate'}</span>
          <span>↵ {lang === 'es' ? 'seleccionar' : 'select'}</span>
          <span>esc {lang === 'es' ? 'cerrar' : 'close'}</span>
        </div>
      </div>
    </div>
  )
}
