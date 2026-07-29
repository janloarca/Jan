'use client'

import { Upload, Plus, ArrowLeftRight, Share2, Download, RefreshCw, ClipboardCheck, DollarSign } from 'lucide-react'

export default function ActionButtons({ onImport, onAddAccount, onTransfer, onCashFlow, onExport, onShare, onIBKR, onBlockchain, onLedger, onIntegrations, onReview, itemCount, lang, ibkrSyncStatus, ibkrLastSync }) {
  // Uniform outline-secondary bar (matches the header's outline buttons).
  const btnBase = 'px-2.5 sm:px-4 py-2 text-body font-medium rounded-lg border transition-colors flex items-center gap-1.5 hover:bg-theme-elevated'
  const btnSecondary = btnBase
  const btnMuted = btnBase
  const outlineStyle = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }

  const hasSyncIndicator = ibkrSyncStatus === 'error' || (ibkrSyncStatus === 'ok' && ibkrLastSync)
  const syncDotColor = ibkrSyncStatus === 'error' ? 'var(--text-negative)'
    : ibkrSyncStatus === 'ok' && ibkrLastSync && !isNaN(new Date(ibkrLastSync).getTime()) && Date.now() - new Date(ibkrLastSync).getTime() < 2 * 60 * 60 * 1000 ? 'var(--accent-green)'
    : ibkrSyncStatus === 'ok' ? 'var(--accent-orange)' : null

  return (
    <div data-tour="actions" className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <button onClick={onImport} className={btnBase} style={outlineStyle}>
        <Upload size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Importar' : 'Import'}</span>
      </button>
      {onIntegrations && (
        <button onClick={onIntegrations} className={`${btnSecondary} relative`} style={outlineStyle}>
          <RefreshCw size={14} /> <span className="hidden sm:inline">Sync</span>
          {hasSyncIndicator && syncDotColor && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: syncDotColor }} />
          )}
        </button>
      )}
      <button onClick={onAddAccount} className={btnSecondary} style={outlineStyle}>
        <Plus size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Agregar' : 'Add'}</span>
      </button>
      <button onClick={onTransfer} className={btnMuted} style={outlineStyle}>
        <ArrowLeftRight size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Transferir' : 'Transfer'}</span>
      </button>
      {onCashFlow && (
        <button onClick={onCashFlow} className={btnSecondary} style={outlineStyle}>
          <DollarSign size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Movimiento' : 'Cash Flow'}</span>
        </button>
      )}
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {onReview && (
          <button onClick={onReview} className={btnMuted} style={outlineStyle} aria-label={lang === 'es' ? 'Revisar' : 'Review'}>
            <ClipboardCheck size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Revisar' : 'Review'}</span>
          </button>
        )}
        {onShare && (
          <button onClick={onShare} className={btnMuted} style={outlineStyle} aria-label={lang === 'es' ? 'Compartir' : 'Share'}>
            <Share2 size={14} /> <span className="hidden sm:inline">{lang === 'es' ? 'Compartir' : 'Share'}</span>
          </button>
        )}
        <button onClick={onExport} className={btnMuted} style={outlineStyle} aria-label="Export">
          <Download size={14} /> <span className="hidden sm:inline">Export</span>
        </button>
        <span className="text-caption text-[var(--text-muted,#475569)] hidden sm:inline">
          {lang === 'es' ? 'Activos' : 'Assets'}: {itemCount}
        </span>
      </div>
    </div>
  )
}
