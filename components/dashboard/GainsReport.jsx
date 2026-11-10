'use client'

import { useMemo } from 'react'
import { formatCurrency, formatDate } from './utils'
import { buildGainsReport } from '@/lib/gainsReport'

const tone = (v) => (v >= 0 ? 'var(--accent-green)' : 'var(--text-negative)')
const signed = (v) => `${v >= 0 ? '+' : ''}${formatCurrency(v)}`

function GainsRow({ s, t }) {
  let term = null
  if (s.heldDays != null) {
    const months = Math.floor(s.heldDays / 30.44)
    const span = months >= 12 ? t(`${(months / 12).toFixed(1)} años`, `${(months / 12).toFixed(1)} yrs`) : t(`${months} m`, `${months} mo`)
    term = `${t('desde', 'since')} ${formatDate(s.since)} · ${span} · ${s.term === 'long' ? t('largo plazo', 'long term') : t('corto plazo', 'short term')}`
  }
  return (
    <div className="py-1.5 px-2 rounded-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }} title={s.name}>{s.symbol}</span>
        <div className="flex items-center gap-3 text-xs shrink-0">
          {s.realized !== 0 && <span style={{ color: tone(s.realized) }}>{t('Real.', 'Real.')} {signed(s.realized)}</span>}
          {s.unrealized !== 0 && <span style={{ color: tone(s.unrealized) }}>{t('No real.', 'Unreal.')} {signed(s.unrealized)}</span>}
        </div>
      </div>
      {s.openQty > 0 && (
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {s.openQty.toLocaleString(undefined, { maximumFractionDigits: 8 })} {t('u.', 'units')} · {t('costo prom.', 'avg cost')} {formatCurrency(s.avgCost)}/{t('u.', 'unit')}
          {s.openLots > 1 ? ` · ${s.openLots} ${t('lotes', 'lots')}` : ''}
          {term ? ` · ${term}` : ''}
        </p>
      )}
    </div>
  )
}

// FASE RQ: las tres cifras de arriba son SOLO lo invertible. La plusvalía del
// inmueble iba sumada a "No realizada" y se leía como ganancia de la cartera;
// ahora va en su propia línea (ver lib/gainsReport.js).
export default function GainsReport({ lots, items, lang, convert, baseCurrency }) {
  const t = (es, en) => lang === 'es' ? es : en

  const report = useMemo(() => buildGainsReport({ lots, items, convert, baseCurrency }), [lots, items, convert, baseCurrency])

  if (!report) return null
  const inv = report.investable
  const re = report.realEstate

  return (
    <div>
      <h3 className="card-title mb-4">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
        {t('GANANCIAS Y PÉRDIDAS', 'GAINS & LOSSES')}
      </h3>

      <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        {t('Cartera invertible (sin vivienda)', 'Investable portfolio (excluding real estate)')}
      </p>
      <div className="grid grid-cols-3 gap-3 mb-3">
        {[['Realizada', 'Realized', inv.realized], ['No realizada', 'Unrealized', inv.unrealized], ['Total', 'Total', inv.total]].map(([es, en, v]) => (
          <div key={en} className="rounded-lg p-3 text-center border" style={{ borderColor: 'var(--card-border)' }}>
            <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t(es, en)}</span>
            <span className="text-sm font-bold block font-mono tabular-nums" style={{ color: tone(v) }}>{signed(v)}</span>
          </div>
        ))}
      </div>

      {re.symbols.length > 0 && (
        <div className="flex items-center justify-between rounded-lg px-3 py-2 mb-3 border text-xs" style={{ borderColor: 'var(--card-border)' }}>
          <span style={{ color: 'var(--text-secondary)' }}>{t('Inmueble (aparte, no es P&L de la cartera)', 'Real estate (separate, not portfolio P&L)')}</span>
          <span className="font-mono tabular-nums" style={{ color: tone(re.total) }}>{signed(re.total)}</span>
        </div>
      )}

      {inv.symbols.length > 0 ? (
        <div className="space-y-0.5">{inv.symbols.slice(0, 10).map((s) => <GainsRow key={s.symbol} s={s} t={t} />)}</div>
      ) : (
        <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
          {t('Agrega lotes al comprar o vender para ver ganancias.', 'Add lots by buying or selling to see gains.')}
        </p>
      )}
    </div>
  )
}
