'use client'

import { useState, useEffect, useCallback } from 'react'

export default function BlockchainSyncModal({ onClose, onSyncComplete, onSaveCredentials, lang = 'es', uid }) {
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

      if (onSaveCredentials && uid) {
        const { encryptToken } = await import('@/lib/crypto')
        const encrypted = await encryptToken(apiKey.trim(), uid)
        onSaveCredentials({ blockchainApiKey: encrypted })
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

  const inputCls = 'w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">₿</span> Blockchain.com Sync
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {step === 'config' && (
          <div className="p-6 space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <p className="text-xs text-blue-400 font-medium mb-1">{t('Cómo obtener tu API key:', 'How to get your API key:')}</p>
              <ol className="text-[11px] text-blue-300/80 space-y-0.5 list-decimal list-inside">
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
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 whitespace-pre-wrap">
                {error}
              </div>
            )}

            <button onClick={handleSync} disabled={syncing || !apiKey.trim()}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2">
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
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <p className="text-sm text-emerald-400 font-medium">{t('Sincronización exitosa', 'Sync successful')}</p>
              <p className="text-xs text-emerald-300/70 mt-1">
                {preview.items.length} {t('posiciones', 'positions')} · {preview.transactions.length} {t('transacciones', 'transactions')}
              </p>
            </div>

            {preview.items.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 font-medium mb-2">{t('Posiciones encontradas:', 'Positions found:')}</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {preview.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 bg-[#0f172a] rounded text-xs">
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
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${syncMode === 'merge' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[#0f172a] text-slate-400 border border-[#334155]'}`}>
                  {t('Fusionar', 'Merge')}
                  <span className="block text-[10px] mt-0.5 opacity-60">{t('Actualiza existentes, agrega nuevos', 'Update existing, add new')}</span>
                </button>
                <button onClick={() => setSyncMode('replace')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${syncMode === 'replace' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-[#0f172a] text-slate-400 border border-[#334155]'}`}>
                  {t('Reemplazar', 'Replace')}
                  <span className="block text-[10px] mt-0.5 opacity-60">{t('Borra todo de Blockchain.com', 'Delete all from Blockchain.com')}</span>
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setStep('config'); setPreview(null) }}
                className="flex-1 py-2.5 border border-[#334155] text-slate-300 rounded-lg hover:bg-[#0f172a] transition-colors text-sm">
                {t('Atrás', 'Back')}
              </button>
              <button onClick={handleConfirm}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
                {t('Importar', 'Import')} ({preview.items.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
