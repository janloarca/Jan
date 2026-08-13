'use client'

import { useMemo, useState } from 'react'
import { PiggyBank } from 'lucide-react'
import { formatCurrency } from './utils'
import { InfoTip } from '../ui/Tooltip'
import { buildReportSeries } from '@/lib/reportData'
import { computeInvestedByYear } from '@/lib/investedByYear'

// Historia de capital, año por año: cuánto dinero EXTERNO se metió cada año
// (depósitos menos retiros, comisiones de entrada descontadas, sin ganancias
// ni intereses) al lado de cuánto GANARON las inversiones ese año. El año en
// curso es la fila YTD y su ganancia llega del hook (el mismo Dietz del
// encabezado, jamás recalculado); los años cerrados usan el mismo motor de
// años calendario que el reporte (lib/investedByYear.js). Un año sin anclas
// en el archivo imprime "-" en ganancia: un guión honesto antes que un número
// inventado. Cada fila expande su detalle (depósitos / retiros / comisiones).
export default function InvestedByYearCard({ transactions, items, snapshots, netWorth, returnYTD, ytdChange, convert, baseCurrency = 'USD', lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [openYear, setOpenYear] = useState(null)

  const data = useMemo(() => {
    const series = buildReportSeries(snapshots, { convert, baseCurrency })
    return computeInvestedByYear({ transactions, items, series, convert, baseCurrency, returnYTD, ytdChange })
  }, [transactions, items, snapshots, convert, baseCurrency, returnYTD, ytdChange])

  if (!data.hasData) return null

  const fmt = (n) => formatCurrency(n, baseCurrency)
  const signFmt = (n) => `${n >= 0 ? '+' : ''}${fmt(n)}`
  const gainColor = (n) => (n >= 0 ? 'var(--accent-green)' : 'var(--text-negative)')
  const ratio = data.totalInvested > 0 && netWorth > 0 ? netWorth / data.totalInvested : null

  return (
    <div data-card-id="INV-01" className="card-glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <PiggyBank className="w-4 h-4" style={{ color: 'var(--accent-blue)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('Invertido por año', 'Invested by year')}
          </h3>
        </div>
        <InfoTip text={t(
          'Invertido = depósitos menos retiros de ese año en todas tus cuentas, descontando comisiones de entrada. Sin ganancias ni intereses, y el dinero movido entre tus propias cuentas no cuenta. Ganado = lo que rindieron las inversiones ese año, neto de tus aportes (método Dietz, el mismo del YTD). Toca un año para ver su detalle.',
          'Invested = that year\'s deposits minus withdrawals across all your accounts, entry fees discounted. No gains or interest, and money moved between your own accounts does not count. Earned = what your investments returned that year, net of your contributions (Dietz method, same as the YTD). Tap a year for its detail.'
        )} />
      </div>

      {/* Encabezado de columnas */}
      <div className="grid grid-cols-[1fr_1.2fr_1.4fr] gap-2 pb-1.5 mb-1" style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>{t('Año', 'Year')}</span>
        <span className="text-[10px] uppercase tracking-wider font-medium text-right" style={{ color: 'var(--text-muted)' }}>{t('Invertido', 'Invested')}</span>
        <span className="text-[10px] uppercase tracking-wider font-medium text-right" style={{ color: 'var(--text-muted)' }}>{t('Ganado', 'Earned')}</span>
      </div>

      <div>
        {data.rows.map((r) => (
          <div key={r.year}>
            <button type="button" onClick={() => setOpenYear(openYear === r.year ? null : r.year)}
              aria-expanded={openYear === r.year}
              className="w-full grid grid-cols-[1fr_1.2fr_1.4fr] gap-2 items-baseline py-1.5 cursor-pointer text-left rounded-md px-1 -mx-1 transition-colors hover:bg-theme-tertiary/50">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {r.year}
                {r.partial && (
                  <span className="ml-1.5 text-[9px] font-semibold px-1 py-0.5 rounded align-middle"
                    style={{ color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}>
                    YTD
                  </span>
                )}
              </span>
              <span className="text-sm font-mono tabular-nums text-right" style={{ color: 'var(--text-primary)' }}>
                {fmt(r.invested)}
              </span>
              <span className="text-sm font-mono tabular-nums text-right">
                {r.gainAbs != null ? (
                  <span style={{ color: gainColor(r.gainAbs) }}>
                    {signFmt(r.gainAbs)}
                    {r.gainPct != null && (
                      <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        ({r.gainPct >= 0 ? '+' : ''}{r.gainPct.toFixed(2)}%)
                      </span>
                    )}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>-</span>
                )}
              </span>
            </button>
            {openYear === r.year && (
              <div className="rounded-lg px-3 py-2 mb-1.5 space-y-1" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('Depósitos', 'Deposits')}</span>
                  <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>+{fmt(r.deposits)}</span>
                </div>
                {r.withdrawals > 0 && (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('Retiros', 'Withdrawals')}</span>
                    <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>-{fmt(r.withdrawals)}</span>
                  </div>
                )}
                {r.fees > 0 && (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('Comisiones de entrada', 'Entry fees')}</span>
                    <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>-{fmt(r.fees)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-2 pt-1" style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{t('Invertido neto', 'Net invested')}</span>
                  <span className="text-xs font-mono tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(r.invested)}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Totales */}
      <div className="grid grid-cols-[1fr_1.2fr_1.4fr] gap-2 items-baseline pt-2 mt-1" style={{ borderTop: '1px solid var(--glass-border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Total</span>
        <span className="text-sm font-mono tabular-nums font-semibold text-right" style={{ color: 'var(--text-primary)' }}>{fmt(data.totalInvested)}</span>
        <span className="text-sm font-mono tabular-nums font-semibold text-right">
          {data.totalGain != null
            ? <span style={{ color: gainColor(data.totalGain) }}>{signFmt(data.totalGain)}</span>
            : <span style={{ color: 'var(--text-muted)' }}>-</span>}
        </span>
      </div>

      {/* El ejercicio patrimonio contra invertido */}
      {netWorth > 0 && (
        <div className="flex items-baseline justify-between gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('Patrimonio hoy', 'Net worth today')}
            {ratio != null && (
              <span className="ml-1.5" style={{ color: 'var(--text-muted)' }}>
                · {ratio.toFixed(2)}x {t('lo invertido', 'invested')}
              </span>
            )}
          </span>
          <span className="text-xs font-mono tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(netWorth)}</span>
        </div>
      )}

      <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {t(
          '"-" en Ganado: el archivo no tiene datos de valor suficientes de ese año para medirlo. Las ganancias nunca incluyen tus aportes.',
          '"-" under Earned: the archive lacks enough value data from that year to measure it. Earnings never include your contributions.'
        )}
      </p>
    </div>
  )
}
