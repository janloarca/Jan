'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Plus, Users } from 'lucide-react'

export default function EntitySwitcher({ entities, activeEntity, onSelect, onAdd, lang }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!entities || entities.length <= 1) return null

  const current = entities.find(e => e.id === activeEntity) || entities[0]
  const allLabel = t('Consolidado', 'Consolidated')

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 bg-theme-card border border-glass-border rounded-lg hover:bg-theme-elevated transition-colors"
      >
        <Users size={12} className="text-slate-400" />
        <span>{activeEntity === '__all__' ? allLabel : (current?.icon ? `${current.icon} ` : '') + (current?.name || 'Personal')}</span>
        <ChevronDown size={12} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-theme-card border border-glass-border rounded-lg shadow-xl z-50 py-1">
          <button
            onClick={() => { onSelect('__all__'); setOpen(false) }}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
              activeEntity !== '__all__' ? 'hover:bg-theme-elevated' : ''
            }`}
            style={activeEntity === '__all__'
              ? { color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)' }
              : { color: '#cbd5e1' }
            }
          >
            📊 {allLabel}
          </button>
          <div className="border-t border-glass-border my-1" />
          {entities.map(entity => (
            <button
              key={entity.id}
              onClick={() => { onSelect(entity.id); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                activeEntity !== entity.id ? 'hover:bg-theme-elevated' : ''
              }`}
              style={activeEntity === entity.id
                ? { color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)' }
                : { color: '#cbd5e1' }
              }
            >
              {entity.icon || '📁'} {entity.name}
            </button>
          ))}
          {onAdd && (
            <>
              <div className="border-t border-glass-border my-1" />
              <button
                onClick={() => { onAdd(); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:text-blue-400 hover:bg-theme-elevated transition-colors flex items-center gap-1.5"
              >
                <Plus size={12} /> {t('Nueva entidad', 'New entity')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
