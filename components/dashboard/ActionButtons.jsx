'use client'

import { Upload, Plus, ArrowLeftRight, Share2, Download, RefreshCw, ClipboardCheck, DollarSign } from 'lucide-react'

export default function ActionButtons({ onImport, onAddAccount, onTransfer, onCashFlow, onExport, onShare, onIBKR, onBlockchain, onLedger, onIntegrations, onReview, itemCount, lang, ibkrSyncStatus, ibkrLastSync }) {
  const btnBase = 'px-2.5 sm:px-4 py-2 text-body font-medium rounded-lg transition-colors flex items-center gap-1.5'
  const btnSecondary = `${btnBase} bg-[var(--card-bg,#1C1C1E)] border border-[var(--card-border,#38383A)] text-slate-300 hover:bg-[var(--input-bg,#2C2C2E)] hover:text-white`
  const btnMuted = `${btnBase} bg-[var(--card-bg,#1C1C1E)] border border-[var(--card-border,#38383A)] text-[var(--text-secondary,#94a3b8)] hover:bg-[var(--input-bg,#2C2C2E)]`

  const hasSyncIndicator = ibkrSyncStatus === 'error' || (ibkrSyncStatus === 'ok' && ibkrLastSync)
  const syncDotColor = ibkrSyncStatus === 'error' ? 'bg-red-400'
    : ibkrSyncStatus === 'ok' && ibkrLastSync && !isNaN(new Date(ibkrLastSync).getTime()) && Date.now() - new Date(ibkrLastSync).getTime() < 2 * 60 * 60 * 1000 ? 'bg-emerald-400'
    : ibkrSyncStatus === 'ok' ? 'bg-amber-400' : ''

  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <button onClick={onImport} className={`${btnBase} bg-blue-600 text-white hover:bg-blue-500`}>
        <Upload size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Importar' : 'Import'}</span>
      </button>
      {onIntegrations && (
        <button onClick={onIntegrations} className={`${btnSecondary} relative`}>
          <RefreshCw size={14} /> <span className="hidden sm:inline">Sync</span>
          {hasSyncIndicator && syncDotColor && (
            <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${syncDotColor}`} />
          )}
        </button>
      )}
      <button onClick={onAddAccount} className={btnSecondary}>
        <Plus size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Agregar' : 'Add'}</span>
      </button>
      <button onClick={onTransfer} className={btnMuted}>
        <ArrowLeftRight size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Transferir' : 'Transfer'}</span>
      </button>
      {onCashFlow && (
        <button onClick={onCashFlow} className={btnSecondary}>
          <DollarSign size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Movimiento' : 'Cash Flow'}</span>
        </button>
      )}
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {onReview && (
          <button onClick={onReview} className={btnMuted} aria-label={lang === 'es' ? 'Revisar' : 'Review'}>
            <ClipboardCheck size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Revisar' : 'Review'}</span>
          </button>
        )}
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
