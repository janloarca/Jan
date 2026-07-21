'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { authFetch } from '@/lib/authFetch'

export default function BlockchainSyncModal({ onClose, onSyncComplete, onSaveCredentials, lang = 'es', uid }) {
  const trapRef = useFocusTrap()
  const [apiKey, setApiKey] = useState('')
  const [step, setStep] = useState('config')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [syncMode, setSyncMode] = useState('merge')

  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleSync = useCallback(async () => {
    if (!apiKey.trim()) {
      setError(t('Ingresa tu API key.', 'Enter your API key.'))
      return
    }
    setSyncing(true)
    setError('')
    try {
      const { syncBlockchain } = await import('@/lib/blockchainSync')
      const data = await syncBlockchain(apiKey.trim())
      setPreview(data)
      setStep('preview')

      // Store the API key in the server-side vault (encrypted with the master key)
      // and drop any legacy client-encrypted copy.
      if (uid) {
        try {
          await authFetch('/api/brokers/blockchain', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save-credentials', apiKey: apiKey.trim() }),
          })
          onSaveCredentials?.({ blockchainApiKey: null })
        } catch (e) { console.error('[blockchain] save-credentials failed (re-enter key to persist):', e?.message) }
      }
    } catch (err) {
      setError(err.message || t('Error conectando con Blockchain.com', 'Error connecting to Blockchain.com'))
    }
    setSyncing(false)
  }, [apiKey, uid, onSaveCredentials, t])

  const handleConfirm = useCallback(() => {
    if (!preview) return
    onSyncComplete({
      items: preview.items,
      transactions: preview.transactions,
      mode: syncMode,
      source: 'blockchain',
    })
    onClose()
  }, [preview, syncMode, onSyncComplete, onClose])

  const inputCls = 'w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="bg-theme-card border border-glass-border rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">₿</span> Blockchain.com Sync
          </h2>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        {step === 'config' && (
          <div className="p-6 space-y-4">
            <div className="border rounded-lg p-3" style={{ backgroundColor: 'rgba(108,122,255,0.1)', borderColor: 'rgba(108,122,255,0.2)' }}>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--accent-blue)' }}>{t('Cómo obtener tu API key:', 'How to get your API key:')}</p>
              <ol className="text-xs space-y-0.5 list-decimal list-inside" style={{ color: 'rgba(147,197,253,0.8)' }}>
                <li>{t('Ve a Blockchain.com Exchange', 'Go to Blockchain.com Exchange')}</li>
                <li>{t('Settings → API Management', 'Settings → API Management')}</li>
                <li>{t('Crea una nueva API Key (solo lectura)', 'Create a new API Key (read-only)')}</li>
                <li>{t('Verifica por email', 'Verify via email')}</li>
              </ol>
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">API Key</label>
              <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className={inputCls} />
            </div>

            {error && (
              <div className="p-3 border rounded-lg text-xs whitespace-pre-wrap" style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--text-negative)' }}>
                {error}
              </div>
            )}

            <button onClick={handleSync} disabled={syncing || !apiKey.trim()}
              className="w-full py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
              {syncing ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('Sincronizando...', 'Syncing...')}
                </>
              ) : t('Conectar y sincronizar', 'Connect & sync')}
            </button>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="p-6 space-y-4">
            <div className="border rounded-lg p-3" style={{ backgroundColor: 'rgba(52,211,153,0.1)', borderColor: 'rgba(52,211,153,0.2)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--accent-green)' }}>{t('Sincronización exitosa', 'Sync successful')}</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(110,231,183,0.7)' }}>
                {preview.items.length} {t('posiciones', 'positions')} · {preview.transactions.length} {t('transacciones', 'transactions')}
              </p>
            </div>

            {preview.items.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 font-medium mb-2">{t('Posiciones encontradas:', 'Positions found:')}</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {preview.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 bg-theme-base rounded text-xs">
                      <span className="text-white font-medium">{item.symbol}</span>
                      <span className="text-slate-400">
                        {item.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                        {item.currentPrice > 0 && (
                          <span className="text-slate-500 ml-2">
                            ≈ ${(item.quantity * item.currentPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-400 font-medium mb-2">{t('Modo de importación:', 'Import mode:')}</p>
              <div className="flex gap-2">
                <button onClick={() => setSyncMode('merge')}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors border"
                  style={syncMode === 'merge' ? { backgroundColor: 'rgba(108,122,255,0.2)', color: 'var(--accent-blue)', borderColor: 'rgba(108,122,255,0.4)' } : { backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}>
                  {t('Fusionar', 'Merge')}
                  <span className="block text-xs mt-0.5 opacity-60">{t('Actualiza existentes, agrega nuevos', 'Update existing, add new')}</span>
                </button>
                <button onClick={() => setSyncMode('replace')}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors border"
                  style={syncMode === 'replace' ? { backgroundColor: 'rgba(245,158,11,0.2)', color: '#fbbf24', borderColor: 'rgba(245,158,11,0.4)' } : { backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}>
                  {t('Reemplazar', 'Replace')}
                  <span className="block text-xs mt-0.5 opacity-60">{t('Borra todo de Blockchain.com', 'Delete all from Blockchain.com')}</span>
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setStep('config'); setPreview(null) }}
                className="flex-1 py-2.5 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-base transition-colors text-sm">
                {t('Atrás', 'Back')}
              </button>
              <button onClick={handleConfirm}
                className="flex-1 py-2.5 rounded-lg hover:opacity-90 transition-colors text-sm font-medium"
                style={{ backgroundColor: '#059669', color: '#ffffff' }}>
                {t('Importar', 'Import')} ({preview.items.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
