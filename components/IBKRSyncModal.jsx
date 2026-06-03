'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { CheckCircle, Lock, ChevronDown, ChevronUp, Upload } from 'lucide-react'
import { parseIBKRFile, formatIBKRFileResult } from '@/lib/parsers/ibkrFileParser'

function DoneStep({ result, onClose, t }) {
  const [countdown, setCountdown] = useState(2)

  useEffect(() => {
    if (countdown <= 0) { onClose(); return }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, onClose])

  return (
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
      {result.equityHistory > 0 && (
        <p className="text-emerald-400/80 text-xs mt-2">
          {result.equityHistory} {t('días de historial guardados', 'days of history saved')}
        </p>
      )}
      <p className="text-[11px] text-slate-600 mt-2">
        {new Date(result.syncedAt).toLocaleString()}
      </p>
      <button onClick={onClose}
        className="mt-8 px-10 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-all text-sm font-medium">
        {t('Cerrar', 'Close')} ({countdown}s)
      </button>
    </div>
  )
}

export default function IBKRSyncModal({ onClose, onSyncComplete, savedToken, savedQueryId, onSaveCredentials, lang = 'es', uid, lastSyncTime, existingItems = [], existingTransactions = [], existingSnapshots = [] }) {
  const [token, setToken] = useState('')
  const [queryId, setQueryId] = useState(savedQueryId || '')
  const [step, setStep] = useState('config')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [result, setResult] = useState(null)
  const [preview, setPreview] = useState(null)
  const [syncMode, setSyncMode] = useState('merge')
  const [decrypting, setDecrypting] = useState(false)
  const [showConfig, setShowConfig] = useState(!(savedToken && savedQueryId))
  const [showHistory, setShowHistory] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [pollProgress, setPollProgress] = useState(null)
  const [importMode, setImportMode] = useState('api')
  const [dragOver, setDragOver] = useState(false)
  const abortRef = useRef(null)
  const fileInputRef = useRef(null)
  const autoStartedRef = useRef(false)

  const ibkrHistory = useMemo(() => {
    const items = existingItems.filter(it => it._source === 'ibkr' || (it.institution || '').toLowerCase().includes('interactive brokers'))
    const txs = existingTransactions.filter(tx => tx._source === 'ibkr' || (tx.institution || '').toLowerCase().includes('interactive brokers'))
    const snaps = existingSnapshots.filter(s => s._source === 'ibkr')
    const allSnaps = [...existingSnapshots].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const totalValue = items.reduce((s, it) => {
      const v = (it.currentPrice || it.purchasePrice || 0) * (it.quantity || 1)
      return s + v
    }, 0)
    return { items, txs, snaps, allSnaps, totalValue }
  }, [existingItems, existingTransactions, existingSnapshots])

  const t = (es, en) => lang === 'es' ? es : en

  const lastSyncLabel = useMemo(() => {
    if (!lastSyncTime) return null
    const diff = Date.now() - new Date(lastSyncTime).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return t('hace un momento', 'just now')
    if (mins < 60) return `${t('hace', '')} ${mins}m ${lang === 'en' ? 'ago' : ''}`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${t('hace', '')} ${hrs}h ${lang === 'en' ? 'ago' : ''}`
    const days = Math.floor(hrs / 24)
    return `${t('hace', '')} ${days}d ${lang === 'en' ? 'ago' : ''}`
  }, [lastSyncTime, lang])

  const hasData = ibkrHistory.items.length > 0

  useEffect(() => {
    if (savedToken && uid) {
      setDecrypting(true)
      import('@/lib/crypto').then(({ decryptToken }) => {
        decryptToken(savedToken, uid).then(plain => {
          setToken(plain)
          setDecrypting(false)
        }).catch(() => {
          setToken('')
          setDecrypting(false)
        })
      }).catch(() => {
        setToken('')
        setDecrypting(false)
      })
    }
  }, [savedToken, uid])

  // Auto-start sync when credentials already exist
  useEffect(() => {
    if (autoStartedRef.current) return
    if (token && savedQueryId && !decrypting && step === 'config') {
      autoStartedRef.current = true
      handleSync()
    }
  }, [token, savedQueryId, decrypting]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const statusMessages = {
    requesting: t('Solicitando reporte a IBKR...', 'Requesting report from IBKR...'),
    'requesting-retry': t('IBKR está ocupado, reintentando...', 'IBKR is busy, retrying...'),
    polling: t('Esperando respuesta de IBKR...', 'Waiting for IBKR response...'),
    processing: t('Procesando datos...', 'Processing data...'),
    importing: t('Importando datos...', 'Importing data...'),
  }

  const handleSync = useCallback(async () => {
    if (!token.trim() || !queryId.trim()) {
      setError(t('Ingresa tu token y Query ID.', 'Enter your token and Query ID.'))
      setShowConfig(true)
      return
    }
    setSyncing(true)
    setError('')
    setErrorCode('')
    setSyncStatus('requesting')
    setPollProgress(null)
    setShowConfig(false)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const { syncIBKR } = await import('@/lib/ibkrSync')

      const data = await syncIBKR(token.trim(), queryId.trim(), {
        signal: controller.signal,
        onStatus: (status, current, total) => {
          setSyncStatus(status)
          if (current && total) setPollProgress({ current, total })
        },
      })

      if (onSaveCredentials && uid) {
        const { encryptToken } = await import('@/lib/crypto')
        const encrypted = await encryptToken(token.trim(), uid)
        onSaveCredentials({ ibkrToken: encrypted, ibkrQueryId: queryId.trim() })
      }

      if (syncMode === 'merge' && onSyncComplete) {
        // Skip preview for merge mode — go straight to done
        setSyncStatus('importing')
        await onSyncComplete(data, 'merge')
        setResult({
          items: data.items.length,
          transactions: data.transactions.length,
          equityHistory: (data.equityHistory || []).length,
          accounts: data.accounts || [],
          syncedAt: data.syncedAt,
          mode: 'merge',
        })
        setStep('done')
      } else {
        // Show preview for replace mode (destructive — needs confirmation)
        setPreview(data)
        setSyncMode('replace')
        setStep('preview')
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.errorCode === 'CANCELLED') {
        setError('')
        setShowConfig(true)
      } else {
        setError(err.message || t('Error conectando con IBKR.', 'Error connecting to IBKR.'))
        setErrorCode(err.errorCode || '')
        setShowConfig(true)
        if (ibkrHistory.items.length > 0) setShowHistory(true)
      }
    } finally {
      setSyncing(false)
      setSyncStatus('')
      setPollProgress(null)
      abortRef.current = null
    }
  }, [token, queryId, onSaveCredentials, onSyncComplete, uid, syncMode, t, ibkrHistory.items.length])

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
    }
  }, [])

  const handleFileImport = useCallback(async (file) => {
    if (!file) return
    setError('')
    setErrorCode('')
    setSyncing(true)

    try {
      const isCSV = file.name.toLowerCase().endsWith('.csv')
      let parsed

      if (isCSV) {
        const text = await file.text()
        parsed = parseIBKRFile(text)
      } else {
        const XLSX = (await import('xlsx')).default || await import('xlsx')
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const csv = XLSX.utils.sheet_to_csv(sheet)
        if (csv && (/,Header,/.test(csv) || /,Data,/.test(csv))) {
          parsed = parseIBKRFile(csv)
        } else {
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
          if (json.length < 2) throw new Error(t('Archivo vacío o sin datos', 'File is empty or has no data'))
          const headers = json[0].map(h => (h || '').toString().trim())
          const rows = json.slice(1).filter(r => r.some(c => c !== ''))
          parsed = parseIBKRFile(rows, headers)
        }
      }

      const data = formatIBKRFileResult(parsed)

      if (data.items.length === 0 && data.transactions.length === 0 && (data.equityHistory || []).length === 0) {
        throw new Error(t(
          'No se encontraron datos en el archivo. Descarga un reporte de Portfolio Analyst desde IBKR (Performance & Reports → PortfolioAnalyst → Reports → CSV).',
          'No data found in the file. Download a Portfolio Analyst report from IBKR (Performance & Reports → PortfolioAnalyst → Reports → CSV).'
        ))
      }

      setPreview(data)
      setStep('preview')
    } catch (err) {
      setError(err.message || t('Error leyendo archivo', 'Error reading file'))
    } finally {
      setSyncing(false)
    }
  }, [t])

  const handleFileDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFileImport(file)
  }, [handleFileImport])

  const handleFileSelect = useCallback((e) => {
    const file = e.target?.files?.[0]
    if (file) handleFileImport(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [handleFileImport])

  const handleConfirm = useCallback(async () => {
    if (!preview || !onSyncComplete) return
    setSyncing(true)
    setError('')
    setErrorCode('')
    try {
      await onSyncComplete(preview, syncMode)
      setResult({
        items: preview.items.length,
        transactions: preview.transactions.length,
        equityHistory: (preview.equityHistory || []).length,
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

  const errorHint = useMemo(() => {
    if (!errorCode) return null
    switch (errorCode) {
      case 'TOKEN_EXPIRED':
        return t(
          'Ve a IBKR → Settings → API → Flex Web Service y genera un nuevo Token.',
          'Go to IBKR → Settings → API → Flex Web Service and generate a new Token.'
        )
      case 'INVALID_QUERY':
        return t(
          'Ve a IBKR → Performance & Reports → Flex Queries y verifica que tu Query esté activo.',
          'Go to IBKR → Performance & Reports → Flex Queries and verify your Query is active.'
        )
      case 'RATE_LIMITED':
        return t(
          'IBKR limita las solicitudes. Espera 1-2 minutos antes de intentar de nuevo.',
          'IBKR rate-limits requests. Wait 1-2 minutes before trying again.'
        )
      case 'TIMEOUT':
        return t(
          'El servicio de IBKR está lento. Esto pasa a veces fuera de horario de mercado.',
          'IBKR service is slow. This sometimes happens outside market hours.'
        )
      case 'EMPTY_REPORT':
        return t(
          'Verifica que tu Flex Query incluya "Open Positions" y "Trades" en su configuración.',
          'Verify your Flex Query includes "Open Positions" and "Trades" in its configuration.'
        )
      default:
        return null
    }
  }, [errorCode, lang])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="ibkr-modal-title">
      <div className="bg-[#1C1C1E] border border-[#38383A]/60 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#38383A]/60">
          <div>
            <h2 id="ibkr-modal-title" className="text-base font-semibold text-white">Interactive Brokers</h2>
            {lastSyncLabel && (
              <p className="text-[10px] text-slate-500 mt-0.5">
                {t('Última sync:', 'Last sync:')} {lastSyncLabel}
                {hasData && <> · {ibkrHistory.items.length} {t('posiciones', 'positions')}</>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg transition-colors">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className={`mb-5 p-3 rounded-lg border ${hasData ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
              <p className={`text-sm ${hasData ? 'text-amber-300' : 'text-red-400'}`}>
                {hasData
                  ? t('No se pudo conectar con IBKR, pero tus datos están actualizados.',
                      'Couldn\'t connect to IBKR, but your data is up to date.')
                  : error}
              </p>
              {hasData && lastSyncLabel && (
                <p className="text-amber-400/60 text-xs mt-1">
                  {t('Última sincronización:', 'Last synced:')} {lastSyncLabel}
                </p>
              )}
              {!hasData && errorHint && (
                <p className="text-red-400/60 text-xs mt-1.5">{errorHint}</p>
              )}
              {!hasData && !errorHint && (errorCode === 'RATE_LIMITED' || error.toLowerCase().includes('try again')) && (
                <p className="text-red-400/60 text-xs mt-1.5">
                  {t('IBKR a veces tarda en generar reportes. Intenta de nuevo en unos minutos.',
                     'IBKR sometimes takes time to generate reports. Try again in a few minutes.')}
                </p>
              )}
              {!syncing && (
                <button onClick={handleSync} className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                  {t('Reintentar', 'Retry')} →
                </button>
              )}
            </div>
          )}

          {step === 'config' && !showConfig && syncing && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-400">
                {statusMessages[syncStatus] || t('Sincronizando con IBKR...', 'Syncing with IBKR...')}
              </p>
              {pollProgress && (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-48 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min((pollProgress.current / pollProgress.total) * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-600">
                    {t(`Esperando... ${pollProgress.current * 3}s`, `Waiting... ${pollProgress.current * 3}s`)}
                  </p>
                </div>
              )}
              <div className="flex items-center gap-3">
                <button onClick={() => setShowConfig(true)} className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
                  {t('Cambiar credenciales', 'Change credentials')}
                </button>
                <button onClick={handleCancel} className="text-xs text-red-500/60 hover:text-red-400 transition-colors">
                  {t('Cancelar', 'Cancel')}
                </button>
              </div>
            </div>
          )}

          {step === 'config' && !showConfig && decrypting && !syncing && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-400">
                {t('Desencriptando credenciales...', 'Decrypting credentials...')}
              </p>
            </div>
          )}

          {step === 'config' && (showConfig || (!syncing && !decrypting && !preview)) && (
            <div className="space-y-6">
              {/* Mode tabs: API Sync vs File Import */}
              <div className="flex bg-[#000000] rounded-lg border border-[#38383A] p-0.5">
                <button onClick={() => { setImportMode('api'); setError(''); setErrorCode('') }}
                  className={`flex-1 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    importMode === 'api' ? 'bg-[#1C1C1E] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  <Lock size={11} />
                  {t('Sync automático', 'Auto sync')}
                </button>
                <button onClick={() => { setImportMode('file'); setError(''); setErrorCode('') }}
                  className={`flex-1 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    importMode === 'file' ? 'bg-[#1C1C1E] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  <Upload size={11} />
                  {t('Importar archivo', 'Import file')}
                </button>
              </div>

              {importMode === 'api' && (
                <>
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

              <div className="border-t border-[#38383A]/40 pt-5 space-y-4">
                <div>
                  <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 block">Token</label>
                  <input type="password" value={token} onChange={e => setToken(e.target.value)}
                    placeholder={decrypting ? t('Desencriptando...', 'Decrypting...') : t('Flex Web Service Token', 'Flex Web Service Token')}
                    disabled={decrypting}
                    className={`w-full px-4 py-2.5 bg-[#000000] border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 font-mono ${errorCode === 'TOKEN_EXPIRED' ? 'border-red-500/60' : 'border-[#38383A]/60'}`} />
                  {errorCode === 'TOKEN_EXPIRED' && (
                    <p className="text-[10px] text-red-400 mt-1">{t('Este token expiró o es inválido.', 'This token has expired or is invalid.')}</p>
                  )}
                </div>

                <div>
                  <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 block">Query ID</label>
                  <input type="text" value={queryId} onChange={e => setQueryId(e.target.value)}
                    placeholder={t('Ej: 123456', 'E.g.: 123456')}
                    className={`w-full px-4 py-2.5 bg-[#000000] border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50 font-mono ${errorCode === 'INVALID_QUERY' ? 'border-red-500/60' : 'border-[#38383A]/60'}`} />
                  {errorCode === 'INVALID_QUERY' && (
                    <p className="text-[10px] text-red-400 mt-1">{t('Este Query ID no existe o no está activo.', 'This Query ID does not exist or is not active.')}</p>
                  )}
                </div>
              </div>

              {/* IBKR imported history */}
              {ibkrHistory.items.length > 0 && (
                <div className="border-t border-[#38383A]/40 pt-4">
                  <button type="button" onClick={() => setShowHistory(h => !h)}
                    className="w-full flex items-center justify-between text-left group">
                    <div>
                      <p className="text-[11px] text-slate-500 uppercase tracking-wider">{t('Historial importado', 'Imported history')}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {ibkrHistory.items.length} {t('posiciones', 'positions')}
                        {ibkrHistory.txs.length > 0 && <> · {ibkrHistory.txs.length} {t('transacciones', 'trades')}</>}
                        {ibkrHistory.snaps.length > 0 && <> · {ibkrHistory.snaps.length} {t('días NAV', 'NAV days')}</>}
                      </p>
                    </div>
                    <span className="text-slate-500 group-hover:text-slate-300 transition-colors">
                      {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </button>

                  {showHistory && (
                    <div className="mt-3 space-y-3">
                      <div className="overflow-x-auto max-h-40 overflow-y-auto rounded-lg border border-[#38383A]/40">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[10px] text-slate-500 border-b border-[#38383A]/60 bg-[#000000]/50 sticky top-0">
                              <th className="text-left py-2 px-2.5 font-normal">Symbol</th>
                              <th className="text-left py-2 px-2.5 font-normal">{t('Tipo', 'Type')}</th>
                              <th className="text-right py-2 px-2.5 font-normal">{t('Cant', 'Qty')}</th>
                              <th className="text-right py-2 px-2.5 font-normal">{t('Valor', 'Value')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ibkrHistory.items
                              .sort((a, b) => Math.abs((b.currentPrice || b.purchasePrice || 0) * (b.quantity || 1)) - Math.abs((a.currentPrice || a.purchasePrice || 0) * (a.quantity || 1)))
                              .map((it, i) => {
                                const val = (it.currentPrice || it.purchasePrice || 0) * (it.quantity || 1)
                                return (
                                  <tr key={i} className="border-b border-[#38383A]/20 hover:bg-slate-700/20">
                                    <td className="py-1.5 px-2.5 text-white font-medium">{it.symbol || it.name}</td>
                                    <td className="py-1.5 px-2.5 text-slate-500">{it.type}</td>
                                    <td className="py-1.5 px-2.5 text-right text-slate-400">{(it.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                    <td className={`py-1.5 px-2.5 text-right font-medium ${val < 0 ? 'text-red-400' : 'text-white'}`}>
                                      ${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </td>
                                  </tr>
                                )
                              })}
                          </tbody>
                        </table>
                      </div>

                      {ibkrHistory.snaps.length > 0 && (
                        <div className="bg-[#000000]/50 rounded-lg p-2.5 text-xs text-slate-400">
                          <span className="text-slate-500">{t('NAV historial:', 'NAV history:')}</span>{' '}
                          {ibkrHistory.snaps[0].date} → {ibkrHistory.snaps[ibkrHistory.snaps.length - 1].date}
                        </div>
                      )}

                      <p className="text-xs text-slate-500">
                        {t('Total:', 'Total:')} <span className="text-white font-medium">${ibkrHistory.totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}

              <button onClick={handleSync} disabled={syncing || !token || !queryId || decrypting}
                className="w-full py-3 text-white rounded-xl disabled:opacity-50 transition-all text-sm font-medium flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500">
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
                </>
              )}

              {importMode === 'file' && (
                <>
                  <div>
                    <p className="text-sm text-white font-medium mb-1">{t('Importar desde archivo', 'Import from file')}</p>
                    <p className="text-xs text-slate-500">
                      {t('Sube un reporte CSV exportado de Portfolio Analyst de IBKR.',
                         'Upload a CSV report exported from IBKR Portfolio Analyst.')}
                    </p>
                  </div>

                  <div className="space-y-5 pl-1">
                    <div className="flex gap-4">
                      <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">1.</span>
                      <div>
                        <p className="text-xs text-white font-medium">{t('Abrir Portfolio Analyst', 'Open Portfolio Analyst')}</p>
                        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                          <span className="text-blue-400 font-mono">interactivebrokers.com</span> → <span className="text-white">Performance & Reports</span> → <span className="text-white">PortfolioAnalyst</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">2.</span>
                      <div>
                        <p className="text-xs text-white font-medium">{t('Descargar reporte', 'Download report')}</p>
                        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                          {t('Ve a la pestaña', 'Go to the')} <span className="text-white">Reports</span> → {t('elige un periodo (ej: Year to Date) y haz clic en el ícono de CSV', 'choose a period (e.g. Year to Date) and click the CSV icon')} <span className="text-white">📄</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">3.</span>
                      <p className="text-xs text-white font-medium">{t('Arrastra o selecciona el archivo abajo', 'Drag or select the file below')}</p>
                    </div>
                  </div>

                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} className="hidden" />

                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                      dragOver
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-[#38383A] hover:border-slate-500 hover:bg-[#2C2C2E]/30'
                    }`}>
                    {syncing ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-sm text-slate-400">{t('Procesando archivo...', 'Processing file...')}</p>
                      </div>
                    ) : (
                      <>
                        <Upload size={24} className="mx-auto text-slate-500 mb-3" />
                        <p className="text-sm text-slate-300 font-medium">
                          {t('Arrastra tu archivo aquí', 'Drag your file here')}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {t('o haz clic para seleccionar', 'or click to browse')}
                        </p>
                        <p className="text-[10px] text-slate-600 mt-3">CSV, XLSX, XLS · Max 5MB</p>
                      </>
                    )}
                  </div>

                  <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg p-3">
                    <p className="text-[11px] text-blue-400/80">
                      {t('Configura el sync automático (pestaña izquierda) para mantener tus datos actualizados sin subir archivos.',
                         'Set up auto sync (left tab) to keep your data updated without uploading files.')}
                    </p>
                  </div>

                </>
              )}
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

              {/* Sync mode selector — shown first for visibility */}
              <div className="bg-[#000000]/50 rounded-xl p-4 border border-[#38383A]/40">
                <p className="text-xs text-white font-medium mb-3">
                  {t('¿Cómo importar?', 'How to import?')}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setSyncMode('merge')}
                    className={`px-4 py-3 rounded-lg text-left transition-all border-2 ${syncMode === 'merge' ? 'border-blue-500 bg-blue-500/10' : 'border-[#38383A] hover:border-slate-500'}`}>
                    <p className="text-sm text-white font-medium">🔄 {t('Actualizar', 'Update')}</p>
                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                      {t('Actualiza precios y cantidades de posiciones existentes. Agrega nuevas posiciones. No borra nada.',
                         'Updates prices and quantities for existing positions. Adds new ones. Deletes nothing.')}
                    </p>
                  </button>
                  <button onClick={() => setSyncMode('replace')}
                    className={`px-4 py-3 rounded-lg text-left transition-all border-2 ${syncMode === 'replace' ? 'border-red-500 bg-red-500/10' : 'border-[#38383A] hover:border-slate-500'}`}>
                    <p className="text-sm text-white font-medium">♻️ {t('Sustituir todo', 'Replace all')}</p>
                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                      {t('Borra TODAS las posiciones de IBKR anteriores y reimporta desde cero. Útil si hay errores.',
                         'Deletes ALL previous IBKR positions and reimports from scratch. Useful to fix errors.')}
                    </p>
                  </button>
                </div>
                <p className="text-[10px] text-slate-600 mt-2">
                  {t('El historial de transacciones y NAV se importa siempre (no se duplica).',
                     'Transaction history and NAV are always imported (no duplicates).')}
                </p>
              </div>

              {preview.items.length > 0 && (
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">
                    {preview.items.length} {t('posiciones', 'positions')}
                  </p>
                  <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-[#38383A]/40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[11px] text-slate-500 border-b border-[#38383A]/60 bg-[#000000]/50">
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
                          <tr key={i} className="border-b border-[#38383A]/30 hover:bg-slate-700/20 transition-colors">
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
                  <div className="overflow-x-auto max-h-36 overflow-y-auto rounded-lg border border-[#38383A]/40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[11px] text-slate-500 border-b border-[#38383A]/60 bg-[#000000]/50">
                          <th className="text-left py-2.5 px-3 font-normal">{t('Fecha', 'Date')}</th>
                          <th className="text-left py-2.5 px-3 font-normal">Symbol</th>
                          <th className="text-left py-2.5 px-3 font-normal">Type</th>
                          <th className="text-right py-2.5 px-3 font-normal">Qty</th>
                          <th className="text-right py-2.5 px-3 font-normal">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.transactions.slice(0, 20).map((tx, i) => (
                          <tr key={i} className="border-b border-[#38383A]/30 hover:bg-slate-700/20 transition-colors">
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

              {(preview.equityHistory || []).length > 0 && (
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">
                    {(preview.equityHistory || []).length} {t('días de historial NAV', 'days of NAV history')}
                  </p>
                  <p className="text-xs text-slate-400">
                    {preview.equityHistory[0].date} → {preview.equityHistory[preview.equityHistory.length - 1].date}
                  </p>
                </div>
              )}

              <div className="flex gap-4 pt-1">
                <button onClick={() => setStep('config')}
                  className="flex-1 py-3 border border-[#38383A]/60 text-slate-400 rounded-xl hover:bg-[#2C2C2E] hover:text-slate-200 transition-all text-sm">
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
            <DoneStep result={result} onClose={onClose} t={t} />
          )}
        </div>
      </div>
    </div>
  )
}
