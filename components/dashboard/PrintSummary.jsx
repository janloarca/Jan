'use client'

import { useMemo, useState } from 'react'
import { formatCurrency, categoryLabel } from './utils'
import { buildReportData, regionLabel } from '@/lib/reportData'
import { attributionRefusalText } from '@/lib/ytdAttribution'

// Este modal es SIEMPRE un documento blanco (un reporte impreso no tiene modo
// oscuro), pero el CSS global del tema reinterpreta clases: en tema claro
// `.text-white` se fuerza a texto OSCURO (globals.css), lo que dejó el chip
// seleccionado y "Descargar PDF" como pastillas negras sin texto visible.
// Por eso los controles usan estilos inline con hex (la regla de colores
// dinámicos que CLAUDE.md ya documenta), inmunes a cualquier tema.
const BTN_DARK = { backgroundColor: '#111827', color: '#ffffff', borderColor: '#111827' }
const BTN_LIGHT = { backgroundColor: '#ffffff', color: '#4b5563', borderColor: '#d1d5db' }
const BTN_BLUE = { backgroundColor: '#2563eb', color: '#ffffff' }

// FASE HT. El hub único del reporte: vista previa en pantalla (estilo estado
// de cuenta, FASE FK: tinta negra/gris, sin colores, negativos en paréntesis
// contables), selector de período, Imprimir y Descargar PDF desde el mismo
// lugar. TODOS los números salen de lib/reportData.js, la misma fuente que el
// PDF: los dos renderers no pueden volver a divergir (antes este archivo
// calculaba su propio "Rendimiento" con (último - primero) / primero sobre
// snapshots crudos, sin netear depósitos: el "+1148.8%" documentado ahí).

