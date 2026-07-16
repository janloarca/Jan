'use client'

import { BarChart3, Plus, Upload, Download, Link2, Sparkles, TrendingUp, Bitcoin, Landmark, Briefcase, Home, Gem, Building2, CreditCard } from 'lucide-react'

export default function EmptyState({ onAdd, onImport, onTemplate, onDemo, onConnect, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  // The four entry paths, visually equal-weight. "Add manually" keeps the solid
  // accent treatment as the primary; the rest are glass cards. Broker connection
  // is deliberately GENERIC (a hub, not one broker's logo) — the hub lists what's
  // available (IBKR auto-sync today, more later).
  const actions = [
    {
      key: 'add', onClick: onAdd, Icon: Plus, primary: true,
      title: t('Agregar manualmente', 'Add manually'),
      desc: t('Una posición a la vez', 'One position at a time'),
    },
    {
      key: 'connect', onClick: onConnect, Icon: Link2,
      title: t('Conectar tu broker', 'Connect your broker'),
      desc: t('Sync automático — IBKR y más', 'Auto sync — IBKR and more'),
    },
    {
      key: 'import', onClick: onImport, Icon: Upload,
      title: t('Importar archivo', 'Import a file'),
      desc: t('Excel o CSV — detectamos el broker', 'Excel or CSV — broker auto-detected'),
    },
    {
      key: 'template', onClick: onTemplate, Icon: Download,
      title: t('Descargar plantilla', 'Download template'),
      desc: t('Llena y sube después', 'Fill in and upload later'),
    },
  ].filter((a) => a.onClick)

  const assetTypes = [
    { Icon: TrendingUp, label: 'Stocks & ETFs', color: 'var(--accent-blue)' },
    { Icon: Bitcoin, label: 'Crypto & DeFi', color: '#fbbf24' },
    { Icon: Landmark, label: t('Bonos & CDTs', 'Bonds & CDs'), color: 'var(--accent-green)' },
    { Icon: Briefcase, label: t('Fondos', 'Funds'), color: '#c084fc' },
    { Icon: Home, label: t('Inmuebles', 'Real Estate'), color: '#fb923c' },
    { Icon: Gem, label: 'SAFEs & VC', color: '#f472b6' },
    { Icon: Building2, label: t('Bancos & Cash', 'Banks & Cash'), color: '#94a3b8' },
    { Icon: CreditCard, label: t('Deudas', 'Debts'), color: 'var(--text-negative)' },
  ]

  return (
    <div className="max-w-3xl mx-auto py-12 text-center px-2">
      {/* Hero */}
      <div className="mb-6 flex justify-center">
        <div className="rounded-2xl p-4" style={{
          background: 'linear-gradient(135deg, rgba(108,122,255,0.16), rgba(108,122,255,0.05))',
          border: '1px solid rgba(108,122,255,0.22)',
          boxShadow: '0 8px 32px rgba(108,122,255,0.12)',
        }}>
          <BarChart3 size={44} style={{ color: 'var(--accent-blue)' }} />
        </div>
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3 tracking-tight">
        {t('Bienvenido a Chispudo', 'Welcome to Chispudo')}
      </h2>
      <p className="text-slate-400 mb-10 text-sm sm:text-base max-w-md mx-auto leading-relaxed">
        {t(
          'Todo tu patrimonio en un solo lugar — stocks, crypto, bonos, inmuebles y más.',
          'Your whole net worth in one place — stocks, crypto, bonds, real estate and more.'
        )}
      </p>

      {/* Entry paths */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {actions.map(({ key, onClick, Icon, title, desc, primary }) => (
          <button key={key} onClick={onClick}
            className={`rounded-2xl p-5 text-left transition-all duration-150 hover:-translate-y-0.5 ${primary
              ? 'text-white'
              : 'bg-theme-card hover:bg-theme-elevated border border-glass-border text-white'}`}
            style={primary
              ? { backgroundColor: 'var(--accent-blue)', boxShadow: '0 8px 24px rgba(108,122,255,0.35)' }
              : { backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-card)' }}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${primary ? '' : ''}`}
              style={primary
                ? { backgroundColor: 'rgba(255,255,255,0.18)' }
                : { backgroundColor: 'rgba(108,122,255,0.10)', border: '1px solid rgba(108,122,255,0.18)' }}>
              <Icon size={18} style={primary ? { color: '#fff' } : { color: 'var(--accent-blue)' }} />
            </div>
            <div className="font-semibold text-sm mb-1">{title}</div>
            <div className="text-xs leading-relaxed" style={primary ? { color: 'rgba(224,231,255,0.85)' } : { color: 'var(--text-muted)' }}>{desc}</div>
          </button>
        ))}
      </div>

      {/* Demo — a real button, not a buried link */}
      {onDemo && (
        <button onClick={onDemo}
          className="inline-flex items-center gap-2 px-5 py-2.5 mb-10 rounded-full text-sm font-medium border transition-colors hover:bg-theme-elevated"
          style={{ color: 'var(--accent-blue)', borderColor: 'rgba(108,122,255,0.35)', backgroundColor: 'rgba(108,122,255,0.06)' }}>
          <Sparkles size={15} />
          {t('Explorar primero con datos de ejemplo', 'Explore with sample data first')}
        </button>
      )}

      {/* Supported asset types — compact pill row */}
      <div>
        <p className="text-[11px] font-semibold text-slate-500 mb-3 uppercase tracking-wider">
          {t('Tipos de activos soportados', 'Supported asset types')}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {assetTypes.map((type) => (
            <span key={type.label}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-glass-border bg-theme-card"
              style={{ color: 'var(--text-secondary)' }}>
              <type.Icon size={13} style={{ color: type.color }} />
              {type.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
