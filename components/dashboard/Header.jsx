'use client'

export default function Header({ user, lang, setLang, onImport, onSignOut, onRefresh }) {
  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  return (
    <header className="border-b border-[#1e2d45] sticky top-0 z-20 bg-[#0b1120]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-xl">⚡</span>
              <h1 className="text-lg font-bold text-emerald-400">Chispudo</h1>
            </div>
            <p className="text-[10px] text-slate-500 hidden sm:block">
              {lang === 'es' ? 'Tu panel de patrimonio privado en tiempo real.' : 'Your private net worth dashboard in real time.'}
            </p>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-[10px] text-slate-500 hidden lg:block">{today}</span>
            <button onClick={onRefresh} className="px-2.5 py-1.5 text-xs text-emerald-400 border border-emerald-400/30 rounded-lg hover:bg-emerald-400/10 transition-colors flex items-center gap-1">
              <span>↻</span> Refresh
            </button>
            <button onClick={() => setLang(lang === 'en' ? 'es' : 'en')} className="px-2.5 py-1.5 text-xs text-slate-400 border border-slate-600 rounded-lg hover:bg-slate-700 transition-colors">
              {lang === 'en' ? 'ES' : 'EN'}
            </button>
            <button onClick={onImport} className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors hidden sm:block">
              {lang === 'es' ? 'Importar' : 'Import'}
            </button>
            <button onClick={onSignOut} className="px-2.5 py-1.5 text-xs text-slate-400 border border-slate-600 rounded-lg hover:bg-slate-700 transition-colors">
              {lang === 'es' ? 'Salir' : 'Log out'}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
