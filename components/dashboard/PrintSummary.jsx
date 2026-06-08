'use client'

import { useMemo, useRef } from 'react'
import { formatCurrency, getTypeCategory, getItemValue, getItemPrice, TYPE_COLORS } from './utils'

export default function PrintSummary({ items, netWorth, totalAssets, snapshots, transactions, lang, onClose }) {
  const t = (es, en) => lang === 'es' ? es : en
  const printRef = useRef(null)

  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const assets = useMemo(() => items.filter((it) => !it.isDebt), [items])
  const debts = useMemo(() => items.filter((it) => it.isDebt), [items])

  const debtTotal = useMemo(() =>
    debts.reduce((s, it) => s + Math.abs(getItemValue(it)), 0),
    [debts]
  )

  const byCategory = useMemo(() => {
    const cats = {}
    assets.forEach((it) => {
      const cat = getTypeCategory(it)
      const val = getItemValue(it)
      if (val > 0) {
        if (!cats[cat]) cats[cat] = { count: 0, value: 0, items: [] }
        cats[cat].count++
        cats[cat].value += val
        cats[cat].items.push(it)
      }
    })
    return Object.entries(cats)
      .map(([cat, d]) => ({ cat, ...d, pct: totalAssets > 0 ? (d.value / totalAssets) * 100 : 0 }))
      .sort((a, b) => b.value - a.value)
  }, [assets, totalAssets])

  const topHoldings = useMemo(() =>
    [...assets]
      .map((it) => ({ ...it, value: getItemValue(it) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15),
    [assets]
  )

  const growthPct = useMemo(() => {
    if (snapshots.length < 2) return null
    const sorted = [...snapshots].sort((a, b) => new Date(a.date) - new Date(b.date))
    const first = sorted[0].netWorthUSD ?? sorted[0].totalActivosUSD ?? 0
    const last = sorted[sorted.length - 1].netWorthUSD ?? sorted[sorted.length - 1].totalActivosUSD ?? 0
    if (first <= 0) return null
    return ((last - first) / first) * 100
  }, [snapshots])

  const incomeItems = useMemo(() =>
    assets.filter((it) => it.incomeRate > 0 || it.dividendYield > 0 || (it.rateType === 'variable' && it.rateMin > 0)),
    [assets]
  )

  const estIncome = useMemo(() =>
    incomeItems.reduce((s, it) => {
      const balance = (it.quantity || 1) * getItemPrice(it)
      const rate = it.rateType === 'variable' ? (it.rateMin + it.rateMax) / 2 : it.incomeRate || it.dividendYield || 0
      return s + balance * (rate / 100)
    }, 0),
    [incomeItems]
  )

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white text-black rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Print controls (hidden when printing) */}
        <div className="flex items-center justify-between px-6 py-3 border-b print:hidden">
          <h2 className="text-lg font-bold">{t('Resumen para Imprimir', 'Print Summary')}</h2>
          <div className="flex gap-2">
            <button onClick={handlePrint}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500">
              🖨 {t('Imprimir', 'Print')}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-black text-xl">&times;</button>
          </div>
        </div>

        <div ref={printRef} className="p-8 print:p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b-2 border-gray-200">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t('Resumen de Portafolio', 'Portfolio Summary')}</h1>
              <p className="text-sm text-gray-500">{today}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-400 block">Chispudo</span>
              <span className="text-xs text-gray-400">chispu.xyz</span>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{t('Patrimonio Neto', 'Net Worth')}</div>
              <div className="text-xl font-bold">{formatCurrency(netWorth)}</div>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{t('Activos', 'Assets')}</div>
              <div className="text-xl font-bold text-green-600">{formatCurrency(totalAssets)}</div>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{t('Deuda', 'Debt')}</div>
              <div className="text-xl font-bold text-red-600">{debtTotal > 0 ? formatCurrency(debtTotal) : '$0'}</div>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{t('Rendimiento', 'Return')}</div>
              <div className="text-xl font-bold" style={{ color: (growthPct || 0) >= 0 ? '#059669' : '#dc2626' }}>
                {growthPct != null ? `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>

          {/* Allocation */}
          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">{t('Asignación de Activos', 'Asset Allocation')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500 text-xs">
                  <th className="text-left py-2">{t('Categoría', 'Category')}</th>
                  <th className="text-right py-2">#</th>
                  <th className="text-right py-2">{t('Valor', 'Value')}</th>
                  <th className="text-right py-2">%</th>
                  <th className="py-2 w-32" />
                </tr>
              </thead>
              <tbody>
                {byCategory.map(({ cat, count, value, pct }) => (
                  <tr key={cat} className="border-b border-gray-100">
                    <td className="py-2 capitalize font-medium">{cat}</td>
                    <td className="py-2 text-right text-gray-500">{count}</td>
                    <td className="py-2 text-right">{formatCurrency(value)}</td>
                    <td className="py-2 text-right text-gray-500">{pct.toFixed(1)}%</td>
                    <td className="py-2">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${pct}%`,
                          backgroundColor: TYPE_COLORS[cat]?.bg || '#64748b',
                        }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Top Holdings */}
          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">{t('Principales Posiciones', 'Top Holdings')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500 text-xs">
                  <th className="text-left py-2">{t('Instrumento', 'Instrument')}</th>
                  <th className="text-left py-2">{t('Tipo', 'Type')}</th>
                  <th className="text-right py-2">{t('Cantidad', 'Qty')}</th>
                  <th className="text-right py-2">{t('Precio', 'Price')}</th>
                  <th className="text-right py-2">{t('Valor', 'Value')}</th>
                  <th className="text-right py-2">%</th>
                </tr>
              </thead>
              <tbody>
                {topHoldings.map((it) => {
                  const pct = totalAssets > 0 ? (it.value / totalAssets) * 100 : 0
                  return (
                    <tr key={it.id} className="border-b border-gray-100">
                      <td className="py-1.5">
                        <span className="font-medium">{it.name || it.symbol}</span>
                        {it.symbol && it.name && <span className="text-gray-400 text-xs ml-1">({it.symbol})</span>}
                      </td>
                      <td className="py-1.5 text-gray-500 text-xs">{it.type}{it.subtype ? `/${it.subtype}` : ''}</td>
                      <td className="py-1.5 text-right text-gray-600">{(it.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td className="py-1.5 text-right">{formatCurrency(getItemPrice(it))}</td>
                      <td className="py-1.5 text-right font-medium">{formatCurrency(it.value)}</td>
                      <td className="py-1.5 text-right text-gray-500">{pct.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Income Summary */}
          {estIncome > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">{t('Ingreso Estimado', 'Estimated Income')}</h2>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500">{t('Anual', 'Annual')}</div>
                  <div className="text-lg font-bold text-green-600">{formatCurrency(estIncome)}</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500">{t('Mensual', 'Monthly')}</div>
                  <div className="text-lg font-bold">{formatCurrency(estIncome / 12)}</div>
                </div>
                <div className="border rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500">Yield</div>
                  <div className="text-lg font-bold">{netWorth > 0 ? ((estIncome / netWorth) * 100).toFixed(2) : 0}%</div>
                </div>
              </div>
            </div>
          )}

          {/* Debts */}
          {debts.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">{t('Deudas y Pasivos', 'Debts & Liabilities')}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500 text-xs">
                    <th className="text-left py-2">{t('Nombre', 'Name')}</th>
                    <th className="text-right py-2">{t('Saldo', 'Balance')}</th>
                    <th className="text-right py-2">{t('Tasa', 'Rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {debts.map((it) => (
                    <tr key={it.id} className="border-b border-gray-100">
                      <td className="py-1.5 font-medium">{it.name || it.symbol}</td>
                      <td className="py-1.5 text-right text-red-600">{formatCurrency(Math.abs(getItemValue(it)))}</td>
                      <td className="py-1.5 text-right text-gray-500">{it.interestRate ? `${it.interestRate}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right mt-2 font-bold text-red-600">
                {t('Total deuda', 'Total debt')}: {formatCurrency(debtTotal)}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-xs text-gray-400 pt-4 border-t mt-6">
            {t('Generado por', 'Generated by')} Chispudo · chispu.xyz · {today}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body > *:not(.fixed) { display: none !important; }
          .fixed { position: static !important; background: white !important; }
          .fixed > div { max-height: none !important; overflow: visible !important; box-shadow: none !important; }
          .print\\:hidden { display: none !important; }
          .print\\:p-4 { padding: 1rem !important; }
        }
      `}</style>
    </div>
  )
}
