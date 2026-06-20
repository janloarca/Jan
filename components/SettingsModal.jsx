'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { Settings, Building2, Users } from 'lucide-react'
import EntityManager from '@/components/dashboard/EntityManager'
import { authFetch, safeJson } from '@/lib/authFetch'
import { isNotificationSupported, getNotificationPermission, requestNotificationPermission } from '@/lib/notifications'
import { BENCHMARKS } from '@/hooks/useBenchmark'

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'MXN', name: 'Peso Mexicano', symbol: '$' },
  { code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  { code: 'COP', name: 'Peso Colombiano', symbol: '$' },
  { code: 'CLP', name: 'Peso Chileno', symbol: '$' },
  { code: 'ARS', name: 'Peso Argentino', symbol: '$' },
  { code: 'BRL', name: 'Real Brasileño', symbol: 'R$' },
  { code: 'PEN', name: 'Sol Peruano', symbol: 'S/' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
]

export default function SettingsModal({ onClose, settings, onSaveSettings, onDeleteAllItems, onDeleteAllSnapshots, onDeleteAllTransactions, onDeleteAllFinanceTransactions, onExportBackup, onSyncBroker, onOpenIBKR, onImport, onAddAccount, onOpenBlockchain, entities, onAddEntity, onUpdateEntity, onDeleteEntity, theme, onToggleTheme, beginnerMode = false, onToggleBeginner, lang = 'es', profile, onSaveProfile, lastSyncTime, portfolioItems = [] }) {
  const trapRef = useFocusTrap()
  const [baseCurrency, setBaseCurrency] = useState(settings?.baseCurrency || 'USD')
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(settings?.benchmarkSymbol || '%5EGSPC')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [tab, setTab] = useState('general')
  const [profileForm, setProfileForm] = useState({
    monthlyIncome: profile?.monthlyIncome || '',
    monthlySavings: profile?.monthlySavings || '',
    monthlyExpenses: profile?.monthlyExpenses || '',
    age: profile?.age || '',
    retirementAge: profile?.retirementAge || '',
    riskTolerance: profile?.riskTolerance || 'moderate',
    emergencyMonths: profile?.emergencyMonths || 6,
    incomeGoal: profile?.incomeGoal || '',
    portfolioGoal: profile?.portfolioGoal || '',
    targetYear: profile?.targetYear || '',
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [shareToken, setShareToken] = useState(null)
  const [shareEnabled, setShareEnabled] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
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

  const t = (es, en) => lang === 'es' ? es : en

  const flash = (type, msg) => { setSaveStatus({ type, msg }); setTimeout(() => setSaveStatus(null), 3000) }

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

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveSettings({ baseCurrency, benchmarkSymbol })
      flash('ok', t('Guardado', 'Saved'))
      setTimeout(() => onClose(), 500)
    } catch (e) { flash('err', e.message || t('Error al guardar', 'Error saving')) }
    setSaving(false)
  }

  const handleDelete = async (type) => {
    if (confirmDelete !== type) {
      setConfirmDelete(type)
      return
    }
    try {
      if (type === 'items') await onDeleteAllItems({ cascade: true })
      if (type === 'snapshots') await onDeleteAllSnapshots()
      if (type === 'transactions') await onDeleteAllTransactions()
      if (type === 'financeTransactions' && onDeleteAllFinanceTransactions) await onDeleteAllFinanceTransactions()
      if (type === 'all') {
        await onDeleteAllItems({ cascade: true })
        await onDeleteAllSnapshots()
        await onDeleteAllTransactions()
        if (onDeleteAllFinanceTransactions) await onDeleteAllFinanceTransactions()
      }
    } catch (e) { flash('err', e.message || t('Error al borrar', 'Error deleting')) }
    setConfirmDelete(null)
    flash('ok', t('Datos eliminados', 'Data deleted'))
  }

  const handleShareAction = useCallback(async (action) => {
    setShareLoading(true)
    try {
      const res = await authFetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        const data = await safeJson(res)
        setShareToken(data.token || null)
        setShareEnabled(data.enabled ?? false)
      }
    } catch {}
    setShareLoading(false)
  }, [])

  const shareUrl = shareToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${shareToken}` : ''

  const copyShareLink = useCallback(() => {
    navigator.clipboard.writeText(shareUrl)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }, [shareUrl])

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
      flash('ok', t('IBKR desvinculado', 'IBKR unlinked'))
    } catch (e) { flash('err', e.message || t('Error al desvincular', 'Error unlinking')) }
    setIbkrSaving(false)
  }


  const BROKER_REGISTRY = [
    { id: 'alpaca', name: 'Alpaca Markets', icon: '🦙', category: 'traditional', hasApi: true, fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'PK...' },
      { key: 'apiSecret', label: 'API Secret', placeholder: '••••••••', type: 'password' },
    ], instructions: { es: 'Ve a tu cuenta Alpaca → Paper/Live → API Keys → Generar', en: 'Go to Alpaca account → Paper/Live → API Keys → Generate' } },
    { id: 'schwab', name: 'Charles Schwab', icon: '🇺🇸', category: 'traditional', hasApi: true, authType: 'oauth', fields: [], instructions: { es: 'Conecta tu cuenta Schwab via OAuth. Se abrirá una ventana de autorización.', en: 'Connect your Schwab account via OAuth. An authorization window will open.' } },
    { id: 'etoro', name: 'eToro', icon: '📈', category: 'traditional', hasApi: true, fields: [
      { key: 'apiKey', label: 'API Key (x-api-key)', placeholder: 'Tu API key' },
      { key: 'userKey', label: 'User Key (x-user-key)', placeholder: 'Tu user key' },
    ], instructions: { es: 'Ve a eToro → Configuración → API → Generar keys', en: 'Go to eToro → Settings → API → Generate keys' } },
    { id: 'tradestation', name: 'TradeStation', icon: '🖥️', category: 'traditional', hasApi: true, authType: 'oauth', fields: [], instructions: { es: 'Conecta tu cuenta TradeStation via OAuth. Requiere cuenta con $10k mínimo.', en: 'Connect your TradeStation account via OAuth. Requires $10k minimum funded account.' } },
    { id: 'tastytrade', name: 'Tastytrade', icon: '🇺🇸', category: 'traditional', hasApi: true, apiNote: 'Session', fields: [
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ], instructions: { es: 'Ingresa tu usuario y contraseña de Tastytrade.', en: 'Enter your Tastytrade username and password.' } },
    { id: 'saxo', name: 'Saxo Bank', icon: '🏦', category: 'traditional', hasApi: true, authType: 'oauth', fields: [], instructions: { es: 'Conecta tu cuenta Saxo Bank via OAuth. Ambiente sim disponible.', en: 'Connect your Saxo Bank account via OAuth. Sim environment available.' } },
    { id: 'ig', name: 'IG Markets', icon: '🇬🇧', category: 'traditional', hasApi: true, apiNote: 'API Key + Session',
      fields: [
        { key: 'apiKey', label: 'API Key', type: 'text' },
        { key: 'username', label: 'Username', type: 'text' },
        { key: 'password', label: 'Password', type: 'password' },
      ],
      instructions: { es: 'Genera tu API key en My IG → Settings → API. Ingresa tu usuario y contraseña.', en: 'Generate your API key at My IG → Settings → API. Enter your username and password.' }
    },
    { id: 'degiro', name: 'DEGIRO', icon: '🇪🇺', category: 'traditional', hasApi: false, apiNote: t('No oficial', 'Unofficial'), fields: [] },
    { id: 'trading212', name: 'Trading 212', icon: '📊', category: 'traditional', hasApi: false, apiNote: t('Limitado', 'Limited'), fields: [] },
    { id: 'traderepublic', name: 'Trade Republic', icon: '🇩🇪', category: 'traditional', hasApi: false, apiNote: t('No oficial', 'Unofficial'), fields: [] },
    { id: 'lightyear', name: 'Lightyear', icon: '💡', category: 'traditional', hasApi: false },
    { id: 'fidelity', name: 'Fidelity', icon: '🇺🇸', category: 'traditional', hasApi: false },
    { id: 'vanguard', name: 'Vanguard', icon: '🇺🇸', category: 'traditional', hasApi: false },
    { id: 'webull', name: 'Webull', icon: '📱', category: 'traditional', hasApi: false, apiNote: t('Partner', 'Partner') },
    { id: 'm1finance', name: 'M1 Finance', icon: '🇺🇸', category: 'traditional', hasApi: false },
    { id: 'revolut', name: 'Revolut Investments', icon: '💳', category: 'traditional', hasApi: false },
    { id: 'myinvestor', name: 'MyInvestor', icon: '🇪🇸', category: 'traditional', hasApi: false },
    { id: 'dukascopy', name: 'Dukascopy', icon: '🇨🇭', category: 'traditional', hasApi: false },
    { id: 'ppiglobal', name: 'PPI Global', icon: '🇦🇷', category: 'traditional', hasApi: false, apiNote: t('API oficial', 'Official API') },
    { id: 'tdameritrade', name: 'TD Ameritrade', icon: '🇺🇸', category: 'traditional', hasApi: false, apiNote: '→ Schwab' },
    { id: 'binance', name: 'Binance', icon: '🟡', category: 'crypto', hasApi: true, fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Tu API key' },
      { key: 'apiSecret', label: 'Secret Key', placeholder: '••••••••', type: 'password' },
    ], instructions: { es: 'Ve a Binance → API Management → Crear API → Solo lectura', en: 'Go to Binance → API Management → Create API → Read-only' } },
    { id: 'coinbase', name: 'Coinbase', icon: '🟠', category: 'crypto', hasApi: true, fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Tu API key' },
      { key: 'apiSecret', label: 'API Secret', placeholder: '••••••••', type: 'password' },
    ], instructions: { es: 'Ve a Coinbase → Settings → API → New API Key → Portfolio read', en: 'Go to Coinbase → Settings → API → New API Key → Portfolio read' } },
    { id: 'kraken', name: 'Kraken', icon: '🦑', category: 'crypto', hasApi: true, fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Tu API key' },
      { key: 'apiSecret', label: 'Private Key', placeholder: '••••••••', type: 'password' },
    ], instructions: { es: 'Ve a Kraken → Security → API → Create Key → Solo consulta', en: 'Go to Kraken → Security → API → Create Key → Query only' } },
    { id: 'bitso', name: 'Bitso', icon: '🟢', category: 'crypto', hasApi: true, fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Tu API key' },
      { key: 'apiSecret', label: 'API Secret', placeholder: '••••••••', type: 'password' },
    ], instructions: { es: 'Ve a Bitso → API → Crear key → 2FA requerido', en: 'Go to Bitso → API → Create key → 2FA required' } },
  ]

  useEffect(() => {
    if (tab !== 'brokers') return
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
  }, [tab])

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

  const handleSaveProfile = async () => {
    if (!onSaveProfile) return
    setProfileSaving(true)
    try {
      const data = {}
      Object.entries(profileForm).forEach(([k, v]) => {
        if (k === 'riskTolerance') { data[k] = v; return }
        if (v !== '' && v != null) data[k] = Number(v)
      })
      await onSaveProfile(data)
      flash('ok', t('Perfil guardado', 'Profile saved'))
    } catch (e) { flash('err', e.message || t('Error al guardar perfil', 'Error saving profile')) }
    setProfileSaving(false)
  }

  const tabs = [
    { key: 'general', label: t('General', 'General') },
    { key: 'profile', label: t('Perfil', 'Profile') },
    { key: 'entities', label: t('Entidades', 'Entities') },
    { key: 'brokers', label: t('Brokers', 'Brokers') },
    { key: 'share', label: t('Compartir', 'Share') },
    { key: 'data', label: t('Datos', 'Data') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="settings-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
            <Settings size={20} className="text-slate-400" />
            {t('Configuracion', 'Settings')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        {saveStatus && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-lg text-xs font-medium transition-all" style={{ color: saveStatus.type === 'ok' ? '#34d399' : '#f87171', backgroundColor: saveStatus.type === 'ok' ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)' }}>
            {saveStatus.msg}
          </div>
        )}

        <div className="flex border-b border-glass-border overflow-x-auto">
          {tabs.map((tb) => (
            <button key={tb.key} onClick={() => { setTab(tb.key); setConfirmDelete(null) }}
              className={`flex-1 px-3 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === tb.key
                  ? 'border-b-2'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
              style={tab === tb.key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue-soft)', backgroundColor: 'rgba(108,122,255,0.05)' } : undefined}>
              {tb.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'general' && (
            <div className="space-y-5">
              {/* Theme toggle */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Tema', 'Theme')}</label>
                <div className="flex gap-2">
                  {[
                    { key: 'light', label: t('Claro', 'Light'), icon: '☀️' },
                    { key: 'dark', label: t('Oscuro', 'Dark'), icon: '🌙' },
                    { key: 'system', label: t('Sistema', 'System'), icon: '💻' },
                  ].map((opt) => (
                    <button key={opt.key} onClick={() => onToggleTheme(opt.key)}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
                        theme === opt.key
                          ? 'border'
                          : 'bg-theme-base border border-glass-border text-slate-300 hover:border-slate-500'
                      }`}
                      style={theme === opt.key ? { color: 'var(--accent-blue)', borderColor: 'rgba(59,130,246,0.4)', backgroundColor: 'rgba(59,130,246,0.15)' } : undefined}>
                      <span className="text-lg">{opt.icon}</span>
                      <span className="text-sm font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Beginner mode toggle */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Modo principiante', 'Beginner mode')}</label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={beginnerMode}
                  onClick={() => onToggleBeginner?.(!beginnerMode)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-all text-left"
                  style={beginnerMode
                    ? { color: 'var(--accent-blue)', borderColor: 'rgba(59,130,246,0.4)', backgroundColor: 'rgba(59,130,246,0.15)' }
                    : { borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-input)' }}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium" style={beginnerMode ? undefined : { color: 'var(--text-primary)' }}>
                      {t('Simplificar el panel', 'Simplify the dashboard')}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {t('Oculta métricas avanzadas (Riesgo, Atribución) y colapsa el análisis. Todo sigue accesible.', 'Hides advanced metrics (Risk, Attribution) and collapses analysis. Everything stays accessible.')}
                    </div>
                  </div>
                  <span className="shrink-0 w-10 h-6 rounded-full flex items-center transition-all px-0.5"
                    style={{ backgroundColor: beginnerMode ? 'var(--accent-blue)' : 'var(--bg-tertiary)' }}>
                    <span className="w-5 h-5 rounded-full bg-white transition-transform"
                      style={{ transform: beginnerMode ? 'translateX(16px)' : 'translateX(0)' }} />
                  </span>
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Moneda principal', 'Base currency')}</label>
                <p className="text-xs text-slate-600 mb-3">{t('Todos los valores se mostrarán en esta moneda.', 'All values will be displayed in this currency.')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {CURRENCIES.map((c) => (
                    <button key={c.code} onClick={() => setBaseCurrency(c.code)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all ${
                        baseCurrency === c.code
                          ? 'border'
                          : 'bg-theme-base border border-glass-border text-slate-300 hover:border-slate-500'
                      }`}
                      style={baseCurrency === c.code ? { color: 'var(--accent-blue)', borderColor: 'rgba(59,130,246,0.4)', backgroundColor: 'rgba(59,130,246,0.15)' } : undefined}>
                      <span className="text-sm font-bold w-8">{c.symbol}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{c.code}</div>
                        <div className="text-xs text-slate-500 truncate">{c.name}</div>
                      </div>
                      {baseCurrency === c.code && (
                        <svg className="w-4 h-4 ml-auto text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Benchmark', 'Benchmark')}</label>
                <p className="text-xs text-slate-600 mb-3">{t('Índice de referencia para comparar tu portafolio.', 'Reference index to compare your portfolio against.')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(BENCHMARKS).map(([key, bm]) => (
                    <button key={key} onClick={() => setBenchmarkSymbol(key)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all ${
                        benchmarkSymbol === key
                          ? 'border'
                          : 'bg-theme-base border border-glass-border text-slate-300 hover:border-slate-500'
                      }`}
                      style={benchmarkSymbol === key ? { color: 'var(--accent-blue)', borderColor: 'rgba(59,130,246,0.4)', backgroundColor: 'rgba(59,130,246,0.15)' } : undefined}>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{bm.short}</div>
                        <div className="text-xs text-slate-500 truncate">{bm.name}</div>
                      </div>
                      {benchmarkSymbol === key && (
                        <svg className="w-4 h-4 ml-auto text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {isNotificationSupported() && (
                <div>
                  <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Notificaciones', 'Notifications')}</label>
                  <div className="p-3 bg-theme-base border border-glass-border rounded-lg flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white font-medium">{t('Alertas del navegador', 'Browser alerts')}</p>
                      <p className="text-xs text-slate-500">{t('Pagos próximos y vencimientos', 'Upcoming payments and maturities')}</p>
                    </div>
                    {getNotificationPermission() === 'granted' ? (
                      <span className="text-xs text-emerald-400 font-medium px-2 py-1 bg-emerald-500/10 rounded">{t('Activado', 'Enabled')}</span>
                    ) : getNotificationPermission() === 'denied' ? (
                      <span className="text-xs text-red-400 font-medium px-2 py-1 bg-red-500/10 rounded">{t('Bloqueado', 'Blocked')}</span>
                    ) : (
                      <button onClick={async () => { await requestNotificationPermission(); }}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors">
                        {t('Activar', 'Enable')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <button onClick={handleSave} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
                {saving ? '...' : t('Guardar configuracion', 'Save settings')}
              </button>
            </div>
          )}

          {tab === 'profile' && (
            <div className="space-y-5">
              <p className="text-xs text-slate-500">{t(
                'Completa tu perfil financiero para recibir insights personalizados.',
                'Complete your financial profile to get personalized insights.'
              )}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { key: 'monthlyIncome', label: t('Ingreso mensual', 'Monthly income'), placeholder: '5000' },
                  { key: 'monthlyExpenses', label: t('Gastos mensuales', 'Monthly expenses'), placeholder: '3000' },
                  { key: 'monthlySavings', label: t('Ahorro mensual', 'Monthly savings'), placeholder: '1000' },
                  { key: 'age', label: t('Edad', 'Age'), placeholder: '30' },
                  { key: 'retirementAge', label: t('Edad de retiro', 'Retirement age'), placeholder: '60' },
                  { key: 'emergencyMonths', label: t('Meses de emergencia', 'Emergency months'), placeholder: '6' },
                  { key: 'incomeGoal', label: t('Meta ingreso pasivo/mes', 'Passive income goal/mo'), placeholder: '2000' },
                  { key: 'portfolioGoal', label: t('Meta de portafolio', 'Portfolio goal'), placeholder: '500000' },
                  { key: 'targetYear', label: t('Año objetivo', 'Target year'), placeholder: '2030' },
                ].map((field) => (
                  <div key={field.key}>
                    <label className="text-xs text-slate-500 uppercase tracking-wider mb-1.5 block">{field.label}</label>
                    <input type="number" value={profileForm[field.key]} onChange={(e) => setProfileForm((p) => ({ ...p, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-4 py-2.5 bg-theme-base border border-glass-border/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                  </div>
                ))}
              </div>

              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wider mb-1.5 block">{t('Tolerancia al riesgo', 'Risk tolerance')}</label>
                <div className="flex gap-2">
                  {[
                    { key: 'conservative', label: t('Conservador', 'Conservative') },
                    { key: 'moderate', label: t('Moderado', 'Moderate') },
                    { key: 'aggressive', label: t('Agresivo', 'Aggressive') },
                  ].map((opt) => (
                    <button key={opt.key} onClick={() => setProfileForm((p) => ({ ...p, riskTolerance: opt.key }))}
                      className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        profileForm.riskTolerance === opt.key
                          ? 'border'
                          : 'bg-theme-base border border-glass-border text-slate-300 hover:border-slate-500'
                      }`}
                      style={profileForm.riskTolerance === opt.key ? { color: 'var(--accent-blue)', borderColor: 'rgba(59,130,246,0.4)', backgroundColor: 'rgba(59,130,246,0.15)' } : undefined}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleSaveProfile} disabled={profileSaving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
                {profileSaving ? '...' : t('Guardar perfil', 'Save profile')}
              </button>
            </div>
          )}

          {tab === 'entities' && (
            <div className="space-y-4">
              {onAddEntity ? (
                <EntityManager
                  entities={entities || []}
                  onAdd={onAddEntity}
                  onUpdate={onUpdateEntity}
                  onDelete={onDeleteEntity}
                  lang={lang}
                />
              ) : (
                <p className="text-xs text-slate-500">{t('No disponible', 'Not available')}</p>
              )}
            </div>
          )}

          {tab === 'brokers' && (() => {
            const syncAge = lastSyncTime ? Date.now() - new Date(lastSyncTime).getTime() : null
            const syncDays = syncAge ? Math.floor(syncAge / 86400000) : null
            const syncStatus = !ibkrConfigured ? 'disconnected' : !lastSyncTime ? 'never' : syncDays > 7 ? 'stale' : 'ok'
            const statusColor = {
              disconnected: { dot: '#ef4444', text: '#f87171' },
              never: { dot: '#f59e0b', text: '#fbbf24' },
              stale: { dot: '#f59e0b', text: '#fbbf24' },
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
                        <p className="text-xs text-emerald-400">{t('Vinculado', 'Linked')}</p>
                      )}
                      {!conn?.configured && broker.apiNote && !broker.hasApi && (
                        <p className="text-xs text-slate-600">{broker.apiNote}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {broker.hasApi && conn?.configured ? (
                        <>
                          <button onClick={() => handleBrokerSync(broker)} disabled={isSyncing}
                            className="px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-500 disabled:opacity-50 transition-colors">
                            {isSyncing ? '...' : 'Sync'}
                          </button>
                          <button onClick={() => handleBrokerDisconnect(broker)} disabled={isSyncing}
                            className="px-2 py-1 text-xs text-red-400/60 hover:text-red-400 transition-colors">
                            ✕
                          </button>
                        </>
                      ) : broker.hasApi ? (
                        <button onClick={() => {
                          if (broker.authType === 'oauth') { handleBrokerConnect(broker); return }
                          setExpandedBroker(isExpanded ? null : broker.id); setBrokerForm({}); setBrokerError(null)
                        }}
                          className="px-2.5 py-1 border border-blue-500/40 text-blue-400 text-xs font-medium rounded-md hover:bg-blue-500/10 transition-colors">
                          {isSyncing ? '...' : broker.authType === 'oauth' ? 'OAuth' : isExpanded ? t('Cancelar', 'Cancel') : 'API'}
                        </button>
                      ) : broker.apiNote ? (
                        <span className="px-2 py-0.5 text-xs text-slate-600 border border-glass-border/40 rounded">
                          {broker.apiNote}
                        </span>
                      ) : null}
                      <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport(broker.id) }, 50) }}
                        className="px-2.5 py-1 border border-glass-border text-slate-400 text-xs font-medium rounded-md hover:bg-theme-elevated transition-colors">
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
                        <p className="text-xs text-red-400">{brokerError}</p>
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
                        className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 text-xs font-medium">
                        {isSyncing ? '...' : t('Conectar', 'Connect')}
                      </button>
                    </div>
                  )}
                </div>
              )
            }

            return (
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
                        <button onClick={() => { onClose(); setTimeout(() => { if (onOpenIBKR) onOpenIBKR() }, 50) }}
                          className="px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-500 transition-colors">
                          Sync
                        </button>
                      ) : (
                        <button onClick={() => setShowConfig(true)}
                          className="px-2.5 py-1 border border-blue-500/40 text-blue-400 text-xs font-medium rounded-md hover:bg-blue-500/10 transition-colors">
                          API
                        </button>
                      )}
                      <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport('ibkr') }, 50) }}
                        className="px-2.5 py-1 border border-glass-border text-slate-400 text-xs font-medium rounded-md hover:bg-theme-elevated transition-colors">
                        CSV
                      </button>
                    </div>
                  </div>
                  {ibkrConfigured && syncStatus === 'stale' && (
                    <p className="text-xs text-amber-400 mt-2 pl-9">
                      {t('Tus datos podrían estar desactualizados', 'Your data may be outdated')}
                    </p>
                  )}
                </div>

                {!ibkrConfigured && showConfig && (
                  <div className="space-y-3 p-3 bg-theme-base border border-glass-border rounded-xl mt-2">
                    <p className="text-xs text-slate-600">
                      {t('Ve a IBKR → Reports → Flex Queries → crear query con Open Positions + Trades. Genera un Flex Token en Settings.',
                         'Go to IBKR → Reports → Flex Queries → create query with Open Positions + Trades. Generate a Flex Token in Settings.')}
                    </p>
                    {ibkrError && <p className="text-xs text-red-400">{ibkrError}</p>}
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
                      className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 text-xs font-medium">
                      {ibkrSaving ? '...' : t('Conectar', 'Connect')}
                    </button>
                  </div>
                )}

                {ibkrConfigured && !confirmUnlink && (
                  <button onClick={() => setConfirmUnlink(true)}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors mt-2">
                    {t('Desvincular', 'Unlink')}
                  </button>
                )}
                {ibkrConfigured && confirmUnlink && (
                  <div className="p-3 bg-theme-surface border border-glass-border border-l-4 border-l-red-500 rounded-lg space-y-2 mt-2">
                    <p className="text-xs text-red-400 font-medium">{t('¿Desvincular Interactive Brokers?', 'Unlink Interactive Brokers?')}</p>
                    <p className="text-xs text-slate-400">
                      {t('Se eliminará la conexión API. Tus posiciones importadas se mantienen.',
                         'The API connection will be removed. Your imported positions will be kept.')}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={async () => { await handleIbkrDisconnect(); setConfirmUnlink(false) }} disabled={ibkrSaving}
                        className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-500 transition-colors">
                        {ibkrSaving ? '...' : t('Sí', 'Yes')}
                      </button>
                      <button onClick={() => setConfirmUnlink(false)}
                        className="px-3 py-1.5 border border-glass-border text-slate-400 text-xs rounded-lg hover:bg-theme-elevated transition-colors">
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
                        className="px-2.5 py-1 border border-blue-500/40 text-blue-400 text-xs font-medium rounded-md hover:bg-blue-500/10 transition-colors">
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
                      className="flex-1 px-3 py-2 border border-blue-500/40 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-500/10 transition-colors">
                      {t('Agregar', 'Add')}
                    </button>
                    <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport() }, 50) }}
                      className="flex-1 px-3 py-2 border border-glass-border text-slate-400 text-xs font-medium rounded-lg hover:bg-theme-elevated transition-colors">
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
            )
          })()}

          {tab === 'share' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-medium text-white mb-1">{t('Modo Asesor', 'Advisor Mode')}</h3>
                <p className="text-xs text-slate-500 mb-4">{t(
                  'Genera un link de solo lectura para compartir tu portafolio con asesores o contadores. No revela la institución de tus activos.',
                  'Generate a read-only link to share your portfolio with advisors or accountants. Does not reveal your asset institutions.'
                )}</p>
              </div>

              {!shareEnabled ? (
                <button onClick={() => handleShareAction('enable')} disabled={shareLoading}
                  className="w-full py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                  {shareLoading ? '...' : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      {t('Activar link compartido', 'Enable share link')}
                    </>
                  )}
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="bg-theme-base border border-glass-border rounded-lg p-3">
                    <label className="text-xs text-slate-500 block mb-1.5">{t('Link de solo lectura', 'Read-only link')}</label>
                    <div className="flex items-center gap-2">
                      <input type="text" readOnly value={shareUrl}
                        className="flex-1 bg-transparent text-xs text-slate-300 outline-none truncate" />
                      <button onClick={copyShareLink}
                        className="shrink-0 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-500 transition-colors">
                        {shareCopied ? t('Copiado!', 'Copied!') : t('Copiar', 'Copy')}
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => handleShareAction('regenerate')} disabled={shareLoading}
                      className="flex-1 py-2 border border-glass-border text-slate-300 rounded-lg hover:bg-slate-700/50 disabled:opacity-50 transition-colors text-xs">
                      {t('Regenerar link', 'Regenerate link')}
                    </button>
                    <button onClick={() => handleShareAction('disable')} disabled={shareLoading}
                      className="flex-1 py-2 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/10 disabled:opacity-50 transition-colors text-xs">
                      {t('Desactivar', 'Disable')}
                    </button>
                  </div>

                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                    <p className="text-xs text-amber-400">{t(
                      'Cualquier persona con este link puede ver tu portafolio (sin montos de instituciones). Regenera o desactiva el link en cualquier momento.',
                      'Anyone with this link can view your portfolio (without institution details). Regenerate or disable the link at any time.'
                    )}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-4">
              {onExportBackup && (
                <div className="flex items-center justify-between p-3 bg-theme-base border border-emerald-500/20 rounded-lg">
                  <div>
                    <div className="text-sm text-white font-medium">{t('Exportar Backup', 'Export Backup')}</div>
                    <div className="text-xs text-slate-500">{t('Descarga todos tus datos en formato JSON.', 'Download all your data as JSON.')}</div>
                  </div>
                  <button onClick={onExportBackup}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ml-3 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                    {t('Descargar', 'Download')}
                  </button>
                </div>
              )}

              <p className="text-xs text-slate-500">{t('Administra los datos de tu portfolio. Estas acciones no se pueden deshacer.', 'Manage your portfolio data. These actions cannot be undone.')}</p>

              {[
                { key: 'items', label: t('Eliminar todas las cuentas', 'Delete all accounts'), desc: t('Borra todos los instrumentos y posiciones.', 'Deletes all instruments and positions.'), warn: t('Se borrarán cuentas, lots y transacciones asociadas.', 'This will delete accounts, lots, and associated transactions.') },
                { key: 'snapshots', label: t('Eliminar snapshots', 'Delete snapshots'), desc: t('Borra el historial de snapshots del portfolio.', 'Deletes portfolio snapshot history.'), warn: t('El gráfico de crecimiento perderá datos históricos.', 'The growth chart will lose historical data.') },
                { key: 'transactions', label: t('Eliminar transacciones', 'Delete transactions'), desc: t('Borra el historial de transacciones.', 'Deletes transaction history.'), warn: t('Los retornos YTD y Modified Dietz serán menos precisos.', 'YTD returns and Modified Dietz will be less accurate.') },
                { key: 'financeTransactions', label: t('Eliminar finanzas', 'Delete finance data'), desc: t('Borra todos los ingresos y gastos.', 'Deletes all income and expense data.'), warn: t('Se perderá el historial de ingresos y gastos.', 'Income and expense history will be lost.') },
                { key: 'all', label: t('Eliminar todo', 'Delete everything'), desc: t('Borra todos los datos del portfolio.', 'Deletes all portfolio data.'), warn: t('Se borrarán TODOS los datos: cuentas, historial, transacciones y finanzas.', 'ALL data will be deleted: accounts, history, transactions, and finances.') },
              ].map((action) => (
                <div key={action.key} className="flex items-center justify-between p-3 bg-theme-base border border-glass-border rounded-lg">
                  <div>
                    <div className="text-sm text-white font-medium">{action.label}</div>
                    <div className="text-xs text-slate-500">{action.desc}</div>
                    {confirmDelete === action.key && (
                      <div className="text-xs mt-1 font-medium" style={{ color: '#fbbf24' }}>{action.warn}</div>
                    )}
                  </div>
                  <button onClick={() => handleDelete(action.key)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ml-3 border"
                    style={confirmDelete === action.key
                      ? { backgroundColor: '#dc2626', color: '#ffffff', borderColor: '#dc2626' }
                      : { color: 'var(--text-negative)', borderColor: 'rgba(239,68,68,0.3)' }}>
                    {confirmDelete === action.key ? t('Confirmar', 'Confirm') : t('Eliminar', 'Delete')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
