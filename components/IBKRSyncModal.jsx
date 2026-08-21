'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { CheckCircle, Lock, ChevronDown, ChevronUp, Upload, RefreshCw, Info } from 'lucide-react'
import { parseIBKRFile, formatIBKRFileResult, detectIBKRFileKind, pickSectionedCsvFromWorkbook } from '@/lib/parsers/ibkrFileParser'
import { parseIBKRXmlFile } from '@/lib/parsers/ibkrXmlFileAdapter'
import { authFetch } from '@/lib/authFetch'
import { saveIbkrCredentials } from '@/lib/ibkrVault'
import { getBrokerHowTo } from '@/lib/brokerHowTo'
import BrokerSteps from '@/components/ui/BrokerSteps'
import BusyLabel, { BusyRing } from '@/components/ui/BusyLabel'
import ChispudoLoader from '@/components/ui/ChispudoLoader'

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
                ...(i === activeIdx ? { boxShadow: '0 0 0 3px rgba(37,99,235,0.2)' } : {}),
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

function DoneStep({ result, onClose, onComplementFile, credWarning, t }) {
  // When there is no value history, don't auto-close: the user needs time to read
  // the warning and reach for the Activity Statement complement.
  const needsHistory = result.items > 0 && result.equityHistory <= 1
  const [countdown, setCountdown] = useState(needsHistory ? -1 : 5)

  useEffect(() => {
    if (countdown < 0) return
    if (countdown === 0) { onClose(); return }
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
        <div className="mt-3 mx-auto max-w-xs">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
            {/* FASE KE. Antes esto ofrecía el Activity Statement diciendo que
                "trae el historial de valor", y es falso por partida doble: las
                instrucciones de esta misma app ya dicen "no uses Statements →
                Activity: ese formato no trae el valor diario de la cuenta", y
                el parser de statements necesita una tabla de NAV con columna de
                fecha que ese reporte no tiene (Change in NAV es un resumen, no
                una serie diaria). El usuario bajaba el Excel, lo importaba, y
                el historial seguía vacío. El único arreglo real es agregar la
                sección al Flex Query; el Activity Statement se sigue ofreciendo
                por lo que SÍ trae. */}
            {t('Importamos tus posiciones, pero no llegó el historial de valor (la sección "Net Asset Value (NAV) in Base"). Por eso tus retornos y la gráfica arrancan desde hoy. El arreglo es agregar esa sección al Flex Query y volver a sincronizar. Para historial más viejo que ~365 días, transcribí los trimestres desde Portfolio Analyst. El Activity Statement (XLS) no trae el valor diario, pero sí tus operaciones con fecha, depósitos y comisiones.',
               'We imported your positions, but the value history did not arrive (the "Net Asset Value (NAV) in Base" section). That is why your returns and chart start from today. The fix is to add that section to your Flex Query and sync again. For history older than ~365 days, transcribe the quarters from Portfolio Analyst. The Activity Statement (XLS) does not carry the daily value, but it does carry your dated trades, deposits and commissions.')}
          </p>
          {onComplementFile && (
            <button onClick={onComplementFile}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
              <Upload size={13} />
              {t('Completar con Activity Statement (XLS)', 'Complete with Activity Statement (XLS)')}
            </button>
          )}
          <p className="text-[11px] leading-relaxed mt-2" style={{ color: 'var(--text-muted)' }}>
            {t('Es de una sola vez: el historial de posiciones que abriste antes de tu query necesita el Excel. De ahí en adelante, cada nuevo depósito, retiro, operación o costo se detecta solo en cada sync.',
               'It is one time only: the history of positions you opened before your query needs the Excel. From then on, every new deposit, withdrawal, trade or cost is detected automatically on each sync.')}
          </p>
        </div>
      )}
      {/* FASE KC. El sync funcionó pero el vault no confirmó el guardado del
          token. No es un fallo de la importación (los datos ya entraron), así
          que va en ámbar y no en rojo; lo que importa es que el usuario sepa
          que va a tener que teclearlo otra vez, en vez de descubrirlo cuando
          el sync automático empiece a fallar solo. */}
      {credWarning && (
        <p className="text-xs mt-3 mx-auto max-w-xs leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
          {t('Tus datos se importaron, pero no pudimos guardar tu token para la próxima vez: vas a tener que volver a pegarlo. ',
             'Your data was imported, but we could not save your token for next time: you will have to paste it again. ')}
          <span style={{ opacity: 0.8 }}>({credWarning})</span>
        </p>
      )}
      {/* History present but SHORT: the query period truncates it, so YTD can't
          match the broker. Same actionable fix: widen the period, re-sync. */}
      {result.items > 0 && result.equityHistory > 1 && result.equityOldest
        && new Date(result.equityOldest).getTime() > Date.UTC(new Date().getUTCFullYear(), 0, 1) + 45 * 86400000 && (
        <p className="text-xs mt-3 mx-auto max-w-xs leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
          {/* FASE KE: decía "Year to Date", igual que el consejo de
              EMPTY_REPORT. Contradice la instrucción principal y, en enero, YTD
              son días: seguir el consejo ACORTA el historial en vez de
              alargarlo, que es justo lo contrario de lo que este aviso pide. */}
          {t(`Tu historial de valor empieza el ${result.equityOldest}. Para que tu retorno del año cuadre con IBKR, pon el período de tu Flex Query en "Last 365 Calendar Days" y vuelve a sincronizar.`,
             `Your value history starts on ${result.equityOldest}. For your yearly return to match IBKR, set your Flex Query period to "Last 365 Calendar Days" and sync again.`)}
        </p>
      )}
      {/* Positions arrived but ZERO deposits/withdrawals did. This failure is
          otherwise SILENT (the sync "succeeds") and its symptom shows up far
          away: with no flows on file, every deposit reads as market gain in
          YTD/TWR/MWR. Two shapes, one message: the Cash Transactions section
          missing entirely from the XML, or present but with the
          "Deposits & Withdrawals" TYPE unticked inside it (adding the section
          alone does not include that type). Softly worded on purpose: an
          account with genuinely no external flows in the window is legitimate
          and rare, not wrong. Gated on result.sections so an older result
          shape without the forensic counts can never false-alarm. */}
      {result.items > 0 && result.sections && (result.impFlows ?? 0) === 0 && (
        <p className="text-xs mt-3 mx-auto max-w-xs leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
          {(result.sections.cashTransactions ?? 0) === 0
            ? t('No llegó ningún depósito ni retiro (la sección "Cash Transactions" no vino en el archivo). Si depositaste o retiraste dinero en el período, edita tu Flex Query, agrega "Cash Transactions" con el tipo "Deposits & Withdrawals" marcado, y sincroniza de nuevo: sin esos movimientos, tus depósitos se cuentan como ganancia en los retornos.',
                'No deposit or withdrawal arrived (the "Cash Transactions" section was not in the file). If you deposited or withdrew money in the period, edit your Flex Query, add "Cash Transactions" with the "Deposits & Withdrawals" type ticked, and sync again: without those movements, your deposits count as gains in your returns.')
            : t('Llegó la sección "Cash Transactions" pero sin ningún depósito ni retiro. Si depositaste o retiraste dinero en el período, edita tu Flex Query y, dentro de "Cash Transactions", marca el tipo "Deposits & Withdrawals": sin esos movimientos, tus depósitos se cuentan como ganancia en los retornos.',
                'The "Cash Transactions" section arrived but with no deposit or withdrawal in it. If you deposited or withdrew money in the period, edit your Flex Query and, inside "Cash Transactions", tick the "Deposits & Withdrawals" type: without those movements, your deposits count as gains in your returns.')}
        </p>
      )}
      {/* Forensic breakdown: what the Flex XML actually delivered per section vs
          what we imported. One screenshot of this pins the failure: low XML counts
          = the query period is short (fix in IBKR); high XML but low imported = our
          pipeline bug. */}
      {result.sections && (
        <div className="text-[10px] font-mono mt-3 mx-auto max-w-xs leading-relaxed px-3 py-2 rounded-lg text-left"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
          <div>{t('Del XML de IBKR', 'From IBKR XML')}:</div>
          <div>· {result.sections.openPositions ?? 0} {t('posiciones', 'positions')} · {result.sections.trades ?? 0} trades · {result.sections.cashTransactions ?? 0} cash tx</div>
          <div>· {result.sections.equitySummary ?? 0} {t('filas NAV', 'NAV rows')} · {result.sections.cashReport ?? 0} cash report</div>
          <div className="mt-1">{t('Importado', 'Imported')}: {result.impTrades ?? 0} trades · {result.impFlows ?? 0} {t('dep/ret', 'dep/wd')} · {result.impDividends ?? 0} div · {result.impFees ?? 0} {t('costos', 'costs')} · {result.equityHistory ?? 0} {t('días NAV', 'NAV days')}</div>
        </div>
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
        className={`mt-8 px-10 py-3 rounded-xl hover:opacity-90 transition-all text-sm font-medium ${needsHistory ? 'border' : ''}`}
        style={needsHistory
          ? { backgroundColor: 'transparent', color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }
          : { backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
        {t('Cerrar', 'Close')}{countdown >= 0 ? ` (${countdown}s)` : ''}
      </button>
    </div>
  )
}

export default function IBKRSyncModal({ onClose, onSyncComplete, savedToken, savedQueryId, vaultMigrated = false, syncSummary = null, onSaveCredentials, onSaveCredentialsPending, onApiSyncSuccess, onDisconnect, lang = 'es', uid, lastSyncTime, existingItems = [], existingTransactions = [], existingSnapshots = [], journeyActive = false }) {
  const trapRef = useFocusTrap()
  // Connected = a usable token (legacy client copy OR migrated to the server
  // vault) AND a query id. Mirrors ibkrConnected in useDashboardData: judging by
  // savedToken alone made every vault-migrated connection open as "not connected"
  // even while auto-sync worked (the user saw a credentials form over live data).
  const isConnected = !!((savedToken || vaultMigrated) && savedQueryId)
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
  // FASE KC. El sync funcionó pero el vault no confirmó el guardado del token:
  // no es un fallo de la importación (los datos ya entraron), así que se dice
  // en ámbar en la pantalla final en vez de en rojo, y con la acción concreta.
  const [credWarning, setCredWarning] = useState('')
  const [showConfig, setShowConfig] = useState(!isConnected)
  // First-time explainer: tells the user how the connection actually works
  // (IBKR only shares what their Flex Query is configured to share, and its
  // period rules everything). Open by default the FIRST time only (FASE GM2:
  // lives inline in the same screen now, not a full-screen gate to dismiss);
  // any manual toggle after that is remembered so it doesn't reopen uninvited.
  const [showExplainer, setShowExplainer] = useState(() => {
    if (isConnected) return false
    try { return !localStorage.getItem('chispudo-ibkr-explained') } catch { return true }
  })
  const toggleExplainer = () => {
    setShowExplainer((v) => {
      try { localStorage.setItem('chispudo-ibkr-explained', '1') } catch {}
      return !v
    })
  }
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
  // ⛔ FASE KC. "El usuario esta tecleando ahora mismo".
  //
  // El efecto de auto-arranque de abajo dispara en cuanto token y queryId son
  // los dos no vacios, y sus deps estan atadas a los inputs, o sea corre en
  // CADA tecla. Con el token ya lleno, el PRIMER digito del Query ID lo
  // disparaba: se guardaba `queryId` = "9" (un solo caracter) y la pantalla
  // saltaba a "Credenciales guardadas" con el usuario a media palabra. Un Query
  // ID truncado no puede funcionar nunca, y cada reintento es un intento
  // fallido mas hacia el bloqueo de IBKR.
  //
  // Quedaba tapado porque un Flex token se PEGA (40+ caracteres), y pegar setea
  // el valor entero de un golpe; solo muerde a quien teclea el segundo campo.
  // FASE GQ2 verifico que se aterrizaba en la pantalla correcta, no CON QUE
  // valor, que es justo el hueco.
  //
  // La regla correcta: el auto-arranque es para credenciales que ya venian
  // GUARDADAS (props o vault), nunca para lo que se esta escribiendo.
  const userTypedRef = useRef(false)

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
  //
  // FASE GQ regression, found from a real report (user still saw the blocking
  // "Requesting report from IBKR..." screen after this shipped): this effect
  // re-runs on EVERY keystroke (token/queryId are both in its deps, bound
  // directly to the two text inputs), and the form asks for Token first, then
  // Query ID — so the instant the user types the FIRST digit of the Query ID
  // with a Token already in the field, both conditions go true and this fires
  // BEFORE the user ever reaches the "Conectar" button. It was still calling
  // the old blocking handleSync(), so the button's own onClick swap to
  // handleQuickConnect (above) never got a chance to matter: this effect won
  // the race first, every time, for any first-time connect. Same non-blocking
  // path here closes that gap for good.
  useEffect(() => {
    if (autoStartedRef.current) return
    // FASE KC: nunca sobre lo que el usuario esta tecleando (ver userTypedRef).
    if (userTypedRef.current) return
    // Gate on the LOCALLY-known queryId (prop OR the one loaded from the vault) so a
    // vault-only connection auto-syncs with the stored token instead of stranding the
    // user on the form. `hasVaultCreds` means the server holds the token → handleSync
    // resolves it via '__stored__'.
    const haveCreds = !!(token || hasVaultCreds)
    const haveQuery = !!(savedQueryId || queryId)
    if (haveCreds && haveQuery && !decrypting && step === 'config' && !isConnected) {
      autoStartedRef.current = true
      handleQuickConnect()
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
          // FASE KC: lanza si el servidor no confirmó, en vez de marcar
          // `_ibkrVaultMigrated` sobre un vault vacío (que deja a la app
          // diciendo "conectado" y sincronizando con '__stored__' para siempre).
          await saveIbkrCredentials(typed, queryId.trim())
          setHasVaultCreds(true)
          setCredWarning('')
          onSaveCredentials?.({ ibkrToken: null, ibkrQueryId: queryId.trim(), _ibkrVaultMigrated: true })
        } catch (e) {
          // El sync SÍ funcionó y los datos ya entraron, así que esto no es un
          // fallo de la importación: es que no pudimos recordar el token. Va en
          // ámbar en la pantalla final, no en rojo, y dice qué hacer.
          console.error('[ibkr] save-credentials failed (re-enter token to persist):', e?.message)
          setCredWarning(e?.message || '')
        }
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
        const _tx = data.transactions || []
        const _c = (types) => _tx.filter((t) => types.includes((t.type || '').toUpperCase())).length
        setResult({
          items: data.items.length,
          transactions: data.transactions.length,
          equityHistory: (data.equityHistory || []).length,
          equityOldest: (data.equityHistory || []).reduce((min, e) => (!min || (e.date && e.date < min)) ? e.date : min, null),
          sections: data.sections || null,
          impTrades: _c(['BUY', 'SELL']),
          impFlows: _c(['DEPOSIT', 'WITHDRAWAL']),
          impDividends: _c(['DIVIDEND']),
          impFees: _c(['FEE', 'TAX', 'INTEREST']),
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

  // FASE GQ: the FIRST-time connect used to block on the live Flex round trip
  // (up to ~90s of polling, per SyncStepper above) before the user could do
  // anything else — and outside market hours (nights, weekends) IBKR often
  // does not answer at all, so that wait ended in TIMEOUT with nothing saved
  // (handleSync only persists credentials AFTER syncIBKR resolves). Saving the
  // credentials FIRST, then landing on a reassurance screen instead of waiting,
  // means the connection is never lost to a bad-timing weekend attempt: the
  // background auto-sync in useDashboardData picks up the newly-saved
  // credentials on its own (same effect that already retries LOCKED/TIMEOUT on
  // a cadence) the moment settings updates, with zero extra wiring here.
  // `onSaveCredentialsPending` is a SEPARATE prop from `onSaveCredentials` on
  // purpose: the caller stamps `_ibkrLastSync` on the latter (it currently only
  // ever fires after a confirmed successful sync in handleSync) — reusing it
  // here would falsely mark a sync that has not happened yet, and the
  // 5-business-day grace period (ibkrNeedsAttention in app/dashboard/page.jsx,
  // FASE HX) needs `_ibkrConnectedAt` to be the ONLY thing that changes on
  // this path.
  const handleQuickConnect = useCallback(async () => {
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
    try {
      if (typed && uid) {
        // FASE KC: si esto lanza, el catch de abajo deja al usuario en el paso
        // de configuración con el error. Antes se seguía derecho a la pantalla
        // "Credenciales guardadas" después de no guardarlas.
        await saveIbkrCredentials(typed, queryId.trim())
        setHasVaultCreds(true)
      }
      onSaveCredentialsPending?.({ ibkrToken: null, ibkrQueryId: queryId.trim(), _ibkrVaultMigrated: true })
      setStep('journey-saved')
    } catch (err) {
      setError(err.message || t('No se pudieron guardar las credenciales. Intenta de nuevo.', 'Could not save credentials. Try again.'))
    } finally {
      setSyncing(false)
    }
  }, [token, hasVaultCreds, queryId, uid, onSaveCredentialsPending, t])

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
        const fileName = file.name.toLowerCase()
        const isCSV = fileName.endsWith('.csv')
        const isXml = fileName.endsWith('.xml')
        let parsed

        if (isCSV || isXml) {
          const text = await file.text()
          // Specific errors beat the generic "no data" so the user knows what to fix.
          const kind = detectIBKRFileKind(text)
          if (kind === 'pdf') throw new Error(t('Esto es un PDF. Vuelve a exportar el Activity Statement en formato CSV o Excel (XLS).', 'This is a PDF. Re-export the Activity Statement as CSV or Excel (XLS).'))
          // The Flex Query XML is exactly what the instructions tell users to
          // download: the adapter reshapes it to the same result the CSV path
          // produces, so the preview/import below works unchanged.
          if (kind === 'xml') return parseIBKRXmlFile(text)
          parsed = parseIBKRFile(text)
        } else {
          const XLSX = (await import('xlsx')).default || await import('xlsx')
          const buf = await file.arrayBuffer()
          const wb = XLSX.read(buf, { type: 'array' })
          // Scan ALL sheets for the sectioned layout — IBKR workbooks often put a
          // cover sheet first and the real data on a later sheet.
          const csv = pickSectionedCsvFromWorkbook(XLSX, wb)
          if (csv) {
            parsed = parseIBKRFile(csv)
          } else {
            const sheet = wb.Sheets[wb.SheetNames[0]]
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
            if (json.length < 2) throw new Error(t('El archivo no tiene datos legibles. Exporta el Activity Statement (Performance & Reports → Statements → Activity) en CSV o Excel.', 'The file has no readable data. Export the Activity Statement (Performance & Reports → Statements → Activity) as CSV or Excel.'))
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
        const found = (data._sectionNames || []).slice(0, 6).join(', ')
        const foundEs = found ? ` Encontramos: ${found}, pero ninguna posición ni operación.` : ''
        const foundEn = found ? ` We found: ${found}, but no positions or trades.` : ''
        throw new Error(t(
          `No se encontraron datos de tu cuenta.${foundEs} Exporta el Activity Statement en IBKR (Performance & Reports → Statements → Activity) en CSV o Excel, con Open Positions, Trades y NAV.`,
          `No account data found.${foundEn} Export the Activity Statement in IBKR (Performance & Reports → Statements → Activity) as CSV or Excel, with Open Positions, Trades and NAV.`
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
          'Ve a IBKR → Performance & Reports → Flex Queries, toca el engranaje ⚙ junto a "Flex Web Service" y genera un nuevo Token.',
          'Go to IBKR → Performance & Reports → Flex Queries, click the gear ⚙ next to "Flex Web Service" and generate a new Token.'
        )
      case 'INVALID_QUERY':
        return t(
          // FASE KE: el formato entra al consejo porque ahora es una de las dos
          // causas de este código (una query guardada en CSV devuelve algo que
          // el Flex Web Service entrega igual pero que no podemos leer).
          'Ve a IBKR → Performance & Reports → Flex Queries y verifica que tu Query esté activo y que su formato sea XML.',
          'Go to IBKR → Performance & Reports → Flex Queries and verify your Query is active and its format is XML.'
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
          // FASE KE: decía "Year to Date", que CONTRADICE la instrucción
          // principal ("Last 365 Calendar Days") y encima estrecha la ventana:
          // en enero, YTD son días. El usuario seguía el consejo y volvía a
          // obtener un reporte vacío.
          'Verifica que tu Flex Query incluya "Open Positions", "Trades", "Cash Transactions", "Cash Report" y "Net Asset Value (NAV) in Base", que en cada sección esté marcado "Select All" en los campos, y que el período sea "Last 365 Calendar Days".',
          'Verify your Flex Query includes "Open Positions", "Trades", "Cash Transactions", "Cash Report" and "Net Asset Value (NAV) in Base", that each section has "Select All" ticked in its fields, and that the period is "Last 365 Calendar Days".'
        )
      case 'LOCKED':
        return t(
          'IBKR bloqueó el token por demasiados intentos. Genera un token NUEVO en IBKR → Performance & Reports → Flex Queries → ⚙ Flex Web Service, o importa un archivo mientras tanto.',
          'IBKR locked the token after too many attempts. Generate a NEW token at IBKR → Performance & Reports → Flex Queries → ⚙ Flex Web Service, or import a file in the meantime.'
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
            <h2 id="ibkr-modal-title" className="text-lg font-bold text-white">Interactive Brokers</h2>
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
              {/* ⛔ FASE KK. La RAZÓN, también cuando el usuario ya tiene datos.
                  Antes `error` y `errorHint` estaban los dos gateados a
                  `!hasData`, así que a cualquiera cuya conexión YA funcionó
                  alguna vez (o sea exactamente la población que llega acá
                  diciendo "dejó de funcionar") el modal le decía "no se pudo
                  conectar" y escondía por qué, con un botón Reintentar al lado
                  que repite lo mismo. La intención era no alarmar a quien tiene
                  sus datos bien, y es razonable, pero "no alarmar" no es "no
                  decir": el resultado era un callejón sin salida. Va en ámbar,
                  debajo de la frase que tranquiliza, no en rojo. */}
              {hasData && (error || errorHint) && (
                <div className="text-xs mt-1.5 opacity-80 leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
                  {errorHint ? <p>{errorHint}</p> : null}
                  {error ? <p className={errorHint ? 'mt-0.5' : ''} style={{ wordBreak: 'break-word' }}>{error}</p> : null}
                </div>
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
                    {syncSummary?.equityDays > 0 && <> · {syncSummary.equityDays} {t('días de historial', 'days of history')}</>}
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
                {/* Persistent last-sync breakdown: opening this connected view must
                    SAY what data the connection holds, without forcing a re-sync. */}
                {/* ⛔ FASE KK. Un resumen SIN fecha de sync es un FÓSIL, no el
                    estado de esta conexión. `_ibkrLastSync`/`_ibkrLastAutoSync`
                    se escriben en el MISMO saveSettings que el resumen, así que
                    no pueden faltar en un resumen legítimo: si faltan, es
                    porque un desconectar los limpió y dejó el resumen vivo
                    (`_ibkrLastSyncSummary` no estaba en IBKR_DISCONNECTED_FIELDS
                    hasta este commit). Eso hacía que una cuenta RECONECTADA
                    mostrara "0 flujos · 0 costos" y "+317 operaciones" de una
                    era anterior como si fueran de ahora. */}
                {syncSummary && lastSyncTime && (
                  <div className="text-[10px] font-mono mt-1 px-3 py-2 rounded-lg text-left w-full max-w-xs"
                    style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                    <div>{t('Datos guardados', 'Stored data')}: {syncSummary.equityDays ?? 0} {t('días NAV', 'NAV days')} · {syncSummary.trades ?? 0} trades · {(syncSummary.flows ?? 0) + (syncSummary.dividends ?? 0)} {t('flujos', 'flows')} · {syncSummary.fees ?? 0} {t('costos', 'costs')}</div>
                    {syncSummary.sections && (
                      <div className="mt-0.5 opacity-80">XML: {syncSummary.sections.trades ?? 0} trades · {syncSummary.sections.cashTransactions ?? 0} cash tx · {syncSummary.sections.equitySummary ?? 0} NAV</div>
                    )}
                  </div>
                )}
                {/* Auto-detected changes since the previous sync: the platform reads
                    every new movement on its own, this makes it visible. */}
                {syncSummary?.changes && lastSyncTime && (
                  <div className="text-xs px-3 py-2 rounded-lg text-left w-full max-w-xs"
                    style={{ backgroundColor: 'var(--alert-success-bg)', border: '1px solid var(--alert-success-border)', color: 'var(--accent-green)' }}>
                    <span className="font-semibold">{t('Detectado en el último sync', 'Detected in the last sync')}:</span>{' '}
                    {[
                      syncSummary.changes.trades ? `+${syncSummary.changes.trades} ${t('operaciones', 'trades')}` : null,
                      syncSummary.changes.flows ? `+${syncSummary.changes.flows} ${t('dep/ret', 'dep/wd')}` : null,
                      syncSummary.changes.dividends ? `+${syncSummary.changes.dividends} ${t('dividendos', 'dividends')}` : null,
                      syncSummary.changes.fees ? `+${syncSummary.changes.fees} ${t('costos', 'costs')}` : null,
                    ].filter(Boolean).join(' · ')}
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
              <ChispudoLoader mode="inline" size={32} state="section-loading" lang={lang} />
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
              <ChispudoLoader mode="inline" size={32} state="section-loading" lang={lang} />
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
              <ChispudoLoader mode="inline" size={32} state="section-loading" lang={lang} />
              <p className="text-sm text-slate-400">
                {t('Desencriptando credenciales...', 'Decrypting credentials...')}
              </p>
            </div>
          )}

          {step === 'config' && (showConfig || (!syncing && !decrypting && !preview)) && (
            <div className="space-y-6">
              {/* FASE GM parte 2: el explicador ya no es una pantalla propia que
                  hay que cerrar para llegar al formulario ("Entendido,
                  continuar" era el pop-up inesperado que el usuario pidió
                  eliminar) — vive DENTRO de esta misma pantalla, abierto por
                  defecto la primera vez (mismo localStorage de antes) y
                  colapsable el resto. Todo en un solo segmento. */}
              {/* FASE IH: el explicador y su contenido comparten una sola caja
                  (antes el panel abierto flotaba suelto debajo del botón, con
                  `-mt-2` para pegarlo a mano) y sus colores salen de las
                  variables de tema, no de un rgba fijo del azul de hoy. */}
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--card-border)' }}>
                <button type="button" onClick={toggleExplainer} aria-expanded={showExplainer}
                  className="w-full flex items-center gap-2 text-left px-3 py-2.5 transition-colors hover:bg-theme-elevated">
                  <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                    style={showExplainer
                      ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff' }
                      : { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                    <Info size={12} />
                  </span>
                  <span className="text-xs font-medium flex-1 min-w-0" style={{ color: 'var(--text-secondary)' }}>
                    {t('Cómo funciona la conexión con IBKR', 'How the IBKR connection works')}
                  </span>
                  <ChevronDown size={13} style={{ color: 'var(--text-muted)', transform: showExplainer ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
                </button>
                {showExplainer && (
                  <div className="space-y-2.5 text-xs leading-relaxed px-3 py-2.5" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--card-border)' }}>
                    <div className="flex gap-2.5">
                      <span>🔒</span>
                      <p>{t('Es SOLO LECTURA y cifrado. Usamos un "Flex Query" (un reporte de tu cuenta): nunca podemos operar ni mover tu dinero, solo leer lo que tú configures.',
                            'It is READ-ONLY and encrypted. We use a "Flex Query" (a report of your account): we can never trade or move your money, only read what you configure.')}</p>
                    </div>
                    <div className="flex gap-2.5">
                      <span>🧩</span>
                      <p>{t('Solo recibimos las secciones que actives en el Flex Query: posiciones y efectivo de hoy, compras/ventas y depósitos (para el retorno real), y el valor diario de tu cuenta (la gráfica histórica).',
                            'We only receive the sections you enable in the Flex Query: today\'s positions and cash, buys/sells and deposits (for real return), and your daily account value (the historical chart).')}</p>
                    </div>
                  </div>
                )}
              </div>
              {/* Mode tabs: API Sync vs File Import.
                  FASE IH2: dentro del viaje no se muestran. Subir el archivo
                  es el PASO 2, con su propia pantalla: ofrecerlo también como
                  pestaña acá pone al usuario a elegir entre "este paso" y "el
                  siguiente", que es justo la bifurcación que el viaje existe
                  para quitar. Fuera del viaje (abrir IBKR desde conexiones)
                  las dos pestañas siguen siendo la única puerta al archivo. */}
              <div className={`flex bg-theme-base rounded-lg border border-glass-border p-0.5 ${journeyActive ? 'hidden' : ''}`}>
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
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t('Configuración inicial', 'Initial setup')}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('Necesitas un Token y un Query ID de tu cuenta IBKR.',
                     'You need a Token and a Query ID from your IBKR account.')}
                </p>
              </div>

              {/* FASE GM parte 2: una sola fuente de verdad para "cómo conseguir
                  esto" (lib/brokerHowTo.js), la MISMA que ya alimenta el paso
                  de archivo y el wizard de BrokerConnectModal — antes esta
                  pantalla tenía su PROPIA copia hardcodeada de 3 pasos con 4
                  párrafos naranjas siempre expandidos debajo del paso 1, la
                  pared de texto que el usuario señaló como agobiante. */}
              {/* FASE IH2: plegado por defecto. Con los 6 pasos abiertos, los
                  campos de Token y Query ID (lo único que esta pantalla pide)
                  quedaban por debajo del borde inferior: había que hacer
                  scroll a través de toda la instrucción para llegar a la
                  acción. Quien ya sabe conseguir su token no lee nada; quien
                  no, lo abre de un toque. */}
              <BrokerSteps steps={getBrokerHowTo('ibkr').api.steps} note={getBrokerHowTo('ibkr').api.note} variant="api" lang={lang} collapsible />

              <div className="border-t border-glass-border/40 pt-5 space-y-4">
                <div>
                  <label className="text-xs uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Token</label>
                  <input type="password" value={token} onChange={e => { userTypedRef.current = true; setToken(e.target.value) }}
                    placeholder={decrypting ? t('Desencriptando...', 'Decrypting...') : t('Flex Web Service Token', 'Flex Web Service Token')}
                    disabled={decrypting}
                    className="w-full px-4 py-2.5 bg-theme-base border rounded-lg text-sm placeholder-slate-600 focus:outline-none focus:border-[var(--accent-blue)] font-mono"
                    style={{ color: 'var(--text-primary)', borderColor: errorCode === 'TOKEN_EXPIRED' ? 'rgba(239,68,68,0.6)' : 'var(--card-border)' }} />
                  {errorCode === 'TOKEN_EXPIRED' && (
                    <p className="text-xs text-[var(--alert-error-icon)] mt-1">{t('Este token expiró o es inválido.', 'This token has expired or is invalid.')}</p>
                  )}
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--text-muted)' }}>Query ID</label>
                  <input type="text" value={queryId} onChange={e => { userTypedRef.current = true; setQueryId(e.target.value) }}
                    placeholder={t('Ej: 123456', 'E.g.: 123456')}
                    className="w-full px-4 py-2.5 bg-theme-base border rounded-lg text-sm placeholder-slate-600 focus:outline-none focus:border-[var(--accent-blue)] font-mono"
                    style={{ color: 'var(--text-primary)', borderColor: errorCode === 'INVALID_QUERY' ? 'rgba(239,68,68,0.6)' : 'var(--card-border)' }} />
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

              {/* A first-time connect saves and moves on right away (FASE GQ,
                  handleQuickConnect above) instead of blocking on the live Flex
                  round trip. Re-entering this form to change ALREADY-working
                  credentials keeps the old blocking handleSync: that case has a
                  known-good connection to fall back on, so immediate feedback
                  is worth the wait it no longer needs to survive a weekend. */}
              <button onClick={isConnected ? handleSync : handleQuickConnect} disabled={syncing || !token || !queryId || decrypting}
                className="w-full py-3 rounded-xl disabled:opacity-50 hover:opacity-90 transition-all text-sm font-medium flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
                <BusyLabel busy={syncing} lang={lang}
                  busyLabel={isConnected ? t('Conectando con IBKR...', 'Connecting to IBKR...') : t('Guardando...', 'Saving...')}>
                  {isConnected ? t('Sincronizar', 'Sync') : t('Conectar', 'Connect')}
                </BusyLabel>
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
                      {t('Complementa tu sync con un archivo de IBKR: trae el historial de valor, tus operaciones con fecha, depósitos y comisiones que el Flex Query no dio.',
                         'Complement your sync with an IBKR file: it brings the value history, dated trades, deposits and commissions your Flex Query did not deliver.')}
                    </p>
                  </div>

                  {/* Activity Statement is the recommended source: it carries the full
                      NAV history + dated trades + deposits + fees, so it fixes the
                      "returns start from today" case when the Flex Query lacks Equity
                      Summary. */}
                  <div className="px-3 py-2.5 rounded-lg text-xs leading-relaxed"
                    style={{ backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)', color: 'var(--text-secondary)' }}>
                    <span className="font-semibold" style={{ color: 'var(--accent-blue)' }}>{t('Recomendado: Activity Statement.', 'Recommended: Activity Statement.')}</span>
                    <span> {t('Es el que trae el historial de valor completo para que tus retornos midan todo el año.', 'It brings the full value history so your returns measure the whole year.')}</span>
                  </div>

                  <div className="space-y-5 pl-1">
                    <div className="flex gap-4">
                      <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">1.</span>
                      <div>
                        <p className="text-xs text-white font-medium">{t('Abrir el Activity Statement', 'Open the Activity Statement')}</p>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          <span className="text-[var(--accent-blue)] font-mono">interactivebrokers.com</span> → <span className="text-white">Performance & Reports</span> → <span className="text-white">Statements</span> → <span className="text-white">Activity</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">2.</span>
                      <div>
                        <p className="text-xs text-white font-medium">{t('Descargar el reporte', 'Download the report')}</p>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          {t('Período', 'Period')} <span className="text-white">Year to Date</span> {t('(o el rango que quieras), formato', '(or any range you want), format')} <span className="text-white">Excel (XLS)</span> {t('o CSV, y descarga.', 'or CSV, then download.')}
                        </p>
                        <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                          {t('También sirve un CSV de Portfolio Analyst (Reports), pero el Activity Statement trae más historial.',
                             'A Portfolio Analyst CSV (Reports) also works, but the Activity Statement carries more history.')}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-xs text-slate-500 font-mono pt-0.5 shrink-0">3.</span>
                      <p className="text-xs text-white font-medium">{t('Arrastra o selecciona el archivo abajo', 'Drag or select the file below')}</p>
                    </div>
                  </div>

                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.xml" onChange={handleFileSelect} className="hidden" />

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
                        <ChispudoLoader mode="inline" size={24} state="section-loading" lang={lang} />
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
                        <p className="text-xs text-slate-600 mt-3">XML, CSV, XLSX, XLS · Max 5MB</p>
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
                      <BusyRing size="16px" style={{ color: 'var(--accent-blue)' }} />
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

          {/* FASE GQ: replaces the ~90s blocking wait for a first-time connect.
              No "will retry automatically" claim without saying HOW LONG we'll
              stay quiet about it — the 5-business-day figure here (FASE HX)
              must match the threshold ibkrNeedsAttention
              (app/dashboard/page.jsx) actually uses, or the copy and the
              behavior would tell two different stories. */}
          {step === 'journey-saved' && (
            <div className="text-center py-10">
              <CheckCircle size={36} strokeWidth={1.5} className="text-[var(--accent-green)] mx-auto mb-5" />
              <p className="text-white font-medium text-base mb-3">
                {t('Credenciales guardadas', 'Credentials saved')}
              </p>
              <p className="text-sm leading-relaxed max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
                {t('Ya guardamos tu Token y Query ID. En cuanto IBKR responda, tus datos se actualizarán solos: no hace falta que esperes aquí.',
                   'We saved your Token and Query ID. As soon as IBKR responds, your data will update on its own: no need to wait here.')}
              </p>
              <p className="text-xs mt-3 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {t('IBKR suele no responder fuera de horario de mercado (fines de semana, noches). Si sigue sin conectar después de 5 días hábiles, te avisaremos para que revises o cambies tus credenciales.',
                   'IBKR often does not respond outside market hours (weekends, nights). If it still has not connected after 5 business days, we will let you know so you can check or change your credentials.')}
              </p>
              <button onClick={onClose}
                className="mt-8 px-10 py-3 rounded-xl hover:opacity-90 transition-all text-sm font-medium"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
                {t('Continuar', 'Continue')}
              </button>
            </div>
          )}

          {step === 'done' && result && (
            <DoneStep result={result} onClose={onClose} t={t} credWarning={credWarning}
              onComplementFile={() => { setResult(null); setImportMode('file'); setShowConfig(true); setStep('config'); setError(''); setErrorCode('') }} />
          )}
        </div>
      </div>
    </div>
  )
}
