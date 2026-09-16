'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useDocumentVault } from '@/hooks/useDocumentVault'
import { useAutoDisarm } from '@/hooks/useAutoDisarm'
import BusyLabel from '@/components/ui/BusyLabel'

const FILE_ICONS = {
  'application/pdf': '📄',
  'image/jpeg': '🖼',
  'image/png': '🖼',
  'image/webp': '🖼',
  default: '📎',
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export default function DocumentVault({ uid, itemId, lang }) {
  const { uploadDocument, deleteDocument, listDocuments, uploading } = useDocumentVault()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  // FASE ND: el "Confirmar" quedaba armado para siempre (sin botón de No y sin
  // timeout): un toque de curiosidad dejaba el documento a un toque de borrarse.
  useAutoDisarm(confirmDelete, () => setConfirmDelete(null))
  const fileRef = useRef()

  const t = (es, en) => lang === 'es' ? es : en

  const loadDocs = useCallback(async () => {
    if (!uid || !itemId) return
    setLoading(true)
    try {
      const list = await listDocuments(uid, itemId)
      setDocs(list.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || '')))
    } catch {
      setError(t('Error cargando documentos', 'Failed to load documents'))
    }
    setLoading(false)
  }, [uid, itemId, listDocuments])

  useEffect(() => { loadDocs() }, [loadDocs])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    try {
      await uploadDocument(uid, itemId, file)
      await loadDocs()
    } catch (err) {
      setError(err.message)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDelete = async (doc) => {
    if (confirmDelete !== doc.id) {
      setConfirmDelete(doc.id)
      return
    }
    try {
      await deleteDocument(uid, itemId, doc.id, doc.storagePath)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    } catch {
      setError(t('Error al eliminar', 'Failed to delete'))
    }
    setConfirmDelete(null)
  }

  return (
    <div className="border-t border-glass-border/50 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
          <span>📁</span> {t('Documentos', 'Documents')}
          {docs.length > 0 && <span className="text-slate-600">({docs.length})</span>}
        </h4>
        <label className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer" style={{ backgroundColor: 'rgba(37,99,235,0.2)', color: 'var(--accent-blue)' }}>
          {<BusyLabel busy={uploading} lang={lang}>{`+ ${t('Subir', 'Upload')}`}</BusyLabel>}
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} disabled={uploading}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv" />
        </label>
      </div>

      {error && <p className="text-xs mb-2" style={{ color: 'var(--text-negative)' }}>{error}</p>}

      {loading ? (
        <div className="text-xs text-slate-600 animate-pulse">{t('Cargando...', 'Loading...')}</div>
      ) : docs.length === 0 ? (
        <p className="text-xs text-slate-600">
          {t('Sin documentos. Sube certificados, contratos o comprobantes.', 'No documents. Upload certificates, contracts, or receipts.')}
        </p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 p-2 bg-theme-base rounded-lg border border-glass-border/30 group">
              <span className="text-sm">{FILE_ICONS[doc.type] || FILE_ICONS.default}</span>
              <a href={doc.url?.startsWith('https://') ? doc.url : '#'} target="_blank" rel="noopener noreferrer"
                className="flex-1 min-w-0 text-xs text-slate-300 hover:text-blue-400 truncate transition-colors">
                {doc.name}
              </a>
              <span className="text-xs text-slate-600 shrink-0">{formatSize(doc.size)}</span>
              {/* FASE ME3: era `opacity-0 group-hover:opacity-100`, o sea invisible
                  en táctil para siempre (borrar un documento era inalcanzable desde
                  iPad); y el gris #475569 medía 2.60:1. Visible siempre, 28px de
                  objetivo, tokens. La confirmación de dos toques ya existía. */}
              <button onClick={() => handleDelete(doc)}
                aria-label={confirmDelete === doc.id ? t('Confirmar borrado', 'Confirm delete') : t(`Borrar ${doc.name}`, `Delete ${doc.name}`)}
                className="text-xs shrink-0 min-w-[28px] min-h-[28px] px-2 rounded transition-colors flex items-center justify-center"
                style={confirmDelete === doc.id
                  ? { backgroundColor: 'var(--text-negative)', color: '#ffffff' }
                  : { color: 'var(--text-muted)' }
                }>
                {confirmDelete === doc.id ? t('Confirmar', 'Confirm') : '×'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