export default function PrintSummary({
  items, transactions, snapshots,
  netWorth, totalAssets,
  returnYTD, ytdChange, returnSinceStart, sinceStartDate,
  ytdBreakdown, ytdBreakdownReason, annualDividends, estimatedAnnualIncome,
  benchmarkName, benchmarkReturn, volatilityPct, sharpe, beta,
  baseCurrency = 'USD', convert,
  profileName = '',
  lang, onClose,
}) {
  const t = (es, en) => lang === 'es' ? es : en
  const locale = lang === 'es' ? 'es-GT' : 'en-US'
  const [period, setPeriod] = useState('ytd')
  const [downloading, setDownloading] = useState(false)

  const data = useMemo(() => buildReportData({
    items, transactions, snapshots,
    netWorth, totalAssets,
    returnYTD, ytdChange, returnSinceStart, sinceStartDate,
    ytdBreakdown, ytdBreakdownReason, annualDividends, estimatedAnnualIncome,
    benchmarkName, benchmarkYtdPct: benchmarkReturn, volatilityPct, sharpe, beta,
    baseCurrency, convert, profileName, period,
  }), [items, transactions, snapshots, netWorth, totalAssets, returnYTD, ytdChange,
    returnSinceStart, sinceStartDate, ytdBreakdown, ytdBreakdownReason, annualDividends,
    estimatedAnnualIncome, benchmarkName, benchmarkReturn, volatilityPct, sharpe, beta,
    baseCurrency, convert, profileName, period])

  const fmtRaw = (v) => formatCurrency(Math.abs(v || 0))
  const fmtAcc = (v) => (v < 0 ? `(${fmtRaw(v)})` : fmtRaw(v))
  const fmtPct = (v) => v == null ? '-' : (v < 0 ? `(${Math.abs(v).toFixed(2)}%)` : `+${v.toFixed(2)}%`)
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : ''

  const now = new Date(data.meta.generatedTs)
  const dateStr = now.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
  const periodLabel = useMemo(() => {
    if (period === 'week') {
      const from = new Date(now.getTime() - 7 * 86400000)
      return `${from.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}`
    }
    if (period === 'month') return now.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
    if (period === 'quarter') return `${t('Trimestre', 'Quarter')} ${Math.floor(now.getMonth() / 3) + 1}, ${now.getFullYear()}`
    if (period === 'ytd') return t(`Año ${now.getFullYear()} al ${dateStr}`, `Year ${now.getFullYear()} through ${dateStr}`)
    return t('Desde el inicio', 'Since inception')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, lang, data.meta.generatedTs])

  const periods = [
    { key: 'week', label: t('Semana', 'Week') },
    { key: 'month', label: t('Este mes', 'This month') },
    { key: 'quarter', label: t('Trimestre', 'Quarter') },
    { key: 'ytd', label: t('Año (YTD)', 'Year (YTD)') },
    { key: 'all', label: t('Desde inicio', 'All time') },
  ]

  const handlePrint = () => window.print()

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const { generateReport } = await import('@/lib/generateReport')
      await generateReport({
        items, snapshots, transactions,
        netWorth, totalAssets, lang,
        returnYTD, ytdChange, returnSinceStart, sinceStartDate, ytdBreakdown,
        annualDividends, estimatedAnnualIncome,
        profileName, baseCurrency, convert, period,
      })
    } catch (err) {
      console.error('[report] PDF generation failed:', err)
    } finally {
      setDownloading(false)
    }
  }

  const per = data.kpis.periodReturn
  const vc = data.kpis.valueChange
  const sectionCls = 'text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider'
  const thCls = 'text-gray-500 text-xs font-normal py-1.5'
  let sectionNo = 0
  const sec = (es, en) => `${++sectionNo}. ${t(es, en)}`

  // Serie para la mini gráfica (solo puntos finitos, regla SVG de siempre).
  const chart = useMemo(() => {
    const pts = (data.series || []).filter((p) => isFinite(p.value))
    if (pts.length < 2) return null
    const values = pts.map((p) => p.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const W = 640, H = 90
    const path = pts.map((p, i) => {
      const x = (i / (pts.length - 1)) * W
      const y = H - ((p.value - min) / range) * H
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    return { path, min, max, first: pts[0], last: pts[pts.length - 1], W, H }
  }, [data.series])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white text-black rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Controles (ocultos al imprimir) */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 border-b print:hidden">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">{t('Reporte', 'Report')}</h2>
            <div className="flex gap-1">
              {periods.map((p) => (
                <button key={p.key} onClick={() => setPeriod(p.key)}
                  className="px-2.5 py-1 text-xs rounded-lg border transition-colors"
                  style={period === p.key ? BTN_DARK : BTN_LIGHT}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={handleDownload} disabled={downloading}
              className="px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50" style={BTN_BLUE}>
              {downloading ? t('Generando...', 'Generating...') : `⬇ ${t('Descargar PDF', 'Download PDF')}`}
            </button>
            <button onClick={handlePrint}
              className="px-4 py-2 text-sm font-medium rounded-lg border" style={BTN_LIGHT}>
              🖨 {t('Imprimir', 'Print')}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-black text-xl" aria-label="Close">&times;</button>
          </div>
        </div>

        <div className="p-8 print:p-4">
          {/* Encabezado del documento */}
          <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-200">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t('Reporte de Portafolio', 'Portfolio Report')}</h1>
              {profileName && <p className="text-sm text-gray-700 mt-0.5">{profileName}</p>}
              <p className="text-sm text-gray-500">{t('Período', 'Period')}: {periodLabel}</p>
              <p className="text-xs text-gray-400">{t('Generado el', 'Generated on')} {dateStr} · {t('Valores en', 'Values in')} {baseCurrency}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-400 block">Chispudo</span>
              <span className="text-xs text-gray-400">chispu.xyz</span>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{t('Patrimonio Neto', 'Net Worth')}</div>
              <div className="text-xl font-bold">{fmtAcc(data.kpis.netWorth)}</div>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{t('Activos', 'Assets')}</div>
              <div className="text-xl font-bold text-gray-900">{fmtAcc(data.kpis.totalAssets)}</div>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{t('Deuda', 'Debt')}</div>
              <div className="text-xl font-bold text-gray-900">{data.kpis.debtTotal > 0 ? `(${fmtRaw(data.kpis.debtTotal)})` : fmtRaw(0)}</div>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500">{t('Retorno del período', 'Period Return')} ¹</div>
              <div className="text-xl font-bold text-gray-900">{fmtPct(per ? per.pct : null)}</div>
            </div>
          </div>

          {/* 1. Resumen del período */}
          <div className="mb-6">
            <h2 className={sectionCls}>{sec('Resumen del período', 'Period Summary')}</h2>
            <table className="w-full text-sm">
              <tbody>
                {vc && (
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5 text-gray-500">{t('Valor al inicio', 'Opening value')}</td>
                    <td className="py-1.5 text-right">{fmtAcc(vc.first)}</td>
                    <td className="py-1.5 text-right text-gray-400 text-xs w-28">{fmtDate(vc.firstTs)}</td>
                  </tr>
                )}
                <tr className="border-b border-gray-100">
                  <td className="py-1.5 text-gray-500">{t('Depósitos', 'Deposits')} ({data.flows.depositCount})</td>
                  <td className="py-1.5 text-right">{fmtAcc(data.flows.deposits)}</td>
                  <td />
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-1.5 text-gray-500">{t('Retiros', 'Withdrawals')} ({data.flows.withdrawalCount})</td>
                  <td className="py-1.5 text-right">{data.flows.withdrawals > 0 ? `(${fmtRaw(data.flows.withdrawals)})` : fmtRaw(0)}</td>
                  <td />
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-1.5 text-gray-500">{t('Ingresos cobrados', 'Income collected')} ({data.flows.incomeCount})</td>
                  <td className="py-1.5 text-right">{fmtAcc(data.flows.incomeCollected)}</td>
                  <td />
                </tr>
                {per && per.abs != null && (
                  <tr className="border-b border-gray-100">
                    <td className="py-1.5 text-gray-500">{t('Ganancia del período', 'Period gain')} ¹</td>
                    <td className="py-1.5 text-right font-medium">{fmtAcc(per.abs)}</td>
                    <td className="py-1.5 text-right text-gray-400 text-xs">{fmtPct(per.pct)}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-1.5 font-bold">{t('Valor al cierre', 'Closing value')}</td>
                  <td className="py-1.5 text-right font-bold">{fmtAcc(data.kpis.netWorth)}</td>
                  <td className="py-1.5 text-right text-gray-400 text-xs">{fmtDate(data.meta.generatedTs)}</td>
                </tr>
              </tbody>
            </table>
            {!per && (
              <p className="text-xs text-gray-400 mt-1">
                {t('Sin dato de arranque confiable para este período: el retorno no se calcula (nunca se inventa).',
                  'No reliable opening data for this period: the return is not computed (never invented).')}
              </p>
            )}
            {per && per.fromTs && data.meta.periodStartTs && per.fromTs > data.meta.periodStartTs + 86400000 && (
              <p className="text-xs text-gray-400 mt-1">
                {t(`Retorno medido desde ${fmtDate(per.fromTs)} (primer dato disponible del período).`,
                  `Return measured from ${fmtDate(per.fromTs)} (first available data point in the period).`)}
              </p>
            )}
          </div>

          {/* 2. Rendimiento por horizonte + referencia + riesgo + costos: la
              tabla estándar de un reporte profesional (retornos rodantes lado
              a lado), con "-" honesto donde no hay ancla. */}
          <div className="mb-6">
            <h2 className={sectionCls}>{sec('Rendimiento', 'Performance')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={`${thCls} text-left`}>{t('Período', 'Period')}</th>
                  <th className={`${thCls} text-right`}>{t('Retorno', 'Return')} ¹</th>
                  <th className={`${thCls} text-right`}>{t('Ganancia', 'Gain')}</th>
                  <th className={`${thCls} text-right`}>{t('Medido desde', 'Measured from')}</th>
                </tr>
              </thead>
              <tbody>
                {data.performance.map((p) => {
                  const labels = {
                    '1m': t('1 mes', '1 month'), '3m': t('3 meses', '3 months'),
                    ytd: t(`Año ${now.getFullYear()} (YTD)`, `Year ${now.getFullYear()} (YTD)`),
                    '1y': t('12 meses', '12 months'), all: t('Desde el inicio', 'Since inception'),
                    '3y': t('3 años (anualizado)', '3 years (annualized)'),
                    '5y': t('5 años (anualizado)', '5 years (annualized)'),
                  }
                  return (
                    <tr key={p.key} className="border-b border-gray-100">
                      <td className="py-1.5 font-medium">{labels[p.key]}</td>
                      <td className="py-1.5 text-right">{fmtPct(p.pct)}</td>
                      <td className="py-1.5 text-right text-gray-600">{p.abs != null ? fmtAcc(p.abs) : '-'}</td>
                      <td className="py-1.5 text-right text-gray-400 text-xs">{p.pct != null && p.fromTs ? fmtDate(p.fromTs) : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {data.calendarYears.length > 0 && (
              <p className="text-xs text-gray-600 mt-2">
                {t('Años calendario', 'Calendar years')}:{' '}
                {data.calendarYears.map((cy, i) => (
                  <span key={cy.year}>
                    {i > 0 && ' · '}
                    {cy.year}{cy.partial ? ` (${t('parcial', 'partial')})` : ''} {fmtPct(cy.pct)}
                  </span>
                ))}
              </p>
            )}
            <div className="text-xs text-gray-500 mt-2 space-y-0.5">
              {data.benchmark && (
                <p>{t('Referencia', 'Benchmark')}: {data.benchmark.name} YTD {fmtPct(data.benchmark.ytdPct)}</p>
              )}
              {(data.risk.maxDrawdown || data.risk.volatilityPct != null || data.risk.sharpe != null || data.risk.beta != null) && (
                <p>
                  {t('Riesgo', 'Risk')}:{' '}
                  {[
                    data.risk.volatilityPct != null ? `${t('volatilidad anualizada', 'annualized volatility')} ${data.risk.volatilityPct.toFixed(1)}%` : null,
                    data.risk.sharpe != null ? `Sharpe ${data.risk.sharpe.toFixed(2)}` : null,
                    data.risk.beta != null ? `${t('beta vs', 'beta vs')} ${data.benchmark?.name || 'benchmark'} ${data.risk.beta.toFixed(2)}` : null,
                    data.risk.maxDrawdown ? `${t('máxima caída del período', 'period max drawdown')} ${data.risk.maxDrawdown.pct.toFixed(1)}% (${fmtDate(data.risk.maxDrawdown.fromTs)} ${t('a', 'to')} ${fmtDate(data.risk.maxDrawdown.toTs)})` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              {data.fees.totalEntryFees > 0 && (
                <p>{t('Comisiones de entrada pagadas', 'Entry fees paid')}: {fmtAcc(data.fees.periodEntryFees)} {t('en el período', 'in period')} · {fmtAcc(data.fees.totalEntryFees)} {t('desde el inicio', 'since inception')}</p>
              )}
            </div>
          </div>

          {/* 2. Evolución */}
          {chart && (
            <div className="mb-6">
              <h2 className={sectionCls}>{sec('Evolución del portafolio', 'Portfolio Growth')}</h2>
              <div className="border border-gray-200 rounded-lg p-3">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{fmtAcc(chart.max)}</span>
                </div>
                <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full h-24" preserveAspectRatio="none">
                  <path d={chart.path} fill="none" stroke="#374151" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>{fmtDate(chart.first.ts)} · {fmtAcc(chart.min)} min</span>
                  <span>{fmtDate(chart.last.ts)}</span>
                </div>
              </div>
            </div>
          )}

          {/* 3. Asignación */}
          <div className="mb-6">
            <h2 className={sectionCls}>{sec('Asignación de activos', 'Asset Allocation')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={`${thCls} text-left`}>{t('Categoría', 'Category')}</th>
                  <th className={`${thCls} text-right`}>#</th>
                  <th className={`${thCls} text-right`}>{t('Valor', 'Value')}</th>
                  <th className={`${thCls} text-right`}>%</th>
                  <th className="py-1.5 w-32" />
                </tr>
              </thead>
              <tbody>
                {data.allocation.map((r) => (
                  <tr key={r.cat} className="border-b border-gray-100">
                    <td className="py-2 font-medium">{categoryLabel(r.cat, lang)}</td>
                    <td className="py-2 text-right text-gray-500">{r.count}</td>
                    <td className="py-2 text-right">{fmtAcc(r.value)}</td>
                    <td className="py-2 text-right text-gray-500">{r.pct.toFixed(1)}%</td>
                    <td className="py-2">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gray-700" style={{ width: `${r.pct}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 4. Posiciones */}
          <div className="mb-6">
            <h2 className={sectionCls}>{sec('Principales posiciones', 'Top Holdings')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className={`${thCls} text-left`}>{t('Instrumento', 'Instrument')}</th>
                  <th className={`${thCls} text-left`}>{t('Tipo', 'Type')}</th>
                  <th className={`${thCls} text-right`}>{t('Cantidad', 'Qty')}</th>
                  <th className={`${thCls} text-right`}>{t('Valor', 'Value')}</th>
                  <th className={`${thCls} text-right`}>%</th>
                  <th className={`${thCls} text-right`}>{t('Retorno', 'Return')} ²</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr key={h.id} className="border-b border-gray-100">
                    <td className="py-1.5">
                      <span className="font-medium">{h.name || h.symbol}</span>
                      {h.symbol && h.name && h.symbol !== h.name && <span className="text-gray-400 text-xs ml-1">({h.symbol})</span>}
                    </td>
                    <td className="py-1.5 text-gray-500 text-xs">{h.type}{h.subtype ? `/${h.subtype}` : ''}</td>
                    <td className="py-1.5 text-right text-gray-600">{h.qty.toLocaleString(locale, { maximumFractionDigits: 4 })}</td>
                    <td className="py-1.5 text-right font-medium">{fmtAcc(h.value)}</td>
                    <td className="py-1.5 text-right text-gray-500">{h.weightPct.toFixed(1)}%</td>
                    <td className="py-1.5 text-right">{fmtPct(h.retPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 5. Rendimiento por cuenta. Las columnas YTD solo existen cuando el
              motor de atribución tiene datos: una pared de "-" no informa nada. */}
          {data.institutions.length > 0 && (() => {
            const hasAttribution = data.institutions.some((r) => r.ytdGain != null)
            return (
              <div className="mb-6">
                <h2 className={sectionCls}>{sec('Rendimiento por cuenta', 'Performance by Account')}</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className={`${thCls} text-left`}>{t('Institución', 'Institution')}</th>
                      <th className={`${thCls} text-right`}>{t('Valor', 'Value')}</th>
                      <th className={`${thCls} text-right`}>{t('% Patrim.', '% NW')}</th>
                      {hasAttribution && <th className={`${thCls} text-right`}>{t('Ganancia YTD', 'YTD Gain')} ³</th>}
                      {hasAttribution && <th className={`${thCls} text-right`}>{t('Retorno YTD', 'YTD Return')} ³</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.institutions.map((r) => (
                      <tr key={r.key} className="border-b border-gray-100">
                        <td className="py-1.5 font-medium">{r.name}</td>
                        <td className="py-1.5 text-right">{fmtAcc(r.value)}</td>
                        <td className="py-1.5 text-right text-gray-500">{r.weightPct.toFixed(1)}%</td>
                        {hasAttribution && <td className="py-1.5 text-right">{r.ytdGain != null ? fmtAcc(r.ytdGain) : '-'}</td>}
                        {hasAttribution && <td className="py-1.5 text-right">{fmtPct(r.ytdRetPct)}</td>}
                      </tr>
                    ))}
                    {hasAttribution && data.ytdUnexplained && (
                      <tr>
                        <td className="py-1.5 text-gray-400 text-xs" colSpan={3}>{t('Sin atribuir (residuo del reparto)', 'Unattributed (allocation residual)')}</td>
                        <td className="py-1.5 text-right text-gray-400 text-xs">{fmtAcc(data.ytdUnexplained.gain)}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
                {!hasAttribution && (
                  <p className="text-xs text-gray-400 mt-1">
                    {data.meta.breakdownReason
                      ? t(`El desglose de ganancia por cuenta no está disponible: ${attributionRefusalText(data.meta.breakdownReason, 'es')}.`,
                          `The per-account gain breakdown is unavailable: ${attributionRefusalText(data.meta.breakdownReason, 'en')}.`)
                      : t('El desglose de ganancia por cuenta no está disponible en este momento (el motor de atribución no pudo repartir el YTD con confianza).',
                          'The per-account gain breakdown is unavailable right now (the attribution engine could not split the YTD confidently).')}
                  </p>
                )}
              </div>
            )
          })()}

          {/* 6. Ingresos */}
          <div className="mb-6">
            <h2 className={sectionCls}>{sec('Ingresos', 'Income')}</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="border rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">{t('Cobrados en el período', 'Collected in period')}</div>
                <div className="text-lg font-bold text-gray-900">{fmtAcc(data.flows.incomeCollected)}</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">{t('Últimos 12 meses', 'Trailing 12 months')}</div>
                <div className="text-lg font-bold">{fmtAcc(data.income.ttmDividends)}</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">{t('Proyección anual', 'Projected annual')}</div>
                <div className="text-lg font-bold">{fmtAcc(data.income.projectedAnnual)}</div>
                {data.income.yieldPct != null && (
                  <div className="text-xs text-gray-400 mt-0.5">{t('Yield', 'Yield')} {data.income.yieldPct.toFixed(2)}%</div>
                )}
              </div>
            </div>
          </div>

          {/* 7. Exposición */}
          {(data.currencies.length > 0 || data.geography.length > 0 || data.sectors.length > 0) && (
            <div className="mb-6">
              <h2 className={sectionCls}>{sec('Exposición por moneda, geografía y sector', 'Currency, Geography & Sector Exposure')}</h2>
              <div className="grid grid-cols-2 gap-6 items-start">
                <table className="w-full text-sm self-start">
                  <thead>
                    <tr className="border-b">
                      <th className={`${thCls} text-left`}>{t('Moneda', 'Currency')}</th>
                      <th className={`${thCls} text-right`}>{t('Valor', 'Value')}</th>
                      <th className={`${thCls} text-right`}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.currencies.slice(0, 6).map((r) => (
                      <tr key={r.key} className="border-b border-gray-100">
                        <td className="py-1.5 font-medium">{r.key}</td>
                        <td className="py-1.5 text-right">{fmtAcc(r.value)}</td>
                        <td className="py-1.5 text-right text-gray-500">{r.pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="w-full text-sm self-start">
                  <thead>
                    <tr className="border-b">
                      <th className={`${thCls} text-left`}>{t('Geografía', 'Geography')}</th>
                      <th className={`${thCls} text-right`}>{t('Valor', 'Value')}</th>
                      <th className={`${thCls} text-right`}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.geography.slice(0, 6).map((r) => (
                      <tr key={r.key} className="border-b border-gray-100">
                        <td className="py-1.5 font-medium">{regionLabel(r.key, locale, t('Otros', 'Other'))}</td>
                        <td className="py-1.5 text-right">{fmtAcc(r.value)}</td>
                        <td className="py-1.5 text-right text-gray-500">{r.pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.sectors.length > 0 && (
                <table className="w-full text-sm mt-4">
                  <thead>
                    <tr className="border-b">
                      <th className={`${thCls} text-left`}>{t('Sector', 'Sector')}</th>
                      <th className={`${thCls} text-right`}>{t('Valor', 'Value')}</th>
                      <th className={`${thCls} text-right`}>%</th>
                      <th className="py-1.5 w-32" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.sectors.slice(0, 8).map((r) => (
                      <tr key={r.key} className="border-b border-gray-100">
                        <td className="py-1.5 font-medium">{r.key === 'Unknown' ? t('Otros', 'Other') : r.key}</td>
                        <td className="py-1.5 text-right">{fmtAcc(r.value)}</td>
                        <td className="py-1.5 text-right text-gray-500">{r.pct.toFixed(1)}%</td>
                        <td className="py-1.5">
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-gray-700" style={{ width: `${r.pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 8. Vencimientos */}
          {data.maturities.length > 0 && (
            <div className="mb-6">
              <h2 className={sectionCls}>{sec('Próximos vencimientos', 'Upcoming Maturities')}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className={`${thCls} text-left`}>{t('Instrumento', 'Instrument')}</th>
                    <th className={`${thCls} text-left`}>{t('Vencimiento', 'Maturity')}</th>
                    <th className={`${thCls} text-right`}>{t('Días', 'Days')}</th>
                    <th className={`${thCls} text-right`}>{t('Valor', 'Value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.maturities.map((r, i) => (
                    <tr key={`${r.name}-${i}`} className="border-b border-gray-100">
                      <td className="py-1.5 font-medium">{r.name}</td>
                      <td className="py-1.5 text-gray-500">{r.date}</td>
                      <td className="py-1.5 text-right text-gray-500">{r.days}</td>
                      <td className="py-1.5 text-right">{fmtAcc(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 9. Deudas */}
          {data.debts.length > 0 && (
            <div className="mb-6">
              <h2 className={sectionCls}>{sec('Deudas y pasivos', 'Debts & Liabilities')}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className={`${thCls} text-left`}>{t('Nombre', 'Name')}</th>
                    <th className={`${thCls} text-right`}>{t('Saldo', 'Balance')}</th>
                    <th className={`${thCls} text-right`}>{t('Tasa', 'Rate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.debts.map((r, i) => (
                    <tr key={`${r.name}-${i}`} className="border-b border-gray-100">
                      <td className="py-1.5 font-medium">{r.name}</td>
                      <td className="py-1.5 text-right text-gray-900">({fmtRaw(r.balance)})</td>
                      <td className="py-1.5 text-right text-gray-500">{r.ratePct != null ? `${r.ratePct}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right mt-2 font-bold text-gray-900">
                {t('Total deuda', 'Total debt')}: ({fmtRaw(data.kpis.debtTotal)})
              </div>
            </div>
          )}

          {/* Metodología y notas */}
          <div className="text-xs text-gray-400 pt-4 border-t mt-6 space-y-1">
            <p className="font-bold text-gray-500">{t('Metodología y notas', 'Methodology & Notes')}</p>
            <p>{t('¹ Ganancia y retorno del período: Modified Dietz, netos de depósitos y retiros. Un depósito nunca se cuenta como ganancia.',
              '¹ Period gain and return: Modified Dietz, net of deposits and withdrawals. A deposit is never counted as gain.')}</p>
            <p>{t('² Retorno por posición: la ganancia se mide contra el principal e incluye los ingresos que el activo generó; el porcentaje divide entre el costo total desembolsado, comisión de entrada incluida.',
              '² Per-position return: gain is measured against principal and includes income the asset generated; the percentage divides by total cash outlay, entry fee included.')}</p>
            <p>{t('³ Ganancia y retorno YTD por cuenta: motor de atribución sobre la misma base Dietz del encabezado del dashboard.',
              '³ Per-account YTD gain and return: attribution engine on the same Dietz base as the dashboard headline.')}</p>
            <p>{t('Este reporte es informativo y no constituye asesoría de inversión.',
              'This report is informational and does not constitute investment advice.')}</p>
            <p className="font-bold text-gray-500 pt-2">{t('Glosario', 'Glossary')}</p>
            <p>{t('Retorno (Modified Dietz): la ganancia del período neta de depósitos y retiros, ponderando cada movimiento por el tiempo que estuvo invertido. Un depósito no es ganancia.',
              'Return (Modified Dietz): the period gain net of deposits and withdrawals, weighting each movement by how long it was invested. A deposit is not gain.')}</p>
            <p>{t('Volatilidad anualizada: qué tanto varían los retornos alrededor de su promedio, escalado a un año. Más alto significa una trayectoria más movida, no necesariamente peor.',
              'Annualized volatility: how much returns vary around their average, scaled to one year. Higher means a bumpier ride, not necessarily a worse one.')}</p>
            <p>{t('Máxima caída: la peor pérdida de pico a valle dentro del período.',
              'Max drawdown: the worst peak-to-trough loss within the period.')}</p>
            <p>{t('Sharpe: retorno por encima de la tasa libre de riesgo por cada unidad de volatilidad. Mayor a 1 se considera bueno.',
              'Sharpe: return above the risk-free rate per unit of volatility. Above 1 is considered good.')}</p>
            <p>{t('Beta: sensibilidad frente al benchmark. 1 significa que se mueve igual que el mercado; menos de 1, menos que el mercado.',
              'Beta: sensitivity to the benchmark. 1 moves with the market; below 1, less than the market.')}</p>
            <p className="text-center pt-2">{t('Generado por', 'Generated by')} Chispudo · chispu.xyz · {dateStr}</p>
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
