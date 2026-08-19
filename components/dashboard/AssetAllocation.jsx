'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, CHART_PALETTE, getItemValue, getSectorFromItem, getGeographyFromItem, getInvestmentClass, INVESTMENT_CLASS_META, isExcludedFromNetWorth, getDividendIncomeByItem, getIncomeReceivedByItem, getInvestedCapital, getItemPrincipalCost, getMaturityInfo } from './utils'
import { InfoTip } from '../ui/Tooltip'

// Maturity buckets, ordered soonest-first. `order` exists only so this view can
// read as a ladder; every other view leaves it at 0 and therefore keeps sorting
// by value exactly as before (see the sort at the end of the memo).
const MATURITY_BUCKETS = {
  matured: { order: 1, label: { es: 'Vencido', en: 'Matured' } },
  under1y: { order: 2, label: { es: 'Menos de 1 año', en: 'Under 1 year' } },
  y1to3: { order: 3, label: { es: '1 a 3 años', en: '1 to 3 years' } },
  over3y: { order: 4, label: { es: 'Más de 3 años', en: 'Over 3 years' } },
  none: { order: 5, label: { es: 'Sin vencimiento', en: 'No maturity' } },
}

function maturityBucketKey(it) {
  const info = getMaturityInfo(it)
  if (!info) return 'none'
  if (info.expired) return 'matured'
  if (info.days <= 365) return 'under1y'
  if (info.days <= 365 * 3) return 'y1to3'
  return 'over3y'
}

