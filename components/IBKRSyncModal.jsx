'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle } from 'lucide-react'

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
      <div className="bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-lg font-bold">IBKR</span>
            <h2 id="ibkr-modal-title" className="text-lg font-bold text-white">{t('Sincronizar Interactive Brokers', 'Sync Interactive Brokers')}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>
          )}

          {step === 'config' && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-3">
                <p className="text-sm text-blue-400 font-semibold">{t('Configuración inicial (solo una vez)', 'One-time setup')}</p>
                <p className="text-xs text-slate-400">
                  {t('Necesitas dos datos de tu cuenta IBKR: un Token y un Query ID. Sigue estos pasos:',
                     'You need two pieces from your IBKR account: a Token and a Query ID. Follow these steps:')}
                </p>

                <div className="space-y-3">
                  <div className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center">1</span>
                    <div>
                      <p className="text-xs text-white font-medium">{t('Crear el Flex Query (reporte automático)', 'Create the Flex Query (automatic report)')}</p>
                      <ol className="text-[11px] text-slate-400 mt-1 space-y-0.5 list-disc list-inside">
                        <li>{t('Inicia sesión en', 'Log in to')} <span className="text-blue-400 font-mono">interactivebrokers.com</span> → {t('Portal del Cliente', 'Client Portal')}</li>
                        <li>{t('Menú', 'Menu')} → <span className="text-white">Performance & Reports</span> → <span className="text-white">Flex Queries</span></li>
                        <li>{t('Click en', 'Click')} <span className="text-white">&quot;+&quot;</span> {t('para crear una nueva Activity Flex Query', 'to create a new Activity Flex Query')}</li>
                        <li>{t('En secciones, selecciona', 'In sections, select')} <span className="text-white font-medium">Open Positions</span> {t('y', 'and')} <span className="text-white font-medium">Trades</span></li>
                        <li>{t('Guarda y anota el', 'Save and note the')} <span className="text-white font-medium">Query ID</span> {t('(número que aparece junto al nombre)', '(number shown next to the name)')}</li>
                      </ol>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center">2</span>
                    <div>
                      <p className="text-xs text-white font-medium">{t('Generar el Token de acceso', 'Generate the access Token')}</p>
                      <ol className="text-[11px] text-slate-400 mt-1 space-y-0.5 list-disc list-inside">
                        <li>{t('En el Portal, ve a', 'In the Portal, go to')} <span className="text-white">Settings</span> → <span className="text-white">Account Settings</span></li>
                        <li>{t('Busca la sección', 'Find the section')} <span className="text-white">&quot;API&quot;</span> → <span className="text-white">Flex Web Service</span></li>
                        <li>{t('Click en', 'Click')} <span className="text-white">&quot;Create Token&quot;</span></li>
                        <li>{t('Copia el', 'Copy the')} <span className="text-white font-medium">Token</span> {t('generado (cadena larga de letras y números)', 'generated (long string of letters and numbers)')}</li>
                      </ol>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-xs font-bold flex items-center justify-center">3</span>
                    <div>
                      <p className="text-xs text-white font-medium">{t('Pega ambos valores aquí abajo y sincroniza', 'Paste both values below and sync')}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Security info */}
              <div className="p-3 bg-slate-700/30 border border-[#334155] rounded-lg">
                <p className="text-xs text-slate-300 font-medium mb-1">{t('Seguridad', 'Security')}</p>
                <ul className="text-[11px] text-slate-400 space-y-0.5 list-disc list-inside">
                  <li>{t('El token de Flex es solo lectura — NO puede ejecutar órdenes ni transferir dinero',
                         'The Flex token is read-only — it CANNOT execute trades or transfer money')}</li>
                  <li>{t('Tu token se encripta (AES-256) antes de guardarse',
                         'Your token is encrypted (AES-256) before being saved')}</li>
                  <li>{t('La conexión es directa a IBKR vía nuestro servidor seguro (HTTPS)',
                         'Connection is direct to IBKR via our secure server (HTTPS)')}</li>
                </ul>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Token *</label>
                <input type="password" value={token} onChange={e => setToken(e.target.value)}
                  placeholder={decrypting ? t('Desencriptando...', 'Decrypting...') : t('Pega tu Flex Web Service Token aquí', 'Paste your Flex Web Service Token here')}
                  disabled={decrypting}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 font-mono" />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">Query ID *</label>
                <input type="text" value={queryId} onChange={e => setQueryId(e.target.value)}
                  placeholder={t('Ej: 123456', 'E.g.: 123456')}
                  className="w-full px-3 py-2 bg-[#0f172a] border border-[#334155] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 font-mono" />
              </div>

              <button onClick={handleSync} disabled={syncing || !token || !queryId || decrypting}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                {syncing ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {t('Conectando con IBKR (puede tomar ~15 segundos)...', 'Connecting to IBKR (may take ~15 seconds)...')}
                  </>
                ) : t('Sincronizar', 'Sync Now')}
              </button>

              <p className="text-[10px] text-slate-600 text-center">
                {t('Tu token se encripta y solo tú puedes ver tus datos. La sincronización tarda ~15 segundos.',
                   'Your token is encrypted and only you can see your data. Sync takes ~15 seconds.')}
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

              {/* Account info */}
              {preview.accounts && preview.accounts.length > 0 && (
                <div className="mb-4 p-3 bg-slate-700/30 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">
                    {t('Cuentas detectadas:', 'Accounts detected:')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {preview.accounts.map(acc => (
                      <span key={acc} className="text-xs font-mono px-2 py-1 bg-slate-700 text-slate-300 rounded">
                        {acc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

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
                          <th className="text-right py-2 px-2">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.items.map((item, i) => (
                          <tr key={i} className="border-b border-[#334155]/50">
                            <td className="py-1.5 px-2 text-white font-medium">{item.symbol}</td>
                            <td className="py-1.5 px-2 text-white max-w-[150px] truncate">{item.name}</td>
                            <td className="py-1.5 px-2 text-slate-400">{item.type}</td>
                            <td className="py-1.5 px-2 text-right text-slate-300">{item.quantity.toLocaleString()}</td>
                            <td className="py-1.5 px-2 text-right text-slate-300">${(item.currentPrice ?? 0).toFixed(2)}</td>
                            <td className="py-1.5 px-2 text-right font-medium text-slate-300">
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
                            <td className="py-1.5 px-2 text-right text-slate-300">${(tx.pricePerUnit ?? 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sync mode selection */}
              <div className="p-4 bg-slate-700/20 border border-[#334155] rounded-lg mb-4">
                <p className="text-sm text-white font-medium mb-3">
                  {t('Modo de sincronización', 'Sync mode')}
                </p>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${syncMode === 'merge' ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-slate-700/20 border border-transparent hover:bg-slate-700/40'}`}>
                    <input type="radio" name="syncMode" value="merge" checked={syncMode === 'merge'} onChange={() => setSyncMode('merge')}
                      className="mt-0.5 accent-blue-500" />
                    <div>
                      <p className="text-sm text-white font-medium">{t('Merge (recomendado)', 'Merge (recommended)')}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t('Actualiza posiciones existentes de IBKR y agrega las nuevas. Tus activos manuales no se tocan.',
                           'Updates existing IBKR positions and adds new ones. Your manual assets are untouched.')}
                      </p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${syncMode === 'replace' ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-slate-700/20 border border-transparent hover:bg-slate-700/40'}`}>
                    <input type="radio" name="syncMode" value="replace" checked={syncMode === 'replace'} onChange={() => setSyncMode('replace')}
                      className="mt-0.5 accent-amber-500" />
                    <div>
                      <p className="text-sm text-white font-medium">{t('Reemplazar', 'Replace')}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t('Elimina todas las posiciones de IBKR anteriores y las reimporta. Tus activos manuales no se tocan.',
                           'Deletes all previous IBKR positions and reimports them. Your manual assets are untouched.')}
                      </p>
                    </div>
                  </label>
                </div>
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
              <CheckCircle size={48} className="text-emerald-400 mx-auto mb-4" />
              <p className="text-white font-semibold text-lg mb-2">
                {t('Sincronización exitosa', 'Sync successful')}
              </p>
              <p className="text-slate-400 text-sm">
                {result.items} {t('posiciones', 'positions')}
                {result.transactions > 0 && <>, {result.transactions} {t('transacciones', 'trades')}</>}
                {result.accounts.length > 0 && (
                  <span className="block text-xs text-slate-500 mt-1">
                    {t('Cuentas:', 'Accounts:')} {result.accounts.join(', ')}
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {t('Modo:', 'Mode:')} {result.mode === 'merge' ? t('Merge', 'Merge') : t('Reemplazar', 'Replace')}
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
