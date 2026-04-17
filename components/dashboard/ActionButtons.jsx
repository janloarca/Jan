'use client'

export default function ActionButtons({ onImport, itemCount, lang }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="px-4 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-amber-400 rounded-lg hover:bg-[#1a2540] transition-colors flex items-center gap-1.5">
        <span>⚡</span> Quick Update
      </button>
      <button onClick={onImport} className="px-4 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-blue-400 rounded-lg hover:bg-[#1a2540] transition-colors flex items-center gap-1.5">
        <span>📁</span> Import
      </button>
      <button className="px-4 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors">
        + {lang === 'es' ? 'Nueva cuenta' : 'Add new account'}
      </button>
      <button className="px-4 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-slate-300 rounded-lg hover:bg-[#1a2540] transition-colors">
        {lang === 'es' ? 'Registrar transaccion' : 'Register transaction'}
      </button>
      <button className="px-3 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-slate-400 rounded-lg hover:bg-[#1a2540] transition-colors">
        + Crypto
      </button>
      <button className="px-3 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-slate-400 rounded-lg hover:bg-[#1a2540] transition-colors">
        + Stock
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button className="px-3 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-slate-400 rounded-lg hover:bg-[#1a2540] transition-colors">
          History
        </button>
        <button className="px-3 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-slate-400 rounded-lg hover:bg-[#1a2540] transition-colors">
          ↓ Export
        </button>
        <span className="text-xs text-slate-500">Accounts: {itemCount}</span>
      </div>
    </div>
  )
}
