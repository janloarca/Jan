'use client'

import { useState, useEffect, useCallback } from 'react'
import { Settings, Building2 } from 'lucide-react'
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

export default function SettingsModal({ onClose, settings, onSaveSettings, onDeleteAllItems, onDeleteAllSnapshots, onDeleteAllTransactions, onDeleteAllFinanceTransactions, onExportBackup, onSyncBroker, theme, onToggleTheme, lang = 'es' }) {
  const [baseCurrency, setBaseCurrency] = useState(settings?.baseCurrency || 'USD')
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(settings?.benchmarkSymbol || '%5EGSPC')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [tab, setTab] = useState('general')
  const [shareToken, setShareToken] = useState(null)
  const [shareEnabled, setShareEnabled] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [ibkrToken, setIbkrToken] = useState('')
  const [ibkrQueryId, setIbkrQueryId] = useState('')
  const [ibkrConfigured, setIbkrConfigured] = useState(false)
  const [ibkrSaving, setIbkrSaving] = useState(false)
  const [ibkrSyncing, setIbkrSyncing] = useState(false)
  const [ibkrResult, setIbkrResult] = useState(null)
  const [ibkrError, setIbkrError] = useState('')

  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveSettings({ baseCurrency, benchmarkSymbol })
    } catch {}
    setSaving(false)
    onClose()
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
    } catch {}
    setConfirmDelete(null)
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
      setIbkrResult(null)
    } catch {}
    setIbkrSaving(false)
  }

  const handleIbkrSync = async () => {
    setIbkrSyncing(true)
    setIbkrError('')
    setIbkrResult(null)
    try {
      const credsRes = await authFetch('/api/brokers/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-credentials' }),
      })
      if (!credsRes.ok) throw new Error('Could not load credentials')
      const creds = await credsRes.json()
      if (!creds.configured) throw new Error(t('Configura IBKR primero', 'Configure IBKR first'))

      const syncRes = await authFetch('/api/brokers/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', token: '__stored__', queryId: creds.flexQueryId }),
      })
      if (!syncRes.ok) {
        const d = await syncRes.json()
        throw new Error(d.error || `Sync failed (${syncRes.status})`)
      }
      const data = await syncRes.json()
      setIbkrResult(data)
      if (onSyncBroker) await onSyncBroker(data.positions)
    } catch (e) { setIbkrError(e.message) }
    setIbkrSyncing(false)
  }

  const tabs = [
    { key: 'general', label: t('General', 'General') },
    { key: 'brokers', label: t('Brokers', 'Brokers') },
    { key: 'share', label: t('Compartir', 'Share') },
    { key: 'data', label: t('Datos', 'Data') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div className="bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
          <h2 id="settings-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
            <Settings size={20} className="text-slate-400" />
            {t('Configuracion', 'Settings')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="flex border-b border-[#334155]">
          {tabs.map((tb) => (
            <button key={tb.key} onClick={() => { setTab(tb.key); setConfirmDelete(null) }}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
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
                          : 'bg-[#0f172a] border border-[#334155] text-slate-300 hover:border-slate-500'
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
                          : 'bg-[#0f172a] border border-[#334155] text-slate-300 hover:border-slate-500'
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
                          : 'bg-[#0f172a] border border-[#334155] text-slate-300 hover:border-slate-500'
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
                  <div className="p-3 bg-[#0f172a] border border-[#334155] rounded-lg flex items-center justify-between">
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

          {tab === 'brokers' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-medium text-white mb-1">Interactive Brokers</h3>
                <p className="text-xs text-slate-500">{t(
                  'Sincroniza posiciones automáticamente via Flex Web Service.',
                  'Sync positions automatically via Flex Web Service.'
                )}</p>
              </div>

              {ibkrError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">{ibkrError}</div>
              )}

              {ibkrResult && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {ibkrResult.count} {t('posiciones importadas', 'positions imported')}
                </div>
              )}

              {!ibkrConfigured ? (
                <div className="space-y-4">
                  <div className="pl-1 space-y-2">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider">{t('Instrucciones', 'Instructions')}</p>
                    <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside leading-relaxed">
                      <li>{t('Entra a tu cuenta IBKR → Account Management', 'Log into your IBKR account → Account Management')}</li>
                      <li>{t('Ve a Reports → Flex Queries → Activity Flex Queries', 'Go to Reports → Flex Queries → Activity Flex Queries')}</li>
                      <li>{t('Crea un query con: Open Positions + Cash Report', 'Create a query with: Open Positions + Cash Report')}</li>
                      <li>{t('Copia el Query ID y genera un Flex Web Service Token', 'Copy the Query ID and generate a Flex Web Service Token')}</li>
                    </ol>
                  </div>

                  <div className="border-t border-[#334155]/40 pt-4 space-y-3">
                    <div>
                      <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 block">{t('Flex Token', 'Flex Token')}</label>
                      <input type="password" value={ibkrToken} onChange={(e) => setIbkrToken(e.target.value)}
                        placeholder="••••••••••••••••"
                        className="w-full px-4 py-2.5 bg-[#0f172a] border border-[#334155]/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-500 uppercase tracking-wider mb-1.5 block">{t('Query ID', 'Query ID')}</label>
                      <input type="text" value={ibkrQueryId} onChange={(e) => setIbkrQueryId(e.target.value)}
                        placeholder="123456"
                        className="w-full px-4 py-2.5 bg-[#0f172a] border border-[#334155]/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                    </div>

                    <button onClick={handleIbkrSave} disabled={ibkrSaving || !ibkrToken || !ibkrQueryId}
                      className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-all text-sm font-medium">
                      {ibkrSaving ? '...' : t('Conectar', 'Connect')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-400 rounded-full" />
                      <span className="text-sm text-white font-medium">{t('Conectado', 'Connected')}</span>
                      <span className="text-xs text-slate-500 font-mono">{ibkrQueryId}</span>
                    </div>
                    <button onClick={handleIbkrDisconnect} disabled={ibkrSaving}
                      className="text-xs text-slate-500 hover:text-red-400 transition-colors">
                      {t('Desconectar', 'Disconnect')}
                    </button>
                  </div>

                  <button onClick={handleIbkrSync} disabled={ibkrSyncing}
                    className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 disabled:opacity-50 transition-all text-sm font-medium flex items-center justify-center gap-2">
                    {ibkrSyncing ? (
                      <><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> {t('Sincronizando...', 'Syncing...')}</>
                    ) : (
                      <>{t('Sincronizar ahora', 'Sync now')}</>
                    )}
                  </button>
                </div>
              )}

              <p className="text-[11px] text-slate-600 italic border-t border-[#334155]/40 pt-4">{t(
                'Próximamente: GBM+, Binance, Bitso y más.',
                'Coming soon: GBM+, Binance, Bitso and more.'
              )}</p>
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
                  <div className="bg-[#0f172a] border border-[#334155] rounded-lg p-3">
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
                      className="flex-1 py-2 border border-[#334155] text-slate-300 rounded-lg hover:bg-slate-700/50 disabled:opacity-50 transition-colors text-xs">
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
                <div className="flex items-center justify-between p-3 bg-[#0f172a] border border-emerald-500/20 rounded-lg">
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
                <div key={action.key} className="flex items-center justify-between p-3 bg-[#0f172a] border border-[#334155] rounded-lg">
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
