'use client'

import { Upload, Plus, ArrowLeftRight, Share2, Download, RefreshCw } from 'lucide-react'

export default function ActionButtons({ onImport, onAddAccount, onTransfer, onExport, onShare, onIBKR, itemCount, lang }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={onImport}
        className="px-4 py-2 text-body font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-1.5">
        <Upload size={14} /> {lang === 'es' ? 'Importar' : 'Import'}
      </button>
      {onIBKR && (
        <button onClick={onIBKR}
          className="px-4 py-2 text-body font-medium bg-orange-600/20 border border-orange-500/30 text-orange-400 rounded-lg hover:bg-orange-600/30 transition-colors flex items-center gap-1.5">
          <RefreshCw size={14} /> IBKR Sync
        </button>
      )}
      <button onClick={onAddAccount}
        className="px-4 py-2 text-body font-medium bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] text-blue-400 rounded-lg hover:bg-[var(--input-bg,#283548)] transition-colors flex items-center gap-1.5">
        <Plus size={14} /> {lang === 'es' ? 'Agregar Activo' : 'Add Asset'}
      </button>
      <button onClick={onTransfer}
        className="px-4 py-2 text-body font-medium bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] text-emerald-400 rounded-lg hover:bg-[var(--input-bg,#283548)] transition-colors flex items-center gap-1.5">
        <ArrowLeftRight size={14} /> {lang === 'es' ? 'Transferir' : 'Transfer'}
      </button>
      <div className="ml-auto flex items-center gap-2">
        {onShare && (
          <button onClick={onShare}
            className="px-3 py-2 text-body font-medium bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] text-[var(--text-secondary,#94a3b8)] rounded-lg hover:bg-[var(--input-bg,#283548)] transition-colors flex items-center gap-1.5">
            <Share2 size={14} /> {lang === 'es' ? 'Compartir' : 'Share'}
          </button>
        )}
        <button onClick={onExport}
          className="px-3 py-2 text-body font-medium bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] text-[var(--text-secondary,#94a3b8)] rounded-lg hover:bg-[var(--input-bg,#283548)] transition-colors flex items-center gap-1.5">
          <Download size={14} /> Export
        </button>
        <span className="text-caption text-[var(--text-muted,#475569)]">
          {lang === 'es' ? 'Activos' : 'Assets'}: {itemCount}
        </span>
      </div>
    </div>
  )
}
