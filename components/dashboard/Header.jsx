'use client'

import Link from 'next/link'
import { useEscClose } from '@/hooks/useEscClose'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import ChispudoRefreshButton from '@/components/ui/ChispudoRefreshButton'
import { RING_VIEWBOX, RING_CX, RING_CY, RING_R, sweepDash } from '@/lib/brandRing'
import Logo from '@/components/ui/Logo'
import { Search, Settings, LogOut, Plus, Upload, ChevronDown, Link2, Sparkles, Compass } from 'lucide-react'

// ibkrNeedsAttention (not a raw `ibkrSyncStatus === 'error'`) drives the warning
// triangle: a single transient sync failure is not news while auto-sync is still
// retrying every 30min. The dashboard owns that rule so the pill, the top banner
// and the actions card dot always agree. See app/dashboard/page.jsx.

// FASE ME7: el arco del pill era la CUARTA copia de la geometría del anillo
// (R=13.5, 0.22/0.78 y su propio keyframe), exactamente lo que lib/brandRing.js
// existe para impedir; el guardián solo miraba tres archivos y este se le
// escapó. Ahora importa del módulo compartido y usa el keyframe global.
export default function Header({ user, lang, setLang, onImport, onSignOut, onRefresh, onSettings, pricesLoading, loadStagesDone = 0, loadStagesTotal = 0, refreshError = false, onAddAccount, onCommandPalette, onOpenConnections, ibkrConnected, ibkrAutoSyncing, ibkrSyncStatus, ibkrNeedsAttention = false, ibkrSyncSummary, onIBKR, friendsEnabled = true, onEnrich, enrichGapCount = 0, onGuided }) {
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const newMenuRef = useRef(null)

  useEscClose(() => setNewMenuOpen(false), newMenuOpen)

  // IBKR pill success flash — mirrors ChispudoRefreshButton's own success-hold
  // effect (same shape: a `wasX` ref that only updates on the non-triggering
  // branch, so it inherits the same correctness across repeated cycles) so a
  // sync finishing cleanly is announced here too, not just a silent snap back
  // to the green dot. Short flash, not the full ring's spark burst — this is
  // a small pill, not the primary control.
  const [ibkrJustSynced, setIbkrJustSynced] = useState(false)
  const wasIbkrSyncing = useRef(false)
  useEffect(() => {
    if (wasIbkrSyncing.current && !ibkrAutoSyncing && !ibkrNeedsAttention) {
      setIbkrJustSynced(true)
      const id = setTimeout(() => setIbkrJustSynced(false), 700)
      return () => clearTimeout(id)
    }
    wasIbkrSyncing.current = ibkrAutoSyncing
  }, [ibkrAutoSyncing, ibkrNeedsAttention])
  // An attention flag arriving mid-flash (rare) cancels it rather than fighting it.
  useEffect(() => { if (ibkrNeedsAttention) setIbkrJustSynced(false) }, [ibkrNeedsAttention])

  // Short, human date: "21 jun 2026" / "Jun 21, 2026"
  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    day: 'numeric', month: 'short', year: 'numeric'
  }).replace('.', '')
  const pathname = usePathname()

  const navItems = [
    // "Net Worth", not "Portfolio" — one name for the core concept everywhere
    // (matches the page's own h1 and the NetWorth card).
    { href: '/dashboard', label: lang === 'es' ? 'Patrimonio' : 'Net Worth' },
    { href: '/finances', label: lang === 'es' ? 'Flujo' : 'Flow' },
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
            <Logo size={19} as="h1" title={lang === 'es' ? 'Tu dinero, tu control' : 'Your money, your control'} />

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

            <ChispudoRefreshButton
              onClick={onRefresh}
              loading={pricesLoading}
              progress={loadStagesTotal > 0 ? Math.round((loadStagesDone / loadStagesTotal) * 100) : null}
              error={refreshError}
              lang={lang}
              // 36px = h-9, la MISMA altura que el resto de la fila (buscar,
              // el pill de IBKR, ajustes, salir). A 44 sobresalía arriba y
              // abajo y rompía la banda que forman los demás controles. El
              // área táctil de 44 la conserva el propio botón por dentro.
              size={36}
            />

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
                className="relative overflow-hidden px-2.5 h-9 text-xs font-medium rounded-full border transition-colors flex items-center gap-1.5 disabled:cursor-default"
                style={ibkrAutoSyncing
                  ? { color: 'var(--accent-blue)', borderColor: 'rgba(79,70,229,0.3)', backgroundColor: 'rgba(79,70,229,0.08)' }
                  : ibkrNeedsAttention
                    // Was a hardcoded light-theme hex triplet with no dark-mode
                    // counterpart — the "needs attention" pill rendered light-theme
                    // cream/amber even in dark mode. These three vars match those
                    // exact hex values in light theme and pick up the real dark
                    // variant automatically (globals.css --alert-warn-*).
                    ? { color: 'var(--alert-warn-icon)', borderColor: 'var(--alert-warn-border)', backgroundColor: 'var(--alert-warn-bg)' }
                    : { color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }
                }>
                {ibkrJustSynced && (
                  <span aria-hidden="true" className="absolute inset-0 rounded-full chispu-pill-anim"
                    style={{ backgroundColor: 'var(--accent-green)', animation: 'chispuPillFlash 700ms ease-out forwards' }} />
                )}
                <span className="font-mono relative">IBKR</span>
                {ibkrAutoSyncing ? (
                  // Same sweep language as the header refresh ring's own
                  // indeterminate state, at pill scale — not a bare browser spin.
                  <svg width="12" height="12" viewBox={RING_VIEWBOX} aria-hidden="true" className="relative">
                    {/* busy-ring-arc: con prefers-reduced-motion el barrido se hace
                        LENTO (regla global), nunca se congela: un indicador de
                        ocupado quieto se lee como pantalla trabada. */}
                    <circle cx={RING_CX} cy={RING_CY} r={RING_R} fill="none" strokeWidth="4" strokeLinecap="round"
                      className="busy-ring-arc"
                      style={{
                        stroke: 'currentColor',
                        strokeDasharray: sweepDash(),
                        transformOrigin: '16px 16px',
                        animation: 'chispuSweep 1.1s linear infinite',
                      }} />
                  </svg>
                ) : ibkrNeedsAttention ? (
                  <span className="relative">⚠</span>
                ) : (
                  <span className="relative" style={{ color: 'var(--accent-green)' }}>●</span>
                )}
              </button>
            )}

            {/* Every way of getting data IN lives behind one primary action, instead of
                spreading "Nuevo" + "Importar" across the bar (and hiding "Conectar" in
                Settings, where nobody looked for it). The language toggle moved into
                Settings — it is a preference you set once, not a per-session control. */}
            {onAddAccount && (
              <div className="relative" ref={newMenuRef}>
                <button onClick={() => setNewMenuOpen((v) => !v)}
                  aria-haspopup="menu" aria-expanded={newMenuOpen}
                  aria-label={lang === 'es' ? 'Agregar' : 'Add'}
                  className="btn-primary text-body" data-tour="header-new">
                  <Plus size={14} /> {lang === 'es' ? 'Nuevo' : 'New'}
                  <ChevronDown size={13} className={newMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {newMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setNewMenuOpen(false)} />
                    <div role="menu"
                      className="absolute right-0 mt-2 w-64 rounded-xl border p-1.5 z-40"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)', boxShadow: 'var(--shadow-modal)', backdropFilter: 'var(--glass-blur)' }}>
                      {[
                        // "Agregar manualmente" nombraba a la vez este destino
                        // (el formulario largo) y al recorrido guiado de la
                        // pantalla de bienvenida. Una etiqueta es una promesa
                        // sobre dónde aterrizas, así que se separan: acá el
                        // nombre que la paleta de comandos ya usaba para ESTE
                        // mismo destino, y el recorrido entra como su propia
                        // entrada, abajo.
                        { icon: Plus, label: lang === 'es' ? 'Agregar posición' : 'Add position',
                          desc: lang === 'es' ? 'Una posición a la vez' : 'One position at a time',
                          onClick: onAddAccount },
                        onGuided && { icon: Compass, label: lang === 'es' ? 'Guíame paso a paso' : 'Walk me through it',
                          desc: lang === 'es' ? 'Te preguntamos qué tienes' : 'We ask what you have',
                          onClick: onGuided },
                        onOpenConnections && { icon: Link2, label: lang === 'es' ? 'Conectar tu broker' : 'Connect your broker',
                          desc: lang === 'es' ? 'Sync automático' : 'Automatic sync',
                          onClick: onOpenConnections },
                        onImport && { icon: Upload, label: lang === 'es' ? 'Importar archivo' : 'Import file',
                          desc: lang === 'es' ? 'Excel o CSV' : 'Excel or CSV',
                          onClick: onImport, tour: 'header-import' },
                        // Enriching what is already here belongs next to the ways
                        // of adding something new: both answer "my data is not
                        // complete". It used to be a line of small print under the
                        // YTD number, where it read as a complaint about the figure.
                        onEnrich && { icon: Sparkles, label: lang === 'es' ? 'Completar información' : 'Complete your data',
                          desc: enrichGapCount > 0
                            ? (lang === 'es' ? `${enrichGapCount} ${enrichGapCount === 1 ? 'hueco' : 'huecos'} por llenar` : `${enrichGapCount} ${enrichGapCount === 1 ? 'gap' : 'gaps'} to fill`)
                            : (lang === 'es' ? 'Fechas, costos y movimientos' : 'Dates, costs and movements'),
                          onClick: onEnrich, badge: enrichGapCount > 0 ? enrichGapCount : null },
                      ].filter(Boolean).map((it) => (
                        <button key={it.label} role="menuitem" data-tour={it.tour}
                          onClick={() => { setNewMenuOpen(false); it.onClick() }}
                          className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-theme-elevated">
                          <it.icon size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--accent-blue)' }} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-body font-medium" style={{ color: 'var(--text-primary)' }}>{it.label}</span>
                            <span className="block text-micro" style={{ color: 'var(--text-muted)' }}>{it.desc}</span>
                          </span>
                          {it.badge && (
                            <span className="shrink-0 mt-0.5 text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                              {it.badge}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

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

      <style jsx>{`
        @keyframes chispuPillFlash {
          0%   { opacity: 0.55; transform: scale(0.4); }
          60%  { opacity: 0.22; transform: scale(1); }
          100% { opacity: 0;    transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .chispu-pill-anim {
            animation: none !important;
          }
        }
      `}</style>
    </header>
  )
}
