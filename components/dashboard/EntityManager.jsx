'use client'

import { useState } from 'react'
import { ENTITY_TYPES } from '@/hooks/useEntities'
import { Trash2, Edit2, Check, X } from 'lucide-react'

// Entities partition the portfolio into separate people/businesses/families.
// The mechanic is invisible unless explained, so this manager leads with a
// "how it works" primer and shows how many accounts live in each entity.

export default function EntityManager({ entities, onAdd, onUpdate, onDelete, items = [], lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('personal')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const countFor = (entityId) => items.filter((it) => (it.entityId || 'default') === entityId).length

  const handleAdd = async () => {
    if (!newName.trim()) return
    const typeInfo = ENTITY_TYPES.find(et => et.key === newType) || ENTITY_TYPES[0]
    await onAdd({ name: newName.trim(), type: newType, icon: typeInfo.icon })
    setNewName('')
    setNewType('personal')
    setAdding(false)
  }

  const handleRename = async (id) => {
    if (!editName.trim()) return
    await onUpdate(id, { name: editName.trim() })
    setEditId(null)
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">{t('Entidades', 'Entities')}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{t(
          'Separa tu dinero personal del de tu empresa o familia: cada entidad tiene su propio patrimonio.',
          'Keep personal money apart from your business or family: each entity has its own net worth.'
        )}</p>
      </div>

      {/* How it works — the mechanic is invisible without this */}
      <div className="p-3 rounded-xl border text-xs space-y-1.5" style={{ backgroundColor: 'var(--alert-info-bg)', borderColor: 'var(--alert-info-border)', color: 'var(--text-secondary)' }}>
        <p className="font-medium" style={{ color: 'var(--alert-info-icon)' }}>{t('¿Cómo funciona?', 'How does it work?')}</p>
        <p>1. {t('Crea una entidad (ej. "Mi empresa").', 'Create an entity (e.g. "My business").')}</p>
        <p>2. {t('Selecciónala en el switcher junto al título del dashboard.', 'Select it in the switcher next to the dashboard title.')}</p>
        <p>3. {t('Todo lo que agregues o importes con ella activa queda asignado a esa entidad.', 'Everything you add or import while it\'s active gets assigned to that entity.')}</p>
        <p>{t('El "Consolidado" siempre suma todas. También puedes mover una cuenta existente de entidad al editarla.', '"Consolidated" always sums them all. You can also move an existing account between entities when editing it.')}</p>
      </div>

      <div className="space-y-1.5">
        {entities.map(entity => {
          const count = countFor(entity.id)
          return (
            <div key={entity.id} className="px-3 py-2.5 bg-theme-base border border-glass-border/60 rounded-xl">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)' }}>{entity.icon || '📁'}</span>
                {editId === entity.id ? (
                  <div className="flex-1 flex items-center gap-1">
                    <input
                      type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(entity.id); if (e.key === 'Escape') setEditId(null) }}
                      autoFocus className="flex-1 px-2 py-0.5 text-xs bg-theme-card border rounded text-white focus:outline-none"
                      style={{ borderColor: 'rgba(37,99,235,0.5)' }}
                    />
                    <button onClick={() => handleRename(entity.id)} aria-label={t('Guardar', 'Save')} className="hover:opacity-80" style={{ color: 'var(--accent-green)' }}><Check size={14} /></button>
                    <button onClick={() => setEditId(null)} aria-label={t('Cancelar', 'Cancel')} className="text-slate-400 hover:text-slate-300"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{entity.name}</p>
                      <p className="text-xs text-slate-500">
                        {ENTITY_TYPES.find(et => et.key === entity.type)?.[lang] || entity.type}
                        {' · '}{count} {t(count === 1 ? 'cuenta' : 'cuentas', count === 1 ? 'account' : 'accounts')}
                      </p>
                    </div>
                    <button onClick={() => { setEditId(entity.id); setEditName(entity.name) }} aria-label={t('Renombrar', 'Rename')} className="text-slate-500 hover:text-slate-300"><Edit2 size={13} /></button>
                    {entity.id !== 'default' && (
                      <button onClick={() => setConfirmDeleteId(confirmDeleteId === entity.id ? null : entity.id)} aria-label={t('Eliminar', 'Delete')} className="text-slate-500 hover:text-red-400"><Trash2 size={13} /></button>
                    )}
                  </>
                )}
              </div>
              {confirmDeleteId === entity.id && (
                <div className="mt-2 pt-2 border-t border-glass-border/40 flex items-center justify-between gap-2">
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {count > 0
                      ? t(`Sus ${count} cuentas pasan a Personal. Nada se borra.`, `Its ${count} accounts move to Personal. Nothing is deleted.`)
                      : t('La entidad está vacía.', 'The entity is empty.')}
                  </p>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={async () => { await onDelete(entity.id); setConfirmDeleteId(null) }}
                      className="px-2.5 py-1 text-xs font-medium rounded-md" style={{ color: '#ffffff', backgroundColor: 'var(--text-negative)' }}>
                      {t('Eliminar', 'Delete')}
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)}
                      className="px-2.5 py-1 text-xs rounded-md border border-glass-border" style={{ color: 'var(--text-secondary)' }}>
                      {t('No', 'No')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {adding ? (
        <div className="space-y-2 p-3 bg-theme-base rounded-xl border border-glass-border">
          <input
            type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder={t('Nombre de la entidad', 'Entity name')}
            autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
            className="w-full px-3 py-1.5 text-xs bg-theme-card border border-glass-border rounded text-white focus:outline-none focus:border-blue-500/50"
          />
          <div className="flex gap-1.5 flex-wrap">
            {ENTITY_TYPES.map(et => (
              <button key={et.key} onClick={() => setNewType(et.key)}
                className={`px-2 py-1 text-micro rounded border transition-colors ${
                  newType !== et.key ? 'hover:text-white' : ''
                }`}
                style={newType === et.key
                  ? { borderColor: 'rgba(37,99,235,0.5)', backgroundColor: 'rgba(37,99,235,0.1)', color: 'var(--accent-blue)' }
                  : { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }
                }>
                {et.icon} {lang === 'es' ? et.es : et.en}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1 text-xs rounded hover:opacity-90" style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>{t('Crear', 'Create')}</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1 text-xs text-slate-400 hover:text-white">{t('Cancelar', 'Cancel')}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="w-full px-3 py-2 text-xs text-slate-400 border border-dashed border-glass-border rounded-xl hover:text-blue-400 hover:border-blue-500/30 transition-colors">
          + {t('Agregar entidad', 'Add entity')}
        </button>
      )}
    </div>
  )
}
