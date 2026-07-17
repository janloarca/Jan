'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { CheckCircle, Lock, ChevronDown, ChevronUp, Upload, RefreshCw } from 'lucide-react'
import { parseIBKRFile, formatIBKRFileResult } from '@/lib/parsers/ibkrFileParser'
import { authFetch } from '@/lib/authFetch'

// Real-phase stepper: shows which of the 4 sync phases is running instead of a
// time-based bar that fills at a fixed rate regardless of IBKR's actual state.
function SyncStepper({ syncStatus, pollProgress, t }) {
  const phases = [
    { keys: ['requesting', 'requesting-retry'], label: t('Solicitando', 'Requesting') },
    { keys: ['polling'], label: t('Generando', 'Generating') },
    { keys: ['processing'], label: t('Procesando', 'Processing') },
    { keys: ['importing'], label: t('Importando', 'Importing') },
  ]
  const activeIdx = Math.max(0, phases.findIndex(p => p.keys.includes(syncStatus)))
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-1">
        {phases.map((p, i) => (
          <div key={p.label} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{
                backgroundColor: i < activeIdx ? 'var(--accent-green)' : i === activeIdx ? 'var(--accent-blue)' : 'rgba(100,116,139,0.4)',
                ...(i === activeIdx ? { boxShadow: '0 0 0 3px rgba(59,130,246,0.2)' } : {}),
              }} />
              <span className="text-[10px]" style={{ color: i === activeIdx ? 'var(--accent-blue)' : 'var(--text-muted)' }}>{p.label}</span>
            </div>
            {i < phases.length - 1 && <div className="w-8 h-px mb-4" style={{ backgroundColor: i < activeIdx ? 'var(--accent-green)' : 'rgba(100,116,139,0.3)' }} />}
          </div>
        ))}
      </div>
      {pollProgress && syncStatus === 'polling' && (
        <p className="text-xs text-slate-600">
          {t(`Esperando a IBKR... ${pollProgress.current * 3}s`, `Waiting for IBKR... ${pollProgress.current * 3}s`)}
        </p>
      )}
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {t('Puede tardar hasta ~90s, sobre todo fuera de horario de mercado.', 'Can take up to ~90s, especially outside market hours.')}
      </p>
    </div>
  )
}

function DoneStep({ result, onClose, t }) {
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    if (countdown <= 0) { onClose(); return }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, onClose])

  return (
    <div className="text-center py-10">
      <CheckCircle size={36} strokeWidth={1.5} className="text-[var(--accent-green)] mx-auto mb-5" />
      <p className="text-white font-medium text-base mb-3">
        {t('Sincronización exitosa', 'Sync successful')}
      </p>
      <p className="text-slate-400 text-sm">
        {result.items} {t('posiciones', 'positions')}
        {result.transactions > 0 && <> · {result.transactions} {t('transacciones', 'trades')}</>}
        {result.accounts.length > 0 && <> · {result.accounts.join(', ')}</>}
      </p>
      {result.equityHistory > 1 && (
        <p className="text-[var(--accent-green)] opacity-80 text-xs mt-2">
          {result.equityHistory} {t('días de historial guardados', 'days of history saved')}
        </p>
      )}
      {result.items > 0 && result.equityHistory <= 1 && (
        <p className="text-xs mt-3 mx-auto max-w-xs leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
          {t('Importamos tus posiciones, pero tu Flex Query no incluye "Equity Summary" (historial de valor). Por eso tus retornos y la gráfica arrancan desde hoy. Agrégala a tu Flex Query y vuelve a sincronizar.',
             'We imported your positions, but your Flex Query has no "Equity Summary" (value history). That is why your returns and chart start from today. Add it to your Flex Query and sync again.')}
        </p>
      )}
      {/* History present but SHORT: the query period truncates it, so YTD can't
          match the broker. Same actionable fix: widen the period, re-sync. */}
      {result.items > 0 && result.equityHistory > 1 && result.equityOldest
        && new Date(result.equityOldest).getTime() > Date.UTC(new Date().getUTCFullYear(), 0, 1) + 45 * 86400000 && (
        <p className="text-xs mt-3 mx-auto max-w-xs leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
          {t(`Tu historial de valor empieza el ${result.equityOldest}. Para que tu retorno del año cuadre con IBKR, pon el período de tu Flex Query en "Year to Date" (o "Last 365 Days") y vuelve a sincronizar.`,
             `Your value history starts on ${result.equityOldest}. For your yearly return to match IBKR, set your Flex Query period to "Year to Date" (or "Last 365 Days") and sync again.`)}
        </p>
      )}
      {result.partial && (
        <p className="text-xs mt-2" style={{ color: 'var(--alert-warn-icon)' }}>
          {t('Importación parcial: algunos registros no se guardaron. Sincroniza de nuevo para completar.',
             'Partial import: some records were not saved. Sync again to complete.')}
        </p>
      )}
      <p className="text-xs text-slate-600 mt-2">
        {new Date(result.syncedAt).toLocaleString()}
      </p>
      <button onClick={onClose}
        className="mt-8 px-10 py-3 rounded-xl hover:opacity-90 transition-all text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
        {t('Cerrar', 'Close')} ({countdown}s)
      </button>
    </div>
  )
}

