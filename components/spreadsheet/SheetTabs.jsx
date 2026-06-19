'use client'

import { useState } from 'react'

export default function SheetTabs({ sheets, activeSheet, onSelect, onAdd, onRename, onDelete, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [editing, setEditing] = useState(null)
  const [editName, setEditName] = useState('')

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-theme-base border-t border-glass-border overflow-x-auto">
      {sheets.map((sheet) => (
        <div key={sheet.id} className="flex items-center group">
          {editing === sheet.id ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => { if (editName.trim()) onRename(sheet.id, editName.trim()); setEditing(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { if (editName.trim()) onRename(sheet.id, editName.trim()); setEditing(null) }
                if (e.key === 'Escape') setEditing(null)
              }}
              autoFocus
              className="px-2 py-1 text-xs bg-theme-card border border-blue-500/50 rounded text-white focus:outline-none w-24"
            />
          ) : (
            <button
              onClick={() => onSelect(sheet.id)}
              onDoubleClick={() => { setEditing(sheet.id); setEditName(sheet.name) }}
              className={`px-3 py-1 text-xs rounded-t transition-colors ${
                activeSheet === sheet.id
                  ? 'bg-theme-card text-white border-t border-x border-glass-border -mb-px'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-theme-card/50'
              }`}
            >
              {sheet.name}
            </button>
          )}
          {sheets.length > 1 && activeSheet === sheet.id && editing !== sheet.id && (
            <button
              onClick={() => onDelete(sheet.id)}
              className="text-slate-600 hover:text-red-400 text-xs ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onAdd}
        className="px-2 py-1 text-xs text-slate-500 hover:text-blue-400 transition-colors"
      >
        +
      </button>
    </div>
  )
}
