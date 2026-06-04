'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Settings, Building2, Users } from 'lucide-react'
import EntityManager from '@/components/dashboard/EntityManager'
import { authFetch } from '@/lib/authFetch'
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

export default function SettingsModal({ onClose, settings, onSaveSettings, onDeleteAllItems, onDeleteAllSnapshots, onDeleteAllTransactions, onDeleteAllFinanceTransactions, onExportBackup, onSyncBroker, onOpenIBKR, onImport, onAddAccount, onOpenBlockchain, entities, onAddEntity, onUpdateEntity, onDeleteEntity, theme, onToggleTheme, lang = 'es', profile, onSaveProfile, lastSyncTime, portfolioItems = [] }) {
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
      if (type === 'items') await onDeleteAllItems()
      if (type === 'snapshots') await onDeleteAllSnapshots()
      if (type === 'transactions') await onDeleteAllTransactions()
      if (type === 'financeTransactions' && onDeleteAllFinanceTransactions) await onDeleteAllFinanceTransactions()
      if (type === 'all') {
        await onDeleteAllItems()
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
        const data = await res.json()
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
    }).then((r) => r.ok ? r.json() : null).then((d) => {
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
        const d = await res.json()
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#38383A]">
          <h2 id="settings-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
            <Settings size={20} className="text-slate-400" />
            {t('Configuracion', 'Settings')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {saveStatus && (
          <div className={`mx-6 mt-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${saveStatus.type === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            {saveStatus.msg}
          </div>
        )}

        <div className="flex border-b border-[#38383A] overflow-x-auto">
          {tabs.map((tb) => (
            <button key={tb.key} onClick={() => { setTab(tb.key); setConfirmDelete(null) }}
              className={`flex-1 px-3 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === tb.key
                  ? 'text-emerald-400 border-b-2 border-emerald-400 bg-emerald-400/5'
                  : 'text-slate-400 hover:text-slate-300'
              }`}>
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
                          ? 'bg-blue-500/15 border border-blue-500/40 text-blue-400'
                          : 'bg-[#000000] border border-[#38383A] text-slate-300 hover:border-slate-500'
                      }`}>
                      <span className="text-lg">{opt.icon}</span>
                      <span className="text-sm font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Moneda principal', 'Base currency')}</label>
                <p className="text-xs text-slate-600 mb-3">{t('Todos los valores se mostrarán en esta moneda.', 'All values will be displayed in this currency.')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {CURRENCIES.map((c) => (
                    <button key={c.code} onClick={() => setBaseCurrency(c.code)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all ${
                        baseCurrency === c.code
                          ? 'bg-blue-500/15 border border-blue-500/40 text-blue-400'
                          : 'bg-[#000000] border border-[#38383A] text-slate-300 hover:border-slate-500'
                      }`}>
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
                          ? 'bg-blue-500/15 border border-blue-500/40 text-blue-400'
                          : 'bg-[#000000] border border-[#38383A] text-slate-300 hover:border-slate-500'
                      }`}>
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
                  <div className="p-3 bg-[#000000] border border-[#38383A] rounded-lg flex items-center justify-between">
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
                    <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 block">{field.label}</label>
                    <input type="number" value={profileForm[field.key]} onChange={(e) => setProfileForm((p) => ({ ...p, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-4 py-2.5 bg-[#000000] border border-[#38383A]/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                  </div>
                ))}
              </div>

              <div>
                <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 block">{t('Tolerancia al riesgo', 'Risk tolerance')}</label>
                <div className="flex gap-2">
                  {[
                    { key: 'conservative', label: t('Conservador', 'Conservative') },
                    { key: 'moderate', label: t('Moderado', 'Moderate') },
                    { key: 'aggressive', label: t('Agresivo', 'Aggressive') },
                  ].map((opt) => (
                    <button key={opt.key} onClick={() => setProfileForm((p) => ({ ...p, riskTolerance: opt.key }))}
                      className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                        profileForm.riskTolerance === opt.key
                          ? 'bg-blue-500/15 border border-blue-500/40 text-blue-400'
                          : 'bg-[#000000] border border-[#38383A] text-slate-300 hover:border-slate-500'
                      }`}>
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
              disconnected: { dot: 'bg-red-500', text: 'text-red-400' },
              never: { dot: 'bg-amber-500', text: 'text-amber-400' },
              stale: { dot: 'bg-amber-500', text: 'text-amber-400' },
              ok: { dot: 'bg-emerald-400', text: 'text-emerald-400' },
            }[syncStatus]
            const statusLabel = {
              disconnected: t('No vinculado', 'Not linked'),
              never: t('Nunca sincronizado', 'Never synced'),
              stale: t(`Hace ${syncDays}d`, `${syncDays}d ago`),
              ok: syncDays === 0 ? t('Hoy', 'Today') : t(`Hace ${syncDays}d`, `${syncDays}d ago`),
            }[syncStatus]

            const nonIbkrInstitutions = institutionSummaries.filter(inst => !inst.isIbkr)

            const csvBrokers = [
              { name: 'DEGIRO', icon: '🇪🇺' },
              { name: 'Trading 212', icon: '📊' },
              { name: 'Trade Republic', icon: '🇩🇪' },
              { name: 'Lightyear', icon: '💡' },
              { name: 'Saxo Bank', icon: '🏦' },
              { name: 'Charles Schwab', icon: '🇺🇸' },
              { name: 'Fidelity', icon: '🇺🇸' },
              { name: 'Vanguard', icon: '🇺🇸' },
              { name: 'eToro', icon: '📈' },
              { name: 'Webull', icon: '📱' },
              { name: 'TradeStation', icon: '🖥️' },
              { name: 'Tastytrade', icon: '🇺🇸' },
              { name: 'IG', icon: '🇬🇧' },
              { name: 'Dukascopy', icon: '🇨🇭' },
              { name: 'Alpaca Markets', icon: '🦙' },
              { name: 'PPI Global', icon: '🇦🇷' },
              { name: 'TD Ameritrade', icon: '🇺🇸' },
              { name: 'M1 Finance', icon: '🇺🇸' },
              { name: 'Revolut Investments', icon: '💳' },
              { name: 'MyInvestor', icon: '🇪🇸' },
            ]

            const cryptoExchanges = [
              { name: 'Coinbase', icon: '🟠' },
              { name: 'Binance', icon: '🟡' },
              { name: 'Kraken', icon: '🦑' },
              { name: 'Bitso', icon: '🟢' },
            ]

            return (
            <div className="space-y-5">
              {/* ── IBKR (API + CSV) ── */}
              <div>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">{t('Conexión API', 'API Connection')}</p>
                <div className="p-3 bg-[#000000] border border-[#38383A] rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <span className="text-xl">🏦</span>
                      <span className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 ${statusColor.dot} rounded-full border-2 border-[#1C1C1E]`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">Interactive Brokers</p>
                      <p className={`text-[11px] ${statusColor.text}`}>
                        {ibkrConfigured ? statusLabel : t('No vinculado', 'Not linked')}
                        {ibkrConfigured && <span className="text-slate-600 ml-1">· ID: {ibkrQueryId}</span>}
                      </p>
                    </div>
                    {ibkrConfigured ? (
                      <button onClick={() => { onClose(); setTimeout(() => { if (onOpenIBKR) onOpenIBKR() }, 50) }}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-500 transition-colors shrink-0">
                        Sync
                      </button>
                    ) : (
                      <button onClick={() => setShowConfig(true)}
                        className="px-3 py-1.5 border border-blue-500/40 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-500/10 transition-colors shrink-0">
                        {t('Vincular', 'Link')}
                      </button>
                    )}
                  </div>
                  {ibkrConfigured && syncStatus === 'stale' && (
                    <p className="text-[10px] text-amber-400 mt-2 pl-9">
                      {t('Tus datos podrían estar desactualizados', 'Your data may be outdated')}
                    </p>
                  )}
                </div>

                {!ibkrConfigured && showConfig && (
                  <div className="space-y-3 p-3 bg-[#000000] border border-[#38383A] rounded-xl mt-2">
                    {ibkrError && <p className="text-xs text-red-400">{ibkrError}</p>}
                    <div>
                      <label className="text-[11px] text-slate-500 mb-1 block">Token</label>
                      <input type="password" value={ibkrToken} onChange={(e) => setIbkrToken(e.target.value)}
                        placeholder="••••••••••••••••"
                        className="w-full px-3 py-2 bg-[#1C1C1E] border border-[#38383A]/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 mb-1 block">Query ID</label>
                      <input type="text" value={ibkrQueryId} onChange={(e) => setIbkrQueryId(e.target.value)}
                        placeholder="123456"
                        className="w-full px-3 py-2 bg-[#1C1C1E] border border-[#38383A]/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                    </div>
                    <button onClick={handleIbkrSave} disabled={ibkrSaving || !ibkrToken || !ibkrQueryId}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 text-sm font-medium">
                      {ibkrSaving ? '...' : t('Conectar', 'Connect')}
                    </button>
                  </div>
                )}

                {ibkrConfigured && !confirmUnlink && (
                  <button onClick={() => setConfirmUnlink(true)}
                    className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors mt-2">
                    {t('Desvincular IBKR', 'Unlink IBKR')}
                  </button>
                )}
                {ibkrConfigured && confirmUnlink && (
                  <div className="p-3 bg-[#1C1C1E] border border-[#38383A] border-l-4 border-l-red-500 rounded-lg space-y-2 mt-2">
                    <p className="text-xs text-red-400 font-medium">{t('¿Desvincular Interactive Brokers?', 'Unlink Interactive Brokers?')}</p>
                    <p className="text-[11px] text-slate-400">
                      {t('Se eliminará la conexión API. Tus posiciones importadas se mantienen.',
                         'The API connection will be removed. Your imported positions will be kept.')}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={async () => { await handleIbkrDisconnect(); setConfirmUnlink(false) }} disabled={ibkrSaving}
                        className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-500 transition-colors">
                        {ibkrSaving ? '...' : t('Sí, desvincular', 'Yes, unlink')}
                      </button>
                      <button onClick={() => setConfirmUnlink(false)}
                        className="px-3 py-1.5 border border-[#38383A] text-slate-400 text-xs rounded-lg hover:bg-[#2C2C2E] transition-colors">
                        {t('Cancelar', 'Cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── BROKERS TRADICIONALES (CSV) ── */}
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider">{t('Brokers Tradicionales', 'Traditional Brokers')}</p>
                  <span className="text-[10px] text-slate-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-2 space-y-1">
                  <p className="text-[11px] text-slate-600 mb-2">
                    {t('Exporta un CSV desde tu broker e impórtalo. El formato se detecta automáticamente.',
                       'Export a CSV from your broker and import it. The format is auto-detected.')}
                  </p>
                  {csvBrokers.map(b => (
                    <div key={b.name} className="flex items-center gap-3 px-3 py-2 bg-[#000000] border border-[#38383A]/60 rounded-lg">
                      <span className="text-sm">{b.icon}</span>
                      <p className="text-sm text-white flex-1">{b.name}</p>
                      <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport() }, 50) }}
                        className="px-2.5 py-1 border border-blue-500/40 text-blue-400 text-[11px] font-medium rounded-md hover:bg-blue-500/10 transition-colors">
                        {t('Importar CSV', 'Import CSV')}
                      </button>
                    </div>
                  ))}
                </div>
              </details>

              {/* ── CRYPTO ── */}
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider">Crypto</p>
                  <span className="text-[10px] text-slate-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-2 space-y-1">
                  <p className="text-[11px] text-slate-600 mb-2">
                    {t('Importa CSV de exchanges, o usa Blockchain/Ledger sync para wallets.',
                       'Import CSV from exchanges, or use Blockchain/Ledger sync for wallets.')}
                  </p>
                  {cryptoExchanges.map(b => (
                    <div key={b.name} className="flex items-center gap-3 px-3 py-2 bg-[#000000] border border-[#38383A]/60 rounded-lg">
                      <span className="text-sm">{b.icon}</span>
                      <p className="text-sm text-white flex-1">{b.name}</p>
                      <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport() }, 50) }}
                        className="px-2.5 py-1 border border-blue-500/40 text-blue-400 text-[11px] font-medium rounded-md hover:bg-blue-500/10 transition-colors">
                        {t('Importar CSV', 'Import CSV')}
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 px-3 py-2 bg-[#000000] border border-[#38383A]/60 rounded-lg mt-1">
                    <span className="text-sm">🔗</span>
                    <div className="flex-1">
                      <p className="text-sm text-white">{t('Wallet on-chain', 'On-chain Wallet')}</p>
                      <p className="text-[10px] text-slate-600">{t('Blockchain.com, Ledger, dirección de wallet', 'Blockchain.com, Ledger, wallet address')}</p>
                    </div>
                    <button onClick={() => { onClose(); setTimeout(() => { if (onOpenBlockchain) onOpenBlockchain() }, 50) }}
                      className="px-2.5 py-1 border border-blue-500/40 text-blue-400 text-[11px] font-medium rounded-md hover:bg-blue-500/10 transition-colors">
                      {t('Conectar', 'Connect')}
                    </button>
                  </div>
                </div>
              </details>

              {/* ── PRIVADO / VC ── */}
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider">{t('Privado / VC', 'Private / VC')}</p>
                  <span className="text-[10px] text-slate-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] text-slate-600 mb-1">
                    {t('Para inversiones privadas (SAFE notes, VC funds, PE, club deals), agrega manualmente o importa CSV.',
                       'For private investments (SAFE notes, VC funds, PE, club deals), add manually or import CSV.')}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => { onClose(); setTimeout(() => { if (onAddAccount) onAddAccount() }, 50) }}
                      className="flex-1 px-3 py-2 border border-blue-500/40 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-500/10 transition-colors">
                      {t('Agregar manualmente', 'Add manually')}
                    </button>
                    <button onClick={() => { onClose(); setTimeout(() => { if (onImport) onImport() }, 50) }}
                      className="flex-1 px-3 py-2 border border-[#38383A] text-slate-400 text-xs font-medium rounded-lg hover:bg-[#2C2C2E] transition-colors">
                      {t('Importar CSV', 'Import CSV')}
                    </button>
                  </div>
                </div>
              </details>

              {/* ── YOUR INSTITUTIONS ── */}
              {nonIbkrInstitutions.length > 0 && (
                <div>
                  <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">{t('Tus instituciones', 'Your institutions')}</p>
                  <div className="space-y-1">
                    {nonIbkrInstitutions.map(inst => (
                      <div key={inst.name} className="flex items-center gap-3 px-3 py-2 bg-[#000000] border border-[#38383A]/60 rounded-lg">
                        <span className="text-slate-500 text-sm">🏢</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium truncate">{inst.name}</p>
                          <p className="text-[11px] text-slate-500">
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
                  <div className="bg-[#000000] border border-[#38383A] rounded-lg p-3">
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
                      className="flex-1 py-2 border border-[#38383A] text-slate-300 rounded-lg hover:bg-slate-700/50 disabled:opacity-50 transition-colors text-xs">
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
                <div className="flex items-center justify-between p-3 bg-[#000000] border border-emerald-500/20 rounded-lg">
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
                { key: 'items', label: t('Eliminar todas las cuentas', 'Delete all accounts'), desc: t('Borra todos los instrumentos y posiciones.', 'Deletes all instruments and positions.') },
                { key: 'snapshots', label: t('Eliminar snapshots', 'Delete snapshots'), desc: t('Borra el historial de snapshots del portfolio.', 'Deletes portfolio snapshot history.') },
                { key: 'transactions', label: t('Eliminar transacciones', 'Delete transactions'), desc: t('Borra el historial de transacciones.', 'Deletes transaction history.') },
                { key: 'financeTransactions', label: t('Eliminar finanzas', 'Delete finance data'), desc: t('Borra todos los ingresos y gastos.', 'Deletes all income and expense data.') },
                { key: 'all', label: t('Eliminar todo', 'Delete everything'), desc: t('Borra todos los datos del portfolio.', 'Deletes all portfolio data.') },
              ].map((action) => (
                <div key={action.key} className="flex items-center justify-between p-3 bg-[#000000] border border-[#38383A] rounded-lg">
                  <div>
                    <div className="text-sm text-white font-medium">{action.label}</div>
                    <div className="text-xs text-slate-500">{action.desc}</div>
                  </div>
                  <button onClick={() => handleDelete(action.key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ml-3 ${
                      confirmDelete === action.key
                        ? 'bg-red-600 text-white'
                        : 'border border-red-500/30 text-red-400 hover:bg-red-500/10'
                    }`}>
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
