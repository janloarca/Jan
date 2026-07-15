'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Calculator, Plus, Menu, Upload, Download, Share2, Settings, Table, Users } from 'lucide-react'

export default function MobileNav({ onAdd, onImport, onExport, onShare, onSettings, onSearch, lang, friendsEnabled = true }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const t = (es, en) => lang === 'es' ? es : en
  const pathname = usePathname()

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 sm:hidden bg-theme-base\/95 border-t border-glass-border" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
        <div className="flex items-center justify-around h-14 px-2">
          <Link href="/dashboard" aria-label={t('Patrimonio', 'Net Worth')} className="flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center" style={{ color: pathname === '/dashboard' ? 'var(--accent-blue)' : '#94a3b8' }}>
            <Home size={20} />
            <span className="text-micro">{t('Patrimonio', 'Net Worth')}</span>
          </Link>
          <Link href="/finances" aria-label={t('Finanzas', 'Finances')} className="flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center" style={{ color: pathname === '/finances' ? 'var(--accent-blue)' : '#94a3b8' }}>
            <Calculator size={20} />
            <span className="text-micro">{t('Finanzas', 'Finances')}</span>
          </Link>
          <Link href="/spreadsheet" aria-label={t('Hoja de Cálculo', 'Spreadsheet')} className="flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center" style={{ color: pathname === '/spreadsheet' ? 'var(--accent-blue)' : '#94a3b8' }}>
            <Table size={20} />
            <span className="text-micro">{t('Hoja', 'Sheet')}</span>
          </Link>
          {friendsEnabled !== false && (
            <Link href="/friends" aria-label={t('Amigos', 'Friends')} className="flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center" style={{ color: pathname === '/friends' ? 'var(--accent-blue)' : '#94a3b8' }}>
              <Users size={20} />
              <span className="text-micro">{t('Amigos', 'Friends')}</span>
            </Link>
          )}
          <button onClick={onAdd} aria-label={t('Agregar', 'Add')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center">
            <div className="w-10 h-10 -mt-5 rounded-full flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: 'var(--accent-blue)', boxShadow: '0 8px 20px -3px rgba(108,122,255,0.4)' }}>
              <Plus size={22} />
            </div>
            <span className="text-micro">{t('Agregar', 'Add')}</span>
          </button>
          <button onClick={() => setMoreOpen(!moreOpen)} aria-label={t('Más opciones', 'More options')} aria-expanded={moreOpen} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center">
            <Menu size={20} />
            <span className="text-micro">{t('Más', 'More')}</span>
          </button>
        </div>
      </div>

      {moreOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute bottom-14 left-0 right-0 bg-theme-card border-t border-glass-border rounded-t-2xl p-4 space-y-1" style={{ backdropFilter: 'var(--glass-blur-strong)', WebkitBackdropFilter: 'var(--glass-blur-strong)', boxShadow: 'var(--shadow-modal)' }} onClick={(e) => e.stopPropagation()}>
            {[
              { action: onImport, icon: Upload, label: t('Importar archivo', 'Import file') },
              { action: onExport, icon: Download, label: t('Exportar Excel', 'Export Excel') },
              { action: onShare, icon: Share2, label: t('Compartir resumen', 'Share summary') },
              { action: onSettings, icon: Settings, label: t('Configuración', 'Settings') },
            ].map((item, i) => (
              <button key={i} onClick={() => { item.action(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-white rounded-lg hover:bg-theme-elevated transition-colors">
                <item.icon size={18} className="text-slate-400" />
                <span className="text-body">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sm:hidden" style={{ height: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }} />
    </>
  )
}
