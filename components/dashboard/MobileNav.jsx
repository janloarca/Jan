'use client'

import { useState } from 'react'

export default function MobileNav({ onAdd, onImport, onExport, onSettings, onSearch, lang }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const t = (es, en) => lang === 'es' ? es : en

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 sm:hidden bg-[#0f172a]/95 backdrop-blur-sm border-t border-[#334155]">
        <div className="flex items-center justify-around h-14 px-2">
          <button onClick={onSearch} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors py-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-[10px]">{t('Buscar', 'Search')}</span>
          </button>
          <button onClick={onAdd} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors py-1">
            <div className="w-10 h-10 -mt-5 rounded-full bg-blue-600 flex items-center justify-center text-white text-xl shadow-lg shadow-blue-600/30">
              +
            </div>
            <span className="text-[10px]">{t('Agregar', 'Add')}</span>
          </button>
          <button onClick={() => setMoreOpen(!moreOpen)} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors py-1">
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
