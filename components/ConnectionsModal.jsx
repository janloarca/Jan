'use client'

// Dedicated sync hub: every platform connection (IBKR Flex, API brokers, crypto
// exchanges, on-chain wallets) lives HERE, extracted out of SettingsModal so
// syncing isn't buried behind a settings tab. The dashboard's "Sync" button
// opens this modal directly.

import { useState, useEffect, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { RefreshCw } from 'lucide-react'
import { authFetch, safeJson } from '@/lib/authFetch'
import { getBrokerRegistry } from '@/lib/brokerRegistry'

export default function ConnectionsModal({ onClose, onSyncBroker, onOpenIBKR, onBackgroundSync, onImport, onAddAccount, onOpenBlockchain, onSaveCredentials, lang = 'es', lastSyncTime, portfolioItems = [] }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en

  const [ibkrToken, setIbkrToken] = useState('')
  const [ibkrQueryId, setIbkrQueryId] = useState('')
  const [ibkrConfigured, setIbkrConfigured] = useState(false)
  const [ibkrSaving, setIbkrSaving] = useState(false)
  const [ibkrError, setIbkrError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [brokerConnections, setBrokerConnections] = useState({})
  const [expandedBroker, setExpandedBroker] = useState(null)
  const [brokerForm, setBrokerForm] = useState({})
  const [brokerSyncing, setBrokerSyncing] = useState(null)
  const [brokerError, setBrokerError] = useState(null)

  const flash = (type, msg) => { setSaveStatus({ type, msg }); setTimeout(() => setSaveStatus(null), 3000) }

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
    try {
      const res = await authFetch('/api/brokers/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-credentials', token: ibkrToken, queryId: ibkrQueryId }),
      })
      if (res.ok) {
        setIbkrConfigured(true)
        setIbkrToken('')
        // Mirror the credentials into the client settings doc so the rest of the app
        // (ibkrConnected → header pill, auto-sync, IBKRSyncModal "connected" state)
        // sees the connection. The token stays server-side only (vault); we persist
        // the queryId + a migration flag. Without this the vault holds creds but the
        // app still thinks IBKR is unconnected and re-prompts for the token.
        onSaveCredentials?.({ ibkrToken: null, ibkrQueryId: ibkrQueryId.trim(), _ibkrVaultMigrated: true })
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
      await authFetch('/api/brokers/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-credentials', token: null, queryId: null }),
      })
      setIbkrConfigured(false)
      setIbkrToken('')
      setIbkrQueryId('')
      // Clear the client settings mirror too, so ibkrConnected/auto-sync turn off.
      onSaveCredentials?.({ ibkrToken: null, ibkrQueryId: null, _ibkrVaultMigrated: false })
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
        setExpandedBroker(null)
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
        if (data.positions && onSyncBroker) {
          onSyncBroker(broker.id, data)
        }
        flash('ok', `${broker.name}: ${data.count || 0} ${t('posiciones sincronizadas', 'positions synced')}`)
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
      await authFetch(`/api/brokers/${broker.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-credentials' }),
      })
      setBrokerConnections(prev => { const n = { ...prev }; delete n[broker.id]; return n })
      flash('ok', `${broker.name} ${t('desvinculado', 'unlinked')}`)
    } catch (e) { flash('err', e.message) }
    setBrokerSyncing(null)
  }

  const syncAge = lastSyncTime ? Date.now() - new Date(lastSyncTime).getTime() : null
  const syncDays = syncAge ? Math.floor(syncAge / 86400000) : null
  const syncStatus = !ibkrConfigured ? 'disconnected' : !lastSyncTime ? 'never' : syncDays > 7 ? 'stale' : 'ok'
  const statusColor = {
    disconnected: { dot: 'var(--text-negative)', text: 'var(--text-negative)' },
    never: { dot: 'var(--accent-orange)', text: 'var(--accent-orange)' },
    stale: { dot: 'var(--accent-orange)', text: 'var(--accent-orange)' },
    ok: { dot: '#34d399', text: '#34d399' },
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
  const connectedCount = Object.keys(brokerConnections).length + (ibkrConfigured ? 1 : 0)

  const renderBrokerCard = (broker) => {
    const conn = brokerConnections[broker.id]
    const isExpanded = expandedBroker === broker.id
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
                  {isSyncing ? '...' : 'Sync'}
                </button>
                <button onClick={() => handleBrokerDisconnect(broker)} disabled={isSyncing}
                  className="px-2 py-1 text-xs hover:opacity-100 transition-colors" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>
                  ✕
                </button>
              </>
            ) : broker.hasApi ? (
              <button onClick={() => {
                if (broker.authType === 'oauth') { handleBrokerConnect(broker); return }
                setExpandedBroker(isExpanded ? null : broker.id); setBrokerForm({}); setBrokerError(null)
              }}
                className="px-2.5 py-1 border text-xs font-medium rounded-md hover:bg-blue-500/10 transition-colors" style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                {isSyncing ? '...' : broker.authType === 'oauth' ? 'OAuth' : isExpanded ? t('Cancelar', 'Cancel') : 'API'}
              </button>
            ) : broker.apiNote ? (
              <span className="px-2 py-0.5 text-xs text-slate-600 border border-glass-border/40 rounded">
                {broker.apiNote}
              </span>
            ) : null}
            <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport(broker.id) }, 50) }}
              className="px-2.5 py-1 border border-glass-border text-xs font-medium rounded-md hover:bg-theme-elevated transition-colors" style={{ color: 'var(--text-secondary)' }}>
              CSV
            </button>
          </div>
        </div>
        {isExpanded && broker.hasApi && !broker.authType && (
          <div className="px-3 pb-3 pt-1 border-t border-glass-border/30 space-y-2">
            {broker.instructions && (
              <p className="text-xs text-slate-600">{broker.instructions[lang] || broker.instructions.en}</p>
            )}
            {brokerError && expandedBroker === broker.id && (
              <p className="text-xs" style={{ color: 'var(--text-negative)' }}>{brokerError}</p>
            )}
            {broker.fields.map(f => (
              <div key={f.key}>
                <label className="text-xs text-slate-500 mb-0.5 block">{f.label}</label>
                <input type={f.type || 'text'} value={brokerForm[f.key] || ''}
                  onChange={(e) => setBrokerForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-1.5 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
              </div>
            ))}
            <button onClick={() => handleBrokerConnect(broker)}
              disabled={isSyncing || broker.fields.some(f => !brokerForm[f.key])}
              className="w-full py-2 rounded-lg hover:bg-blue-500 disabled:opacity-50 text-xs font-medium" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
              {isSyncing ? '...' : t('Conectar', 'Connect')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="connections-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="connections-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
            <RefreshCw size={20} style={{ color: 'var(--text-secondary)' }} />
            {t('Conexiones y Sync', 'Connections & Sync')}
            {connectedCount > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: 'var(--accent-green)', backgroundColor: 'rgba(52,211,153,0.12)' }}>
                {connectedCount} {t('activas', 'active')}
              </span>
            )}
          </h2>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        {saveStatus && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-lg text-xs font-medium transition-all" style={{ color: saveStatus.type === 'ok' ? '#34d399' : '#f87171', backgroundColor: saveStatus.type === 'ok' ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)' }}>
            {saveStatus.msg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-5">
            {/* ── IBKR (API + CSV) ── */}
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Interactive Brokers</p>
              <div className="p-3 bg-theme-base border border-glass-border rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <span className="text-xl">🏦</span>
                    <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-[#1C1C1E]" style={{ backgroundColor: statusColor.dot }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">Interactive Brokers</p>
                    <p className="text-xs" style={{ color: statusColor.text }}>
                      {ibkrConfigured ? statusLabel : t('No vinculado', 'Not linked')}
                      {ibkrConfigured && <span className="text-slate-600 ml-1">· ID: {ibkrQueryId}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {ibkrConfigured ? (
                      <button onClick={() => { onClose(); if (onBackgroundSync) onBackgroundSync(); else if (onOpenIBKR) setTimeout(() => onOpenIBKR(), 50) }}
                        className="px-2.5 py-1 text-xs font-medium rounded-md hover:bg-blue-500 transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                        {t('Sincronizar', 'Sync')}
                      </button>
                    ) : (
                      <button onClick={() => setShowConfig(true)}
                        className="px-2.5 py-1 border text-xs font-medium rounded-md hover:bg-blue-500/10 transition-colors" style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                        API
                      </button>
                    )}
                    <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport('ibkr') }, 50) }}
                      className="px-2.5 py-1 border border-glass-border text-xs font-medium rounded-md hover:bg-theme-elevated transition-colors" style={{ color: 'var(--text-secondary)' }}>
                      CSV
                    </button>
                  </div>
                </div>
                {ibkrConfigured && syncStatus === 'stale' && (
                  <p className="text-xs mt-2 pl-9" style={{ color: 'var(--accent-orange)' }}>
                    {t('Tus datos podrían estar desactualizados', 'Your data may be outdated')}
                  </p>
                )}
              </div>

              {!ibkrConfigured && showConfig && (
                <div className="space-y-3 p-3 bg-theme-base border border-glass-border rounded-xl mt-2">
                  <p className="text-xs text-slate-600">
                    {t('Ve a IBKR → Reports → Flex Queries → crear query con Open Positions + Trades + Cash Transactions + Equity Summary (esta última da tus retornos reales y la gráfica). Genera un Flex Token en Settings.',
                       'Go to IBKR → Reports → Flex Queries → create query with Open Positions + Trades + Cash Transactions + Equity Summary (this last one powers your real returns and chart). Generate a Flex Token in Settings.')}
                  </p>
                  {ibkrError && <p className="text-xs" style={{ color: 'var(--text-negative)' }}>{ibkrError}</p>}
                  <div>
                    <label className="text-xs text-slate-500 mb-0.5 block">Flex Token</label>
                    <input type="password" value={ibkrToken} onChange={(e) => setIbkrToken(e.target.value)}
                      placeholder="••••••••••••••••"
                      className="w-full px-3 py-1.5 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-0.5 block">Query ID</label>
                    <input type="text" value={ibkrQueryId} onChange={(e) => setIbkrQueryId(e.target.value)}
                      placeholder="123456"
                      className="w-full px-3 py-1.5 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                  </div>
                  <button onClick={handleIbkrSave} disabled={ibkrSaving || !ibkrToken || !ibkrQueryId}
                    className="w-full py-2 rounded-lg hover:bg-blue-500 disabled:opacity-50 text-xs font-medium" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                    {ibkrSaving ? '...' : t('Conectar', 'Connect')}
                  </button>
                </div>
              )}

              {ibkrConfigured && !confirmUnlink && (
                <button onClick={() => setConfirmUnlink(true)}
                  className="text-xs hover:opacity-100 transition-colors mt-2" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>
                  {t('Desvincular', 'Unlink')}
                </button>
              )}
              {ibkrConfigured && confirmUnlink && (
                <div className="p-3 bg-theme-surface border border-glass-border border-l-4 border-l-red-500 rounded-lg space-y-2 mt-2">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-negative)' }}>{t('¿Desvincular Interactive Brokers?', 'Unlink Interactive Brokers?')}</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {t('Se eliminará la conexión API. Tus posiciones importadas se mantienen.',
                       'The API connection will be removed. Your imported positions will be kept.')}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={async () => { await handleIbkrDisconnect(); setConfirmUnlink(false) }} disabled={ibkrSaving}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-red-500 transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--text-negative)' }}>
                      {ibkrSaving ? '...' : t('Sí', 'Yes')}
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
                  <span className="text-slate-600 ml-1">({cryptoBrokers.length + 1})</span>
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
          </div>
        </div>
      </div>
    </div>
  )
}
