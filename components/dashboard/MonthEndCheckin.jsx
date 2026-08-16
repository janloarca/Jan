'use client'

import { useMemo } from 'react'

// Month-end check-in for users WITHOUT live broker connections. Their data
// only moves when they tell us, so during the last two days of the month we
// ask once, kindly: did you buy or sell anything? Three honest answers:
// import a statement (the native PDF path covers Hapi and friends), add it by
// hand, or "nothing happened". Any answer dismisses the card for that month;
// the dismissal lives in settings (_monthCheckin = 'YYYY-MM'), so it survives
// reloads and never nags twice for the same month.
//
// Live sources: broker APIs and wallet syncs keep themselves up to date, so
// asking those users would be noise. File imports (generic CSV/xlsx, and the
// IBKR statement upload) stamp no auto-sync source, so those users DO get
// asked: their statements are exactly what the reminder is for.
const LIVE_SOURCES = new Set([
  'blockchain', 'ledger', 'alpaca', 'coinbase', 'kraken', 'binance', 'bitso',
  'etoro', 'schwab', 'ig', 'saxo', 'tastytrade', 'tradestation',
])

export function hasLiveSync(items, ibkrConnected) {
  if (ibkrConnected) return true
  return (items || []).some((it) => it._source && LIVE_SOURCES.has(it._source))
}

export default function MonthEndCheckin({ settings, saveSettings, hasItems, hasLiveConnection, onImport, onAddManual, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const monthKey = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }, [])

  const visible = useMemo(() => {
    if (!settings || !hasItems || hasLiveConnection) return false
    if (typeof saveSettings !== 'function') return false
    const now = new Date()
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    if (now.getDate() < lastDay - 1) return false
    return settings._monthCheckin !== monthKey
  }, [settings, hasItems, hasLiveConnection, saveSettings, monthKey])

  // After the last hook (CLAUDE.md): nothing below registers hooks.
  if (!visible) return null

  const dismiss = () => saveSettings({ ...settings, _monthCheckin: monthKey })
  const handleImport = () => { dismiss(); onImport?.() }
  const handleManual = () => { dismiss(); onAddManual?.() }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">📅</span>
          <p className="text-sm font-semibold text-white">{t('Cierre de mes', 'Month-end check-in')}</p>
        </div>
        <button onClick={dismiss} aria-label={t('Cerrar', 'Dismiss')}
          className="text-slate-500 hover:text-slate-300 transition-colors text-sm px-1">
          ✕
        </button>
      </div>
      <p className="text-sm mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {t('¿Hiciste compras o ventas este mes? Regístralas para que tu retorno y tu gráfica sigan exactos.',
           'Did you buy or sell anything this month? Log it so your return and your chart stay exact.')}
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={handleImport}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
          {t('Importar estado (PDF o CSV)', 'Import statement (PDF or CSV)')}
        </button>
        <button onClick={handleManual}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-glass)' }}>
          {t('Agregar manualmente', 'Add manually')}
        </button>
        <button onClick={dismiss}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ color: 'var(--text-muted)' }}>
          {t('No, todo igual', 'No, nothing changed')}
        </button>
      </div>
    </div>
  )
}
