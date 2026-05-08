'use client'

export default function EmptyState({ onAdd, onImport, onTemplate, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="max-w-2xl mx-auto py-12 text-center">
      <div className="text-6xl mb-6">📊</div>
      <h2 className="text-2xl font-bold text-white mb-3">
        {t('Bienvenido a Chispudo', 'Welcome to Chispudo')}
      </h2>
      <p className="text-slate-400 mb-8 text-sm max-w-md mx-auto">
        {t(
          'Empieza agregando tus inversiones para trackear tu portafolio completo — stocks, crypto, bonos, inmuebles y más.',
          'Start adding your investments to track your full portfolio — stocks, crypto, bonds, real estate and more.'
        )}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <button onClick={onAdd}
          className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl p-5 transition-colors text-left">
          <div className="text-2xl mb-2">+</div>
          <div className="font-semibold text-sm mb-1">{t('Agregar manualmente', 'Add manually')}</div>
          <div className="text-xs text-blue-200/70">{t('Una posición a la vez', 'One position at a time')}</div>
        </button>

        <button onClick={onImport}
          className="bg-[#1e293b] hover:bg-[#283548] border border-[#334155] text-white rounded-xl p-5 transition-colors text-left">
          <div className="text-2xl mb-2">📁</div>
          <div className="font-semibold text-sm mb-1">{t('Importar archivo', 'Import file')}</div>
          <div className="text-xs text-slate-400">{t('Excel o CSV de tu broker', 'Excel or CSV from your broker')}</div>
        </button>

        <button onClick={onTemplate}
          className="bg-[#1e293b] hover:bg-[#283548] border border-[#334155] text-white rounded-xl p-5 transition-colors text-left">
          <div className="text-2xl mb-2">📥</div>
          <div className="font-semibold text-sm mb-1">{t('Descargar plantilla', 'Download template')}</div>
          <div className="text-xs text-slate-400">{t('Llena y sube después', 'Fill in and upload later')}</div>
        </button>
      </div>

      <div className="bg-[#1e293b]/60 border border-[#334155]/30 rounded-xl p-5 text-left">
        <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">
          {t('Tipos de activos soportados', 'Supported asset types')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { icon: '📈', label: 'Stocks & ETFs' },
            { icon: '₿', label: 'Crypto & DeFi' },
            { icon: '🏛', label: t('Bonos & CDTs', 'Bonds & CDs') },
            { icon: '💼', label: t('Fondos', 'Funds') },
            { icon: '🏠', label: t('Inmuebles', 'Real Estate') },
            { icon: '🔮', label: t('SAFEs & VC', 'SAFEs & VC') },
            { icon: '🏦', label: t('Bancos & Cash', 'Banks & Cash') },
            { icon: '💳', label: t('Deudas', 'Debts') },
          ].map((type) => (
            <div key={type.label} className="flex items-center gap-2 text-xs text-slate-400 py-1">
              <span>{type.icon}</span>
              <span>{type.label}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-600">
        {t('Detectamos brokers automáticamente: IBKR, Binance, Schwab, Fidelity', 'Auto-detect brokers: IBKR, Binance, Schwab, Fidelity')}
      </p>
    </div>
  )
}
