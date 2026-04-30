'use client'

export default function ActionButtons({ onImport, onAddAccount, onExport, itemCount, lang }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={onImport}
        className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-1.5">
        <span>📁</span> {lang === 'es' ? 'Importar' : 'Import'}
      </button>
      <button onClick={onAddAccount}
        className="px-4 py-2 text-xs font-medium bg-[#1e293b] border border-[#334155] text-blue-400 rounded-lg hover:bg-[#283548] transition-colors">
        + {lang === 'es' ? 'Registro de Activos' : 'Asset Registry'}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button onClick={onExport}
          className="px-3 py-2 text-xs font-medium bg-[#1e293b] border border-[#334155] text-slate-400 rounded-lg hover:bg-[#283548] transition-colors">
          ↓ Export
        </button>
        <span className="text-xs text-slate-500">
          {lang === 'es' ? 'Activos' : 'Assets'}: {itemCount}
        </span>
      </div>
    </div>
  )
}
