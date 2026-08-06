'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { Settings, Building2, Users } from 'lucide-react'
import EntityManager from '@/components/dashboard/EntityManager'
import { authFetch, safeJson } from '@/lib/authFetch'
import { isNotificationSupported, getNotificationPermission, requestNotificationPermission } from '@/lib/notifications'
import { BENCHMARKS } from '@/hooks/useBenchmark'
import { disconnectAllSyncs, IBKR_DISCONNECTED_FIELDS } from '@/lib/brokerRegistry'

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

export default function SettingsModal({ onClose, settings, onSaveSettings, onDeleteAllItems, onDeleteAllSnapshots, onDeleteAllTransactions, onDeleteAllFinanceTransactions, onDeleteItemGroup, onExportBackup, onOpenConnections, entities, onAddEntity, onUpdateEntity, onDeleteEntity, theme, onToggleTheme, beginnerMode = false, onToggleBeginner, lang = 'es', onSetLang, portfolioItems = [] }) {
  const trapRef = useFocusTrap()
  const [baseCurrency, setBaseCurrency] = useState(settings?.baseCurrency || 'USD')
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(settings?.benchmarkSymbol || '%5EGSPC')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [tab, setTab] = useState('general')
  const [shareLinks, setShareLinks] = useState(null) // null = not loaded yet
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(null) // token just copied
  const [shareCreating, setShareCreating] = useState(false)
  const [shareForm, setShareForm] = useState({ label: '', scopeType: 'all', entityId: '', institutions: [], display: 'both' })
  const [saveStatus, setSaveStatus] = useState(null)
  const [friendsEnabled, setFriendsEnabled] = useState(settings?.friendsEnabled !== false)
  // Per-category notification prefs. Absent = on, mirrors friendsEnabled's default.
  const NOTIF_CATEGORIES = [
    { key: 'notifMaturity', es: 'Vencimientos', en: 'Maturities' },
    { key: 'notifDividend', es: 'Dividendos recibidos', en: 'Dividends received' },
    { key: 'notifValuation', es: 'Valuaciones desactualizadas', en: 'Outdated valuations' },
    { key: 'notifPriceAlerts', es: 'Alertas de precio', en: 'Price alerts' },
  ]
  const [notifPrefs, setNotifPrefs] = useState(() =>
    Object.fromEntries(NOTIF_CATEGORIES.map((c) => [c.key, settings?.[c.key] !== false]))
  )
  const toggleNotifCategory = async (key) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] }
    setNotifPrefs(next)
    try {
      await onSaveSettings({ [key]: next[key] })
    } catch (e) {
      setNotifPrefs(notifPrefs) // revert on failure
      flash('err', e.message || t('Error al guardar', 'Error saving'))
    }
  }

  const t = (es, en) => lang === 'es' ? es : en

  // Group holdings by origin (source + institution) so the user can wipe one account
  // — e.g. "Interactive Brokers · IBKR API" — without touching another (their manual
  // "IDC"). Same batch-delete engine (deleteItemGroup) that respects shared symbols.
  // `_origin` separates an API sync from an uploaded statement for the SAME broker
  // (both carry _source:'ibkr'); items saved before it existed have none and simply
  // group by source+institution, so nothing needs migrating.
  const sourceLabel = (s, origin) => {
    const m = { ibkr: 'IBKR', blockchain: t('Wallet', 'Wallet'), ledger: 'Ledger', hapi: 'Hapi', demo: 'Demo' }
    const base = m[s] || ((!s || String(s).startsWith('manual')) ? t('Manual', 'Manual') : String(s))
    if (origin === 'api') return `${base} API`
    if (origin === 'file') return `${base} ${t('archivo', 'file')}`
    return base
  }
  const accountGroups = useMemo(() => {
    const map = new Map()
    for (const it of portfolioItems || []) {
      const source = it._source || 'manual'
      const institution = (it.institution || '').trim()
      const origin = it._origin || ''
      const key = `${source}|${institution}|${origin}`
      if (!map.has(key)) map.set(key, { key, source, institution, origin, ids: [], count: 0 })
      const g = map.get(key); g.ids.push(it.id); g.count++
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [portfolioItems])

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
    setDeleting(type)
    try {
      if (type.startsWith('group:') && onDeleteItemGroup) {
        const g = accountGroups.find((x) => `group:${x.key}` === type)
        if (g) await onDeleteItemGroup(g.ids)
      }
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
        // The IBKR auto-sync gate reads these preference flags (useDashboardData);
        // clearing only the server vault leaves the 30-min auto-sync alive and the
        // "deleted" IBKR positions come back. This was a real user-reported bug.
        await onSaveSettings(IBKR_DISCONNECTED_FIELDS)
        // "Delete everything" left the Amigos profile and group membership
        // behind — the wipe only ever touched portfolio collections, never
        // the social ones. Same purge toggleFriends(false) does.
        await authFetch('/api/friends', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disable' }),
        }).catch(() => {})
      }
      setConfirmDelete(null)
      flash('ok', type === 'all' ? t('Datos y conexiones eliminados', 'Data and connections deleted') : t('Datos eliminados', 'Data deleted'))
    } catch (e) {
      flash('err', e.message || t('Error al borrar', 'Error deleting'))
    } finally {
      setDeleting(null)
    }
  }

  const shareApi = useCallback(async (payload) => {
    const res = await authFetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await safeJson(res)
    if (!res.ok) throw new Error(data?.error || 'Error')
    return data
  }, [])

  useEffect(() => {
    if (tab !== 'share' || shareLinks !== null) return
    setShareLoading(true)
    shareApi({ action: 'list' })
      .then((d) => setShareLinks(d.links || []))
      .catch(() => setShareLinks([]))
      .finally(() => setShareLoading(false))
  }, [tab, shareLinks, shareApi])

  const shareUrlFor = (token) => `${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${token}`

  const copyShareLink = (token) => {
    navigator.clipboard.writeText(shareUrlFor(token))
    setShareCopied(token)
    setTimeout(() => setShareCopied(null), 2000)
  }

  const handleCreateShare = async () => {
    setShareLoading(true)
    try {
      const scope = shareForm.scopeType === 'entity'
        ? { type: 'entity', entityId: shareForm.entityId, entityName: (entities || []).find((e) => e.id === shareForm.entityId)?.name || '' }
        : shareForm.scopeType === 'institutions'
          ? { type: 'institutions', institutions: shareForm.institutions }
          : { type: 'all' }
      const { link } = await shareApi({ action: 'create', label: shareForm.label, scope, display: shareForm.display })
      setShareLinks((prev) => [...(prev || []), link])
      setShareCreating(false)
      setShareForm({ label: '', scopeType: 'all', entityId: '', institutions: [], display: 'both' })
      copyShareLink(link.token)
      flash('ok', t('Link creado y copiado', 'Link created and copied'))
    } catch (e) { flash('err', e.message) }
    setShareLoading(false)
  }

  const toggleFriends = async () => {
    const next = !friendsEnabled
    setFriendsEnabled(next)
    try {
      await onSaveSettings({ friendsEnabled: next })
      // Turning it off purges the public profile + removes you from every group.
      if (!next) {
        await authFetch('/api/friends', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disable' }),
        }).catch(() => {})
      }
      flash('ok', next ? t('Amigos activado', 'Friends enabled') : t('Amigos desactivado', 'Friends disabled'))
    } catch (e) {
      setFriendsEnabled(!next) // revert on failure
      flash('err', e.message || t('Error al guardar', 'Error saving'))
    }
  }

  const handleRevokeShare = async (token) => {
    setShareLoading(true)
    try {
      await shareApi({ action: 'revoke', token })
      setShareLinks((prev) => (prev || []).filter((l) => l.token !== token))
      flash('ok', t('Link revocado', 'Link revoked'))
    } catch (e) { flash('err', e.message) }
    setShareLoading(false)
  }


  const tabs = [
    { key: 'general', label: t('General', 'General') },
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

              {/* Language. Moved here from the header: it's a preference you set once,
                  not a control worth permanent space in the top bar. */}
              {onSetLang && (
                <div>
                  <label className="text-xs mb-2 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Idioma', 'Language')}</label>
                  <div className="flex gap-2">
                    {[
                      { key: 'es', label: 'Español' },
                      { key: 'en', label: 'English' },
                    ].map((opt) => (
                      <button key={opt.key} onClick={() => { if (lang !== opt.key) onSetLang() }}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
                          lang === opt.key ? 'border' : 'bg-theme-base border border-glass-border text-slate-300 hover:border-slate-500'
                        }`}
                        style={lang === opt.key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' } : undefined}>
                        <span className="text-sm font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

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

              {/* Friends tab toggle — social leaderboard, off = hidden + profile purged */}
              <div>
                <label className="text-xs mb-2 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Amigos', 'Friends')}</label>
                <button type="button" role="switch" aria-checked={friendsEnabled} onClick={toggleFriends}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-all text-left"
                  style={friendsEnabled
                    ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' }
                    : { borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-input)' }}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium" style={friendsEnabled ? undefined : { color: 'var(--text-primary)' }}>
                      {t('Mostrar la pestaña Amigos', 'Show the Friends tab')}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {t('Ranking de retorno con tus amigos. Solo se comparte tu % y símbolos, nunca montos. Al apagar se oculta la pestaña y se borra tu perfil público.', 'A return leaderboard with friends. Only your % and symbols are shared, never amounts. Turning it off hides the tab and deletes your public profile.')}
                    </div>
                  </div>
                  <span className="shrink-0 w-10 h-6 rounded-full flex items-center transition-all px-0.5"
                    style={{ backgroundColor: friendsEnabled ? 'var(--accent-blue)' : 'var(--bg-tertiary)' }}>
                    <span className="w-5 h-5 rounded-full bg-white transition-transform"
                      style={{ transform: friendsEnabled ? 'translateX(16px)' : 'translateX(0)' }} />
                  </span>
                </button>
              </div>

              {/* Currency + benchmark as compact selects — the old 14-card grid
                  made the tab feel endless for a choice made once. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="settings-currency" className="text-xs mb-1.5 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Moneda principal', 'Base currency')}</label>
                  <select id="settings-currency" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}
                    className="w-full px-3 py-2.5 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.symbol} {c.code} · {c.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-600 mt-1">{t('Todos los valores se muestran en esta moneda.', 'All values are displayed in this currency.')}</p>
                </div>
                <div>
                  <label htmlFor="settings-benchmark" className="text-xs mb-1.5 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Benchmark', 'Benchmark')}</label>
                  <select id="settings-benchmark" value={benchmarkSymbol} onChange={(e) => setBenchmarkSymbol(e.target.value)}
                    className="w-full px-3 py-2.5 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                    {Object.entries(BENCHMARKS).map(([key, bm]) => (
                      <option key={key} value={key}>{bm.short} · {bm.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-600 mt-1">{t('Índice contra el que se compara tu portafolio.', 'Index your portfolio is compared against.')}</p>
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

              {/* Which categories matter to this user — a payment/maturity notice for
                  someone with no bonds/CDs is just noise, and this was pure all-or-nothing
                  browser permission before. */}
              <div>
                <label className="text-xs mb-2 block font-medium" style={{ color: 'var(--text-secondary)' }}>{t('Qué avisar', 'What to notify about')}</label>
                <div className="p-3 bg-theme-base border border-glass-border rounded-lg space-y-2.5">
                  {NOTIF_CATEGORIES.map((c) => (
                    <label key={c.key} className="flex items-center justify-between gap-3 cursor-pointer">
                      <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{t(c.es, c.en)}</span>
                      <button type="button" role="switch" aria-checked={notifPrefs[c.key]} onClick={() => toggleNotifCategory(c.key)}
                        className="shrink-0 w-9 h-5 rounded-full flex items-center transition-all px-0.5"
                        style={{ backgroundColor: notifPrefs[c.key] ? 'var(--accent-blue)' : 'var(--bg-tertiary)' }}>
                        <span className="w-4 h-4 rounded-full bg-white transition-transform"
                          style={{ transform: notifPrefs[c.key] ? 'translateX(16px)' : 'translateX(0)' }} />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              <button onClick={handleSave} disabled={saving}
                className="w-full py-2.5 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                {saving ? '...' : t('Guardar configuracion', 'Save settings')}
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
                  items={portfolioItems}
                  lang={lang}
                />
              ) : (
                <p className="text-xs text-slate-500">{t('No disponible', 'Not available')}</p>
              )}
            </div>
          )}


          {tab === 'share' && (() => {
            const institutionOptions = [...new Set(portfolioItems.map((it) => (it.institution || '').trim()).filter(Boolean))].sort()
            const scopeChip = (scope) => {
              if (scope?.type === 'entity') return `👥 ${scope.entityName || t('Entidad', 'Entity')}`
              if (scope?.type === 'institutions') return `🏦 ${(scope.institutions || []).join(', ')}`
              return `📊 ${t('Todo el portafolio', 'Whole portfolio')}`
            }
            const displayChip = (display) => {
              if (display === 'percent') return ` · 👁 ${t('solo %', '% only')}`
              if (display === 'amounts') return ` · 👁 ${t('solo montos', 'amounts only')}`
              return ''
            }
            const toggleInst = (inst) => setShareForm((p) => ({
              ...p,
              institutions: p.institutions.includes(inst) ? p.institutions.filter((i) => i !== inst) : [...p.institutions, inst],
            }))
            const canCreate = shareForm.scopeType === 'all'
              || (shareForm.scopeType === 'entity' && shareForm.entityId)
              || (shareForm.scopeType === 'institutions' && shareForm.institutions.length > 0)

            return (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-white mb-1">{t('Links de solo lectura', 'Read-only links')}</h3>
                <p className="text-xs text-slate-500">{t(
                  'Comparte tu portafolio completo con un asesor, o solo una parte: una entidad o cuentas específicas (ej. solo tu IBKR). Cada link es independiente y se puede revocar sin tocar los demás. Nunca revelan la institución de tus activos.',
                  'Share your whole portfolio with an advisor, or just a slice: one entity or specific accounts (e.g. only your IBKR). Each link is independent and can be revoked without touching the others. They never reveal the institution behind your assets.'
                )}</p>
              </div>

              {/* Existing links */}
              {shareLinks === null || (shareLoading && !shareLinks?.length && !shareCreating) ? (
                <p className="text-xs text-slate-500">…</p>
              ) : shareLinks.length === 0 && !shareCreating ? (
                <p className="text-xs text-slate-600">{t('Aún no has creado ningún link.', 'You haven\'t created any links yet.')}</p>
              ) : (
                <div className="space-y-1.5">
                  {shareLinks.map((link) => (
                    <div key={link.token} className="p-3 bg-theme-base border border-glass-border/60 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium truncate">{link.label || t('Sin nombre', 'Untitled')}</p>
                          <p className="text-xs text-slate-500 truncate">{scopeChip(link.scope)}{displayChip(link.display)}</p>
                        </div>
                        <button onClick={() => copyShareLink(link.token)}
                          className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                          {shareCopied === link.token ? t('¡Copiado!', 'Copied!') : t('Copiar', 'Copy')}
                        </button>
                        <button onClick={() => handleRevokeShare(link.token)} disabled={shareLoading} aria-label={t('Revocar', 'Revoke')}
                          className="shrink-0 px-2 py-1 text-xs hover:opacity-100 transition-opacity" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Create flow */}
              {shareCreating ? (
                <div className="space-y-3 p-3 bg-theme-base border border-glass-border rounded-xl">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('Nombre del link (para ti)', 'Link name (for you)')}</label>
                    <input value={shareForm.label} onChange={(e) => setShareForm((p) => ({ ...p, label: e.target.value }))}
                      placeholder={t('Ej: Para mi contador', 'E.g. For my accountant')} maxLength={40}
                      className="w-full px-3 py-1.5 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('¿Qué compartes?', 'What are you sharing?')}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        { key: 'all', label: t('Todo', 'Everything') },
                        ...(entities && entities.length > 1 ? [{ key: 'entity', label: t('Una entidad', 'One entity') }] : []),
                        ...(institutionOptions.length > 0 ? [{ key: 'institutions', label: t('Cuentas específicas', 'Specific accounts') }] : []),
                      ].map((opt) => (
                        <button key={opt.key} onClick={() => setShareForm((p) => ({ ...p, scopeType: opt.key }))}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${shareForm.scopeType !== opt.key ? 'hover:text-white' : ''}`}
                          style={shareForm.scopeType === opt.key
                            ? { borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }
                            : { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">{t('¿Qué números verán?', 'Which numbers will they see?')}</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        { key: 'both', label: t('Montos y %', 'Amounts & %') },
                        { key: 'amounts', label: t('Solo montos', 'Amounts only') },
                        { key: 'percent', label: t('Solo % (oculta montos)', '% only (hides amounts)') },
                      ].map((opt) => (
                        <button key={opt.key} onClick={() => setShareForm((p) => ({ ...p, display: opt.key }))}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${shareForm.display !== opt.key ? 'hover:text-white' : ''}`}
                          style={shareForm.display === opt.key
                            ? { borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }
                            : { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {shareForm.display === 'percent' && (
                      <p className="text-xs text-slate-600 mt-1">{t('Verán el desempeño y la asignación en %, sin ningún monto de dinero.', 'They\'ll see performance and allocation in %, without any money amounts.')}</p>
                    )}
                  </div>

                  {shareForm.scopeType === 'entity' && (
                    <select value={shareForm.entityId} onChange={(e) => setShareForm((p) => ({ ...p, entityId: e.target.value }))}
                      className="w-full px-3 py-2 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white focus:outline-none">
                      <option value="">{t('- Elige la entidad -', '- Pick the entity -')}</option>
                      {(entities || []).map((en) => (
                        <option key={en.id} value={en.id}>{en.icon || '📁'} {en.name}</option>
                      ))}
                    </select>
                  )}

                  {shareForm.scopeType === 'institutions' && (
                    <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                      <p className="text-xs text-slate-600">{t('Solo se compartirán las posiciones de lo que marques:', 'Only positions from what you check will be shared:')}</p>
                      {institutionOptions.map((inst) => (
                        <label key={inst} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-theme-elevated cursor-pointer">
                          <input type="checkbox" checked={shareForm.institutions.includes(inst)} onChange={() => toggleInst(inst)} />
                          <span className="text-xs text-white">{inst}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={handleCreateShare} disabled={shareLoading || !canCreate}
                      className="flex-1 py-2 rounded-lg hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium" style={{ color: '#ffffff', backgroundColor: 'var(--accent-green)' }}>
                      {shareLoading ? '...' : t('Crear y copiar link', 'Create & copy link')}
                    </button>
                    <button onClick={() => setShareCreating(false)}
                      className="px-3 py-2 border border-glass-border text-xs rounded-lg hover:bg-theme-elevated transition-colors" style={{ color: 'var(--text-secondary)' }}>
                      {t('Cancelar', 'Cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShareCreating(true)}
                  className="w-full px-3 py-2.5 text-xs font-medium text-slate-400 border border-dashed border-glass-border rounded-lg hover:text-blue-400 hover:border-blue-500/30 transition-colors">
                  + {t('Crear link para compartir', 'Create share link')}
                </button>
              )}

              <p className="text-xs text-slate-600">{t('Los links expiran a los 90 días.', 'Links expire after 90 days.')}</p>
            </div>
            )
          })()}

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

              {/* One prominent nuclear action; the granular deletes live collapsed
                  below — they're rarely needed and were drowning the tab. */}
              {(() => {
                const renderAction = (action) => {
                  const armed = confirmDelete === action.key
                  const busy = deleting === action.key
                  return (
                  <div key={action.key} className="p-3 bg-theme-base border border-glass-border rounded-lg">
                    {/* Label+desc and the button live in one centered row; the warning
                        reveals BELOW it (animated max-height) so arming confirm never
                        shifts the button's position ("la casilla se mueve"). */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-white font-medium">{action.label}</div>
                        <div className="text-xs text-slate-500">{action.desc}</div>
                      </div>
                      <button onClick={() => handleDelete(action.key)} disabled={busy}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 border inline-flex items-center gap-1.5 disabled:opacity-70"
                        style={armed
                          ? { backgroundColor: 'var(--text-negative)', color: '#ffffff', borderColor: 'var(--text-negative)' }
                          : { color: 'var(--text-negative)', borderColor: 'rgba(239,68,68,0.3)' }}>
                        {busy && <span className="inline-block w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
                        {busy ? t('Borrando…', 'Deleting…') : armed ? t('Confirmar', 'Confirm') : t('Eliminar', 'Delete')}
                      </button>
                    </div>
                    <div className="overflow-hidden transition-all duration-200 ease-out"
                      style={{ maxHeight: armed ? 48 : 0, opacity: armed ? 1 : 0 }}>
                      <div className="text-xs mt-2 font-medium" style={{ color: 'var(--accent-orange)' }}>{action.warn}</div>
                    </div>
                  </div>
                )}
                return (
                  <>
                    <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'rgba(239,68,68,0.25)' }}>
                      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-negative)' }}>{t('Empezar de cero', 'Start over')}</p>
                      {renderAction({ key: 'all', label: t('Eliminar todo', 'Delete everything'), desc: t('Borra cuentas, historial, transacciones y finanzas, y desconecta todos los brokers vinculados.', 'Deletes accounts, history, transactions and finances, and disconnects every linked broker.'), warn: t('No se puede deshacer. Descarga un backup antes si tienes duda.', 'This cannot be undone. Download a backup first if in doubt.') })}
                    </div>

                    <details className="group">
                      <summary className="flex items-center justify-between cursor-pointer py-1">
                        <p className="text-xs text-slate-500 uppercase tracking-wider">{t('Borrado selectivo', 'Selective delete')}</p>
                        <span className="text-xs text-slate-600 group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-slate-600">{t('Para casos puntuales: normalmente no necesitas esto.', 'For edge cases: you normally don\'t need these.')}</p>
                        {[
                          { key: 'items', label: t('Eliminar todas las cuentas', 'Delete all accounts'), desc: t('Instrumentos y posiciones (con sus lots y transacciones).', 'Instruments and positions (with their lots and transactions).'), warn: t('Se borrarán cuentas, lots y transacciones asociadas.', 'This will delete accounts, lots, and associated transactions.') },
                          { key: 'transactions', label: t('Eliminar transacciones', 'Delete transactions'), desc: t('Solo el historial de movimientos del portafolio.', 'Only the portfolio movement history.'), warn: t('Los retornos YTD y Modified Dietz serán menos precisos.', 'YTD returns and Modified Dietz will be less accurate.') },
                          { key: 'financeTransactions', label: t('Eliminar finanzas', 'Delete finance data'), desc: t('Solo los ingresos y gastos personales.', 'Only personal income and expense data.'), warn: t('Se perderá el historial de ingresos y gastos.', 'Income and expense history will be lost.') },
                          { key: 'snapshots', label: t('Eliminar snapshots', 'Delete snapshots'), desc: t('Solo el historial del gráfico de crecimiento.', 'Only the growth chart history.'), warn: t('El gráfico de crecimiento perderá datos históricos.', 'The growth chart will lose historical data.') },
                        ].map(renderAction)}

                        {/* Per-account delete: wipe one origin (e.g. IBKR API) without
                            touching another (manual IDC). Only when >1 account exists. */}
                        {/* Shown from ONE account up: the guard used to require >1, which
                            hid the section from exactly the users who most need it (a
                            single connected broker they want to wipe without touching
                            their manual holdings). It also makes the accounts visible. */}
                        {onDeleteItemGroup && accountGroups.length > 0 && (
                          <div className="pt-1">
                            <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">{t('Por cuenta', 'By account')}</p>
                            <div className="space-y-2">
                              {accountGroups.map((g) => renderAction({
                                key: `group:${g.key}`,
                                label: g.institution || t('Sin institución', 'No institution'),
                                desc: `${g.count} ${g.count === 1 ? t('posición', 'position') : t('posiciones', 'positions')} · ${sourceLabel(g.source, g.origin)}`,
                                warn: t('Se borra solo esta cuenta: posiciones, lots, transacciones y su historial de valor. Las demás no se tocan.', 'Deletes only this account: positions, lots, transactions and its value history. The others are untouched.'),
                              }))}
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                    {/* Build id: lets anyone confirm at a glance whether this phone is
                        running the latest deploy (Vercel free tier has silently stopped
                        deploying before when the daily limit was hit). */}
                    <BuildVersionFooter lang={lang} />
                  </>
                )
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Tiny build stamp so a screenshot of Settings proves which deploy the device runs.
function BuildVersionFooter({ lang }) {
  const [buildId, setBuildId] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/version').then((r) => r.json()).then((d) => {
      if (!cancelled) setBuildId(d?.buildId || '?')
    }).catch(() => { if (!cancelled) setBuildId('?') })
    return () => { cancelled = true }
  }, [])
  return (
    <div className="text-center pt-2 space-y-1">
      <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
        {lang === 'es' ? 'Versión' : 'Build'}: {buildId || '…'}
      </p>
      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">{lang === 'es' ? 'Términos' : 'Terms'}</a>
        {' · '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">{lang === 'es' ? 'Privacidad' : 'Privacy'}</a>
      </p>
    </div>
  )
}
