'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Calculator, Plus, Menu, Upload, Download, Share2, Settings, Table } from 'lucide-react'

export default function MobileNav({ onAdd, onImport, onExport, onShare, onSettings, onSearch, lang }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const t = (es, en) => lang === 'es' ? es : en
  const pathname = usePathname()

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 sm:hidden bg-[#09090b]/95 backdrop-blur-sm border-t border-[#38383A]">
        <div className="flex items-center justify-around h-14 px-2">
          <Link href="/dashboard" aria-label={t('Patrimonio', 'Portfolio')} className="flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center" style={{ color: pathname === '/dashboard' ? '#60a5fa' : '#94a3b8' }}>
            <Home size={20} />
            <span className="text-micro">{t('Patrimonio', 'Portfolio')}</span>
          </Link>
          <Link href="/finances" aria-label={t('Finanzas', 'Finances')} className="flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center" style={{ color: pathname === '/finances' ? '#60a5fa' : '#94a3b8' }}>
            <Calculator size={20} />
            <span className="text-micro">{t('Finanzas', 'Finances')}</span>
          </Link>
          <Link href="/spreadsheet" aria-label="Spreadsheet" className="flex flex-col items-center gap-0.5 transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center" style={{ color: pathname === '/spreadsheet' ? '#60a5fa' : '#94a3b8' }}>
            <Table size={20} />
            <span className="text-micro">Sheet</span>
          </Link>
          <button onClick={onAdd} aria-label={t('Agregar', 'Add')} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors p-2.5 min-w-[44px] min-h-[44px] justify-center">
            <div className="w-10 h-10 -mt-5 rounded-full flex items-center justify-center text-white shadow-lg" style={{ backgroundColor: '#2563eb', boxShadow: '0 10px 15px -3px rgba(37,99,235,0.3)' }}>
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
          <div className="absolute bottom-14 left-0 right-0 bg-[#1C1C1E] border-t border-[#38383A] rounded-t-2xl shadow-2xl p-4 space-y-1" onClick={(e) => e.stopPropagation()}>
            {[
              { action: onImport, icon: Upload, label: t('Importar archivo', 'Import file') },
              { action: onExport, icon: Download, label: t('Exportar Excel', 'Export Excel') },
              { action: onShare, icon: Share2, label: t('Compartir resumen', 'Share summary') },
              { action: onSettings, icon: Settings, label: t('Configuración', 'Settings') },
            ].map((item, i) => (
              <button key={i} onClick={() => { item.action(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-white rounded-lg hover:bg-[#2C2C2E] transition-colors">
                <item.icon size={18} className="text-slate-400" />
                <span className="text-body">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="h-14 sm:hidden" />
    </>
  )
}
