'use client'

export default function Header({ user, lang, setLang, onImport, onSignOut, onRefresh, onSettings, pricesLoading }) {
  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  return (
    <header className="border-b border-[#1e2d45] sticky top-0 z-20 bg-[#0b1120]/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-xl">⚡</span>
            <div>
              <h1 className="text-base font-bold text-emerald-400 leading-tight">Chispudo</h1>
              <p className="text-[9px] text-slate-500 hidden sm:block leading-none">
                {lang === 'es' ? 'Control financiero' : 'Financial control'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-[10px] text-slate-500 hidden lg:block">{today}</span>
            <button onClick={onRefresh} disabled={pricesLoading}
              className="px-2 py-1.5 text-xs text-emerald-400 border border-emerald-400/30 rounded-lg hover:bg-emerald-400/10 transition-colors disabled:opacity-50">
              <span className={pricesLoading ? 'animate-spin inline-block' : ''}>↻</span>
            </button>
            <button onClick={setLang}
              className="px-2 py-1.5 text-xs text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#1a2540] transition-colors font-medium">
              {lang === 'en' ? 'ES' : 'EN'}
            </button>
            <button onClick={onImport}
              className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors">
              {lang === 'es' ? 'Importar' : 'Import'}
            </button>
            <button onClick={onSettings}
              className="px-2 py-1.5 text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#1a2540] hover:text-white transition-colors"
              title={lang === 'es' ? 'Configuracion' : 'Settings'}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button onClick={onSignOut}
              className="px-2 py-1.5 text-xs text-slate-400 border border-slate-600/50 rounded-lg hover:bg-[#1a2540] transition-colors">
              {lang === 'es' ? 'Salir' : 'Log out'}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
