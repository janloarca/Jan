'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search, RefreshCw, Settings, LogOut, Plus, Upload, Zap } from 'lucide-react'

export default function Header({ user, lang, setLang, onImport, onSignOut, onRefresh, onSettings, pricesLoading, onAddAccount, onCommandPalette, ibkrConnected, ibkrAutoSyncing, ibkrSyncStatus, ibkrSyncSummary, onIBKR, friendsEnabled = true }) {
  // Short, human date: "21 jun 2026" / "Jun 21, 2026"
  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    day: 'numeric', month: 'short', year: 'numeric'
  }).replace('.', '')
  const pathname = usePathname()

  const navItems = [
    // "Net Worth", not "Portfolio" — one name for the core concept everywhere
    // (matches the page's own h1 and the NetWorth card).
    { href: '/dashboard', label: lang === 'es' ? 'Patrimonio' : 'Net Worth' },
    { href: '/finances', label: lang === 'es' ? 'Finanzas' : 'Finances' },
    { href: '/spreadsheet', label: lang === 'es' ? 'Hoja de Cálculo' : 'Spreadsheet' },
    ...(friendsEnabled !== false ? [{ href: '/friends', label: lang === 'es' ? 'Amigos' : 'Friends' }] : []),
  ]

  // Shared icon-button style (settings, logout, refresh) — 36px, hairline border.
  const iconBtn = 'w-9 h-9 flex items-center justify-center rounded-lg border transition-colors'
  const iconBtnStyle = { color: 'var(--text-muted)', borderColor: 'var(--card-border)' }

  return (
    <header className="border-b sticky top-0 z-20 bg-theme-base\/95"
      style={{ borderColor: 'var(--card-border)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            {/* Logo — lightning integrated with the wordmark */}
            <div className="flex items-center gap-1.5" title={lang === 'es' ? 'Tu dinero, tu control' : 'Your money, your control'}>
              <Zap size={18} style={{ color: 'var(--accent-blue)' }} fill="var(--accent-blue)" />
              <h1 className="text-base font-bold leading-none tracking-tight" style={{ color: 'var(--text-primary)' }}>Chispudo</h1>
            </div>

            {/* Navigation — segmented control */}
            <nav className="hidden sm:flex items-center gap-0.5 p-1 rounded-[10px]"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
              aria-label="Main navigation" data-tour="nav">
              {navItems.map(item => {
                const active = pathname === item.href
                return (
                  <Link key={item.href} href={item.href}
                    className="px-4 py-1.5 text-body font-medium rounded-lg transition-all"
                    style={active
                      ? { backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                      : { color: 'var(--text-muted)' }}>
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-caption hidden lg:block" style={{ color: 'var(--text-muted)' }}>{today}</span>

            {onCommandPalette && (
              <button onClick={onCommandPalette}
                aria-label={lang === 'es' ? 'Buscar' : 'Search'}
                className="hidden sm:flex items-center gap-1.5 px-3 h-9 text-caption rounded-lg border transition-colors hover:bg-theme-elevated"
                style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
                <Search size={12} />
                <kbd className="text-micro" style={{ color: 'var(--text-muted)' }}>{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'}</kbd>
              </button>
            )}

            <button onClick={onRefresh} disabled={pricesLoading} aria-label={lang === 'es' ? 'Actualizar precios' : 'Refresh prices'}
              className={`${iconBtn} disabled:opacity-50 hover:bg-theme-elevated`}
              style={{ color: 'var(--accent-blue)', borderColor: 'var(--card-border)' }}>
              <RefreshCw size={14} className={pricesLoading ? 'animate-spin' : ''} />
            </button>

            {ibkrConnected && (
              <button onClick={onIBKR} disabled={ibkrAutoSyncing}
                aria-label={ibkrAutoSyncing
                  ? (lang === 'es' ? 'Sincronizando IBKR' : 'Syncing IBKR')
                  : (lang === 'es' ? 'Sincronizar IBKR ahora' : 'Sync IBKR now')}
                title={ibkrAutoSyncing
                  ? (lang === 'es' ? 'Sincronizando IBKR…' : 'Syncing IBKR…')
                  : ibkrSyncSummary
                    ? (lang === 'es'
                        ? `IBKR conectado · ${ibkrSyncSummary.items ?? 0} posiciones · toca para sincronizar`
                        : `IBKR connected · ${ibkrSyncSummary.items ?? 0} positions · tap to sync`)
                    : (lang === 'es' ? 'Sincronizar IBKR ahora' : 'Sync IBKR now')}
                className="px-2.5 h-9 text-xs font-medium rounded-full border transition-colors flex items-center gap-1.5 disabled:cursor-default"
                style={ibkrAutoSyncing
                  ? { color: 'var(--accent-blue)', borderColor: 'rgba(79,70,229,0.3)', backgroundColor: 'rgba(79,70,229,0.08)' }
                  : ibkrSyncStatus === 'error'
                    ? { color: '#D97706', borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }
                    : { color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }
                }>
                <span className="font-mono">IBKR</span>
                {ibkrAutoSyncing
                  ? <RefreshCw size={10} className="animate-spin" />
                  : ibkrSyncStatus === 'error'
                    ? <span>⚠</span>
                    : <span style={{ color: 'var(--accent-green)' }}>●</span>
                }
              </button>
            )}

            <button onClick={setLang} aria-label={lang === 'es' ? 'Cambiar a inglés' : 'Switch to Spanish'}
              className="px-2 h-9 text-caption rounded-md border transition-colors hover:bg-theme-elevated font-medium"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
              {lang === 'en' ? 'ES' : 'EN'}
            </button>

            {onAddAccount && (
              <button onClick={onAddAccount} aria-label={lang === 'es' ? 'Agregar activo' : 'Add asset'}
                className="btn-primary text-body" style={{ borderRadius: '8px' }} data-tour="header-new">
                <Plus size={14} /> {lang === 'es' ? 'Nuevo' : 'New'}
              </button>
            )}

            <button onClick={onImport} aria-label={lang === 'es' ? 'Importar archivo' : 'Import file'}
              className="hidden sm:flex items-center gap-1 px-3 h-9 text-body font-medium rounded-lg border transition-colors hover:bg-theme-elevated"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }} data-tour="header-import">
              <Upload size={14} /> {lang === 'es' ? 'Importar' : 'Import'}
            </button>

            <button onClick={onSettings}
              className={`${iconBtn} hover:bg-theme-elevated`}
              style={iconBtnStyle}
              data-tour="header-settings"
              aria-label={lang === 'es' ? 'Configuración' : 'Settings'}>
              <Settings size={16} />
            </button>

            <button onClick={onSignOut} aria-label={lang === 'es' ? 'Cerrar sesión' : 'Log out'}
              className={`${iconBtn} hover:bg-theme-elevated`}
              style={iconBtnStyle}>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
