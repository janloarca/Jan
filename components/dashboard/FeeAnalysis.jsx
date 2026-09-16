'use client'

import { useMemo } from 'react'
import { formatCurrency, getTypeCategory } from './utils'

const FEE_PRESETS = {
  stocks: { label: 'Brokerage', defaultPct: 0.10 },
  crypto: { label: 'Exchange', defaultPct: 0.25 },
  funds: { label: 'Expense Ratio', defaultPct: 0.50 },
  bonds: { label: 'Management', defaultPct: 0.30 },
  banks: { label: 'Account', defaultPct: 0 },
  realestate: { label: 'Management', defaultPct: 1.0 },
  alternatives: { label: 'Management', defaultPct: 2.0 },
  debts: { label: 'Interest', defaultPct: 0 },
}

export default function FeeAnalysis({ items, netWorth, lang, convert = null, baseCurrency = null }) {
  const t = (es, en) => lang === 'es' ? es : en

  const analysis = useMemo(() => {
    const byCategory = {}
    let totalFees = 0
    let totalValue = 0

    ;(items || []).forEach((it) => {
      if (it.isDebt) return
      const cat = getTypeCategory(it)
      const value = Math.abs((it.quantity || 0) * (it.currentPrice || it.purchasePrice || 0))
      if (value <= 0) return

      let feeAmount = 0
      if (it.managementFee > 0) {
        // FASE OE. `value` ya viene en la moneda BASE (el ítem llega
        // enriquecido); una comisión FIJA se teclea en la moneda del ÍTEM, así
        // que sumarla cruda mezclaba las dos ($50 de un fondo en dólares
        // contaban como Q50 con base en quetzales). Un porcentaje no tiene
        // moneda y se aplica sobre el valor ya convertido, como siempre.
        const fixedCur = it._originalCurrency || it.currency || 'USD'
        const fixed = convert && baseCurrency ? convert(it.managementFee, fixedCur, baseCurrency) : it.managementFee
        feeAmount += it.managementFeeType === 'fixed' ? fixed : value * (it.managementFee / 100)
      }
      if (it.expenseRatio > 0) {
        feeAmount += value * (it.expenseRatio / 100)
      }
      if (feeAmount === 0) {
        const defaultPct = FEE_PRESETS[cat]?.defaultPct ?? 0
        feeAmount = value * (defaultPct / 100)
      }

      if (!byCategory[cat]) byCategory[cat] = { value: 0, fees: 0, count: 0 }
      byCategory[cat].value += value
      byCategory[cat].fees += feeAmount
      byCategory[cat].count++
      totalFees += feeAmount
      totalValue += value
    })

    const categories = Object.entries(byCategory)
      .filter(([, d]) => d.fees > 0)
      .sort((a, b) => b[1].fees - a[1].fees)
      .map(([cat, d]) => ({
        cat,
        value: d.value,
        fees: d.fees,
        pct: d.value > 0 ? (d.fees / d.value) * 100 : 0,
        count: d.count,
      }))

    const tenYearImpact = totalFees * 10
    const compoundImpact = totalValue > 0
      ? totalValue * (Math.pow(1 + totalFees / totalValue, 10) - 1) - totalFees * 10
      : 0

    return { totalFees, totalValue, avgPct: totalValue > 0 ? (totalFees / totalValue) * 100 : 0, categories, tenYearImpact, compoundImpact }
  }, [items, convert, baseCurrency])

  if (analysis.totalFees <= 0 && analysis.categories.length === 0) return null

  const feeColorHex = analysis.avgPct < 0.3 ? 'var(--accent-green)' : analysis.avgPct < 1.0 ? 'var(--accent-orange)' : 'var(--text-negative)'

  return (
    <div>
      {/* Era el único encabezado con emoji y sin punto de color, en una card
          que vive al lado de otras diez que sí lo llevan. */}
      <h3 className="card-title mb-4">
        <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: 'var(--accent-orange)' }} />
        {t('ANÁLISIS DE COMISIONES', 'FEE ANALYSIS')}
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center">
          <div className="text-h1" style={{ color: feeColorHex }}>{formatCurrency(analysis.totalFees)}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('Comisiones/año', 'Fees/year')}</div>
        </div>
        <div className="text-center">
          <div className="text-h1" style={{ color: feeColorHex }}>{analysis.avgPct.toFixed(2)}%</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('Tasa promedio', 'Avg rate')}</div>
        </div>
        <div className="text-center">
          <div className="text-h1" style={{ color: 'var(--text-negative)' }}>{formatCurrency(analysis.tenYearImpact)}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('Impacto 10 años', '10yr impact')}</div>
        </div>
      </div>

      {analysis.categories.length > 0 && (
        <div className="space-y-2 mb-3">
          {analysis.categories.map(({ cat, fees, pct, count }) => (
            <div key={cat} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="capitalize" style={{ color: 'var(--text-secondary)' }}>{cat}</span>
                <span style={{ color: 'var(--text-muted)' }}>({count})</span>
              </div>
              <div className="flex items-center gap-3">
                <span style={{ color: 'var(--text-muted)' }}>{pct.toFixed(2)}%</span>
                <span className="text-white font-medium w-20 text-right">{formatCurrency(fees)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {netWorth > 0 && analysis.totalFees > 0 && (
        <div className="pt-3 border-t border-glass-border/30 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t(
            `Las comisiones representan ${(analysis.totalFees / netWorth * 100).toFixed(2)}% de tu patrimonio neto`,
            `Fees represent ${(analysis.totalFees / netWorth * 100).toFixed(2)}% of your net worth`
          )}
        </div>
      )}
    </div>
  )
}
