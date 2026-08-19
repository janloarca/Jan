'use client'

import { useState } from 'react'
import { Pencil, X } from 'lucide-react'

// Renombrar y borrar una hoja dependían las DOS de tener mouse.
//
// Borrar vivía en `opacity-0 group-hover:opacity-100`: en un iPad no hay hover,
// así que era literalmente inalcanzable, y tampoco había salida por teclado.
// Renombrar era `onDoubleClick`, que en Safari táctil compite con el zoom de
// doble toque. Las dos son ahora botones visibles con objetivo de 24x24
// (WCAG 2.2 SC 2.5.8), solo sobre la pestaña activa, que es donde ya estaba la
// de borrar. El doble clic se conserva para quien lo tenga en los dedos.
//
// Y borrar pide confirmación, que ANTES no pedía: `handleDeleteSheet` borra y
// persiste de una (`app/spreadsheet/page.jsx:140`), así que volverla visible sin
// este paso habría hecho MÁS fácil perder una hoja entera de un toque. Mismo
// patrón de dos pasos que `RecentTransactions`.
export default function SheetTabs({ sheets, activeSheet, onSelect, onAdd, onRename, onDelete, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [editing, setEditing] = useState(null)
  const [editName, setEditName] = useState('')
  const [confirmId, setConfirmId] = useState(null)

  const startEdit = (sheet) => { setConfirmId(null); setEditing(sheet.id); setEditName(sheet.name) }

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-t overflow-x-auto" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--glass-border-color)' }}>
      {sheets.map((sheet) => (
        <div key={sheet.id} className="flex items-center shrink-0">
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
              aria-label={t('Nombre de la hoja', 'Sheet name')}
              className="px-2 py-1 text-caption rounded w-24 focus:outline-none"
              style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--accent-blue)', color: 'var(--text-primary)' }}
            />
          ) : (
            <button
              onClick={() => onSelect(sheet.id)}
              onDoubleClick={() => startEdit(sheet)}
              aria-current={activeSheet === sheet.id ? 'true' : undefined}
              className="px-3 min-h-[28px] text-caption rounded-t transition-colors whitespace-nowrap"
              style={activeSheet === sheet.id
                ? { backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--card-border)', borderBottom: 'none', marginBottom: '-1px' }
                : { color: 'var(--text-muted)' }}
            >
              {sheet.name}
            </button>
          )}

          {activeSheet === sheet.id && editing !== sheet.id && (
            <span className="flex items-center ml-0.5">
              <button
                onClick={() => startEdit(sheet)}
                aria-label={t('Renombrar hoja', 'Rename sheet')}
                className="min-w-[24px] min-h-[24px] flex items-center justify-center rounded opacity-40 hover:opacity-100 transition-opacity"
                style={{ color: 'var(--text-muted)' }}
              >
                <Pencil size={12} />
              </button>

              {sheets.length > 1 && (
                confirmId === sheet.id ? (
                  <span className="flex items-center gap-1 ml-0.5">
                    <button
                      onClick={() => { onDelete(sheet.id); setConfirmId(null) }}
                      className="text-micro font-semibold px-1.5 min-h-[24px] rounded"
                      style={{ backgroundColor: 'var(--text-negative)', color: 'var(--bg-card)' }}
                    >
                      {t('Borrar', 'Delete')}
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      className="text-micro px-1 min-h-[24px] rounded"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {t('No', 'No')}
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmId(sheet.id)}
                    aria-label={t('Borrar hoja', 'Delete sheet')}
                    className="min-w-[24px] min-h-[24px] flex items-center justify-center rounded opacity-40 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X size={12} />
                  </button>
                )
              )}
            </span>
          )}
        </div>
      ))}

      <button
        onClick={onAdd}
        aria-label={t('Agregar hoja', 'Add sheet')}
        className="px-2 min-w-[24px] min-h-[24px] text-caption transition-colors shrink-0"
        style={{ color: 'var(--text-muted)' }}
      >
        +
      </button>
    </div>
  )
}
