'use client'

import { Upload, Plus, ArrowLeftRight, Share2, Download, RefreshCw } from 'lucide-react'

export default function ActionButtons({ onImport, onAddAccount, onTransfer, onExport, onShare, onIBKR, itemCount, lang }) {
  const btnBase = 'px-2.5 sm:px-4 py-2 text-body font-medium rounded-lg transition-colors flex items-center gap-1.5'
  const btnSecondary = `${btnBase} bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] text-slate-300 hover:bg-[var(--input-bg,#283548)] hover:text-white`
  const btnMuted = `${btnBase} bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] text-[var(--text-secondary,#94a3b8)] hover:bg-[var(--input-bg,#283548)]`

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <button onClick={onImport} className={`${btnBase} bg-blue-600 text-white hover:bg-blue-500`}>
        <Upload size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Importar' : 'Import'}</span>
      </button>
      {onIBKR && (
        <button onClick={onIBKR} className={btnSecondary}>
          <RefreshCw size={14} /> <span className="hidden sm:inline">IBKR</span>
        </button>
      )}
      <button onClick={onAddAccount} className={btnSecondary}>
        <Plus size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Agregar' : 'Add'}</span>
      </button>
      <button onClick={onTransfer} className={btnMuted}>
        <ArrowLeftRight size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Transferir' : 'Transfer'}</span>
      </button>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {onShare && (
          <button onClick={onShare} className={btnMuted} aria-label={lang === 'es' ? 'Compartir' : 'Share'}>
            <Share2 size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Compartir' : 'Share'}</span>
          </button>
        )}
        <button onClick={onExport} className={btnMuted} aria-label="Export">
          <Download size={14} /> <span className="hidden sm:inline">Export</span>
        </button>
        <span className="text-caption text-[var(--text-muted,#475569)] hidden sm:inline">
          {lang === 'es' ? 'Activos' : 'Assets'}: {itemCount}
        </span>
      </div>
    </div>
  )
}
