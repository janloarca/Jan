'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, Lock } from 'lucide-react'

export default function IBKRSyncModal({ onClose, onSyncComplete, savedToken, savedQueryId, onSaveCredentials, lang = 'es', uid }) {
  const [token, setToken] = useState('')
  const [queryId, setQueryId] = useState(savedQueryId || '')
  const [step, setStep] = useState('config')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [preview, setPreview] = useState(null)
  const [syncMode, setSyncMode] = useState('merge')
  const [decrypting, setDecrypting] = useState(false)

  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    if (savedToken && uid) {
      setDecrypting(true)
      import('@/lib/crypto').then(({ decryptToken }) => {
        decryptToken(savedToken, uid).then(plain => {
          setToken(plain)
          setDecrypting(false)
        })
      }).catch(() => {
        setToken(savedToken)
        setDecrypting(false)
      })
    }
  }, [savedToken, uid])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleSync = useCallback(async () => {
    if (!token.trim() || !queryId.trim()) {
      setError(t('Ingresa tu token y Query ID.', 'Enter your token and Query ID.'))
      return
    }
    setSyncing(true)
    setError('')
    try {
      const { syncIBKR } = await import('@/lib/ibkrSync')
      const data = await syncIBKR(token.trim(), queryId.trim())
      setPreview(data)
      setStep('preview')

      if (onSaveCredentials && uid) {
        const { encryptToken } = await import('@/lib/crypto')
        const encrypted = await encryptToken(token.trim(), uid)
        onSaveCredentials({ ibkrToken: encrypted, ibkrQueryId: queryId.trim() })
      }
    } catch (err) {
      setError(err.message || t('Error conectando con IBKR.', 'Error connecting to IBKR.'))
    }
    setSyncing(false)
  }, [token, queryId, onSaveCredentials, uid, t])

  const handleConfirm = useCallback(async () => {
    if (!preview || !onSyncComplete) return
    setSyncing(true)
    setError('')
    try {
      await onSyncComplete(preview, syncMode)
      setResult({
        items: preview.items.length,
        transactions: preview.transactions.length,
        accounts: preview.accounts || [],
        syncedAt: preview.syncedAt,
        mode: syncMode,
      })
      setStep('done')
    } catch (err) {
      setError(err.message)
    }
    setSyncing(false)
  }, [preview, onSyncComplete, syncMode])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="ibkr-modal-title">
      <div className="bg-[#1e293b] border border-[#334155]/60 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#334155]/60">
          <h2 id="ibkr-modal-title" className="text-base font-semibold text-white">Interactive Brokers</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg transition-colors">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>
          )}

          {step === 'config' && (
            <div className="space-y-6">
              <div>
                <p className="text-sm text-white font-medium mb-1">{t('Configuración inicial', 'Initial setup')}</p>
                <p className="text-xs text-slate-500">
                  {t('Necesitas un Token y un Query ID de tu cuenta IBKR.',
                     'You need a Token and a Query ID from your IBKR account.')}
                </p>
              </div>

              <div className="space-y-5 pl-1">
                <div className="flex gap-4">
                  <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">1.</span>
                  <div>
                    <p className="text-xs text-white font-medium">{t('Crear el Flex Query', 'Create the Flex Query')}</p>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      <span className="text-blue-400 font-mono">interactivebrokers.com</span> → Performance & Reports → Flex Queries → {t('crear Activity Flex Query con', 'create Activity Flex Query with')} <span className="text-white">Open Positions</span> {t('y', 'and')} <span className="text-white">Trades</span>
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">2.</span>
                  <div>
                    <p className="text-xs text-white font-medium">{t('Generar el Token', 'Generate the Token')}</p>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      Settings → Account Settings → API → Flex Web Service → Create Token
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">3.</span>
                  <p className="text-xs text-white font-medium">{t('Pega ambos valores abajo', 'Paste both values below')}</p>
                </div>
              </div>

              <div className="border-t border-[#334155]/40 pt-5 space-y-4">
                <div>
                  <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 block">Token</label>
                  <input type="password" value={token} onChange={e => setToken(e.target.value)}
                    placeholder={decrypting ? t('Desencriptando...', 'Decrypting...') : t('Flex Web Service Token', 'Flex Web Service Token')}
                    disabled={decrypting}
                    className="w-full px-4 py-2.5 bg-[#0f172a] border border-[#334155]/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 font-mono" />
                </div>

                <div>
                  <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 block">Query ID</label>
                  <input type="text" value={queryId} onChange={e => setQueryId(e.target.value)}
                    placeholder={t('Ej: 123456', 'E.g.: 123456')}
                    className="w-full px-4 py-2.5 bg-[#0f172a] border border-[#334155]/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 font-mono" />
                </div>
              </div>

              <button onClick={handleSync} disabled={syncing || !token || !queryId || decrypting}
                className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-all text-sm font-medium flex items-center justify-center gap-2">
                {syncing ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {t('Conectando con IBKR...', 'Connecting to IBKR...')}
                  </>
                ) : t('Sincronizar', 'Sync')}
              </button>

              <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-600">
                <Lock size={10} />
                {t('Solo lectura · AES-256 · HTTPS', 'Read-only · AES-256 · HTTPS')}
              </p>
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-xs text-slate-400">
                  {t('Datos recibidos de IBKR', 'Data received from IBKR')}
                </span>
                {preview.accounts && preview.accounts.length > 0 && (
                  <span className="text-[11px] text-slate-600 font-mono ml-auto">
                    {preview.accounts.join(', ')}
                  </span>
                )}
              </div>

              {preview.items.length > 0 && (
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">
                    {preview.items.length} {t('posiciones', 'positions')}
                  </p>
                  <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-[#334155]/40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[11px] text-slate-500 border-b border-[#334155]/60 bg-[#0f172a]/50">
                          <th className="text-left py-2.5 px-3 font-normal">Symbol</th>
                          <th className="text-left py-2.5 px-3 font-normal">Name</th>
                          <th className="text-left py-2.5 px-3 font-normal">Type</th>
                          <th className="text-right py-2.5 px-3 font-normal">Qty</th>
                          <th className="text-right py-2.5 px-3 font-normal">Price</th>
                          <th className="text-right py-2.5 px-3 font-normal">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.items.map((item, i) => (
                          <tr key={i} className="border-b border-[#334155]/30 hover:bg-slate-700/20 transition-colors">
                            <td className="py-2.5 px-3 text-white font-medium">{item.symbol}</td>
                            <td className="py-2.5 px-3 text-slate-300 max-w-[150px] truncate">{item.name}</td>
                            <td className="py-2.5 px-3 text-slate-500">{item.type}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">{item.quantity.toLocaleString()}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">${(item.currentPrice ?? 0).toFixed(2)}</td>
                            <td className="py-2.5 px-3 text-right text-white font-medium">
                              ${((item.currentPrice || 0) * (item.quantity || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.transactions.length > 0 && (
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">
                    {preview.transactions.length} {t('transacciones', 'trades')}
                  </p>
                  <div className="overflow-x-auto max-h-36 overflow-y-auto rounded-lg border border-[#334155]/40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[11px] text-slate-500 border-b border-[#334155]/60 bg-[#0f172a]/50">
                          <th className="text-left py-2.5 px-3 font-normal">{t('Fecha', 'Date')}</th>
                          <th className="text-left py-2.5 px-3 font-normal">Symbol</th>
                          <th className="text-left py-2.5 px-3 font-normal">Type</th>
                          <th className="text-right py-2.5 px-3 font-normal">Qty</th>
                          <th className="text-right py-2.5 px-3 font-normal">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.transactions.slice(0, 20).map((tx, i) => (
                          <tr key={i} className="border-b border-[#334155]/30 hover:bg-slate-700/20 transition-colors">
                            <td className="py-2.5 px-3 text-slate-500">{tx.date}</td>
                            <td className="py-2.5 px-3 text-white">{tx.symbol}</td>
                            <td className={`py-2.5 px-3 font-medium ${tx.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{tx.type}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">{tx.quantity}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">${(tx.pricePerUnit ?? 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="border-t border-[#334155]/40 pt-5">
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">
                  {t('Modo de sincronización', 'Sync mode')}
                </p>
                <div className="space-y-1">
                  <label className={`flex items-start gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all ${syncMode === 'merge' ? 'border-l-2 border-l-blue-400 bg-blue-500/5' : 'border-l-2 border-l-transparent opacity-60 hover:opacity-80'}`}
                    onClick={() => setSyncMode('merge')}>
                    <input type="radio" name="syncMode" value="merge" checked={syncMode === 'merge'} onChange={() => setSyncMode('merge')}
                      className="mt-0.5 accent-blue-500" />
                    <div>
                      <p className="text-sm text-white font-medium">{t('Merge', 'Merge')}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {t('Actualiza existentes, agrega nuevas. Activos manuales intactos.',
                           'Updates existing, adds new. Manual assets untouched.')}
                      </p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all ${syncMode === 'replace' ? 'border-l-2 border-l-amber-400 bg-amber-500/5' : 'border-l-2 border-l-transparent opacity-60 hover:opacity-80'}`}
                    onClick={() => setSyncMode('replace')}>
                    <input type="radio" name="syncMode" value="replace" checked={syncMode === 'replace'} onChange={() => setSyncMode('replace')}
                      className="mt-0.5 accent-amber-500" />
                    <div>
                      <p className="text-sm text-white font-medium">{t('Reemplazar', 'Replace')}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {t('Elimina posiciones IBKR anteriores y reimporta. Activos manuales intactos.',
                           'Deletes previous IBKR positions and reimports. Manual assets untouched.')}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex gap-4 pt-1">
                <button onClick={() => setStep('config')}
                  className="flex-1 py-3 border border-[#334155]/60 text-slate-400 rounded-xl hover:bg-[#283548] hover:text-slate-200 transition-all text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={handleConfirm} disabled={syncing}
                  className="flex-1 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-all text-sm font-medium">
                  {syncing ? t('Importando...', 'Importing...') : t('Confirmar', 'Confirm')}
                </button>
              </div>
            </div>
          )}

          {step === 'done' && result && (
            <div className="text-center py-10">
              <CheckCircle size={36} strokeWidth={1.5} className="text-emerald-400 mx-auto mb-5" />
              <p className="text-white font-medium text-base mb-3">
                {t('Sincronización exitosa', 'Sync successful')}
              </p>
              <p className="text-slate-400 text-sm">
                {result.items} {t('posiciones', 'positions')}
                {result.transactions > 0 && <> · {result.transactions} {t('transacciones', 'trades')}</>}
                {result.accounts.length > 0 && <> · {result.accounts.join(', ')}</>}
              </p>
              <p className="text-[11px] text-slate-600 mt-2">
                {new Date(result.syncedAt).toLocaleString()}
              </p>
              <button onClick={onClose}
                className="mt-8 px-10 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-all text-sm font-medium">
                {t('Cerrar', 'Close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
