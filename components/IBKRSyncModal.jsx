'use client'

import { useState, useEffect, useCallback } from 'react'

export default function IBKRSyncModal({ onClose, onSyncComplete, savedToken, savedQueryId, onSaveCredentials, lang = 'es' }) {
  const [token, setToken] = useState(savedToken || '')
  const [queryId, setQueryId] = useState(savedQueryId || '')
  const [step, setStep] = useState('config')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [preview, setPreview] = useState(null)

  const t = (es, en) => lang === 'es' ? es : en

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

      if (onSaveCredentials) {
        onSaveCredentials({ ibkrToken: token.trim(), ibkrQueryId: queryId.trim() })
      }
    } catch (err) {
      setError(err.message || t('Error conectando con IBKR.', 'Error connecting to IBKR.'))
    }
    setSyncing(false)
  }, [token, queryId, onSaveCredentials, t])

  const handleConfirm = useCallback(async () => {
    if (!preview || !onSyncComplete) return
    setSyncing(true)
    setError('')
    try {
      await onSyncComplete(preview)
      setResult({
        items: preview.items.length,
        transactions: preview.transactions.length,
        syncedAt: preview.syncedAt,
      })
      setStep('done')
    } catch (err) {
      setError(err.message)
    }
    setSyncing(false)
  }, [preview, onSyncComplete])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
          <div className="flex items-center gap-2">
            <span className="text-orange-400 text-lg font-bold">IBKR</span>
            <h2 className="text-lg font-bold text-white">{t('Sincronizar Interactive Brokers', 'Sync Interactive Brokers')}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>
          )}

          {step === 'config' && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-xs text-blue-400 font-medium mb-2">{t('¿Cómo configurar?', 'How to set up?')}</p>
                <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
                  <li>{t('Inicia sesión en IBKR Account Management', 'Log in to IBKR Account Management')}</li>
                  <li>{t('Ve a Performance & Reports → Flex Queries', 'Go to Performance & Reports → Flex Queries')}</li>
                  <li>{t('Crea un Activity Flex Query con Open Positions y Trades', 'Create an Activity Flex Query with Open Positions and Trades')}</li>
                  <li>{t('En Settings → API, genera un Flex Web Service Token', 'In Settings → API, generate a Flex Web Service Token')}</li>
                  <li>{t('Copia el token y el Query ID aquí abajo', 'Copy the token and Query ID below')}</li>
                </ol>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Flex Web Service Token *</label>
                <input type="password" value={token} onChange={e => setToken(e.target.value)}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 font-mono" />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Flex Query ID *</label>
                <input type="text" value={queryId} onChange={e => setQueryId(e.target.value)}
                  placeholder="123456"
                  className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 font-mono" />
              </div>

              <button onClick={handleSync} disabled={syncing || !token || !queryId}
                className="w-full py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-500 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                {syncing ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {t('Conectando con IBKR...', 'Connecting to IBKR...')}
                  </>
                ) : t('Sincronizar', 'Sync Now')}
              </button>

              <p className="text-[10px] text-slate-600 text-center">
                {t('Tu token se guarda localmente en Firestore. Nunca compartimos tus credenciales.',
                   'Your token is saved locally in Firestore. We never share your credentials.')}
              </p>
            </div>
          )}

          {step === 'preview' && preview && (
            <div>
              <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <span className="text-emerald-400 text-xs font-medium">
                  {t('Datos recibidos de IBKR', 'Data received from IBKR')}
                </span>
              </div>

              {preview.items.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-white mb-2">
                    {t(`${preview.items.length} posiciones`, `${preview.items.length} positions`)}
                  </h3>
                  <div className="overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-[#334155] sticky top-0 bg-[#1e293b]">
                          <th className="text-left py-2 px-2">Symbol</th>
                          <th className="text-left py-2 px-2">Name</th>
                          <th className="text-left py-2 px-2">Type</th>
                          <th className="text-right py-2 px-2">Qty</th>
                          <th className="text-right py-2 px-2">Price</th>
                          <th className="text-right py-2 px-2">P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.items.map((item, i) => (
                          <tr key={i} className="border-b border-[#334155]/50">
                            <td className="py-1.5 px-2 text-emerald-400 font-medium">{item.symbol}</td>
                            <td className="py-1.5 px-2 text-white max-w-[150px] truncate">{item.name}</td>
                            <td className="py-1.5 px-2 text-slate-400">{item.type}</td>
                            <td className="py-1.5 px-2 text-right text-slate-300">{item.quantity.toLocaleString()}</td>
                            <td className="py-1.5 px-2 text-right text-slate-300">${item.currentPrice.toFixed(2)}</td>
                            <td className={`py-1.5 px-2 text-right font-medium ${item._ibkrUnrealizedPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {item._ibkrUnrealizedPL >= 0 ? '+' : ''}{item._ibkrUnrealizedPL.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview.transactions.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-white mb-2">
                    {t(`${preview.transactions.length} transacciones recientes`, `${preview.transactions.length} recent trades`)}
                  </h3>
                  <div className="overflow-x-auto max-h-36 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-[#334155] sticky top-0 bg-[#1e293b]">
                          <th className="text-left py-2 px-2">{t('Fecha', 'Date')}</th>
                          <th className="text-left py-2 px-2">Symbol</th>
                          <th className="text-left py-2 px-2">Type</th>
                          <th className="text-right py-2 px-2">Qty</th>
                          <th className="text-right py-2 px-2">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.transactions.slice(0, 20).map((tx, i) => (
                          <tr key={i} className="border-b border-[#334155]/50">
                            <td className="py-1.5 px-2 text-slate-400">{tx.date}</td>
                            <td className="py-1.5 px-2 text-white">{tx.symbol}</td>
                            <td className={`py-1.5 px-2 font-medium ${tx.type === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{tx.type}</td>
                            <td className="py-1.5 px-2 text-right text-slate-300">{tx.quantity}</td>
                            <td className="py-1.5 px-2 text-right text-slate-300">${tx.pricePerUnit.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg mb-4">
                <p className="text-xs text-amber-400">
                  {t('Las posiciones existentes con el mismo símbolo serán actualizadas. Las nuevas serán agregadas.',
                     'Existing positions with the same symbol will be updated. New ones will be added.')}
                </p>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('config')}
                  className="flex-1 py-2.5 border border-[#334155] text-slate-300 rounded-lg hover:bg-[#283548] transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={handleConfirm} disabled={syncing}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
                  {syncing ? t('Importando...', 'Importing...') : t('Confirmar e Importar', 'Confirm & Import')}
                </button>
              </div>
            </div>
          )}

          {step === 'done' && result && (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">🎉</div>
              <p className="text-white font-semibold text-lg mb-2">
                {t('Sincronización exitosa', 'Sync successful')}
              </p>
              <p className="text-slate-400 text-sm">
                {result.items} {t('posiciones', 'positions')}
                {result.transactions > 0 && <>, {result.transactions} {t('transacciones', 'trades')}</>}
              </p>
              <p className="text-xs text-slate-600 mt-2">
                {t('Sincronizado:', 'Synced:')} {new Date(result.syncedAt).toLocaleString()}
              </p>
              <button onClick={onClose}
                className="mt-6 px-8 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium">
                {t('Cerrar', 'Close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
