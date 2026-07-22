'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Receipt, ArrowRight } from 'lucide-react'
import { computeCosts } from '@/lib/costsSummary'

// Compact dashboard square: what the portfolio pays to hold and trade this year
// (commissions + fees + taxes + interest). Links to the full Costs tab. Renders
// nothing when there are no costs, so it never clutters a fresh account.
export default function CostsCard({ transactions, convert, baseCurrency = 'USD', lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const year = new Date().getFullYear()
  const costs = useMemo(
    () => computeCosts({ transactions, convert, baseCurrency, year }),
    [transactions, convert, baseCurrency, year]
  )
  if (!costs.hasData) return null

  const fmt = (n) => {
    try {
      return new Intl.NumberFormat(lang === 'es' ? 'es-GT' : 'en-US', {
        style: 'currency', currency: baseCurrency || 'USD', maximumFractionDigits: 0,
      }).format(Number(n) || 0)
    } catch { return `${baseCurrency || 'USD'} ${Math.round(Number(n) || 0)}` }
  }

  const parts = [
    { label: t('Comisiones', 'Commissions'), value: costs.commissions },
    { label: t('Cargos', 'Fees'), value: costs.fees },
    { label: t('Impuestos', 'Taxes'), value: costs.taxes },
    { label: t('Intereses', 'Interest'), value: costs.interestPaid },
  ].filter((p) => p.value > 0)

  return (
    <Link href="/costs" data-card-id="COST-01"
      className="card-glass rounded-2xl p-5 block transition-all hover:-translate-y-0.5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Receipt size={15} style={{ color: 'var(--accent-blue)' }} />
          <span className="text-xs uppercase tracking-wider text-slate-500">{t('Costos', 'Costs')} {year}</span>
        </div>
        <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
      </div>
      <p className="text-2xl font-bold text-white tracking-tight">{fmt(costs.totalCost)}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{t('Lo que pagaste por invertir', 'What you paid to invest')}</p>
      {parts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {parts.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-glass-border"
              style={{ color: 'var(--text-secondary)' }}>
              {p.label}: <span className="text-white font-medium">{fmt(p.value)}</span>
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}
