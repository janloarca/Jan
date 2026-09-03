'use client'

import { useState, useEffect, useCallback } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { authFetch } from '@/lib/authFetch'
import BusyLabel from '@/components/ui/BusyLabel'

export default function BlockchainSyncModal({ onClose, onSyncComplete, onSaveCredentials, lang = 'es', uid }) {
  const trapRef = useFocusTrap()
  const [apiKey, setApiKey] = useState('')
  const [step, setStep] = useState('config')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [syncMode, setSyncMode] = useState('merge')

  const t = (es, en) => lang === 'es' ? es : en

  useEscClose(onClose)

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

  // FASE NB: el handler del dashboard escribe a Firestore y es async. Antes
  // esto disparaba y cerraba en el acto: una escritura fallida dejaba el modal
  // cerrado con cara de "importado" y ninguna señal de lo contrario. Se espera
  // y se cierra solo si terminó bien; un fallo se dice y el modal se queda.
  const [importing, setImporting] = useState(false)
  const handleConfirm = useCallback(async () => {
    if (!preview || importing) return
    setError('')
    setImporting(true)
    try {
      await onSyncComplete({
        items: preview.items,
        transactions: preview.transactions,
        mode: syncMode,
        source: 'blockchain',
      })
      onClose()
    } catch (err) {
      setError(t(`No se pudo importar: ${err?.message || 'error de conexión'}. Intenta de nuevo.`,
        `Import failed: ${err?.message || 'connection error'}. Try again.`))
    } finally {
      setImporting(false)
    }
  }, [preview, importing, syncMode, onSyncComplete, onClose, t])

  const inputCls = 'w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50'

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div ref={trapRef} className="modal-anim bg-theme-card border border-glass-border rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">₿</span> Blockchain.com Sync
          </h2>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        {step === 'config' && (
          <div className="p-6 space-y-4">
            <div className="border rounded-lg p-3" style={{ backgroundColor: 'var(--alert-info-bg)', borderColor: 'var(--alert-info-border)' }}>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--accent-blue)' }}>{t('Cómo obtener tu API key:', 'How to get your API key:')}</p>
              <ol className="text-xs space-y-0.5 list-decimal list-inside" style={{ color: 'var(--text-secondary)' }}>
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
              <div className="p-3 border rounded-lg text-xs whitespace-pre-wrap" style={{ backgroundColor: 'var(--alert-error-bg)', borderColor: 'var(--alert-error-border)', color: 'var(--text-negative)' }}>
                {error}
              </div>
            )}

            <button onClick={handleSync} disabled={syncing || !apiKey.trim()}
              className="w-full py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
              <BusyLabel busy={syncing} lang={lang} busyLabel={t('Sincronizando...', 'Syncing...')}>
                {t('Conectar y sincronizar', 'Connect & sync')}
              </BusyLabel>
            </button>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="p-6 space-y-4">
            <div className="border rounded-lg p-3" style={{ backgroundColor: 'var(--alert-success-bg)', borderColor: 'var(--alert-success-border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--accent-green)' }}>{t('Sincronización exitosa', 'Sync successful')}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
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
                  style={syncMode === 'merge' ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', color: 'var(--accent-blue)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}>
                  {t('Fusionar', 'Merge')}
                  <span className="block text-xs mt-0.5 opacity-60">{t('Actualiza existentes, agrega nuevos', 'Update existing, add new')}</span>
                </button>
                <button onClick={() => setSyncMode('replace')}
                  className="flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors border"
                  style={syncMode === 'replace' ? { backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)', borderColor: 'var(--alert-warn-border)' } : { backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}>
                  {t('Reemplazar', 'Replace')}
                  <span className="block text-xs mt-0.5 opacity-60">{t('Borra todo de Blockchain.com', 'Delete all from Blockchain.com')}</span>
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg text-xs whitespace-pre-wrap"
                style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)', color: 'var(--alert-warn-icon)' }}>
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setStep('config'); setPreview(null) }} disabled={importing}
                className="flex-1 py-2.5 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-base transition-colors text-sm disabled:opacity-50">
                {t('Atrás', 'Back')}
              </button>
              <button onClick={handleConfirm} disabled={importing}
                className="flex-1 py-2.5 rounded-lg hover:opacity-90 transition-colors text-sm font-medium disabled:opacity-60"
                style={{ backgroundColor: '#059669', color: '#ffffff' }}>
                <BusyLabel busy={importing} lang={lang}>
                  {t('Importar', 'Import')} ({preview.items.length})
                </BusyLabel>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
