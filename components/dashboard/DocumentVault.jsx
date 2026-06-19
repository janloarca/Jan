'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useDocumentVault } from '@/hooks/useDocumentVault'

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
        <label className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer" style={{ backgroundColor: 'rgba(37,99,235,0.2)', color: '#60a5fa' }}>
          {uploading ? '...' : `+ ${t('Subir', 'Upload')}`}
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
              <button onClick={() => handleDelete(doc)}
                className={`text-xs shrink-0 px-2 py-0.5 rounded transition-colors ${
                  confirmDelete !== doc.id ? 'opacity-0 group-hover:opacity-100' : ''
                }`}
                style={confirmDelete === doc.id
                  ? { backgroundColor: '#dc2626', color: '#ffffff' }
                  : { color: '#475569' }
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
