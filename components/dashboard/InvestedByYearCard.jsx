'use client'

import { useMemo, useState } from 'react'
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

  // Mismo marco y mismo encabezado que AssetAllocation / InstitutionPerformance
  // (p-4, punto + título en mayúsculas + InfoTip): las cuatro cards de esta
  // zona comparten inset y tipografía, así que sus contenidos alinean sobre el
  // mismo borde izquierdo en vez de tres estilos distintos en un mismo bloque.
  // h-full + mt-auto en el bloque de cierre: la card estira hasta el alto de la
  // columna vecina y el bloque de patrimonio queda pegado abajo, de modo que
  // las dos columnas terminan en la misma línea.
  return (
    <div data-card-id="INV-01" className="card p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {t('INVERTIDO POR AÑO', 'INVESTED BY YEAR')}
        </h3>
        <InfoTip text={t(
          'Invertido = depósitos menos retiros de ese año en todas tus cuentas, descontando comisiones de entrada. Sin ganancias ni intereses, y el dinero movido entre tus propias cuentas no cuenta. Ganado = lo que rindieron las inversiones ese año, neto de tus aportes (método Dietz, el mismo del YTD). Toca un año para ver su detalle.',
          'Invested = that year\'s deposits minus withdrawals across all your accounts, entry fees discounted. No gains or interest, and money moved between your own accounts does not count. Earned = what your investments returned that year, net of your contributions (Dietz method, same as the YTD). Tap a year for its detail.'
        )} />
      </div>

      {/* Encabezado de columnas. El % de Ganado vive en una sub-columna de
          ancho FIJO (pctCol): sin ella, el paréntesis de cada fila termina a
          una distancia distinta según el ancho del monto y la columna se lee
          desordenada aunque esté alineada a la derecha. */}
      <div className="grid grid-cols-[5rem_1fr_1fr] gap-2 pb-1.5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>{t('Año', 'Year')}</span>
        <span className="text-[10px] uppercase tracking-wider font-medium text-right" style={{ color: 'var(--text-muted)' }}>{t('Invertido', 'Invested')}</span>
        <span className="text-[10px] uppercase tracking-wider font-medium text-right" style={{ color: 'var(--text-muted)' }}>{t('Ganado', 'Earned')}</span>
      </div>

      <div className="divide-y divide-glass-border/50">
        {data.rows.map((r) => (
          <div key={r.year}>
            <button type="button" onClick={() => setOpenYear(openYear === r.year ? null : r.year)}
              aria-expanded={openYear === r.year}
              className="w-full grid grid-cols-[5rem_1fr_1fr] gap-2 items-baseline py-2 cursor-pointer text-left transition-colors hover:bg-theme-tertiary/50">
              <span className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
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
              <span className="text-sm font-mono tabular-nums text-right whitespace-nowrap">
                {r.gainAbs != null ? (
                  <span style={{ color: gainColor(r.gainAbs) }}>{signFmt(r.gainAbs)}</span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>-</span>
                )}
                <span className="inline-block w-[4.4rem] text-right text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {r.gainPct != null ? `(${r.gainPct >= 0 ? '+' : ''}${r.gainPct.toFixed(2)}%)` : ''}
                </span>
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

      {/* Totales: misma plantilla de columnas que las filas, incluida la
          sub-columna fija del %, para que el monto total alinee exacto con
          los montos de arriba. */}
      <div className="grid grid-cols-[5rem_1fr_1fr] gap-2 items-baseline pt-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Total</span>
        <span className="text-sm font-mono tabular-nums font-semibold text-right" style={{ color: 'var(--text-primary)' }}>{fmt(data.totalInvested)}</span>
        <span className="text-sm font-mono tabular-nums font-semibold text-right whitespace-nowrap">
          {data.totalGain != null
            ? <span style={{ color: gainColor(data.totalGain) }}>{signFmt(data.totalGain)}</span>
            : <span style={{ color: 'var(--text-muted)' }}>-</span>}
          <span className="inline-block w-[4.4rem]" aria-hidden="true" />
        </span>
      </div>

      {/* El ejercicio patrimonio contra invertido. mt-auto lo ancla al fondo
          cuando la card estira para igualar el alto de la columna vecina. */}
      {netWorth > 0 && (
        <div className="flex items-baseline justify-between gap-2 mt-auto pt-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
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
