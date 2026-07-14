'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { Settings, Building2, Users } from 'lucide-react'
import EntityManager from '@/components/dashboard/EntityManager'
import { authFetch, safeJson } from '@/lib/authFetch'
import { isNotificationSupported, getNotificationPermission, requestNotificationPermission } from '@/lib/notifications'
import { BENCHMARKS } from '@/hooks/useBenchmark'
import { disconnectAllSyncs } from '@/lib/brokerRegistry'

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

export default function SettingsModal({ onClose, settings, onSaveSettings, onDeleteAllItems, onDeleteAllSnapshots, onDeleteAllTransactions, onDeleteAllFinanceTransactions, onExportBackup, onOpenConnections, entities, onAddEntity, onUpdateEntity, onDeleteEntity, theme, onToggleTheme, beginnerMode = false, onToggleBeginner, lang = 'es', profile, onSaveProfile }) {
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
  const [saveStatus, setSaveStatus] = useState(null)

  const t = (es, en) => lang === 'es' ? es : en

  const flash = (type, msg) => { setSaveStatus({ type, msg }); setTimeout(() => setSaveStatus(null), 3000) }

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
        // An emptied account must not keep live broker connections silently
        // re-importing positions — wipe every stored sync credential too.
        await disconnectAllSyncs(authFetch)
      }
    } catch (e) { flash('err', e.message || t('Error al borrar', 'Error deleting')) }
    setConfirmDelete(null)
    flash('ok', type === 'all' ? t('Datos y conexiones eliminados', 'Data and connections deleted') : t('Datos eliminados', 'Data deleted'))
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
    { key: 'share', label: t('Compartir', 'Share') },
    { key: 'data', label: t('Datos', 'Data') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="settings-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
            <Settings size={20} style={{ color: 'var(--text-secondary)' }} />
            {t('Configuracion', 'Settings')}
          </h2>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
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
                  : 'hover:text-slate-300'
              }`}
              style={tab === tb.key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue-soft)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 5%, transparent)' } : { color: 'var(--text-secondary)' }}>
              {tb.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'general' && (
            <div className="space-y-5">
              {/* Broker syncs moved to their own hub — keep a pointer for discoverability */}
              {onOpenConnections && (
                <div className="flex items-center justify-between p-3 bg-theme-base border border-glass-border rounded-lg">
                  <div>
                    <div className="text-sm text-white font-medium">🔗 {t('Conexiones y Sync', 'Connections & Sync')}</div>
                    <div className="text-xs text-slate-500">{t('Brokers, exchanges y wallets vinculados.', 'Linked brokers, exchanges and wallets.')}</div>
                  </div>
                  <button onClick={() => { onClose(); setTimeout(() => onOpenConnections(), 50) }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ml-3 border hover:bg-blue-500/10" style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                    {t('Abrir', 'Open')}
                  </button>
                </div>
              )}

              {/* Theme toggle */}
              <div>
                <label className="text-xs mb-2 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Tema', 'Theme')}</label>
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
                      style={theme === opt.key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' } : undefined}>
                      <span className="text-lg">{opt.icon}</span>
                      <span className="text-sm font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Beginner mode toggle */}
              <div>
                <label className="text-xs mb-2 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Modo principiante', 'Beginner mode')}</label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={beginnerMode}
                  onClick={() => onToggleBeginner?.(!beginnerMode)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-all text-left"
                  style={beginnerMode
                    ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' }
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
                <label className="text-xs mb-2 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Moneda principal', 'Base currency')}</label>
                <p className="text-xs text-slate-600 mb-3">{t('Todos los valores se mostrarán en esta moneda.', 'All values will be displayed in this currency.')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {CURRENCIES.map((c) => (
                    <button key={c.code} onClick={() => setBaseCurrency(c.code)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all ${
                        baseCurrency === c.code
                          ? 'border'
                          : 'bg-theme-base border border-glass-border text-slate-300 hover:border-slate-500'
                      }`}
                      style={baseCurrency === c.code ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' } : undefined}>
                      <span className="text-sm font-bold w-8">{c.symbol}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{c.code}</div>
                        <div className="text-xs text-slate-500 truncate">{c.name}</div>
                      </div>
                      {baseCurrency === c.code && (
                        <svg className="w-4 h-4 ml-auto shrink-0" style={{ color: 'var(--accent-blue)' }} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs mb-2 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Benchmark', 'Benchmark')}</label>
                <p className="text-xs text-slate-600 mb-3">{t('Índice de referencia para comparar tu portafolio.', 'Reference index to compare your portfolio against.')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(BENCHMARKS).map(([key, bm]) => (
                    <button key={key} onClick={() => setBenchmarkSymbol(key)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all ${
                        benchmarkSymbol === key
                          ? 'border'
                          : 'bg-theme-base border border-glass-border text-slate-300 hover:border-slate-500'
                      }`}
                      style={benchmarkSymbol === key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' } : undefined}>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{bm.short}</div>
                        <div className="text-xs text-slate-500 truncate">{bm.name}</div>
                      </div>
                      {benchmarkSymbol === key && (
                        <svg className="w-4 h-4 ml-auto shrink-0" style={{ color: 'var(--accent-blue)' }} fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {isNotificationSupported() && (
                <div>
                  <label className="text-xs mb-2 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Notificaciones', 'Notifications')}</label>
                  <div className="p-3 bg-theme-base border border-glass-border rounded-lg flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white font-medium">{t('Alertas del navegador', 'Browser alerts')}</p>
                      <p className="text-xs text-slate-500">{t('Pagos próximos y vencimientos', 'Upcoming payments and maturities')}</p>
                    </div>
                    {getNotificationPermission() === 'granted' ? (
                      <span className="text-xs font-medium px-2 py-1 bg-emerald-500/10 rounded" style={{ color: 'var(--accent-green)' }}>{t('Activado', 'Enabled')}</span>
                    ) : getNotificationPermission() === 'denied' ? (
                      <span className="text-xs font-medium px-2 py-1 bg-red-500/10 rounded" style={{ color: 'var(--text-negative)' }}>{t('Bloqueado', 'Blocked')}</span>
                    ) : (
                      <button onClick={async () => { await requestNotificationPermission(); }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-blue-500 transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                        {t('Activar', 'Enable')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <button onClick={handleSave} disabled={saving}
                className="w-full py-2.5 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
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
                      style={profileForm.riskTolerance === opt.key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' } : undefined}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleSaveProfile} disabled={profileSaving}
                className="w-full py-2.5 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
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
                  className="w-full py-3 rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2" style={{ color: '#ffffff', backgroundColor: 'var(--accent-green)' }}>
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
                        className="shrink-0 px-3 py-1.5 text-xs rounded-lg hover:bg-blue-500 transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
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
                      className="flex-1 py-2 border rounded-lg hover:bg-red-500/10 disabled:opacity-50 transition-colors text-xs" style={{ borderColor: 'var(--text-negative)', color: 'var(--text-negative)' }}>
                      {t('Desactivar', 'Disable')}
                    </button>
                  </div>

                  <div className="border rounded-lg p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-orange) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-orange) 20%, transparent)' }}>
                    <p className="text-xs" style={{ color: 'var(--accent-orange)' }}>{t(
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
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ml-3 border hover:bg-emerald-500/10" style={{ borderColor: 'color-mix(in srgb, var(--accent-green) 30%, transparent)', color: 'var(--accent-green)' }}>
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
                { key: 'all', label: t('Eliminar todo', 'Delete everything'), desc: t('Borra todos los datos del portfolio.', 'Deletes all portfolio data.'), warn: t('Se borrarán TODOS los datos (cuentas, historial, transacciones, finanzas) y se desconectarán todos los brokers vinculados.', 'ALL data will be deleted (accounts, history, transactions, finances) and every linked broker will be disconnected.') },
              ].map((action) => (
                <div key={action.key} className="flex items-center justify-between p-3 bg-theme-base border border-glass-border rounded-lg">
                  <div>
                    <div className="text-sm text-white font-medium">{action.label}</div>
                    <div className="text-xs text-slate-500">{action.desc}</div>
                    {confirmDelete === action.key && (
                      <div className="text-xs mt-1 font-medium" style={{ color: 'var(--accent-orange)' }}>{action.warn}</div>
                    )}
                  </div>
                  <button onClick={() => handleDelete(action.key)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ml-3 border"
                    style={confirmDelete === action.key
                      ? { backgroundColor: 'var(--text-negative)', color: '#ffffff', borderColor: 'var(--text-negative)' }
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
