'use client'

// Dedicated sync hub: every platform connection (IBKR Flex, API brokers, crypto
// exchanges, on-chain wallets) lives HERE, extracted out of SettingsModal so
// syncing isn't buried behind a settings tab. The dashboard's "Sync" button
// opens this modal directly.

import { useState, useEffect, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { RefreshCw, Rocket } from 'lucide-react'
import { authFetch, safeJson } from '@/lib/authFetch'
import { clearIbkrCredentials } from '@/lib/ibkrVault'
import { getBrokerRegistry, IBKR_DISCONNECTED_FIELDS } from '@/lib/brokerRegistry'
import { getBrokerHowTo } from '@/lib/brokerHowTo'
import { syncSkipReasonText } from '@/lib/ibkrSchedule'
import BrokerConnectModal from '@/components/BrokerConnectModal'
import ModalMount from '@/components/ui/ModalMount'
import useModalExit from '@/hooks/useModalExit'
import BrokerProgressPanel from '@/components/dashboard/BrokerProgressPanel'
import BusyLabel from '@/components/ui/BusyLabel'

// Not a lib/brokerRegistry.js entry: IBKR's /api/brokers/ibkr endpoint takes
// {token, queryId}, not the generic {fields: [...]} shape every registry
// broker uses, so it's excluded on purpose from getBrokerRegistry() (e.g.
// disconnectAllSyncs iterates hasApi brokers and handles IBKR separately).
// This is just enough of a broker-shaped object to feed the SAME wizard every
// other broker gets — BrokerConnectModal special-cases id === 'ibkr' to
// render the Token/Query ID pair instead of a generic credentials form.
const IBKR_PSEUDO_BROKER = { id: 'ibkr', name: 'Interactive Brokers', icon: '🏦', hasApi: true, authType: null, fields: [] }

export default function ConnectionsModal({ onClose, onSyncBroker, onOpenIBKR, onStartIbkrJourney, onBackgroundSync, onImport, onAddAccount, onOpenBlockchain, onOpenLedger, onSaveCredentials, onCalibrate, onOpenBrokerChecklist, lang = 'es', lastSyncTime, portfolioItems = [],
  // FASE IH: el avance real de IBKR (lib/ibkrJourney.js). Mientras nada esté
  // cumplido, la tarjeta se queda con "Empezar" (no hay progreso que mostrar
  // y ese es el botón correcto). En cuanto el usuario cumple el primer
  // requisito aparece el panel con el % y los requisitos tocables, que es lo
  // que pidió: "un panel con los requisitos y un % del 1 al cien y que toque
  // el que quiere editar".
  ibkrProgress = null, onOpenIbkrStep = null,
  // ⛔ FASE KI. Por qué falló el último sync, dicho.
  //
  // El servidor SIEMPRE nos dice la razón y la guardamos
  // (`_ibkrAutoSyncError` / `_ibkrAutoSyncErrorCode`), pero hasta acá NADIE la
  // renderizaba: `ibkrSyncError` salía del hook y no tenía un solo consumidor.
  // O sea el dato existía y era inalcanzable, la misma clase de campo muerto
  // que `prefs.profileName` (leído y nunca escrito) y `lastUsedAt` (escrito y
  // nunca leído). El banner del tablero traduce el CÓDIGO a una frase, pero
  // nunca muestra el mensaje del servidor, así que un código sin mapear cae a
  // "la última sincronización falló": cero información accionable.
  //
  // Va acá y no en el banner porque esta es la pantalla a la que uno viene
  // cuando algo anda mal, y porque en un teléfono no hay consola: sin esto,
  // "no me funciona IBKR" obliga a una ronda de preguntas para saber si es un
  // token vencido, un bloqueo temporal o la query mal configurada.
  ibkrSyncError = null, ibkrSyncErrorCode = null, ibkrLastAttempt = null,
  ibkrUpstreamError = null, ibkrSkipReason = null,
}) {
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en

  const [ibkrToken, setIbkrToken] = useState('')
  const [ibkrQueryId, setIbkrQueryId] = useState('')
  const [ibkrConfigured, setIbkrConfigured] = useState(false)
  const [ibkrSaving, setIbkrSaving] = useState(false)
  const [ibkrError, setIbkrError] = useState('')
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [brokerConnections, setBrokerConnections] = useState({})
  const [connectBroker, setConnectBroker] = useState(null)
  // El wizard sobrevive su animación de salida. Ver hooks/useModalExit.js.
  const [connectShown, connectClosing] = useModalExit(connectBroker)
  const [brokerForm, setBrokerForm] = useState({})
  const [brokerSyncing, setBrokerSyncing] = useState(null)
  const [brokerError, setBrokerError] = useState(null)

  const flash = (type, msg) => { setSaveStatus({ type, msg }); setTimeout(() => setSaveStatus(null), 3000) }

  // "Arrancado" = al menos un requisito cumplido. Con cero, la tarjeta se
  // queda como estaba (un botón "Empezar" y nada más): un panel de 0% sobre
  // cuatro filas vacías no informa nada que el botón no diga mejor.
  const ibkrStarted = !!(ibkrProgress && ibkrProgress.started && ibkrProgress.steps?.length)

  const BROKER_REGISTRY = getBrokerRegistry(t)

  const institutionSummaries = useMemo(() => {
    const map = {}
    for (const item of portfolioItems) {
      const inst = (item.institution || '').trim()
      if (!inst) continue
      if (!map[inst]) map[inst] = { name: inst, count: 0, value: 0, isIbkr: false }
      map[inst].count++
      const val = (item.currentPrice || item.purchasePrice || 0) * (item.quantity || 1)
      map[inst].value += val
      if (item._source === 'ibkr' || inst.toLowerCase().includes('interactive brokers') || inst.toLowerCase() === 'ibkr') {
        map[inst].isIbkr = true
      }
    }
    return Object.values(map).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  }, [portfolioItems])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    authFetch('/api/brokers/ibkr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get-credentials' }),
    }).then((r) => r.ok ? safeJson(r) : null).then((d) => {
      if (d?.configured) {
        setIbkrConfigured(true)
        setIbkrQueryId(d.flexQueryId || '')
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const apiBrokers = BROKER_REGISTRY.filter(b => b.hasApi)
    apiBrokers.forEach(broker => {
      authFetch(`/api/brokers/${broker.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-credentials' }),
        signal: controller.signal,
      }).then(r => r.ok ? safeJson(r) : null).then(d => {
        if (controller.signal.aborted) return
        if (d?.configured) {
          setBrokerConnections(prev => ({ ...prev, [broker.id]: { configured: true, lastSync: d.lastSync } }))
        }
      }).catch(() => {})
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleIbkrSave = async () => {
    setIbkrSaving(true)
    setIbkrError('')
    // Captured BEFORE the write: whether this is a brand-new connection (the
    // case the continuous flow below is for) vs. a token refresh on an
    // already-configured account (where popping the checklist unprompted
    // would just be noise on top of a routine credential update).
    const wasFreshConnect = !ibkrConfigured
    try {
      const res = await authFetch('/api/brokers/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-credentials', token: ibkrToken, queryId: ibkrQueryId }),
      })
      if (res.ok) {
        setIbkrConfigured(true)
        setIbkrToken('')
        setConnectBroker(null)
        // Mirror the credentials into the client settings doc so the rest of the app
        // (ibkrConnected → header pill, auto-sync, IBKRSyncModal "connected" state)
        // sees the connection. The token stays server-side only (vault); we persist
        // the queryId + a migration flag. Without this the vault holds creds but the
        // app still thinks IBKR is unconnected and re-prompts for the token.
        onSaveCredentials?.({ ibkrToken: null, ibkrQueryId: ibkrQueryId.trim(), _ibkrVaultMigrated: true })
        // Continue straight into "llevar al 100%" instead of dropping the user
        // back on the connections list to go find that button themselves — the
        // user's own complaint: "hacer los pasos bien... mas UI paso por paso
        // sin moverse mucho de pantallas, continuo". Same close+reopen pattern
        // the existing "Completar historial" button already uses (onClose then
        // a short delay before the next modal mounts), just fired automatically
        // on the FIRST successful connect instead of requiring the user to find
        // and click it.
        if (wasFreshConnect && onOpenBrokerChecklist) {
          onClose()
          setTimeout(() => onOpenBrokerChecklist('ibkr'), 50)
        }
      } else {
        const d = await safeJson(res) || {}
        setIbkrError(d.error || 'Error')
      }
    } catch (e) { setIbkrError(e.message) }
    setIbkrSaving(false)
  }

  const handleIbkrDisconnect = async () => {
    setIbkrSaving(true)
    try {
      // FASE KC: lanza si el servidor no confirmó el borrado. Antes se
      // limpiaba la UI y se decía "IBKR desvinculado" igual, dejando el token
      // cifrado vivo en el vault: reconectar lo encontraba de vuelta.
      await clearIbkrCredentials()
      setIbkrConfigured(false)
      setIbkrToken('')
      setIbkrQueryId('')
      // Clear the client settings mirror AND every auto-sync status/error
      // field — leaving _ibkrAutoSyncErrorCode set kept the "IBKR bloqueó tu
      // token" banner showing forever even after unlinking, with no way to
      // dismiss it short of reconnecting.
      onSaveCredentials?.(IBKR_DISCONNECTED_FIELDS)
      flash('ok', t('IBKR desvinculado', 'IBKR unlinked'))
    } catch (e) { flash('err', e.message || t('Error al desvincular', 'Error unlinking')) }
    setIbkrSaving(false)
  }

  const handleBrokerConnect = async (broker) => {
    setBrokerSyncing(broker.id)
    setBrokerError(null)

    if (broker.authType === 'oauth') {
      try {
        const res = await authFetch(`/api/brokers/${broker.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get-auth-url' }),
        })
        if (res.ok) {
          const data = await safeJson(res)
          if (data.url) {
            window.open(data.url, '_blank', 'width=600,height=700')
            flash('ok', t('Ventana de autorización abierta. Completa el proceso allí.', 'Authorization window opened. Complete the process there.'))
          }
        } else {
          const d = await safeJson(res) || {}
          setBrokerError(d.error || 'OAuth not configured')
        }
      } catch (e) { setBrokerError(e.message) }
      setBrokerSyncing(null)
      return
    }

    try {
      const res = await authFetch(`/api/brokers/${broker.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-credentials', ...brokerForm }),
      })
      if (res.ok) {
        setBrokerConnections(prev => ({ ...prev, [broker.id]: { configured: true } }))
        setConnectBroker(null)
        setBrokerForm({})
        flash('ok', `${broker.name} ${t('vinculado', 'linked')}`)
      } else {
        const d = await safeJson(res) || {}
        setBrokerError(d.error || 'Error')
      }
    } catch (e) { setBrokerError(e.message) }
    setBrokerSyncing(null)
  }

  const handleBrokerSync = async (broker) => {
    setBrokerSyncing(broker.id)
    setBrokerError(null)
    try {
      const res = await authFetch(`/api/brokers/${broker.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      if (res.ok) {
        const data = await safeJson(res)
        // A 200 can still carry an error body (EMPTY_PORTFOLIO and friends) — the old
        // code ignored it and flashed a green "0 positions synced", so an expired
        // token or a swallowed per-account failure looked like a success.
        const n = (data.positions || []).length || data.count || 0
        if (data.error || n === 0) {
          setBrokerError(data.error || t('No se recibió ninguna posición. Revisa que la conexión siga activa.',
                                         'No positions received. Check that the connection is still active.'))
        } else {
          if (data.positions && onSyncBroker) await onSyncBroker(broker.id, data)
          flash('ok', `${broker.name}: ${n} ${t('posiciones sincronizadas', 'positions synced')}`)
        }
      } else {
        const d = await safeJson(res) || {}
        setBrokerError(d.error || 'Sync failed')
      }
    } catch (e) { setBrokerError(e.message) }
    setBrokerSyncing(null)
  }

  const handleBrokerDisconnect = async (broker) => {
    setBrokerSyncing(broker.id)
    try {
      const res = await authFetch(`/api/brokers/${broker.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-credentials' }),
      })
      // Without this check a server-side failure still cleared the card and said
      // "unlinked" while the encrypted credential stayed in the vault.
      if (!res.ok) {
        const d = await safeJson(res) || {}
        throw new Error(d.error || t('No se pudo desvincular. Intenta de nuevo.', 'Could not unlink. Try again.'))
      }
      setBrokerConnections(prev => { const n = { ...prev }; delete n[broker.id]; return n })
      flash('ok', `${broker.name} ${t('desvinculado', 'unlinked')}`)
    } catch (e) { flash('err', e.message) }
    setBrokerSyncing(null)
  }

  // FASE IH3. "¿Está vinculado?" tenía DOS respuestas en esta pantalla y se
  // contradecían a la vista: la fila leía SOLO el vault del servidor
  // (ibkrConfigured, del fetch de get-credentials) mientras el panel de abajo
  // lee el estado que usa toda la app (settings: ibkrToken/_ibkrVaultMigrated
  // + ibkrQueryId, vía el paso 'connect' de lib/ibkrJourney.js). Con el vault
  // sin contestar todavía, o si su fetch falló (se traga el error con
  // .catch), la tarjeta imprimía "No vinculado" en rojo justo encima de un
  // "Conectar por API: Listo" con check verde.
  //
  // Manda el estado de la app, no el vault: es el mismo que ya decide el pill
  // del header, el auto-sync y cómo abre IBKRSyncModal, así que esta pantalla
  // era la única discrepando (misma lección que FASE AF, que documenta cómo
  // juzgar por el vault solo hacía leer como desconectada toda conexión ya
  // migrada).
  // ⛔ FASE KI. La hora del último intento se formatea DESPUÉS de montar, nunca
  // durante el render. `toLocaleString` depende de la zona horaria, y el
  // servidor renderiza en UTC mientras el navegador lo hace en la del usuario:
  // "04:38 p. m." contra "10:38 a. m." es un desajuste de hidratación, y React
  // descarta el árbol servido y vuelve a renderizar. Verificado con un A/B en
  // el navegador: 0 pageerrors sin esta línea, 8 con ella formateando en el
  // render. Es la MISMA trampa que FASE JT ya documenta para la pantalla de
  // error; el estado arranca vacío, así que servidor y primer render del
  // cliente coinciden y el efecto lo rellena después.
  const skipReasonText = useMemo(() => syncSkipReasonText(ibkrSkipReason, lang), [ibkrSkipReason, lang])
  const [attemptLabel, setAttemptLabel] = useState('')
  useEffect(() => {
    if (!ibkrLastAttempt) { setAttemptLabel(''); return }
    const d = new Date(ibkrLastAttempt)
    if (isNaN(d.getTime())) { setAttemptLabel(''); return }
    setAttemptLabel(d.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }))
  }, [ibkrLastAttempt, lang])

  const ibkrLinked = ibkrConfigured || !!ibkrProgress?.steps?.find((s) => s.id === 'connect')?.done
  const syncAge = lastSyncTime ? Date.now() - new Date(lastSyncTime).getTime() : null
  const syncDays = syncAge ? Math.floor(syncAge / 86400000) : null
  const syncStatus = !ibkrLinked ? 'disconnected' : !lastSyncTime ? 'never' : syncDays > 7 ? 'stale' : 'ok'
  const statusColor = {
    disconnected: { dot: 'var(--text-negative)', text: 'var(--text-negative)' },
    never: { dot: 'var(--accent-orange)', text: 'var(--accent-orange)' },
    stale: { dot: 'var(--accent-orange)', text: 'var(--accent-orange)' },
    ok: { dot: 'var(--accent-green)', text: 'var(--accent-green)' },
  }[syncStatus]
  const statusLabel = {
    disconnected: t('No vinculado', 'Not linked'),
    never: t('Nunca sincronizado', 'Never synced'),
    stale: t(`Hace ${syncDays}d`, `${syncDays}d ago`),
    ok: syncDays === 0 ? t('Hoy', 'Today') : t(`Hace ${syncDays}d`, `${syncDays}d ago`),
  }[syncStatus]

  const nonIbkrInstitutions = institutionSummaries.filter(inst => !inst.isIbkr)
  const traditionalBrokers = BROKER_REGISTRY.filter(b => b.category === 'traditional')
  const cryptoBrokers = BROKER_REGISTRY.filter(b => b.category === 'crypto')
  const connectedCount = Object.keys(brokerConnections).length + (ibkrLinked ? 1 : 0)

  const renderBrokerCard = (broker) => {
    const conn = brokerConnections[broker.id]
    const isSyncing = brokerSyncing === broker.id
    return (
      <div key={broker.id} className="bg-theme-base border border-glass-border/60 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="relative shrink-0">
            <span className="text-sm">{broker.icon}</span>
            {conn?.configured && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full border border-[#000000]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white">{broker.name}</p>
            {conn?.configured && (
              <p className="text-xs" style={{ color: 'var(--accent-green)' }}>{t('Vinculado', 'Linked')}</p>
            )}
            {!conn?.configured && broker.apiNote && !broker.hasApi && (
              <p className="text-xs text-slate-600">{broker.apiNote}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {broker.hasApi && conn?.configured ? (
              <>
                <button onClick={() => handleBrokerSync(broker)} disabled={isSyncing}
                  className="px-2.5 py-1 text-xs font-medium rounded-md hover:bg-blue-500 disabled:opacity-50 transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                  {<BusyLabel busy={isSyncing} lang={lang}>{'Sync'}</BusyLabel>}
                </button>
                <button onClick={() => handleBrokerDisconnect(broker)} disabled={isSyncing}
                  className="px-2 py-1 text-xs hover:opacity-100 transition-colors" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>
                  ✕
                </button>
              </>
            ) : (
              /* One entry point instead of the old API / Pasos / CSV row: every
                 way of bringing data in (file, screenshot, API) lives inside the
                 step wizard now, so there is nothing left to choose between
                 before even knowing what each button did (FASE EY). */
              <button onClick={() => { setConnectBroker(broker); setBrokerForm({}); setBrokerError(null) }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg hover:brightness-110 active:scale-[0.97] transition-all"
                style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)', boxShadow: '0 1px 4px rgba(37,99,235,0.35)' }}>
                <Rocket size={13} strokeWidth={2.25} />
                {t('Empezar', 'Get started')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="connections-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="connections-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
            <RefreshCw size={20} style={{ color: 'var(--text-secondary)' }} />
            {t('Conexiones y Sync', 'Connections & Sync')}
            {connectedCount > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: 'var(--accent-green)', backgroundColor: 'rgba(52,211,153,0.12)' }}>
                {connectedCount} {connectedCount === 1 ? t('activa', 'active') : t('activas', 'active')}
              </span>
            )}
          </h2>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        {saveStatus && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-lg text-xs font-medium transition-all" style={{ color: saveStatus.type === 'ok' ? 'var(--accent-green)' : 'var(--accent-red)', backgroundColor: saveStatus.type === 'ok' ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)' }}>
            {saveStatus.msg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-5">
            {/* IBKR keeps a dedicated block because its setup (Flex Query + token) needs
                more UI than a registry card. But the heading used to read "Interactive
                Brokers" at the very top, so a NEW user opened the panel and saw one
                broker privileged above all others for no reason. Now it is labelled by
                ROLE: your live connection when configured, "quick connect" when not. */}
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">
                {ibkrLinked ? t('Conectado', 'Connected') : t('Conexión rápida', 'Quick connect')}
              </p>
              <div className="p-3 bg-theme-base border border-glass-border rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <span className="text-xl">🏦</span>
                    <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-[#1C1C1E]" style={{ backgroundColor: statusColor.dot }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">Interactive Brokers</p>
                    <p className="text-xs" style={{ color: statusColor.text }}>
                      {ibkrLinked ? statusLabel : t('No vinculado', 'Not linked')}
                      {ibkrLinked && ibkrQueryId && <span className="text-slate-600 ml-1">· ID: {ibkrQueryId}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {ibkrLinked ? (
                      <button onClick={() => { onClose(); if (onBackgroundSync) onBackgroundSync(); else if (onOpenIBKR) setTimeout(() => onOpenIBKR(), 50) }}
                        className="px-2.5 py-1 text-xs font-medium rounded-md hover:bg-blue-500 transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                        {t('Sincronizar', 'Sync')}
                      </button>
                    ) : (
                      /* Same single entry point every other broker got — the
                         Token/Query ID pair (IBKR's own credential shape, not
                         the generic fields form) lives inside the wizard's
                         API step now instead of this inline expansion. */
                      /* FASE GM: con el orquestador disponible, "Empezar"
                         arranca el viaje continuo de 5 pasos (conectar →
                         archivo → foto → % → resumen) en vez del wizard
                         suelto que soltaba al usuario tras cada paso. */
                      <button onClick={() => { if (onStartIbkrJourney) onStartIbkrJourney(ibkrStarted ? (ibkrProgress.nextStep || 1) : 1); else setConnectBroker(IBKR_PSEUDO_BROKER) }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg hover:brightness-110 active:scale-[0.97] transition-all"
                        style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)', boxShadow: '0 1px 4px rgba(37,99,235,0.35)' }}>
                        <Rocket size={13} strokeWidth={2.25} />
                        {ibkrStarted ? t('Continuar', 'Continue') : t('Empezar', 'Get started')}
                      </button>
                    )}
                  </div>
                </div>
                {ibkrLinked && syncStatus === 'stale' && (
                  <p className="text-xs mt-2 pl-9" style={{ color: 'var(--accent-orange)' }}>
                    {t('Tus datos podrían estar desactualizados', 'Your data may be outdated')}
                  </p>
                )}
                {ibkrLinked && (ibkrSyncError || ibkrSyncErrorCode) && (
                  <div className="text-xs mt-2 pl-9 leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
                    <p>
                      {t('Último intento: falló', 'Last attempt: failed')}
                      {attemptLabel ? ` · ${attemptLabel}` : ''}
                      {ibkrSyncErrorCode ? ` · ${ibkrSyncErrorCode}` : ''}
                    </p>
                    {/* El mensaje CRUDO del servidor. Un código que todavía no
                        mapeamos deja de ser un callejón sin salida: lo que IBKR
                        contestó se puede leer y reportar tal cual. */}
                    {ibkrSyncError && (
                      <p className="mt-0.5" style={{ opacity: 0.85, wordBreak: 'break-word' }}>{ibkrSyncError}</p>
                    )}
                    {/* Lo que IBKR dijo LITERALMENTE, y solo cuando aporta algo
                        que nuestro texto no dice: para un codigo mapeado los dos
                        son la misma frase con otras palabras, y repetirla fue
                        justo el defecto de FASE KM. */}
                    {ibkrUpstreamError && ibkrUpstreamError !== ibkrSyncError && (
                      <p className="mt-0.5 font-mono text-[10px]" style={{ opacity: 0.7, wordBreak: 'break-word' }}>
                        IBKR: {ibkrUpstreamError}
                      </p>
                    )}
                  </div>
                )}
                {/* Por que el automatico no esta corriendo. Sin esto, "no
                    sincroniza" y "sincronizo hace un rato y no toca hasta
                    maniana" se ven exactamente igual. */}
                {ibkrLinked && !ibkrSyncError && skipReasonText && (
                  <p className="text-xs mt-2 pl-9" style={{ color: 'var(--text-muted)' }}>{skipReasonText}</p>
                )}
                {/* El 365-day Flex cap hace que "conectado" casi nunca sea
                    "completo". Antes eso era un link de texto ("Completar
                    historial (3 pasos)") que había que saber que existía;
                    ahora es el panel con el % y los requisitos, cada uno
                    tocable para ir a editarlo directo. */}
                {ibkrStarted && (
                  <div className="mt-3">
                    <BrokerProgressPanel
                      progress={ibkrProgress}
                      lang={lang}
                      compact
                      // En la lista compite por espacio con los otros brokers:
                      // se pliega, y con todo listo arranca plegado.
                      collapsible
                      // Sin conectar, la fila de arriba ya trae "Continuar" y
                      // arranca en el mismo paso; conectado dice "Sincronizar"
                      // y entonces el panel es el único camino a lo que falta.
                      showCta={ibkrLinked}
                      onOpenStep={(n) => {
                        if (onOpenIbkrStep) { onClose(); setTimeout(() => onOpenIbkrStep(n), 50) }
                        else if (onOpenBrokerChecklist) { onClose(); setTimeout(() => onOpenBrokerChecklist('ibkr'), 50) }
                      }}
                    />
                  </div>
                )}
                {/* Fallback para cuando el avance no llegó como prop (ningún
                    caller lo omite hoy, pero la puerta al checklist no puede
                    depender de eso). */}
                {ibkrLinked && !ibkrStarted && onOpenBrokerChecklist && (
                  <button onClick={() => { onClose(); setTimeout(() => onOpenBrokerChecklist('ibkr'), 50) }}
                    className="text-xs mt-2 pl-9 hover:underline transition-colors" style={{ color: 'var(--accent-blue)' }}>
                    {t('Completar historial', 'Complete history')}
                  </button>
                )}
              </div>

              {ibkrLinked && !confirmUnlink && (
                <button onClick={() => setConfirmUnlink(true)}
                  className="text-xs hover:opacity-100 transition-colors mt-2" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>
                  {t('Desvincular', 'Unlink')}
                </button>
              )}
              {ibkrLinked && confirmUnlink && (
                <div className="p-3 bg-theme-surface border border-glass-border border-l-4 border-l-red-500 rounded-lg space-y-2 mt-2">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-negative)' }}>{t('¿Desvincular Interactive Brokers?', 'Unlink Interactive Brokers?')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {t('Se eliminará la conexión API. Tus posiciones importadas se mantienen.',
                       'The API connection will be removed. Your imported positions will be kept.')}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={async () => { await handleIbkrDisconnect(); setConfirmUnlink(false) }} disabled={ibkrSaving}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-red-500 transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--text-negative)' }}>
                      {<BusyLabel busy={ibkrSaving} lang={lang}>{t('Sí', 'Yes')}</BusyLabel>}
                    </button>
                    <button onClick={() => setConfirmUnlink(false)}
                      className="px-3 py-1.5 border border-glass-border text-xs rounded-lg hover:bg-theme-elevated transition-colors" style={{ color: 'var(--text-secondary)' }}>
                      {t('No', 'No')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── BROKERS TRADICIONALES ── */}
            <details className="group" open>
              <summary className="flex items-center justify-between cursor-pointer">
                <p className="text-xs text-slate-500 uppercase tracking-wider">
                  {t('Brokers Tradicionales', 'Traditional Brokers')}
                  <span className="text-slate-600 ml-1">({traditionalBrokers.length})</span>
                </p>
                <span className="text-xs text-slate-600 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-2 space-y-1">
                {traditionalBrokers.map(renderBrokerCard)}
              </div>
            </details>

            {/* ── CRYPTO ── */}
            <details className="group" open>
              <summary className="flex items-center justify-between cursor-pointer">
                <p className="text-xs text-slate-500 uppercase tracking-wider">
                  Crypto
                  <span className="text-slate-600 ml-1">({cryptoBrokers.length + 2})</span>
                </p>
                <span className="text-xs text-slate-600 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-2 space-y-1">
                {cryptoBrokers.map(renderBrokerCard)}
                <div className="bg-theme-base border border-glass-border/60 rounded-lg">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <span className="text-sm">🔗</span>
                    <div className="flex-1">
                      <p className="text-sm text-white">{t('Wallet on-chain', 'On-chain Wallet')}</p>
                      <p className="text-xs text-slate-600">Blockchain.com, Ledger, MetaMask</p>
                    </div>
                    <button onClick={() => { onClose(); setTimeout(() => { if (onOpenBlockchain) onOpenBlockchain() }, 50) }}
                      className="px-2.5 py-1 border text-xs font-medium rounded-md hover:bg-blue-500/10 transition-colors" style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                      {t('Conectar', 'Connect')}
                    </button>
                  </div>
                </div>
                <div className="bg-theme-base border border-glass-border/60 rounded-lg">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <span className="text-sm">🔒</span>
                    <div className="flex-1">
                      <p className="text-sm text-white">{t('Cripto por dirección', 'Crypto by address')}</p>
                      <p className="text-xs text-slate-600">Ledger, Trezor, Coldcard (watch-only)</p>
                    </div>
                    <button onClick={() => { onClose(); setTimeout(() => { if (onOpenLedger) onOpenLedger() }, 50) }}
                      className="px-2.5 py-1 border text-xs font-medium rounded-md hover:bg-blue-500/10 transition-colors" style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                      {t('Conectar', 'Connect')}
                    </button>
                  </div>
                </div>
              </div>
            </details>

            {/* ── PRIVADO / VC ── */}
            <details className="group">
              <summary className="flex items-center justify-between cursor-pointer">
                <p className="text-xs text-slate-500 uppercase tracking-wider">{t('Privado / VC', 'Private / VC')}</p>
                <span className="text-xs text-slate-600 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-xs text-slate-600 mb-1">
                  {t('SAFE notes, VC funds, PE, club deals.',
                     'SAFE notes, VC funds, PE, club deals.')}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => { onClose(); setTimeout(() => { if (onAddAccount) onAddAccount() }, 50) }}
                    className="flex-1 px-3 py-2 border text-xs font-medium rounded-lg hover:bg-blue-500/10 transition-colors" style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                    {t('Agregar', 'Add')}
                  </button>
                  <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport() }, 50) }}
                    className="flex-1 px-3 py-2 border border-glass-border text-xs font-medium rounded-lg hover:bg-theme-elevated transition-colors" style={{ color: 'var(--text-secondary)' }}>
                    CSV
                  </button>
                </div>
              </div>
            </details>

            {/* ── YOUR INSTITUTIONS ── */}
            {nonIbkrInstitutions.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">{t('Tus instituciones', 'Your institutions')}</p>
                <div className="space-y-1">
                  {nonIbkrInstitutions.map(inst => (
                    <div key={inst.name} className="flex items-center gap-3 px-3 py-2 bg-theme-base border border-glass-border/60 rounded-lg">
                      <span className="text-slate-500 text-sm">🏢</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">{inst.name}</p>
                        <p className="text-xs text-slate-500">
                          {inst.count} {t('posiciones', 'positions')} · ${Math.abs(inst.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Calibrate return: lives here (account-sync context) instead of
                on the net worth card, which was getting crowded with actions
                that aren't "look at your number" — this is "fix your number". */}
            {onCalibrate && (
              <button onClick={() => { onClose(); setTimeout(() => onCalibrate(), 50) }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-theme-base border border-glass-border/60 rounded-lg hover:bg-theme-elevated transition-colors text-left">
                <span className="min-w-0">
                  <span className="text-sm text-white font-medium block">{t('¿Tu retorno no cuadra con tu broker?', "Your return doesn't match your broker?")}</span>
                  <span className="text-xs text-slate-500">{t('Escribe el % que ves ahí y lo calibramos', 'Type the % you see there and we calibrate it')}</span>
                </span>
                <span className="text-xs shrink-0" style={{ color: 'var(--accent-blue)' }}>{t('Calibrar', 'Calibrate')}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    <ModalMount closing={connectClosing}>
    {connectShown && (
      <BrokerConnectModal
        broker={connectShown}
        howTo={getBrokerHowTo(connectShown.id)}
        lang={lang}
        onClose={() => setConnectBroker(null)}
        onCloseAll={onClose}
        onImport={onImport}
        brokerForm={brokerForm}
        setBrokerForm={setBrokerForm}
        onSubmitApi={connectShown.id === 'ibkr' ? handleIbkrSave : () => handleBrokerConnect(connectShown)}
        isSyncing={connectShown.id === 'ibkr' ? ibkrSaving : brokerSyncing === connectShown.id}
        error={connectShown.id === 'ibkr' ? ibkrError : brokerError}
        ibkrToken={ibkrToken}
        setIbkrToken={setIbkrToken}
        ibkrQueryId={ibkrQueryId}
        setIbkrQueryId={setIbkrQueryId}
      />
    )}
    </ModalMount>
    </>
  )
}
