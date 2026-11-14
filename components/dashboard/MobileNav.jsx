'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useInstitutional } from '@/hooks/useInstitutional'
import { Home, Calculator, Plus, Menu, Upload, Download, Share2, Settings, Table, Users, Receipt, Building2, Sparkles, Zap, SlidersHorizontal, MessageSquare, Search } from 'lucide-react'

export default function MobileNav({ onAdd, addActions = null, onImport, onExport, onShare, onSettings, onSearch, onAuto, onManage, lang, friendsEnabled = true, onEnrich, enrichGapCount = 0, onChat }) {
  const [moreOpen, setMoreOpen] = useState(false)
  // FASE SE (B3): el «+» de abajo ofrece las cuatro acciones de registrar
  // (dinero, posición, venta, transferencia) en vez de ir directo al alta de
  // una posición. Salen de lib/dashboardActions.js (`record`), la MISMA lista
  // que el menú «Nuevo» del header, así las dos puertas dicen lo mismo. Sin
  // `addActions` (o con una sola) el botón hace lo de siempre: la bienvenida
  // de cero activos sigue entrando directo al recorrido guiado.
  const [addOpen, setAddOpen] = useState(false)
  const addSheet = Array.isArray(addActions) && addActions.length > 1
  const handleAdd = () => { if (addSheet) { setMoreOpen(false); setAddOpen((o) => !o) } else onAdd?.() }
  const t = (es, en) => lang === 'es' ? es : en
  const pathname = usePathname()
  const inst = useInstitutional()

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 sm:hidden bg-theme-base\/95 border-t border-glass-border" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 4px)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
        <div className="flex items-center justify-around h-14 px-1">
          <Link href="/dashboard" aria-label={t('Patrimonio', 'Net Worth')} className="flex flex-1 min-w-0 flex-col items-center gap-0.5 transition-colors px-0.5 py-2.5 min-h-[44px] justify-center" style={{ color: pathname === '/dashboard' ? 'var(--accent-blue)' : 'var(--text-muted)' }}>
            <Home size={20} />
            <span className="text-micro">{t('Patrimonio', 'Net Worth')}</span>
          </Link>
          <Link href="/finances" aria-label={t('Flujo', 'Flow')} className="flex flex-1 min-w-0 flex-col items-center gap-0.5 transition-colors px-0.5 py-2.5 min-h-[44px] justify-center" style={{ color: pathname === '/finances' ? 'var(--accent-blue)' : 'var(--text-muted)' }}>
            <Calculator size={20} />
            <span className="text-micro">{t('Flujo', 'Flow')}</span>
          </Link>
          <Link href="/spreadsheet" aria-label={t('Hoja de Cálculo', 'Spreadsheet')} className="flex flex-1 min-w-0 flex-col items-center gap-0.5 transition-colors px-0.5 py-2.5 min-h-[44px] justify-center" style={{ color: pathname === '/spreadsheet' ? 'var(--accent-blue)' : 'var(--text-muted)' }}>
            <Table size={20} />
            <span className="text-micro">{t('Hoja', 'Sheet')}</span>
          </Link>
          {friendsEnabled !== false && (
            <Link href="/friends" aria-label={t('Amigos', 'Friends')} className="flex flex-1 min-w-0 flex-col items-center gap-0.5 transition-colors px-0.5 py-2.5 min-h-[44px] justify-center" style={{ color: pathname === '/friends' ? 'var(--accent-blue)' : 'var(--text-muted)' }}>
              <Users size={20} />
              <span className="text-micro">{t('Amigos', 'Friends')}</span>
            </Link>
          )}
          <button onClick={handleAdd} aria-label={t('Agregar', 'Add')} aria-expanded={addSheet ? addOpen : undefined} aria-haspopup={addSheet ? 'menu' : undefined} className="flex flex-1 min-w-0 flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors px-0.5 py-2.5 min-h-[44px] justify-center">
            <div className="w-10 h-10 -mt-5 rounded-full flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: 'var(--accent-blue)', boxShadow: '0 8px 20px -3px rgba(37,99,235,0.4)' }}>
              <Plus size={22} />
            </div>
            <span className="text-micro">{t('Agregar', 'Add')}</span>
          </button>
          <button onClick={() => { setAddOpen(false); setMoreOpen(!moreOpen) }} aria-label={t('Más opciones', 'More options')} aria-expanded={moreOpen} className="flex flex-1 min-w-0 flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors px-0.5 py-2.5 min-h-[44px] justify-center">
            <Menu size={20} />
            <span className="text-micro">{t('Más', 'More')}</span>
          </button>
        </div>
      </div>

      {addSheet && addOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={() => setAddOpen(false)}>
          <div role="menu" aria-label={t('Registrar', 'Record')} className="absolute bottom-14 left-0 right-0 bg-theme-card border-t border-glass-border rounded-t-2xl p-4 space-y-1" style={{ backdropFilter: 'var(--glass-blur-strong)', WebkitBackdropFilter: 'var(--glass-blur-strong)', boxShadow: 'var(--shadow-modal)' }} onClick={(e) => e.stopPropagation()}>
            <p className="card-title px-4 pb-1">{t('¿Qué quieres registrar?', 'What do you want to record?')}</p>
            {addActions.map((a) => (
              <button key={a.key} role="menuitem" onClick={() => { setAddOpen(false); a.onClick() }}
                className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left rounded-lg hover:bg-theme-elevated transition-colors">
                <span className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }}>
                  <a.icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-body" style={{ color: 'var(--text-primary)' }}>{a.label}</span>
                  {a.desc && <span className="block text-caption" style={{ color: 'var(--text-muted)' }}>{a.desc}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {moreOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute bottom-14 left-0 right-0 bg-theme-card border-t border-glass-border rounded-t-2xl p-4 space-y-1" style={{ backdropFilter: 'var(--glass-blur-strong)', WebkitBackdropFilter: 'var(--glass-blur-strong)', boxShadow: 'var(--shadow-modal)' }} onClick={(e) => e.stopPropagation()}>
            {/* FASE SB (B4): onSearch llegaba y no se dibujaba en ningún lado, así
                que en un teléfono la búsqueda global no tenía puerta. Va primero:
                es la forma más rápida de llegar a cualquier cosa. */}
            {onSearch && (
              <button onClick={() => { setMoreOpen(false); onSearch() }}
                className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left text-white rounded-lg hover:bg-theme-elevated transition-colors">
                <Search size={18} className="text-slate-400" />
                <span className="text-body">{t('Buscar', 'Search')}</span>
              </button>
            )}
            <Link href="/costs" onClick={() => setMoreOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-white rounded-lg hover:bg-theme-elevated transition-colors"
              style={{ color: pathname === '/costs' ? 'var(--accent-blue)' : undefined }}>
              <Receipt size={18} className="text-slate-400" />
              <span className="text-body">{t('Costos', 'Costs')}</span>
            </Link>
            <Link href="/world" onClick={() => setMoreOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-white rounded-lg hover:bg-theme-elevated transition-colors"
              style={{ color: pathname === '/world' ? 'var(--accent-blue)' : undefined }}>
              <Building2 size={18} className="text-slate-400" />
              <span className="text-body">{t('Mundo', 'World')}</span>
            </Link>
            {inst.isAdvisor && (
              <Link href="/asesor" onClick={() => setMoreOpen(false)} className="w-full flex items-center gap-3 px-4 py-3 text-left text-white rounded-lg hover:bg-theme-elevated transition-colors">
                <Users size={18} className="text-slate-400" />
                <span className="text-body">{t('Asesor', 'Advisor')}</span>
              </Link>
            )}
            {inst.hasAdvisor && (
              <Link href="/tu-asesor" onClick={() => setMoreOpen(false)} className="w-full flex items-center gap-3 px-4 py-3 text-left text-white rounded-lg hover:bg-theme-elevated transition-colors">
                <MessageSquare size={18} className="text-slate-400" />
                <span className="text-body">{t('Tu asesor', 'Your advisor')}</span>
              </Link>
            )}
            {[
              // On a phone the header's "Nuevo" menu is cramped and the big +
              // goes straight to adding a position, so completing what is
              // already there needs its own door here or it is unreachable.
              onEnrich && { action: onEnrich, icon: Sparkles, label: t('Completar información', 'Complete your data'), badge: enrichGapCount > 0 ? enrichGapCount : null },
              onChat && { action: onChat, icon: MessageSquare, label: t('Asistente AI', 'AI Assistant') },
              { action: onImport, icon: Upload, label: t('Importar archivo', 'Import file') },
              { action: onExport, icon: Download, label: t('Exportar Excel', 'Export Excel') },
              onManage && { action: onManage, icon: SlidersHorizontal, label: t('Administrar gastos', 'Manage expenses') },
              onAuto && { action: onAuto, icon: Zap, label: t('Gastos automáticos', 'Automatic expenses') },
              { action: onShare, icon: Share2, label: t('Compartir resumen', 'Share summary') },
              { action: onSettings, icon: Settings, label: t('Configuración', 'Settings') },
            ].filter(Boolean).map((item, i) => (
              <button key={i} onClick={() => { item.action(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-white rounded-lg hover:bg-theme-elevated transition-colors">
                <item.icon size={18} className="text-slate-400" />
                <span className="text-body flex-1">{item.label}</span>
                {item.badge && (
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sm:hidden" style={{ height: 'calc(3.5rem + max(env(safe-area-inset-bottom, 0px), 4px))' }} />
    </>
  )
}
