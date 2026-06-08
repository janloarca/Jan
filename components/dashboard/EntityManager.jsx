'use client'

import { useState } from 'react'
import { ENTITY_TYPES } from '@/hooks/useEntities'
import { Trash2, Edit2, Check, X } from 'lucide-react'

export default function EntityManager({ entities, onAdd, onUpdate, onDelete, lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('personal')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')

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
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white">{t('Entidades', 'Entities')}</h3>
      <p className="text-xs text-slate-500">{t('Gestiona personas, empresas o familias por separado.', 'Manage separate people, businesses, or families.')}</p>

      <div className="space-y-1">
        {entities.map(entity => (
          <div key={entity.id} className="flex items-center gap-2 px-3 py-2 bg-[#000000] rounded-lg">
            <span className="text-sm">{entity.icon || '📁'}</span>
            {editId === entity.id ? (
              <div className="flex-1 flex items-center gap-1">
                <input
                  type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRename(entity.id); if (e.key === 'Escape') setEditId(null) }}
                  autoFocus className="flex-1 px-2 py-0.5 text-xs bg-[#1C1C1E] border rounded text-white focus:outline-none"
                  style={{ borderColor: 'rgba(59,130,246,0.5)' }}
                />
                <button onClick={() => handleRename(entity.id)} className="hover:opacity-80" style={{ color: '#34d399' }}><Check size={14} /></button>
                <button onClick={() => setEditId(null)} className="text-slate-400 hover:text-slate-300"><X size={14} /></button>
              </div>
            ) : (
              <>
                <span className="flex-1 text-xs text-white">{entity.name}</span>
                <span className="text-micro text-slate-500">{ENTITY_TYPES.find(et => et.key === entity.type)?.[lang] || entity.type}</span>
                <button onClick={() => { setEditId(entity.id); setEditName(entity.name) }} className="text-slate-500 hover:text-slate-300"><Edit2 size={12} /></button>
                {entity.id !== 'default' && (
                  <button onClick={() => onDelete(entity.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={12} /></button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {adding ? (
        <div className="space-y-2 p-3 bg-[#000000] rounded-lg border border-[#38383A]">
          <input
            type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder={t('Nombre de la entidad', 'Entity name')}
            autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
            className="w-full px-3 py-1.5 text-xs bg-[#1C1C1E] border border-[#38383A] rounded text-white focus:outline-none focus:border-blue-500/50"
          />
          <div className="flex gap-1.5">
            {ENTITY_TYPES.map(et => (
              <button key={et.key} onClick={() => setNewType(et.key)}
                className={`px-2 py-1 text-micro rounded border transition-colors ${
                  newType !== et.key ? 'hover:text-white' : ''
                }`}
                style={newType === et.key
                  ? { borderColor: 'rgba(59,130,246,0.5)', backgroundColor: 'rgba(59,130,246,0.1)', color: '#60a5fa' }
                  : { borderColor: '#38383A', color: '#94a3b8' }
                }>
                {et.icon} {lang === 'es' ? et.es : et.en}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1 text-xs rounded hover:opacity-90" style={{ backgroundColor: '#2563eb', color: '#ffffff' }}>{t('Crear', 'Create')}</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1 text-xs text-slate-400 hover:text-white">{t('Cancelar', 'Cancel')}</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="w-full px-3 py-2 text-xs text-slate-400 border border-dashed border-[#38383A] rounded-lg hover:text-blue-400 hover:border-blue-500/30 transition-colors">
          + {t('Agregar entidad', 'Add entity')}
        </button>
      )}
    </div>
  )
}
