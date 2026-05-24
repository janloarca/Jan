'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search, RefreshCw, Settings, LogOut, Plus, Upload, Zap } from 'lucide-react'

export default function Header({ user, lang, setLang, onImport, onSignOut, onRefresh, onSettings, pricesLoading, onAddAccount, onCommandPalette }) {
  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', label: lang === 'es' ? 'Patrimonio' : 'Portfolio' },
    { href: '/finances', label: lang === 'es' ? 'Finanzas' : 'Finances' },
  ]

  return (
    <header className="border-b border-[#334155] sticky top-0 z-20 bg-[#0f172a]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Zap size={20} className="text-blue-400" />
              <div>
                <h1 className="text-base font-bold text-blue-400 leading-tight">Chispudo</h1>
                <p className="text-caption text-slate-500 hidden sm:block leading-none">
                  {lang === 'es' ? 'Tu dinero, tu control' : 'Your money, your control'}
                </p>
              </div>
            </div>
            <nav className="hidden sm:flex items-center gap-1 ml-2" aria-label="Main navigation">
              {navItems.map(item => (
                <Link key={item.href} href={item.href}
                  className={`px-3 py-1.5 text-body font-medium rounded-lg transition-colors ${
                    pathname === item.href
                      ? 'text-blue-400 bg-blue-400/10'
                      : 'text-slate-400 hover:text-white hover:bg-[#283548]'
                  }`}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-caption text-slate-500 hidden lg:block">{today}</span>
            {onCommandPalette && (
              <button onClick={onCommandPalette}
                aria-label={lang === 'es' ? 'Buscar' : 'Search'}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-caption text-slate-500 border border-slate-600/50 rounded-lg hover:bg-[#283548] hover:text-slate-300 transition-colors">
                <Search size={12} />
                <kbd className="text-micro text-slate-600 bg-slate-800/50 px-1 rounded">⌘K</kbd>
              </button>
            )}
            <button onClick={onRefresh} disabled={pricesLoading} aria-label={lang === 'es' ? 'Actualizar precios' : 'Refresh prices'}
              className="px-2 py-1.5 text-blue-400 border border-blue-400/30 rounded-lg hover:bg-blue-400/10 transition-colors disabled:opacity-50">
              <RefreshCw size={14} className={pricesLoading ? 'animate-spin' : ''} />
            </button>
            <button onClick={setLang} aria-label={lang === 'es' ? 'Cambiar a inglés' : 'Switch to Spanish'}
              className="px-2 py-1.5 text-caption text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#283548] transition-colors font-medium">
              {lang === 'en' ? 'ES' : 'EN'}
            </button>
            {onAddAccount && (
              <button onClick={onAddAccount} aria-label={lang === 'es' ? 'Agregar activo' : 'Add asset'}
                className="px-3 py-1.5 text-body font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-1">
                <Plus size={14} /> {lang === 'es' ? 'Nuevo' : 'New'}
              </button>
            )}
            <button onClick={onImport} aria-label={lang === 'es' ? 'Importar archivo' : 'Import file'}
              className="hidden sm:flex items-center gap-1 px-3 py-1.5 text-body font-medium text-slate-300 border border-slate-600/50 rounded-lg hover:bg-[#283548] transition-colors">
              <Upload size={14} /> {lang === 'es' ? 'Importar' : 'Import'}
            </button>
            <button onClick={onSettings}
              className="px-2 py-1.5 text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#283548] hover:text-white transition-colors"
              aria-label={lang === 'es' ? 'Configuración' : 'Settings'}>
              <Settings size={16} />
            </button>
            <button onClick={onSignOut} aria-label={lang === 'es' ? 'Cerrar sesión' : 'Log out'}
              className="px-2 py-1.5 text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#283548] transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
