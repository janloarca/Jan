'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function MobileNav({ onAdd, onImport, onExport, onShare, onSettings, onSearch, lang }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const t = (es, en) => lang === 'es' ? es : en
  const pathname = usePathname()

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 sm:hidden bg-[#0f172a]/95 backdrop-blur-sm border-t border-[#334155]">
        <div className="flex items-center justify-around h-14 px-2">
          <Link href="/dashboard" className={`flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center ${pathname === '/dashboard' ? 'text-blue-400' : 'text-slate-400 hover:text-white'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="text-[10px]">{t('Patrimonio', 'Portfolio')}</span>
          </Link>
          <Link href="/finances" className={`flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center ${pathname === '/finances' ? 'text-blue-400' : 'text-slate-400 hover:text-white'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="text-[10px]">{t('Finanzas', 'Finances')}</span>
          </Link>
          <button onClick={onAdd} aria-label={t('Agregar', 'Add')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center">
            <div className="w-10 h-10 -mt-5 rounded-full bg-blue-600 flex items-center justify-center text-white text-xl shadow-lg shadow-blue-600/30">
              +
            </div>
            <span className="text-[10px]">{t('Agregar', 'Add')}</span>
          </button>
          <button onClick={() => setMoreOpen(!moreOpen)} aria-label={t('Más opciones', 'More options')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span className="text-[10px]">{t('Más', 'More')}</span>
          </button>
        </div>
      </div>

      {moreOpen && (
        <div className="fixed inset-0 z-50 sm:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute bottom-14 left-0 right-0 bg-[#1e293b] border-t border-[#334155] rounded-t-2xl shadow-2xl p-4 space-y-1" onClick={(e) => e.stopPropagation()}>
            {[
              { action: onImport, icon: '📁', label: t('Importar archivo', 'Import file') },
              { action: onExport, icon: '📊', label: t('Exportar Excel', 'Export Excel') },
              { action: onShare, icon: '↗', label: t('Compartir resumen', 'Share summary') },
              { action: onSettings, icon: '⚙️', label: t('Configuración', 'Settings') },
            ].map((item, i) => (
              <button key={i} onClick={() => { item.action(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-white rounded-lg hover:bg-[#283548] transition-colors">
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="h-14 sm:hidden" />
    </>
  )
}
