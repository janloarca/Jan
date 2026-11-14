'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { formatCurrency, formatDate, getTypeCategory, TYPE_ICONS } from './utils'
import { searchGlobal, zeroUnitsNote } from '@/lib/globalSearch'
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

export default function CommandPalette({ open, onClose, items, lots, transactions, lang, onAction, brokersEnabled = true }) {
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

  // La lógica de búsqueda vive en lib/globalSearch.js (pura y con tests): acá
  // solo se formatea. Busca posiciones, símbolos con historia pero sin unidades,
  // cuentas, movimientos y acciones.
  const results = useMemo(() => {
    const es = lang === 'es'
    const actions = ACTIONS
      // Integraciones con brokers ocultas: la acción de sincronizar IBKR no
      // debe aparecer en la paleta cuando la UI de conexión está apagada.
      .filter((a) => !(a.id === 'ibkr' && !brokersEnabled))
      .map((a) => ({ ...a, label: es ? a.labelEs : a.labelEn }))
    const hits = searchGlobal({ query, items, lots, transactions, actions })

    // Dos posiciones con mismo nombre, símbolo e institución se veían idénticas:
    // se agrega cantidad e identificador corto SOLO cuando hay homónimos.
    const keyOf = (it) => `${it.name}|${it.symbol}|${it.institution}`
    const dupCount = {}
    hits.forEach((h) => { if (h.type === 'item') dupCount[keyOf(h.item)] = (dupCount[keyOf(h.item)] || 0) + 1 })

    return hits.map((h) => {
      if (h.type === 'item') {
        const it = h.item
        const dup = dupCount[keyOf(it)] > 1
        const cat = getTypeCategory(it)
        const value = (it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0)
        const tail = h.zeroUnits
          ? zeroUnitsNote(h, lang)
          : formatCurrency(value)
        return {
          type: 'item', id: h.id, icon: TYPE_ICONS[cat] || 'BarChart3',
          label: `${it.name || it.symbol}${it.symbol ? ` (${it.symbol})` : ''}`,
          detail: `${it.institution || it.type || ''}${it.institution || it.type ? ' · ' : ''}${tail}${dup ? ` · ${it.quantity ?? 1} u. · #${String(it.id || '').slice(-4)}` : ''}`,
          data: it,
        }
      }
      if (h.type === 'symbol') {
        return {
          type: 'symbol', id: h.id, icon: 'Activity',
          label: h.name ? `${h.name} (${h.symbol})` : h.symbol,
          detail: zeroUnitsNote(h, lang),
          data: { symbol: h.symbol, label: h.symbol },
        }
      }
      if (h.type === 'account') {
        const n = h.items.length
        return {
          type: 'account', id: h.id, icon: 'Building2',
          label: h.name,
          detail: es ? `Cuenta · ${n} ${n === 1 ? 'posición' : 'posiciones'}` : `Account · ${n} ${n === 1 ? 'position' : 'positions'}`,
          data: h.items,
        }
      }
      if (h.type === 'transaction') {
        const tx = h.tx
        return {
          type: 'transaction', id: h.id, icon: 'ArrowLeftRight',
          label: tx.description || h.symbol || tx.type || (es ? 'Movimiento' : 'Movement'),
          detail: `${es ? 'Movimiento' : 'Movement'} · ${tx.type || ''}${h.symbol ? ` · ${h.symbol}` : ''} · ${formatDate(tx.date)} · ${formatCurrency(tx.totalAmount ?? 0, tx.currency)}`,
          data: { symbol: h.symbol, txId: tx.id, label: h.symbol || tx.description || '' },
        }
      }
      const a = h.action
      return { type: 'action', id: a.id, icon: a.icon, label: a.label, shortcut: a.shortcut }
    })
  }, [query, items, lots, transactions, lang, brokersEnabled])

  useEffect(() => {
    setSelectedIdx(0)
  }, [query])

  const execute = useCallback((result) => {
    if (!result) return
    onClose()
    if (result.type === 'item') {
      onAction('viewItem', result.data)
    } else if (result.type === 'symbol' || result.type === 'transaction') {
      onAction('viewActivity', result.data)
    } else if (result.type === 'account') {
      onAction('editAccount', result.data)
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
    <div className="modal-backdrop fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
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
            placeholder={lang === 'es' ? 'Busca posición, cuenta, movimiento o acción...' : 'Search position, account, movement or action...'}
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
              {r.type !== 'action' && (
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
