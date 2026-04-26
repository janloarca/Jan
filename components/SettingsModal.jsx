'use client'

import { useState } from 'react'

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'MXN', name: 'Peso Mexicano', symbol: '$' },
  { code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  { code: 'COP', name: 'Peso Colombiano', symbol: '$' },
  { code: 'CLP', name: 'Peso Chileno', symbol: '$' },
  { code: 'ARS', name: 'Peso Argentino', symbol: '$' },
  { code: 'BRL', name: 'Real Brasileño', symbol: 'R$' },
  { code: 'PEN', name: 'Sol Peruano', symbol: 'S/' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
]

export default function SettingsModal({ onClose, settings, onSaveSettings, onDeleteAllItems, onDeleteAllSnapshots, onDeleteAllTransactions, theme, onToggleTheme, lang = 'es' }) {
  const [baseCurrency, setBaseCurrency] = useState(settings?.baseCurrency || 'USD')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [tab, setTab] = useState('general')

  const t = (es, en) => lang === 'es' ? es : en

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveSettings({ baseCurrency })
    } catch {}
    setSaving(false)
    onClose()
  }

  const handleDelete = async (type) => {
    if (confirmDelete !== type) {
      setConfirmDelete(type)
      return
    }
    try {
      if (type === 'items') await onDeleteAllItems()
      if (type === 'snapshots') await onDeleteAllSnapshots()
      if (type === 'transactions') await onDeleteAllTransactions()
      if (type === 'all') {
        await onDeleteAllItems()
        await onDeleteAllSnapshots()
        await onDeleteAllTransactions()
      }
    } catch {}
    setConfirmDelete(null)
  }

  const tabs = [
    { key: 'general', label: t('General', 'General') },
    { key: 'data', label: t('Datos', 'Data') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#1e293b] border border-[#334155] rounded-xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#334155]">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {t('Configuracion', 'Settings')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="flex border-b border-[#334155]">
          {tabs.map((tb) => (
            <button key={tb.key} onClick={() => { setTab(tb.key); setConfirmDelete(null) }}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                tab === tb.key
                  ? 'text-emerald-400 border-b-2 border-emerald-400 bg-emerald-400/5'
                  : 'text-slate-400 hover:text-slate-300'
              }`}>
              {tb.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'general' && (
            <div className="space-y-5">
              {/* Theme toggle */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Tema', 'Theme')}</label>
                <div className="flex gap-2">
                  {[
                    { key: 'dark', label: t('Oscuro', 'Dark'), icon: '🌙' },
                    { key: 'light', label: t('Claro', 'Light'), icon: '☀️' },
                  ].map((opt) => (
                    <button key={opt.key} onClick={() => onToggleTheme(opt.key)}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
                        theme === opt.key
                          ? 'bg-blue-500/15 border border-blue-500/40 text-blue-400'
                          : 'bg-[#0f172a] border border-[#334155] text-slate-300 hover:border-slate-500'
                      }`}>
                      <span className="text-lg">{opt.icon}</span>
                      <span className="text-sm font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-2 block font-medium">{t('Moneda principal', 'Base currency')}</label>
                <p className="text-[10px] text-slate-600 mb-3">{t('Todos los valores se mostrarán en esta moneda.', 'All values will be displayed in this currency.')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {CURRENCIES.map((c) => (
                    <button key={c.code} onClick={() => setBaseCurrency(c.code)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-all ${
                        baseCurrency === c.code
                          ? 'bg-blue-500/15 border border-blue-500/40 text-blue-400'
                          : 'bg-[#0f172a] border border-[#334155] text-slate-300 hover:border-slate-500'
                      }`}>
                      <span className="text-sm font-bold w-8">{c.symbol}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{c.code}</div>
                        <div className="text-[9px] text-slate-500 truncate">{c.name}</div>
                      </div>
                      {baseCurrency === c.code && (
                        <svg className="w-4 h-4 ml-auto text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleSave} disabled={saving}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
                {saving ? '...' : t('Guardar configuracion', 'Save settings')}
              </button>
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">{t('Administra los datos de tu portfolio. Estas acciones no se pueden deshacer.', 'Manage your portfolio data. These actions cannot be undone.')}</p>

              {[
                { key: 'items', label: t('Eliminar todas las cuentas', 'Delete all accounts'), desc: t('Borra todos los instrumentos y posiciones.', 'Deletes all instruments and positions.') },
                { key: 'snapshots', label: t('Eliminar snapshots', 'Delete snapshots'), desc: t('Borra el historial de snapshots del portfolio.', 'Deletes portfolio snapshot history.') },
                { key: 'transactions', label: t('Eliminar transacciones', 'Delete transactions'), desc: t('Borra el historial de transacciones.', 'Deletes transaction history.') },
                { key: 'all', label: t('Eliminar todo', 'Delete everything'), desc: t('Borra todos los datos del portfolio.', 'Deletes all portfolio data.') },
              ].map((action) => (
                <div key={action.key} className="flex items-center justify-between p-3 bg-[#0f172a] border border-[#334155] rounded-lg">
                  <div>
                    <div className="text-sm text-white font-medium">{action.label}</div>
                    <div className="text-[10px] text-slate-500">{action.desc}</div>
                  </div>
                  <button onClick={() => handleDelete(action.key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ml-3 ${
                      confirmDelete === action.key
                        ? 'bg-red-600 text-white'
                        : 'border border-red-500/30 text-red-400 hover:bg-red-500/10'
                    }`}>
                    {confirmDelete === action.key ? t('Confirmar', 'Confirm') : t('Eliminar', 'Delete')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
