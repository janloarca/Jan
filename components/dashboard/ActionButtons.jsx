'use client'

export default function ActionButtons({ onImport, onAddAccount, onAddTransaction, onExport, itemCount, lang }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={onImport}
        className="px-4 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors flex items-center gap-1.5">
        <span>📁</span> {lang === 'es' ? 'Importar' : 'Import'}
      </button>
      <button onClick={onAddAccount}
        className="px-4 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-emerald-400 rounded-lg hover:bg-[#1a2540] transition-colors">
        + {lang === 'es' ? 'Nueva cuenta' : 'New account'}
      </button>
      <button onClick={onAddTransaction}
        className="px-4 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-blue-400 rounded-lg hover:bg-[#1a2540] transition-colors">
        {lang === 'es' ? 'Registrar transacción' : 'Record transaction'}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button onClick={onExport}
          className="px-3 py-2 text-xs font-medium bg-[#131c2e] border border-[#1e2d45] text-slate-400 rounded-lg hover:bg-[#1a2540] transition-colors">
          ↓ Export
        </button>
        <span className="text-xs text-slate-500">
          {lang === 'es' ? 'Cuentas' : 'Accounts'}: {itemCount}
        </span>
      </div>
    </div>
  )
}