export default function AssetAllocation({ items, lang, transactions, convert, baseCurrency, ibkrDataComplete }) {
  const [view, setView] = useState('type')

  const allocation = useMemo(() => {
    const groupFns = {
      type: (it) => getTypeCategory(it),
      returnType: (it) => getInvestmentClass(it),
      sector: (it) => getSectorFromItem(it),
      geography: (it) => getGeographyFromItem(it),
      currency: (it) => it._originalCurrency || it.currency || 'USD',
      institution: (it) => it.institution || (lang === 'es' ? 'Sin institución' : 'No institution'),
      maturity: (it) => MATURITY_BUCKETS[maturityBucketKey(it)].label[lang === 'es' ? 'es' : 'en'],
    }

    const fn = groupFns[view] || groupFns.type
    // A bond/bank account that pays cash to a different account (rather than
    // reinvesting) never moves its own currentPrice — without this, it always
    // shows 0% here no matter how much it actually paid out.
    // ⛔ LÓGICA CONGELADA (A). Antes de tocar la fórmula de retorno de este
    // archivo, leer lib/assetLogic/corporateBondWithEntryFee.js
    // y seguir el protocolo de su cabecera: hay que PREGUNTAR antes de cambiarla.
    // gain contra principalCost, % contra getInvestedCapital. 3.94%, 2 decimales.
    const dividendIncome = getDividendIncomeByItem(transactions, items, convert, baseCurrency)
    // Income that LANDED in an account is not capital the user invested, so it
    // never belongs in the denominator (see getIncomeReceivedByItem). Same
    // adjustment InstitutionPerformance makes, so grouping by type and grouping
    // by institution can never drift apart on the same holdings.
    const incomeReceived = getIncomeReceivedByItem(transactions, items, convert, baseCurrency)
    const byGroup = {}
    const gainByGroup = {}
    // costByGroup, NOT total portfolio value, is the % denominator — same
    // gain÷cost formula "Rendimiento por Institución" uses. The two used to
    // answer different questions (this one was "% of the WHOLE portfolio's
    // gain"), which meant the same asset showed two different, unrelated
    // numbers depending which card you looked at. One return definition,
    // used everywhere.
    const costByGroup = {}
    // Presentation-only tallies, rescued from InstitutionPerformance when its
    // card stopped being mounted on the dashboard (that component and its
    // formula are untouched and still on disk; only the dashboard stopped
    // rendering it, because its six rows duplicated this card's "Inst." view
    // number for number). Neither of these feeds any calculation: countByGroup
    // is a tally and ibkrByGroup is an OR of a flag that already arrives by
    // prop. Origin: InstitutionPerformance.jsx, the "N pos." span and the
    // history badge next to it.
    const countByGroup = {}
    const ibkrByGroup = {}
    const orderByGroup = {}
    let total = 0
    items.forEach((it) => {
      if (it.isDebt || isExcludedFromNetWorth(it)) return
      const val = getItemValue(it)
      if (val <= 0) return
      const key = fn(it)
      // Gain measures against principal; the % divides by all-in cost (with
      // fees) — see getItemPrincipalCost for why the two differ.
      const principal = getItemPrincipalCost(it)
      const invested = getInvestedCapital(it, incomeReceived.get(it.id))
      const income = dividendIncome.get(it.id) || 0
      byGroup[key] = (byGroup[key] || 0) + val
      gainByGroup[key] = (gainByGroup[key] || 0) + (val - principal) + income
      costByGroup[key] = (costByGroup[key] || 0) + invested
      countByGroup[key] = (countByGroup[key] || 0) + 1
      if (it._source === 'ibkr') ibkrByGroup[key] = true
      if (view === 'maturity') orderByGroup[key] = MATURITY_BUCKETS[maturityBucketKey(it)].order
      total += val
    })
    return Object.entries(byGroup)
      .filter(([, value]) => Math.abs(value) > 0.01)
      .map(([name, value], i) => ({
        name,
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
        returnPct: costByGroup[name] > 0 ? ((gainByGroup[name] || 0) / costByGroup[name]) * 100 : null,
        count: countByGroup[name] || 0,
        hasIbkr: !!ibkrByGroup[name],
        order: orderByGroup[name] || 0,
        color: view === 'type' ? (TYPE_COLORS[name]?.bg || CHART_PALETTE[i % CHART_PALETTE.length])
             : view === 'returnType' ? (INVESTMENT_CLASS_META[name]?.color || CHART_PALETTE[i % CHART_PALETTE.length])
             : CHART_PALETTE[i % CHART_PALETTE.length],
      }))
      // Every view except "maturity" leaves order at 0, so this falls through
      // to the value sort those views have always used.
      .sort((a, b) => (a.order !== b.order ? a.order - b.order : b.value - a.value))
  }, [items, view, lang, transactions, convert, baseCurrency])

  const totalValue = useMemo(() => items.reduce((s, it) => {
    if (it.isDebt || isExcludedFromNetWorth(it)) return s
    const val = getItemValue(it)
    return val > 0 ? s + val : s
  }, 0), [items])

  if (items.length === 0) return null

  const t = (es, en) => lang === 'es' ? es : en

  const views = [
    { key: 'type', label: t('Tipo', 'Type') },
    { key: 'returnType', label: t('Retorno', 'Return') },
    { key: 'sector', label: t('Sector', 'Sector') },
    { key: 'geography', label: t('Geo', 'Geo') },
    { key: 'currency', label: t('Moneda', 'Currency') },
    { key: 'institution', label: t('Inst.', 'Inst.') },
    { key: 'maturity', label: t('Vencim.', 'Maturity') },
  ]

  return (
    <div className="card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {t('ASIGNACIÓN DE ACTIVOS', 'ASSET ALLOCATION')}
          <InfoTip text={t(
            'El % junto al monto es el retorno propio de ese grupo: ganancia ÷ lo que invertiste en él (incluye costos de entrada, excluye el capital nuevo). Cambiá la vista para agrupar los mismos activos por tipo, institución, vencimiento y más: el total no cambia, solo cómo se reparte.',
            'The % next to the amount is that group\'s own return: gain ÷ what you invested in it (includes entry costs, excludes new capital). Switch the view to group the same holdings by type, institution, maturity and more: the total never changes, only how it is split.'
          )} />
        </h3>
        <span className="text-sm font-bold text-white font-mono tabular-nums">
          {formatCurrency(totalValue)}
        </span>
      </div>

      {/* View toggle — segmented control */}
      <div className="inline-flex items-center gap-0.5 p-1 rounded-[10px] mb-5 max-w-full overflow-x-auto" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
        {views.map((v) => {
          const active = view === v.key
          return (
            <button key={v.key} onClick={() => setView(v.key)}
              className="px-2.5 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap"
              style={active
                ? { backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }
                : { color: 'var(--text-muted)' }}>
              {v.label}
            </button>
          )
        })}
      </div>

      {/* Horizontal bar breakdown */}
      <div className="space-y-0">
        {allocation.map((seg) => {
          const displayName = view === 'returnType' && INVESTMENT_CLASS_META[seg.name]
            ? INVESTMENT_CLASS_META[seg.name].label[lang] || seg.name
            : seg.name
          const returnTypeDesc = view === 'returnType' && INVESTMENT_CLASS_META[seg.name]
            ? INVESTMENT_CLASS_META[seg.name].returnType[lang]
            : null

          return (
            <div key={seg.name} className="rounded-lg px-2 -mx-2 transition-colors hover:bg-theme-elevated" style={{ paddingTop: 6, paddingBottom: 6 }}>
              {/* Top row: label left, contribution + value + pct right */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: seg.color }}
                  />
                  <div className="flex flex-col min-w-0">
                    {/* `capitalize` existe porque los nombres de tipo y sector
                        llegan en minúscula. Las etiquetas de vencimiento ya
                        vienen escritas como frase ("Menos de 1 año"), y
                        capitalizarlas palabra por palabra las rompe. */}
                    <span className={`text-sm text-slate-300 truncate ${view === 'maturity' ? '' : 'capitalize'}`}>
                      {displayName}
                    </span>
                    {returnTypeDesc && (
                      <span className="text-xs text-slate-500 leading-tight">
                        {returnTypeDesc}
                      </span>
                    )}
                  </div>
                  {/* Rescued from InstitutionPerformance (see the tally comment
                      in the memo above). Only in the institution view: a
                      position count next to "Bonds" or "USD" would mean
                      something different and read as noise. */}
                  {view === 'institution' && (
                    <span className="text-xs text-slate-500 shrink-0">
                      {seg.count} {t('pos.', 'pos.')}
                    </span>
                  )}
                  {view === 'institution' && seg.hasIbkr && ibkrDataComplete != null && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={ibkrDataComplete
                        ? { color: 'var(--accent-green)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 15%, transparent)' }
                        : { color: 'var(--accent-orange)', backgroundColor: 'color-mix(in srgb, var(--accent-orange) 15%, transparent)' }}
                      title={ibkrDataComplete
                        ? t('Historial y retornos completos: los pasos de conexión están hechos.', 'History and returns complete: all connection steps are done.')
                        : t('Historial incompleto: faltan pasos en "Nuevo → Completar información".', 'History incomplete: steps missing in "New → Complete your data".')}>
                      {/* Etiqueta corta a propósito: en esta card el nombre de
                          la institución comparte la línea con el conteo y con
                          esto, y "100% historial" lo truncaba ("Interactive…").
                          El texto completo vive en el title de arriba. */}
                      {ibkrDataComplete ? t('100%', '100%') : t('parcial', 'partial')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-xs w-14 text-right"
                    style={seg.returnPct == null ? { color: 'var(--text-muted)' } : { color: seg.returnPct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}
                  >
                    {/* 2 decimals, same as InstitutionPerformance and the YTD headline: the
                        same return shown three ways must not read as three numbers. */}
                    {seg.returnPct == null ? '-' : `${seg.returnPct >= 0 ? '+' : ''}${seg.returnPct.toFixed(2)}%`}
                  </span>
                  <span className="text-sm text-white font-mono tabular-nums text-right min-w-[80px]">
                    {formatCurrency(seg.value)}
                  </span>
                  <span className="text-xs text-slate-500 w-12 text-right">
                    {seg.pct.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Bar track + fill */}
              <div
                className="rounded-full overflow-hidden"
                style={{ height: 6, backgroundColor: 'var(--bg-tertiary)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${Math.max(seg.pct, 0.5)}%`,
                    backgroundColor: seg.color,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
