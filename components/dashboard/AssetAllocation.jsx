'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, CHART_PALETTE, getItemValue, getSectorFromItem, getGeographyFromItem, getInvestmentClass, INVESTMENT_CLASS_META, isExcludedFromNetWorth, getDividendIncomeByItem, getIncomeReceivedByItem, getOwnReinvestedYieldByItem, getInvestedCapital, getItemPrincipalCost, getMaturityInfo, CATEGORY_LABELS } from './utils'
import { InfoTip } from '../ui/Tooltip'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import SubTabs from '@/components/ui/SubTabs'

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

const MORE_KEY = '__more'

function maturityBucketKey(it) {
  const info = getMaturityInfo(it)
  if (!info) return 'none'
  if (info.expired) return 'matured'
  if (info.days <= 365) return 'under1y'
  if (info.days <= 365 * 3) return 'y1to3'
  return 'over3y'
}

export default function AssetAllocation({ items, lang, transactions, convert, baseCurrency, ibkrDataComplete, embedded = false }) {
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
    // Y el rendimiento PROPIO de una cuenta líquida tampoco es capital del
    // usuario: su saldo ES su costo, así que el interés que ella misma ganó
    // vive en purchasePrice igual que un cupón recibido (FASE KZ3).
    const ownYield = getOwnReinvestedYieldByItem(transactions, items, convert, baseCurrency)
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
      const invested = getInvestedCapital(it, incomeReceived.get(it.id), ownYield.get(it.id))
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
        // Solo presentación: la ganancia en dinero ya se acumulaba arriba para
        // calcular returnPct; acá se muestra tal cual, sin recalcular nada.
        gain: gainByGroup[name] || 0,
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

  // Rediseño, sección 2: tres vistas a la vista y el resto detrás de "Más",
  // que se despliega como una fila de chips DENTRO de la card (el mismo
  // segundo nivel que Análisis), nunca como un menú flotante. Siete pestañas
  // en una fila no entraban en un teléfono y la última quedaba cortada.
  // Ninguna vista desaparece: las siete siguen ahí, a lo sumo un toque más.
  const primaryViews = [
    { key: 'type', label: t('Tipo', 'Type') },
    { key: 'institution', label: t('Institución', 'Institution') },
    { key: 'sector', label: t('Sector', 'Sector') },
  ]
  const moreViews = [
    { key: 'returnType', label: t('Retorno', 'Return') },
    { key: 'geography', label: t('Geografía', 'Geography') },
    { key: 'currency', label: t('Moneda', 'Currency') },
    { key: 'maturity', label: t('Vencimiento', 'Maturity') },
  ]
  const inMore = moreViews.some((v) => v.key === view)
  const tabs = [...primaryViews, { key: MORE_KEY, label: `${t('Más', 'More')} ▾` }]

  // Rediseño (FASE QI): era una lista de barras dentro de una card de alto
  // fijo, y con cuatro filas quedaba medio panel vacío. Ahora es una TABLA a lo
  // ancho que dice cada cosa una sola vez: grupo, posiciones, peso (barra + %),
  // valor, ganancia en dinero y retorno. Ninguna fórmula se movió: gain y
  // returnPct salen del mismo memo de arriba.
  const COLS = 'sm:grid-cols-[minmax(0,1.5fr)_3.5rem_minmax(0,2fr)_minmax(7.5rem,max-content)_minmax(7rem,max-content)_minmax(6rem,max-content)]'
  const signed = (n) => `${n >= 0 ? '+' : '-'}${formatCurrency(Math.abs(n))}`
  const tone = (n) => (n == null ? 'var(--text-muted)' : n >= 0 ? 'var(--accent-green)' : 'var(--text-negative)')

  return (
    <div className={embedded ? '' : 'card p-4 sm:p-5'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className={`card-title${embedded ? ' card-title-quiet' : ''}`}>
          {!embedded && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />}
          {!embedded && t('ASIGNACIÓN DE ACTIVOS', 'ASSET ALLOCATION')}
          <InfoTip text={t(
            'El % de retorno es propio de cada grupo: ganancia ÷ lo que invertiste en él (incluye costos de entrada, excluye el capital nuevo). Cambia la vista para agrupar los mismos activos por tipo, institución, vencimiento y más: el total no cambia, solo cómo se reparte. Tus deudas no entran acá: se restan en el patrimonio de arriba.',
            'The return % is each group\'s own: gain ÷ what you invested in it (includes entry costs, excludes new capital). Switch the view to group the same holdings by type, institution, maturity and more: the total never changes, only how it is split. Your debts are not in here: they subtract in the net worth above.'
          )} />
        </h3>
        {/* El total de esta card son ACTIVOS (isDebt se filtra arriba) y el
            hero muestra el patrimonio NETO: difieren por la deuda y nada lo
            decia. La caption solo existe cuando hay deudas. */}
        <span className="text-right">
          <span className="text-sm font-bold text-white font-mono tabular-nums block">
            {formatCurrency(totalValue)}
          </span>
          {items.some((it) => it.isDebt) && (
            <span className="text-[10px] block" style={{ color: 'var(--text-muted)' }}>{t('solo activos', 'assets only')}</span>
          )}
        </span>
      </div>

      {/* Siete formas paralelas de agrupar el mismo dinero: tres a la vista y
          cuatro detrás de "Más" (una fila de chips dentro de la card). */}
      <SegmentedTabs
        tabs={tabs}
        value={inMore ? MORE_KEY : view}
        onChange={(k) => {
          if (k === MORE_KEY) { if (!inMore) setView(moreViews[0].key) }
          else setView(k)
        }}
        deps={[lang]}
        ariaLabel={t('Agrupar por', 'Group by')}
        className={inMore ? 'mb-2' : 'mb-3'}
      />
      {inMore && (
        <SubTabs tabs={moreViews} value={view} onChange={setView}
          ariaLabel={t('Más formas de agrupar', 'More ways to group')} className="mb-3" />
      )}

      {/* Encabezado de columnas (desde sm; en teléfono cada fila se explica sola) */}
      <div className={`hidden sm:grid ${COLS} gap-x-4 px-2 -mx-2 pb-2 text-[11px] font-semibold uppercase tracking-wide`}
        style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--card-border)' }}>
        <span>{t('Grupo', 'Group')}</span>
        <span className="text-right">{t('Pos.', 'Pos.')}</span>
        <span>{t('Peso', 'Weight')}</span>
        <span className="text-right">{t('Valor', 'Value')}</span>
        <span className="text-right">{t('Ganancia', 'Gain')}</span>
        <span className="text-right">{t('Retorno', 'Return')}</span>
      </div>

      <div>
        {allocation.map((seg) => {
          const displayName = view === 'returnType' && INVESTMENT_CLASS_META[seg.name]
            ? INVESTMENT_CLASS_META[seg.name].label[lang] || seg.name
            : (view === 'type' && CATEGORY_LABELS[seg.name] ? CATEGORY_LABELS[seg.name][lang === 'es' ? 'es' : 'en'] : seg.name)
          const returnTypeDesc = view === 'returnType' && INVESTMENT_CLASS_META[seg.name]
            ? INVESTMENT_CLASS_META[seg.name].returnType[lang]
            : null

          const ibkrBadge = view === 'institution' && seg.hasIbkr && ibkrDataComplete != null && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={ibkrDataComplete
                ? { color: 'var(--accent-green)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 15%, transparent)' }
                : { color: 'var(--accent-orange)', backgroundColor: 'color-mix(in srgb, var(--accent-orange) 15%, transparent)' }}
              title={ibkrDataComplete
                ? t('Historial y retornos completos: los pasos de conexión están hechos.', 'History and returns complete: all connection steps are done.')
                : t('Historial incompleto: faltan pasos en "Nuevo → Completar información".', 'History incomplete: steps missing in "New → Complete your data".')}>
              {ibkrDataComplete ? t('100%', '100%') : t('parcial', 'partial')}
            </span>
          )

          const nameBlock = (
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <div className="flex flex-col min-w-0">
                {/* `capitalize` solo donde el nombre llega en minúscula: las
                    etiquetas de vencimiento ya son frases. */}
                <span className={`text-sm text-slate-300 truncate ${view === 'maturity' ? '' : 'capitalize'}`}>{displayName}</span>
                {returnTypeDesc && <span className="text-xs text-slate-500 leading-tight">{returnTypeDesc}</span>}
              </div>
              {/* En teléfono no hay columna de posiciones: va junto al nombre */}
              <span className="sm:hidden text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{seg.count} {t('pos.', 'pos.')}</span>
              {ibkrBadge}
            </div>
          )

          const returnText = seg.returnPct == null ? '-' : `${seg.returnPct >= 0 ? '+' : ''}${seg.returnPct.toFixed(2)}%`
          const bar = (
            <div className="rounded-full overflow-hidden flex-1" style={{ height: 6, backgroundColor: 'var(--bg-tertiary)' }}>
              <div className="h-full rounded-full bar-fill" style={{ width: `${Math.max(seg.pct, 0.5)}%`, backgroundColor: seg.color }} />
            </div>
          )

          return (
            <div key={seg.name} className="rounded-lg px-2 -mx-2 py-2.5 transition-colors hover:bg-theme-elevated"
              style={{ borderBottom: '1px solid var(--card-border)' }}>
              {/* Teléfono: nombre y valor arriba, barra con % y retorno debajo */}
              <div className="sm:hidden">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  {nameBlock}
                  <span className="text-sm text-white font-mono tabular-nums shrink-0">{formatCurrency(seg.value)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {bar}
                  <span className="text-xs text-slate-500 tabular-nums w-11 text-right">{seg.pct.toFixed(1)}%</span>
                  <span className="text-xs tabular-nums w-16 text-right" style={{ color: tone(seg.returnPct) }}>{returnText}</span>
                </div>
              </div>

              {/* Tabla desde sm */}
              <div className={`hidden sm:grid ${COLS} gap-x-4 items-center`}>
                {nameBlock}
                <span className="text-xs text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{seg.count}</span>
                <div className="flex items-center gap-3 min-w-0">
                  {bar}
                  <span className="text-xs text-slate-500 tabular-nums w-12 text-right shrink-0">{seg.pct.toFixed(1)}%</span>
                </div>
                <span className="text-sm text-white font-mono tabular-nums text-right">{formatCurrency(seg.value)}</span>
                <span className="text-sm font-mono tabular-nums text-right" style={{ color: tone(seg.gain) }}>{signed(seg.gain)}</span>
                <span className="text-sm tabular-nums text-right" style={{ color: tone(seg.returnPct) }}>{returnText}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
