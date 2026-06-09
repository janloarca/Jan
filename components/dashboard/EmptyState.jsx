'use client'

import { BarChart3, Plus, Upload, Download, TrendingUp, Bitcoin, Landmark, Briefcase, Home, Gem, Building2, CreditCard } from 'lucide-react'

export default function EmptyState({ onAdd, onImport, onTemplate, lang }) {
  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="max-w-2xl mx-auto py-12 text-center">
      <div className="mb-6 flex justify-center">
        <BarChart3 size={48} style={{ color: '#60a5fa' }} />
      </div>
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
          className="text-white rounded-xl p-5 transition-colors text-left" style={{ backgroundColor: '#2563eb' }}>
          <Plus size={24} className="mb-2" />
          <div className="font-semibold text-sm mb-1">{t('Agregar manualmente', 'Add manually')}</div>
          <div className="text-xs" style={{ color: 'rgba(191,219,254,0.7)' }}>{t('Una posición a la vez', 'One position at a time')}</div>
        </button>

        <button onClick={onImport}
          className="bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-[#38383A] text-white rounded-xl p-5 transition-colors text-left">
          <Upload size={24} className="mb-2 text-slate-400" />
          <div className="font-semibold text-sm mb-1">{t('Importar archivo', 'Import file')}</div>
          <div className="text-xs text-slate-400">{t('Excel o CSV de tu broker', 'Excel or CSV from your broker')}</div>
        </button>

        <button onClick={onTemplate}
          className="bg-[#1C1C1E] hover:bg-[#2C2C2E] border border-[#38383A] text-white rounded-xl p-5 transition-colors text-left">
          <Download size={24} className="mb-2 text-slate-400" />
          <div className="font-semibold text-sm mb-1">{t('Descargar plantilla', 'Download template')}</div>
          <div className="text-xs text-slate-400">{t('Llena y sube después', 'Fill in and upload later')}</div>
        </button>
      </div>

      <div className="bg-[#1C1C1E]/60 border border-[#38383A]/30 rounded-xl p-5 text-left">
        <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">
          {t('Tipos de activos soportados', 'Supported asset types')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { Icon: TrendingUp, label: 'Stocks & ETFs', color: '#60a5fa' },
            { Icon: Bitcoin, label: 'Crypto & DeFi', color: '#fbbf24' },
            { Icon: Landmark, label: t('Bonos & CDTs', 'Bonds & CDs'), color: '#34d399' },
            { Icon: Briefcase, label: t('Fondos', 'Funds'), color: '#c084fc' },
            { Icon: Home, label: t('Inmuebles', 'Real Estate'), color: '#fb923c' },
            { Icon: Gem, label: t('SAFEs & VC', 'SAFEs & VC'), color: '#f472b6' },
            { Icon: Building2, label: t('Bancos & Cash', 'Banks & Cash'), color: '#94a3b8' },
            { Icon: CreditCard, label: t('Deudas', 'Debts'), color: '#f87171' },
          ].map((type) => (
            <div key={type.label} className="flex items-center gap-2 text-xs py-1" style={{ color: '#94a3b8' }}>
              <type.Icon size={14} style={{ color: type.color }} />
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
