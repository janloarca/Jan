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
//
// DOS COSAS QUE NO SON DECORACIÓN, y que hay que conservar al editar esta card:
//
// 1. El encabezado DICE que el % es un rendimiento. Ese porcentaje mide contra
//    el valor de arranque del año, no contra la columna "invertido" que tiene
//    justo a la izquierda, y sin decirlo el lector no tiene forma de saberlo:
//    una fila con $760.46 invertidos y +$2,905.76 ganados imprime "+35.31%"
//    mientras la cuenta obvia da 382%. El detalle expandido muestra el valor
//    de inicio y de cierre, que es contra lo que ese % de verdad se midió.
// 2. El pie NUNCA es un guión suelto. "Total" suma los años que SÍ se pudieron
//    medir (diciendo cuántos son) y lo que falta se nombra como "sin repartir
//    por año", de modo que invertido + ganado + sin repartir = patrimonio de
//    hoy, exacto por construcción. Antes el total imprimía "-" y tiraba a la
//    basura tanto la suma de los años medidos como el residuo, que es un
//    número real y calculable.
export default function InvestedByYearCard({ transactions, items, snapshots, netWorth, totalAssets = null, returnYTD, ytdChange, ytdStartValue, convert, baseCurrency = 'USD', lang = 'es' }) {
  // FASE LV: la identidad del pie cierra contra los ACTIVOS (el universo del
  // rendimiento, FASE LU); sin el prop, netWorth: en un portafolio sin deuda
  // son el mismo número y nada cambia.
  const assetsToday = totalAssets != null && isFinite(totalAssets) && totalAssets > 0 ? totalAssets : netWorth
  const t = (es, en) => (lang === 'es' ? es : en)
  const [openYear, setOpenYear] = useState(null)

  const data = useMemo(() => {
    const series = buildReportSeries(snapshots, { convert, baseCurrency })
    return computeInvestedByYear({ transactions, items, series, convert, baseCurrency, returnYTD, ytdChange, ytdStartValue, netWorth, totalAssets })
  }, [transactions, items, snapshots, convert, baseCurrency, returnYTD, ytdChange, ytdStartValue, netWorth, totalAssets])

  if (!data.hasData) return null

  const fmt = (n) => formatCurrency(n, baseCurrency)
  const signFmt = (n) => `${n >= 0 ? '+' : ''}${fmt(n)}`
  const gainColor = (n) => (n >= 0 ? 'var(--accent-green)' : 'var(--text-negative)')
  const ratio = data.totalInvested > 0 && assetsToday > 0 ? assetsToday / data.totalInvested : null

  // Mismo marco y mismo encabezado que AssetAllocation / InstitutionPerformance
  // (p-4, punto + título en mayúsculas + InfoTip): las cuatro cards de esta
  // zona comparten inset y tipografía, así que sus contenidos alinean sobre el
  // mismo borde izquierdo en vez de tres estilos distintos en un mismo bloque.
  // h-full + mt-auto en el bloque de cierre: la card estira hasta el alto de la
  // columna vecina y el bloque de patrimonio queda pegado abajo, de modo que
  // las dos columnas terminan en la misma línea.
  return (
    <div className="card p-4 sm:p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {t('INVERTIDO POR AÑO', 'INVESTED BY YEAR')}
        </h3>
        <InfoTip text={t(
          'Invertido = depósitos menos retiros de ese año en todas tus cuentas, descontando comisiones de entrada. Sin ganancias ni intereses, y el dinero movido entre tus propias cuentas no cuenta. Ganado = lo que rindieron las inversiones ese año, neto de tus aportes (método Dietz, el mismo del YTD). El % es el RENDIMIENTO del año: se mide contra el valor con el que arrancaste ese año, no contra lo que invertiste en él. Un "-" en Ganado significa que el archivo no tiene datos de valor suficientes de ese año para medirlo; un año con "-" en las dos columnas es un año del que el archivo no tiene nada, y aparece igual para que la lista no salte años. La fila "Sin repartir por año" es lo que falta para llegar a tus activos de hoy: casi todo es la ganancia de esos años. Toca un año para ver su valor de arranque y el detalle.',
          'Invested = that year\'s deposits minus withdrawals across all your accounts, entry fees discounted. No gains or interest, and money moved between your own accounts does not count. Earned = what your investments returned that year, net of your contributions (Dietz method, same as the YTD). The % is the year\'s RETURN: measured against the value you started that year with, not against what you invested during it. A "-" under Earned means the archive lacks enough value data from that year to measure it; a year with "-" in both columns is one the archive has nothing for, listed anyway so the years never skip. The "Not attributed to a year" row is what is left to reach today\'s assets: almost all of it is the gain of those years. Tap a year to see its starting value and the detail.'
        )} />
      </div>

      {/* Encabezado de columnas. El % de Ganado vive en una sub-columna de
          ancho FIJO (pctCol): sin ella, el paréntesis de cada fila termina a
          una distancia distinta según el ancho del monto y la columna se lee
          desordenada aunque esté alineada a la derecha. */}
      <div className="grid grid-cols-[5rem_1fr_1fr] gap-2 pb-1.5 items-end" style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>{t('Año', 'Year')}</span>
        <span className="text-[10px] uppercase tracking-wider font-medium text-right" style={{ color: 'var(--text-muted)' }}>{t('Invertido', 'Invested')}</span>
        {/* El % vive dentro de esta columna, así que es ACÁ donde hay que decir
            qué es. Sin esta segunda línea el único denominador a la vista es la
            columna de al lado, y no es contra esa que se midió. */}
        <span className="text-right leading-tight" style={{ color: 'var(--text-muted)' }}>
          <span className="block text-[10px] uppercase tracking-wider font-medium">{t('Ganado', 'Earned')}</span>
          <span className="block text-[9px]">{t('% = rendimiento', '% = return')}</span>
        </span>
      </div>

      <div className="divide-y divide-glass-border/50">
        {data.rows.map((r) => (
          <div key={r.year}>
            <button type="button" onClick={() => !r.empty && setOpenYear(openYear === r.year ? null : r.year)}
              aria-expanded={r.empty ? undefined : openYear === r.year}
              disabled={r.empty}
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
              {/* Un año del que el archivo no tiene NADA no puede imprimir
                  "$0.00": eso afirma que no invertiste, y lo que la app sabe es
                  que no tiene datos. Se dice con un guión, igual que la columna
                  de al lado. */}
              <span className="text-sm font-mono tabular-nums text-right" style={{ color: r.empty ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                {r.empty ? '-' : fmt(r.invested)}
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
                {/* Contra QUÉ se midió el % de la fila. Va PRIMERO porque es el
                    dato que la fila colapsada no puede mostrar y sin el cual el
                    porcentaje no se puede reconciliar con nada. */}
                {r.startValue != null && (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('Valor al inicio del año', 'Value at the start of the year')}</span>
                    <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(r.startValue)}</span>
                  </div>
                )}
                {r.endValue != null && (
                  <div className="flex items-baseline justify-between gap-2 pb-1" style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {r.partial ? t('Valor hoy', 'Value today') : t('Valor al cierre', 'Value at year end')}
                    </span>
                    <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmt(r.endValue)}</span>
                  </div>
                )}
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
                {/* La frase que cierra la pregunta: el % es un rendimiento y se
                    midió contra el arranque de arriba, no contra el invertido
                    neto de esta misma caja. */}
                {r.gainPct != null && r.startValue != null && (
                  <p className="text-[10px] pt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {t(
                      `Rendimiento ${r.gainPct >= 0 ? '+' : ''}${r.gainPct.toFixed(2)}%: medido sobre los ${fmt(r.startValue)} del inicio más tus aportes ponderados por el tiempo que estuvieron invertidos, no sobre el invertido de este año.`,
                      `Return ${r.gainPct >= 0 ? '+' : ''}${r.gainPct.toFixed(2)}%: measured against the ${fmt(r.startValue)} you started with plus your contributions weighted by how long they were invested, not against this year's invested amount.`
                    )}
                  </p>
                )}
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
        {/* Ya no un guión. La suma de los años que SÍ se midieron es
            información real; lo que se dice al lado es cuántos son, para que
            nadie la lea como la ganancia de toda la vida. */}
        <span className="text-sm font-mono tabular-nums font-semibold text-right whitespace-nowrap">
          {data.measuredGain != null
            ? <span style={{ color: gainColor(data.measuredGain) }}>{signFmt(data.measuredGain)}</span>
            : <span style={{ color: 'var(--text-muted)' }}>-</span>}
          <span className="inline-block w-[4.4rem] text-right text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {data.unmeasuredYears > 0 ? `${data.measuredYears}/${data.rows.length} ${t('años', 'yrs')}` : ''}
          </span>
        </span>
      </div>

      {/* Lo que la tabla no pudo repartir por año, NOMBRADO. Es exactamente
          patrimonio − invertido − lo medido, así que las tres líneas suman el
          patrimonio de abajo por construcción. Casi siempre es la ganancia de
          los años que imprimen "-"; por eso el rótulo no dice "ganancia". */}
      {data.unallocated != null && (
        <div className="grid grid-cols-[5rem_1fr_1fr] gap-2 items-baseline pt-1.5">
          <span className="col-span-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('Sin repartir por año', 'Not attributed to a year')}
          </span>
          <span className="text-sm font-mono tabular-nums text-right whitespace-nowrap">
            <span style={{ color: 'var(--text-muted)' }}>{signFmt(data.unallocated)}</span>
            <span className="inline-block w-[4.4rem]" aria-hidden="true" />
          </span>
        </div>
      )}

      {/* El ejercicio patrimonio contra invertido. mt-auto lo ancla al fondo
          cuando la card estira para igualar el alto de la columna vecina. */}
      {assetsToday > 0 && (
        <div className="flex items-baseline justify-between gap-2 mt-auto pt-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('Tus activos hoy', 'Your assets today')}
            {ratio != null && (
              <span className="ml-1.5" style={{ color: 'var(--text-muted)' }}>
                · {ratio.toFixed(2)}x {t('lo invertido', 'invested')}
              </span>
            )}
          </span>
          <span className="text-xs font-mono tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{fmt(assetsToday)}</span>
        </div>
      )}

      {/* La explicacion completa del "-" y del "sin repartir" vive en el
          InfoTip del encabezado: eran ~4 lineas de gris siempre visibles al pie
          de la card, o sea ruido permanente para explicar un caso que no
          siempre esta en pantalla. Aca queda UNA linea, porque quien se topa
          con el guion lo ve en la tabla y no va a adivinar que el (i) de
          arriba lo explica. */}
      <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {t('"-" = sin datos suficientes de ese año para medirlo. Detalle en el (i).',
           '"-" = not enough data from that year to measure it. Details under the (i).')}
      </p>
    </div>
  )
}