export default function IBKRSyncModal({ onClose, onSyncComplete, savedToken, savedQueryId, onSaveCredentials, onApiSyncSuccess, onDisconnect, lang = 'es', uid, lastSyncTime, existingItems = [], existingTransactions = [], existingSnapshots = [] }) {
  const trapRef = useFocusTrap()
  const isConnected = !!(savedToken && savedQueryId)
  const [token, setToken] = useState('')
  const [queryId, setQueryId] = useState(savedQueryId || '')
  const [step, setStep] = useState(isConnected ? 'connected' : 'config')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [result, setResult] = useState(null)
  const [preview, setPreview] = useState(null)
  const [syncMode, setSyncMode] = useState('merge')
  const [decrypting, setDecrypting] = useState(false)
  // True when the Flex token lives in the server-side vault (settings/ibkr), so a
  // sync can run with '__stored__' without the client ever handling the token.
  const [hasVaultCreds, setHasVaultCreds] = useState(false)
  const [showConfig, setShowConfig] = useState(!isConnected)
  const [showHistory, setShowHistory] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')
  const [pollProgress, setPollProgress] = useState(null)
  const [importMode, setImportMode] = useState('api')
  const [dragOver, setDragOver] = useState(false)
  const [importProgress, setImportProgress] = useState(null)
  const [selectedAccounts, setSelectedAccounts] = useState(null)
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
    const accounts = [...new Set(items.map(it => it._ibkrAccountId).filter(Boolean))].sort()
    return { items, txs, snaps, allSnaps, totalValue, accounts }
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
      // Legacy client-encrypted token still present: decrypt to pre-fill.
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
    } else if (uid) {
      // No legacy token: check the server vault (credentials migrated / saved there).
      let cancelled = false
      authFetch('/api/brokers/ibkr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-credentials' }),
      }).then(r => r.json()).then(d => {
        if (cancelled) return
        setHasVaultCreds(!!d?.hasToken)
        if (d?.flexQueryId) setQueryId(prev => prev || d.flexQueryId)
      }).catch(() => {})
      return () => { cancelled = true }
    }
  }, [savedToken, uid])

  // Auto-start sync when credentials already exist (only from config step, not connected)
  useEffect(() => {
    if (autoStartedRef.current) return
    // Gate on the LOCALLY-known queryId (prop OR the one loaded from the vault) so a
    // vault-only connection auto-syncs with the stored token instead of stranding the
    // user on the form. `hasVaultCreds` means the server holds the token → handleSync
    // resolves it via '__stored__'.
    const haveCreds = !!(token || hasVaultCreds)
    const haveQuery = !!(savedQueryId || queryId)
    if (haveCreds && haveQuery && !decrypting && step === 'config' && !isConnected) {
      autoStartedRef.current = true
      handleSync()
    }
  }, [token, hasVaultCreds, savedQueryId, queryId, decrypting]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Use the typed token, or '__stored__' to sync from the server vault without the
    // client ever handling the token.
    const typed = token.trim()
    const effToken = typed || (hasVaultCreds ? '__stored__' : '')
    if (!effToken || !queryId.trim()) {
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

      const data = await syncIBKR(effToken, queryId.trim(), {
        signal: controller.signal,
        onStatus: (status, current, total) => {
          setSyncStatus(status)
          if (current && total) setPollProgress({ current, total })
        },
      })

      // Persist a freshly-typed token in the server-side vault (encrypted with the
      // master key) and drop any legacy client-encrypted copy. A '__stored__' sync
      // reused an already-saved token, so nothing to persist.
      if (typed && uid) {
        try {
          await authFetch('/api/brokers/ibkr', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save-credentials', token: typed, queryId: queryId.trim() }),
          })
          setHasVaultCreds(true)
          onSaveCredentials?.({ ibkrToken: null, ibkrQueryId: queryId.trim(), _ibkrVaultMigrated: true })
        } catch (e) { console.error('[ibkr] save-credentials failed (re-enter token to persist):', e?.message) }
      }

      // The flex API returned data → the token works right now. Clear any stale
      // error/LOCKED state so the red banner drops (a stored-token sync doesn't hit
      // onSaveCredentials, so nothing else would clear it). File imports never reach
      // here, so a CSV workaround correctly leaves a real LOCKED state in place.
      onApiSyncSuccess?.()

      if (syncMode === 'merge' && onSyncComplete) {
        // Skip preview for merge mode — go straight to done
        setSyncStatus('importing')
        await onSyncComplete(data, 'merge')
        setResult({
          items: data.items.length,
          transactions: data.transactions.length,
          equityHistory: (data.equityHistory || []).length,
          equityOldest: (data.equityHistory || []).reduce((min, e) => (!min || (e.date && e.date < min)) ? e.date : min, null),
          accounts: data.accounts || [],
          syncedAt: data.syncedAt,
          mode: 'merge',
        })
        setStep('done')
      } else {
        // Show preview for replace mode (destructive — needs confirmation)
        setPreview(data)
        setSelectedAccounts(null)
        setSyncMode('replace')
        setStep('preview')
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.errorCode === 'CANCELLED') {
        setError('')
        if (isConnected) { setStep('connected') } else { setShowConfig(true) }
      } else {
        setError(err.message || t('Error conectando con IBKR.', 'Error connecting to IBKR.'))
        setErrorCode(err.errorCode || '')
        if (isConnected) { setStep('connected') } else { setShowConfig(true) }
        if (ibkrHistory.items.length > 0) setShowHistory(true)
      }
    } finally {
      setSyncing(false)
      setSyncStatus('')
      setPollProgress(null)
      abortRef.current = null
    }
  }, [token, hasVaultCreds, queryId, onSaveCredentials, onApiSyncSuccess, onSyncComplete, uid, syncMode, t, ibkrHistory.items.length, isConnected])

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
      const parsePromise = (async () => {
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
        return formatIBKRFileResult(parsed)
      })()

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(t('El archivo tardó demasiado en procesarse.', 'File took too long to process.'))), 30000)
      )

      const data = await Promise.race([parsePromise, timeout])

      if (data.items.length === 0 && data.transactions.length === 0 && (data.equityHistory || []).length === 0) {
        throw new Error(t(
          'No se encontraron datos en el archivo. Descarga un reporte de Portfolio Analyst desde IBKR (Performance & Reports → PortfolioAnalyst → Reports → CSV).',
          'No data found in the file. Download a Portfolio Analyst report from IBKR (Performance & Reports → PortfolioAnalyst → Reports → CSV).'
        ))
      }

      setPreview(data)
      setSelectedAccounts(null)
      setStep('preview')
    } catch (err) {
      setError(err.message || t('Error leyendo archivo', 'Error reading file'))
    } finally {
      setSyncing(false)
    }
  }, [t, syncMode, onSyncComplete])

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
    const progress = { done: 0, total: 0 }
    setImportProgress({ done: 0, total: 0 })

    const accounts = preview.accounts || []
    const activeAccounts = selectedAccounts || accounts
    const hasFilter = accounts.length > 1 && selectedAccounts
    const dataToImport = hasFilter ? {
      ...preview,
      items: preview.items.filter(it => !it._ibkrAccountId || activeAccounts.includes(it._ibkrAccountId)),
      transactions: preview.transactions.filter(tx => !tx._ibkrAccountId || activeAccounts.includes(tx._ibkrAccountId)),
    } : preview

    const totalItems = dataToImport.items.length + dataToImport.transactions.length + (dataToImport.equityHistory || []).length
    const timeoutMs = Math.max(120000, totalItems * 1500)
    const MAX_RETRIES = 1
    let lastError = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(t('La importación tardó demasiado. Intenta de nuevo.', 'Import took too long. Please try again.'))), timeoutMs)
        )
        await Promise.race([
          onSyncComplete(dataToImport, syncMode, (done, total) => {
            progress.done = done
            progress.total = total
            setImportProgress({ done, total })
          }),
          timeout,
        ])
        setResult({
          items: dataToImport.items.length,
          transactions: dataToImport.transactions.length,
          equityHistory: (dataToImport.equityHistory || []).length,
          accounts: activeAccounts,
          syncedAt: dataToImport.syncedAt || new Date().toISOString(),
          mode: syncMode,
        })
        setStep('done')
        return
      } catch (err) {
        lastError = err
        const isTimeout = (err.message || '').includes('tardó demasiado') || (err.message || '').includes('too long')
        if (attempt < MAX_RETRIES && !isTimeout) {
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
      }
    }

    if (progress.done > 0) {
      const accounts = preview.accounts || []
      const activeAccounts = selectedAccounts || accounts
      const dataToImport = preview
      // Partial-write fallback: report what actually persisted, not the preview
      // totals — declaring the full count here would overstate the import.
      const partial = progress.total > 0 && progress.done < progress.total
      const nItems = dataToImport.items.length
      const nTx = dataToImport.transactions.length
      setResult({
        items: Math.min(progress.done, nItems),
        transactions: Math.min(Math.max(progress.done - nItems, 0), nTx),
        equityHistory: Math.min(Math.max(progress.done - nItems - nTx, 0), (dataToImport.equityHistory || []).length),
        accounts: activeAccounts,
        syncedAt: dataToImport.syncedAt || new Date().toISOString(),
        mode: syncMode,
        partial,
      })
      setStep('done')
    } else {
      setError(lastError?.message || t('Error importando datos', 'Error importing data'))
    }
    setSyncing(false)
    setImportProgress(null)
  }, [preview, onSyncComplete, syncMode, selectedAccounts, t])

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
          'Verifica que tu Flex Query incluya "Open Positions", "Trades", "Cash Transactions", "Cash Report" y "Equity Summary" en su configuración.',
          'Verify your Flex Query includes "Open Positions", "Trades", "Cash Transactions", "Cash Report" and "Equity Summary" in its configuration.'
        )
      case 'LOCKED':
        return t(
          'IBKR bloqueó el token por demasiados intentos. Genera un token NUEVO en IBKR → Settings → API → Flex Web Service, o importa un archivo CSV mientras tanto.',
          'IBKR locked the token after too many attempts. Generate a NEW token at IBKR → Settings → API → Flex Web Service, or import a CSV file in the meantime.'
        )
      default:
        return null
    }
  }, [errorCode, lang])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="ibkr-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-glass-border/60">
          <div>
            <h2 id="ibkr-modal-title" className="text-base font-semibold text-white">Interactive Brokers</h2>
            {lastSyncLabel && (
              <p className="text-xs text-slate-500 mt-0.5">
                {t('Última sync:', 'Last sync:')} {lastSyncLabel}
                {hasData && <> · {ibkrHistory.items.length} {t('posiciones', 'positions')}</>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg transition-colors" aria-label="Close">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-5 p-3 rounded-lg border"
              style={hasData ? { backgroundColor: 'var(--alert-warn-bg)', borderColor: 'var(--alert-warn-border)' } : { backgroundColor: 'var(--alert-error-bg)', borderColor: 'var(--alert-error-border)' }}>
              <p className="text-sm" style={{ color: hasData ? 'var(--alert-warn-icon)' : 'var(--alert-error-icon)' }}>
                {hasData
                  ? t('No se pudo conectar con IBKR, pero tus datos están actualizados.',
                      'Couldn\'t connect to IBKR, but your data is up to date.')
                  : error}
              </p>
              {hasData && lastSyncLabel && (
                <p className="text-xs mt-1 opacity-80" style={{ color: 'var(--alert-warn-icon)' }}>
                  {t('Última sincronización:', 'Last synced:')} {lastSyncLabel}
                </p>
              )}
              {!hasData && errorHint && (
                <p className="text-[var(--alert-error-icon)] opacity-80 text-xs mt-1.5">{errorHint}</p>
              )}
              {!hasData && !errorHint && (errorCode === 'RATE_LIMITED' || error.toLowerCase().includes('try again')) && (
                <p className="text-[var(--alert-error-icon)] opacity-80 text-xs mt-1.5">
                  {t('IBKR a veces tarda en generar reportes. Intenta de nuevo en unos minutos.',
                     'IBKR sometimes takes time to generate reports. Try again in a few minutes.')}
                </p>
              )}
              {!syncing && (
                <div className="mt-2 flex items-center gap-4">
                  <button onClick={handleSync} className="text-xs text-[var(--accent-blue)] hover:text-blue-300 transition-colors">
                    {t('Reintentar', 'Retry')} →
                  </button>
                  {/* The CSV path bypasses the Flex token entirely — offer it
                      whenever the API path fails, not buried in a tab. */}
                  {importMode !== 'file' && (
                    <button onClick={() => { setImportMode('file'); setStep('config'); setShowConfig(true); setError(''); setErrorCode('') }}
                      className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
                      {t('o importa un archivo CSV', 'or import a CSV file')} →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'connected' && !syncing && (
            <div className="space-y-5">
              <div className="flex flex-col items-center py-6 gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(52,211,153,0.15)' }}>
                  <CheckCircle size={20} style={{ color: 'var(--accent-green)' }} />
                </div>
                <p className="text-sm text-white font-medium">{t('IBKR Conectado', 'IBKR Connected')}</p>
                {lastSyncLabel && (
                  <p className="text-xs text-slate-500">
                    {t('Última sync:', 'Last sync:')} {lastSyncLabel}
                  </p>
                )}
                {hasData && (
                  <p className="text-xs text-slate-400">
                    {ibkrHistory.items.length} {t('posiciones', 'positions')}
                    {ibkrHistory.txs.length > 0 && <> · {ibkrHistory.txs.length} {t('transacciones', 'trades')}</>}
                  </p>
                )}
                {ibkrHistory.accounts.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('Cuentas:', 'Accounts:')}</span>
                    {ibkrHistory.accounts.map((acc) => (
                      <span key={acc} className="text-[11px] font-mono px-1.5 py-0.5 rounded border" style={{ color: 'var(--text-secondary)', borderColor: 'rgba(71,85,105,0.5)' }}>{acc}</span>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={handleSync}
                className="w-full py-3 rounded-xl transition-all text-sm font-medium flex items-center justify-center gap-2"
                style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}
                disabled={decrypting}>
                <RefreshCw size={14} />
                {decrypting ? t('Desencriptando...', 'Decrypting...') : t('Sincronizar ahora', 'Sync now')}
              </button>

              <button onClick={() => { setStep('config'); setShowConfig(true) }}
                className="w-full py-2.5 text-xs text-slate-400 hover:text-slate-300 transition-colors">
                {t('Cambiar credenciales', 'Change credentials')}
              </button>

              {onDisconnect && (
                <button onClick={() => { onDisconnect(); onClose() }}
                  className="w-full py-2.5 text-xs transition-colors" style={{ color: 'var(--accent-red)' }}>
                  {t('Desconectar IBKR', 'Disconnect IBKR')}
                </button>
              )}
            </div>
          )}

          {step === 'connected' && syncing && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }} />
              <p className="text-sm text-slate-400">
                {statusMessages[syncStatus] || t('Sincronizando con IBKR...', 'Syncing with IBKR...')}
              </p>
              <SyncStepper syncStatus={syncStatus} pollProgress={pollProgress} t={t} />
              <button onClick={handleCancel} className="text-xs opacity-70 hover:opacity-100 transition-opacity" style={{ color: 'var(--accent-red)' }}>
                {t('Cancelar', 'Cancel')}
              </button>
            </div>
          )}

          {step === 'config' && !showConfig && syncing && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }} />
              <p className="text-sm text-slate-400">
                {statusMessages[syncStatus] || t('Sincronizando con IBKR...', 'Syncing with IBKR...')}
              </p>
              <SyncStepper syncStatus={syncStatus} pollProgress={pollProgress} t={t} />
              <div className="flex items-center gap-3">
                <button onClick={() => setShowConfig(true)} className="text-xs text-slate-600 hover:text-slate-400 transition-colors">
                  {t('Cambiar credenciales', 'Change credentials')}
                </button>
                <button onClick={handleCancel} className="text-xs opacity-70 hover:opacity-100 transition-opacity" style={{ color: 'var(--accent-red)' }}>
                  {t('Cancelar', 'Cancel')}
                </button>
              </div>
            </div>
          )}

          {step === 'config' && !showConfig && decrypting && !syncing && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }} />
              <p className="text-sm text-slate-400">
                {t('Desencriptando credenciales...', 'Decrypting credentials...')}
              </p>
            </div>
          )}

          {step === 'config' && (showConfig || (!syncing && !decrypting && !preview)) && (
            <div className="space-y-6">
              {/* Mode tabs: API Sync vs File Import */}
              <div className="flex bg-theme-base rounded-lg border border-glass-border p-0.5">
                <button onClick={() => { setImportMode('api'); setError(''); setErrorCode('') }}
                  className={`flex-1 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    importMode === 'api' ? 'bg-theme-card text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  <Lock size={11} />
                  {t('Sync automático', 'Auto sync')}
                </button>
                <button onClick={() => { setImportMode('file'); setError(''); setErrorCode('') }}
                  className={`flex-1 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    importMode === 'file' ? 'bg-theme-card text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
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
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      <span className="text-[var(--accent-blue)] font-mono">interactivebrokers.com</span> → Performance & Reports → Flex Queries → {t('crear Activity Flex Query con', 'create Activity Flex Query with')} <span className="text-white">Open Positions</span>, <span className="text-white">Trades</span>, <span className="text-white">Cash Transactions</span>, <span className="text-white">Cash Report</span> {t('y', 'and')} <span className="text-white">Equity Summary</span>
                    </p>
                    {/* Cash Report → <CashReportCurrency> balance rows. Without it the
                        account's idle cash never appears as a position. */}
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--accent-orange)' }}>
                      {t('Incluye "Cash Report": es la sección que trae el efectivo de tu cuenta. Sin ella tu cash no aparece en el portafolio.',
                         'Include "Cash Report": it is the section that carries your account cash. Without it your cash never shows in the portfolio.')}
                    </p>
                    {/* Equity Summary → <EquitySummaryByReportDateInBase> daily NAV rows.
                        This is the ONLY source of real historical portfolio value; without
                        it YTD/ALL and the value chart start from today (estimated, not real). */}
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--accent-orange)' }}>
                      {t('Incluye "Equity Summary" y pon el período del query en "Year to Date" o "Last 365 Days". El período manda: con "Last 30 Days" solo recibimos 30 días de historial, depósitos y trades, y tu retorno del año no puede cuadrar con IBKR.',
                         'Include "Equity Summary" and set the query period to "Year to Date" or "Last 365 Days". The period rules everything: with "Last 30 Days" we only receive 30 days of history, deposits and trades, and your yearly return cannot match IBKR.')}
                    </p>
                    {/* Without Cash Transactions, deposits/withdrawals never import,
                        so Modified-Dietz returns are distorted by unaccounted flows. */}
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--accent-orange)' }}>
                      {t('Incluye "Cash Transactions" (Deposits/Withdrawals): sin ella tus depósitos no se importan y tus retornos pueden salir inflados.',
                         'Include "Cash Transactions" (Deposits/Withdrawals): without it your deposits don\'t import and your returns may look inflated.')}
                    </p>
                    {/* Without the Asset Class column everything imports as Stock —
                        bonds/cash then fetch quotes from unrelated real tickers. */}
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--accent-orange)' }}>
                      {t('Importante: incluye la columna "Asset Class" en Open Positions: sin ella, los bonos y el cash se importan como acciones.',
                         'Important: include the "Asset Class" column in Open Positions: without it, bonds and cash import as stocks.')}
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">2.</span>
                  <div>
                    <p className="text-xs text-white font-medium">{t('Generar el Token', 'Generate the Token')}</p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Settings → Account Settings → API → Flex Web Service → Create Token
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">3.</span>
                  <p className="text-xs text-white font-medium">{t('Pega ambos valores abajo', 'Paste both values below')}</p>
                </div>
              </div>

              <div className="border-t border-glass-border/40 pt-5 space-y-4">
                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider mb-1.5 block">Token</label>
                  <input type="password" value={token} onChange={e => setToken(e.target.value)}
                    placeholder={decrypting ? t('Desencriptando...', 'Decrypting...') : t('Flex Web Service Token', 'Flex Web Service Token')}
                    disabled={decrypting}
                    className="w-full px-4 py-2.5 bg-theme-base border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[var(--accent-blue)] font-mono"
                    style={{ borderColor: errorCode === 'TOKEN_EXPIRED' ? 'rgba(239,68,68,0.6)' : 'var(--card-border)' }} />
                  {errorCode === 'TOKEN_EXPIRED' && (
                    <p className="text-xs text-[var(--alert-error-icon)] mt-1">{t('Este token expiró o es inválido.', 'This token has expired or is invalid.')}</p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-slate-500 uppercase tracking-wider mb-1.5 block">Query ID</label>
                  <input type="text" value={queryId} onChange={e => setQueryId(e.target.value)}
                    placeholder={t('Ej: 123456', 'E.g.: 123456')}
                    className="w-full px-4 py-2.5 bg-theme-base border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[var(--accent-blue)] font-mono"
                    style={{ borderColor: errorCode === 'INVALID_QUERY' ? 'rgba(239,68,68,0.6)' : 'var(--card-border)' }} />
                  {errorCode === 'INVALID_QUERY' && (
                    <p className="text-xs text-[var(--alert-error-icon)] mt-1">{t('Este Query ID no existe o no está activo.', 'This Query ID does not exist or is not active.')}</p>
                  )}
                </div>
              </div>

              {/* IBKR imported history */}
              {ibkrHistory.items.length > 0 && (
                <div className="border-t border-glass-border/40 pt-4">
                  <button type="button" onClick={() => setShowHistory(h => !h)}
                    className="w-full flex items-center justify-between text-left group">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider">{t('Historial importado', 'Imported history')}</p>
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
                      <div className="overflow-x-auto max-h-40 overflow-y-auto rounded-lg border border-glass-border/40">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-xs text-slate-500 border-b border-glass-border/60 bg-theme-base/50 sticky top-0">
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
                                  <tr key={i} className="border-b border-glass-border/20 hover:bg-slate-700/20">
                                    <td className="py-1.5 px-2.5 text-white font-medium">{it.symbol || it.name}</td>
                                    <td className="py-1.5 px-2.5 text-slate-500">{it.type}</td>
                                    <td className="py-1.5 px-2.5 text-right text-slate-400">{(it.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                    <td className="py-1.5 px-2.5 text-right font-medium" style={{ color: val < 0 ? 'var(--alert-error-icon)' : 'var(--text-primary)' }}>
                                      ${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </td>
                                  </tr>
                                )
                              })}
                          </tbody>
                        </table>
                      </div>

                      {ibkrHistory.snaps.length > 0 && (
                        <div className="bg-theme-base/50 rounded-lg p-2.5 text-xs text-slate-400">
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
                className="w-full py-3 rounded-xl disabled:opacity-50 hover:opacity-90 transition-all text-sm font-medium flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
                {syncing ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {t('Conectando con IBKR...', 'Connecting to IBKR...')}
                  </>
                ) : t('Sincronizar', 'Sync')}
              </button>

              <p className="flex items-center justify-center gap-1.5 text-xs text-slate-600">
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
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          <span className="text-[var(--accent-blue)] font-mono">interactivebrokers.com</span> → <span className="text-white">Performance & Reports</span> → <span className="text-white">PortfolioAnalyst</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">2.</span>
                      <div>
                        <p className="text-xs text-white font-medium">{t('Descargar reporte', 'Download report')}</p>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
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
                    className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all"
                    style={dragOver
                      ? { borderColor: 'var(--accent-blue)', backgroundColor: 'var(--alert-info-bg)' }
                      : { borderColor: 'var(--card-border)' }
                    }>
                    {syncing ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }} />
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
                        <p className="text-xs text-slate-600 mt-3">CSV, XLSX, XLS · Max 5MB</p>
                      </>
                    )}
                  </div>

                  <div className="bg-[var(--alert-info-bg)] border border-[var(--alert-info-border)] rounded-lg p-3">
                    <p className="text-xs text-[var(--accent-blue)] opacity-80">
                      {t('Configura el sync automático (pestaña izquierda) para mantener tus datos actualizados sin subir archivos.',
                         'Set up auto sync (left tab) to keep your data updated without uploading files.')}
                    </p>
                  </div>

                </>
              )}
            </div>
          )}

          {step === 'preview' && preview && (() => {
            const accounts = preview.accounts || []
            const hasMultiple = accounts.length > 1
            const activeAccounts = selectedAccounts || accounts
            const filteredPreview = hasMultiple ? {
              ...preview,
              items: preview.items.filter(it => !it._ibkrAccountId || activeAccounts.includes(it._ibkrAccountId)),
              transactions: preview.transactions.filter(tx => !tx._ibkrAccountId || activeAccounts.includes(tx._ibkrAccountId)),
            } : preview

            return (
            <div className="space-y-5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]" />
                <span className="text-xs text-slate-400">
                  {t('Datos recibidos de IBKR', 'Data received from IBKR')}
                </span>
              </div>

              {hasMultiple && (
                <div className="bg-theme-base/50 rounded-xl p-4 border border-glass-border/40">
                  <p className="text-xs text-white font-medium mb-3">
                    {t('Cuentas detectadas', 'Accounts detected')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {accounts.map(acc => {
                      const isSelected = activeAccounts.includes(acc)
                      const count = preview.items.filter(it => it._ibkrAccountId === acc).length
                      return (
                        <button key={acc} onClick={() => {
                          if (!selectedAccounts) {
                            setSelectedAccounts([acc])
                          } else if (isSelected && activeAccounts.length > 1) {
                            setSelectedAccounts(activeAccounts.filter(a => a !== acc))
                          } else if (!isSelected) {
                            setSelectedAccounts([...activeAccounts, acc])
                          }
                        }}
                          className="px-3 py-2 rounded-lg text-xs font-mono transition-all border"
                          style={isSelected
                            ? { borderColor: 'var(--accent-blue)', backgroundColor: 'var(--alert-info-bg)', color: 'var(--accent-blue)' }
                            : { borderColor: 'var(--card-border)', color: 'var(--text-muted)' }
                          }>
                          {acc} <span className="text-slate-600 ml-1">({count})</span>
                        </button>
                      )
                    })}
                    {selectedAccounts && (
                      <button onClick={() => setSelectedAccounts(null)}
                        className="px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-300 transition-colors">
                        {t('Todas', 'All')}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-2">
                    {t('Selecciona qué cuentas importar. Cada cuenta se mantiene separada.',
                       'Select which accounts to import. Each account is kept separate.')}
                  </p>
                </div>
              )}

              {/* Sync mode selector — shown first for visibility */}
              <div className="bg-theme-base/50 rounded-xl p-4 border border-glass-border/40">
                <p className="text-xs text-white font-medium mb-3">
                  {t('¿Cómo importar?', 'How to import?')}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setSyncMode('merge')}
                    className={`px-4 py-3 rounded-lg text-left transition-all border-2 ${syncMode !== 'merge' ? 'border-glass-border hover:border-slate-500' : ''}`}
                    style={syncMode === 'merge' ? { borderColor: 'var(--accent-blue)', backgroundColor: 'var(--alert-info-bg)' } : undefined}>
                    <p className="text-sm text-white font-medium">🔄 {t('Actualizar', 'Update')}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      {t('Actualiza precios y cantidades de posiciones existentes. Agrega nuevas posiciones. No borra nada.',
                         'Updates prices and quantities for existing positions. Adds new ones. Deletes nothing.')}
                    </p>
                  </button>
                  <button onClick={() => setSyncMode('replace')}
                    className={`px-4 py-3 rounded-lg text-left transition-all border-2 ${syncMode !== 'replace' ? 'border-glass-border hover:border-slate-500' : ''}`}
                    style={syncMode === 'replace' ? { borderColor: 'var(--accent-red)', backgroundColor: 'var(--alert-error-bg)' } : undefined}>
                    <p className="text-sm text-white font-medium">♻️ {t('Sustituir todo', 'Replace all')}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      {t('Borra TODAS las posiciones de IBKR anteriores y reimporta desde cero. Útil si hay errores.',
                         'Deletes ALL previous IBKR positions and reimports from scratch. Useful to fix errors.')}
                    </p>
                  </button>
                </div>
                <p className="text-xs text-slate-600 mt-2">
                  {t('El historial de transacciones y NAV se importa siempre (no se duplica).',
                     'Transaction history and NAV are always imported (no duplicates).')}
                </p>
              </div>

              {(() => {
                const totalValue = filteredPreview.items.reduce((s, it) => s + (it.currentPrice || 0) * (it.quantity || 0), 0)
                const sortedNav = (filteredPreview.equityHistory || []).length > 0
                  ? [...filteredPreview.equityHistory].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                  : []
                return (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-theme-base/50 rounded-lg p-3 border border-glass-border/30">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">{t('Posiciones', 'Positions')}</p>
                        <p className="text-lg text-white font-semibold mt-1">{filteredPreview.items.length}</p>
                        {totalValue > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </p>
                        )}
                      </div>
                      <div className="bg-theme-base/50 rounded-lg p-3 border border-glass-border/30">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">Trades</p>
                        <p className="text-lg text-white font-semibold mt-1">{filteredPreview.transactions.length}</p>
                      </div>
                      <div className="bg-theme-base/50 rounded-lg p-3 border border-glass-border/30">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">{t('Historial', 'History')}</p>
                        <p className="text-lg text-white font-semibold mt-1">{sortedNav.length}</p>
                        {sortedNav.length > 0 && (
                          <p className="text-xs text-slate-400 mt-0.5 break-words">
                            {sortedNav[0].date} → {sortedNav[sortedNav.length - 1].date}
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )
              })()}

              {filteredPreview.items.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                    {filteredPreview.items.length} {t('posiciones', 'positions')}
                  </p>
                  <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-glass-border/40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-xs text-slate-500 border-b border-glass-border/60 bg-theme-base/50">
                          <th className="text-left py-2.5 px-3 font-normal">Symbol</th>
                          <th className="text-left py-2.5 px-3 font-normal">Name</th>
                          <th className="text-left py-2.5 px-3 font-normal">Type</th>
                          <th className="text-right py-2.5 px-3 font-normal">Qty</th>
                          <th className="text-right py-2.5 px-3 font-normal">Price</th>
                          <th className="text-right py-2.5 px-3 font-normal">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPreview.items.map((item, i) => (
                          <tr key={i} className="border-b border-glass-border/30 hover:bg-slate-700/20 transition-colors">
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

              {filteredPreview.transactions.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                    {filteredPreview.transactions.length} {t('transacciones', 'trades')}
                  </p>
                  <div className="overflow-x-auto max-h-36 overflow-y-auto rounded-lg border border-glass-border/40">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-xs text-slate-500 border-b border-glass-border/60 bg-theme-base/50">
                          <th className="text-left py-2.5 px-3 font-normal">{t('Fecha', 'Date')}</th>
                          <th className="text-left py-2.5 px-3 font-normal">Symbol</th>
                          <th className="text-left py-2.5 px-3 font-normal">Type</th>
                          <th className="text-right py-2.5 px-3 font-normal">Qty</th>
                          <th className="text-right py-2.5 px-3 font-normal">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPreview.transactions.slice(0, 20).map((tx, i) => (
                          <tr key={i} className="border-b border-glass-border/30 hover:bg-slate-700/20 transition-colors">
                            <td className="py-2.5 px-3 text-slate-500">{tx.date}</td>
                            <td className="py-2.5 px-3 text-white">{tx.symbol}</td>
                            <td className="py-2.5 px-3 font-medium" style={{ color: tx.type === 'BUY' ? 'var(--accent-green)' : 'var(--alert-error-icon)' }}>{tx.type}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">{tx.quantity}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">${(tx.pricePerUnit ?? 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {syncing ? (
                <div className="space-y-3 pt-2">
                  <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--fill-secondary, rgba(100,116,139,0.3))' }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        backgroundColor: importProgress && importProgress.total > 0 && importProgress.done >= importProgress.total ? 'var(--accent-green)' : 'var(--accent-blue)',
                        width: `${importProgress && importProgress.total > 0 ? Math.round((importProgress.done / importProgress.total) * 100) : 0}%`,
                      }} />
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    {importProgress && importProgress.total > 0 && importProgress.done >= importProgress.total ? (
                      <CheckCircle size={16} className="text-[var(--accent-green)]" />
                    ) : (
                      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent-blue)', borderTopColor: 'transparent' }} />
                    )}
                    <p className="text-sm text-slate-400">
                      {importProgress && importProgress.total > 0
                        ? importProgress.done >= importProgress.total
                          ? t('¡Listo! Guardando...', 'Done! Saving...')
                          : `${t('Importando', 'Importing')} ${importProgress.done}/${importProgress.total} (${Math.round((importProgress.done / importProgress.total) * 100)}%)`
                        : t('Preparando...', 'Preparing...')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-4 pt-1">
                  <button onClick={() => setStep('config')}
                    className="flex-1 py-3 border border-glass-border/60 text-slate-400 rounded-xl hover:bg-theme-elevated hover:text-slate-200 transition-all text-sm">
                    {t('Atrás', 'Back')}
                  </button>
                  <button onClick={handleConfirm}
                    className="flex-1 py-3 rounded-xl hover:opacity-90 transition-all text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
                    {t('Confirmar', 'Confirm')}
                  </button>
                </div>
              )}
            </div>
            )
          })()}

          {step === 'done' && result && (
            <DoneStep result={result} onClose={onClose} t={t} />
          )}
        </div>
      </div>
    </div>
  )
}
