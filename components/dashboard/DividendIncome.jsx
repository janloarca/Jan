'use client'

import { useMemo, useState } from 'react'
import { formatCurrency, getTypeCategory, projectItemAnnualIncome, itemLabel } from './utils'
import { isReinvestedDividend, reinvestIndex } from '@/lib/dividendCash'

// Subtítulo de grupo. La card llevaba ONCE bloques bajo un solo título, así que
// no había forma de saber si un número era algo que ya entró o algo proyectado:
// "YTD recibido" y "Próximos 12 meses" se veían igual de firmes. Cada bloque
// sigue estando; ahora cada uno dice de qué lado del tiempo habla.
function Group({ children }) {
  return (
    <p className="text-micro font-semibold uppercase tracking-wide mt-5 mb-2 pt-3 border-t"
      style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
      {children}
    </p>
  )
}

// Las dos tiras de barras (historial y proyección) eran DOS bloques copiados a
// mano, y ya habían divergido en lo único que no podían: la de historial
// escalaba contra su propio máximo y la de proyección contra el suyo, mientras
// el comentario que tenían encima afirmaba que compartían eje. O sea una barra
// de $50 se dibujaba a dos alturas distintas según en cuál de las dos cayera,
// que es exactamente lo que ese comentario creía estar evitando. Ahora el
// máximo entra por parámetro y las dos reciben el mismo.
//
// Y el valor de cada barra vivía SOLO en un tooltip de hover. En el iPad del
// usuario eso significa que estas dos gráficas son barras sin una sola cifra:
// `:hover` en Safari táctil o no aparece o se queda pegado tras el primer
// toque. Ahora la barra es un botón: al tocarla su valor se queda escrito
// arriba de la tira, y sigue funcionando con mouse y con teclado.
function BarStrip({ bars, max, color, dim, label, monthName, selected, onSelect, lang }) {
  const sel = bars.find((b) => b.key === selected)
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <span className="text-caption" style={{ color: 'var(--text-muted)' }}>{label}</span>
        {/* Ranura de alto fijo: sin ella la tira salta 18px al tocar la primera
            barra, y el salto se lee como que algo se rompió. */}
        <span className="text-caption font-mono tabular-nums min-h-[1.15rem]" style={{ color: 'var(--text-secondary)' }}>
          {sel ? `${monthName(sel.month)} · ${formatCurrency(sel.value)}` : ''}
        </span>
      </div>
      {/* `min-w-[24px]` mantiene la separación entre centros por encima de los
          24px que pide WCAG 2.2 SC 2.5.8 por su excepción de espaciado, en
          cualquier ancho de pantalla; si doce barras ya no caben, la tira
          scrollea en vez de encoger las barras hasta que no se puedan tocar. */}
      <div className="flex items-end gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {bars.map((b, i) => {
          const paid = b.value > 0
          const h = paid && max > 0 ? (b.value / max) * 100 : 0
          const on = b.key === selected
          // Rótulo cada tres meses, más el seleccionado. Doce nombres de mes a
          // 13px no caben en un teléfono y se tocaban entre sí; a 10px sí
          // cabían, pero 10px queda por debajo del piso de legibilidad. Adelgazar
          // el eje es lo que hace cualquier gráfica ante lo mismo, y no esconde
          // nada: tocar una barra nombra su mes y su monto arriba de la tira, y
          // cada barra lo lleva en su `aria-label` para un lector de pantalla.
          const showLabel = i % 3 === 0 || on
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onSelect(on ? null : b.key)}
              aria-pressed={on}
              aria-label={`${monthName(b.month)}: ${paid ? formatCurrency(b.value) : (lang === 'es' ? 'sin pagos' : 'no payments')}`}
              className="flex-1 min-w-[24px] shrink-0 flex flex-col items-center gap-1 transition-opacity"
              style={{ opacity: selected && !on ? 0.55 : 1 }}
            >
              {/* Caja de alto FIJO para la barra. Antes el `height: N%` competía
                  con el rótulo del mes dentro del mismo flex column, así que el
                  porcentaje no resolvía contra una altura estable y dos valores
                  distintos podían dibujarse a la misma altura: justo lo que un
                  eje compartido existe para impedir. */}
              <span className="w-full h-12 flex items-end">
                <span className="w-full rounded-t block" style={{
                  height: paid ? `${Math.max(h, 6)}%` : '4px',
                  backgroundColor: paid ? color : 'var(--bg-tertiary)',
                  opacity: dim && paid ? 0.75 : 1,
                  outline: on ? '2px solid var(--accent-blue)' : 'none',
                  outlineOffset: '1px',
                }} />
              </span>
              {/* La ranura existe siempre aunque el rótulo no se dibuje, para
                  que las barras no queden a alturas distintas entre sí. */}
              <span className="text-caption min-h-[1.15rem] whitespace-nowrap"
                style={{ color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {showLabel ? monthName(b.month) : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function DividendIncome({ transactions, items, convert, baseCurrency, lang, totalAssets }) {
  // Una sola selección para las dos tiras: son la misma historia en dos
  // direcciones del tiempo, así que tener dos meses resaltados a la vez
  // invitaría a compararlos como si fueran el mismo dato.
  const [selectedBar, setSelectedBar] = useState(null)
  const t = (es, en) => lang === 'es' ? es : en
  const now = new Date()

  const projected = useMemo(() => {
    if (!items || items.length === 0) return { annualTotal: 0, sources: [], upcoming: [] }

    const now = new Date()
    const currentMonth = now.getMonth()
    const sources = []

    items.forEach((it) => {
      const cur = it._originalCurrency || it.currency || 'USD'
      const qty = it.quantity || 1
      const price = it._originalPrice || it.currentPrice || it.purchasePrice || 0
      const balance = qty * price
      const annual = projectItemAnnualIncome(it, balance)
      if (annual <= 0) return

      const converted = convert ? convert(annual, cur, baseCurrency || 'USD') : annual
      const months = Array.isArray(it.incomeMonths) ? it.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
      const payDay = it.incomePayDay || 1

      const cat = getTypeCategory(it.type)
      const incomeType = cat === 'bonds' ? 'coupon' : cat === 'banks' ? 'interest' : 'dividend'
      // El rótulo sale de `itemLabel`, la MISMA regla que usa la Hoja: para un
      // activo de mercado manda el símbolo (es su identidad y cabe en la
      // columna), para todo lo demás manda el nombre. Esta card leía
      // `symbol || name`, o sea al revés, así que renombrar un bono de "RV4" a
      // "Milésimo" en la Hoja no cambiaba nada acá: dos pantallas nombrando el
      // mismo activo distinto.
      sources.push({ id: it.id, label: itemLabel(it), annual: converted, months, payDay, currency: cur, incomeType })
    })

    const upcoming = []
    // Rolling forward-looking projection, THIS month through +11 (a real
    // "next 12 months" window, not "however much of the current calendar year
    // is left") — the counterpart to the trailing 12-month history chart
    // below. Built off the same per-source months/perPayment math as
    // `upcoming`, just walked out further and bucketed by month instead of
    // kept as a flat list.
    const next12 = []
    for (let offset = 0; offset < 12; offset++) {
      const m = (currentMonth + offset) % 12
      const y = now.getFullYear() + (currentMonth + offset >= 12 ? 1 : 0)
      next12.push({ key: `${y}-${String(m).padStart(2, '0')}`, month: m, year: y, value: 0 })
    }
    sources.forEach((s) => {
      const perPayment = s.annual / (s.months.length || 12)
      for (let offset = 0; offset < 12; offset++) {
        const m = (currentMonth + offset) % 12
        if (s.months.includes(m)) {
          next12[offset].value += perPayment
          if (offset < 3) {
            const y = now.getFullYear() + (currentMonth + offset >= 12 ? 1 : 0)
            upcoming.push({ id: s.id, label: s.label, amount: perPayment, month: m, year: y, day: s.payDay })
          }
        }
      }
    })
    upcoming.sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month) || a.day - b.day)

    const annualTotal = sources.reduce((s, x) => s + x.annual, 0)
    const next12Total = next12.reduce((s, m) => s + m.value, 0)
    // "What's still coming this calendar year" — offset 0 is the current
    // month, which may be partially elapsed, so it's included as-is (an
    // estimate for the whole month, same convention incomeCalendar already
    // uses) rather than trying to prorate a single in-progress month.
    const restOfYearTotal = next12
      .filter((m) => m.year === now.getFullYear())
      .reduce((s, m) => s + m.value, 0)

    return {
      annualTotal, sources: sources.sort((a, b) => b.annual - a.annual), upcoming: upcoming.slice(0, 6),
      next12, next12Total, restOfYearTotal,
    }
  }, [items, convert, baseCurrency])

  const stats = useMemo(() => {
    // Exclude reinvested dividends — same filter as the dashboard's annualDividends,
    // so "YTD recibido" here matches the headline figure. FASE JW: la regla
    // compartida, no la bandera sola (que se estampa al escribir, así que un
    // pago anterior a que la cuenta pasara a reinvertir no la lleva).
    const divIdx = reinvestIndex(items)
    const divs = (transactions || []).filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND' && !isReinvestedDividend(tx, divIdx))

    const now = new Date()
    const thisYear = now.getFullYear()
    const thisMonth = now.getMonth()

    let totalAll = 0
    let totalYTD = 0
    let totalThisMonth = 0
    const byMonth = {}
    const bySymbol = {}

    divs.forEach((tx) => {
      const rawAmt = tx.totalAmount ?? 0
      const amt = convert ? convert(rawAmt, tx.currency || 'USD', baseCurrency || 'USD') : rawAmt
      totalAll += amt
      const sym = tx.symbol || tx.description || 'Other'
      bySymbol[sym] = (bySymbol[sym] || 0) + amt
      const d = tx.date ? new Date(tx.date) : null
      if (d) {
        const y = d.getFullYear()
        const m = d.getMonth()
        const key = `${y}-${String(m).padStart(2, '0')}`
        byMonth[key] = (byMonth[key] || 0) + amt
        if (y === thisYear) totalYTD += amt
        if (y === thisYear && m === thisMonth) totalThisMonth += amt
      }
    })

    const monthKeys = Object.keys(byMonth).sort()
    // Average over elapsed calendar months since the first payment, not over the
    // count of months that happened to have a payment — otherwise one dividend in
    // one month projects a full year of income (avgMonthly × 12).
    let avgMonthly = 0
    if (monthKeys.length > 0) {
      const [fy, fm] = monthKeys[0].split('-').map(Number)
      const elapsedMonths = (thisYear - fy) * 12 + (thisMonth - fm) + 1
      avgMonthly = totalAll / Math.max(elapsedMonths, monthKeys.length)
    }
    let daySpan = 30
    if (divs.length > 1) {
      const first = new Date(divs[0].date).getTime()
      const last = new Date(divs[divs.length - 1].date).getTime()
      if (!isNaN(first) && !isNaN(last) && last > first) daySpan = Math.ceil((last - first) / 86400000)
    }
    const dailyAvg = totalAll / Math.max(1, daySpan)

    const last6 = monthKeys.slice(-6)
    const maxBar = Math.max(...last6.map((k) => byMonth[k]), 1)

    // Trailing 12 months (oldest → newest) for the history bar chart. Months
    // with no payment stay at 0 so they render as a flat gray bar.
    const monthly12 = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisYear, thisMonth - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      monthly12.push({ key, month: d.getMonth(), value: byMonth[key] || 0 })
    }
    const maxBar12 = Math.max(...monthly12.map((b) => b.value), 1)

    // Un pago se agrupa por SÍMBOLO (es lo único que toda fila trae), pero se
    // MUESTRA con el rótulo del activo que lo generó, para que esta lista y la
    // Hoja nombren lo mismo. Solo cuando el símbolo resuelve a UN activo: con
    // dos activos compartiendo símbolo, el monto agregado no le pertenece a
    // ninguno de los dos en particular y ponerle el nombre de uno sería mentir.
    const labelBySymbol = {}
    ;(items || []).forEach((it) => {
      const sym = it?.symbol
      if (!sym) return
      if (Object.prototype.hasOwnProperty.call(labelBySymbol, sym)) {
        labelBySymbol[sym] = null // ambiguo
        return
      }
      labelBySymbol[sym] = itemLabel(it) || null
    })

    const topPayers = Object.entries(bySymbol)
      .map(([symbol, total]) => ({ symbol, label: labelBySymbol[symbol] || symbol, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)

    return {
      totalAll, totalYTD, totalThisMonth, avgMonthly, dailyAvg,
      divCount: divs.length, byMonth, last6, maxBar, topPayers, monthly12, maxBar12,
    }
  }, [transactions, items, convert, baseCurrency])

  const estAnnual = projected.annualTotal > 0 ? projected.annualTotal : (stats.avgMonthly * 12)
  // Yield over total assets — dividing by net worth (assets − debt) would inflate
  // the yield for anyone with debt.
  const portfolioYield = totalAssets > 0 && estAnnual > 0 ? (estAnnual / totalAssets) * 100 : 0

  const yoyComparison = useMemo(() => {
    if (!transactions || transactions.length === 0) return null
    const divs = transactions.filter(tx => (tx.type || '').toUpperCase() === 'DIVIDEND' && !isReinvestedDividend(tx, reinvestIndex(items)))
    if (divs.length === 0) return null
    const now = new Date()
    const thisYear = now.getFullYear()
    const lastYear = thisYear - 1
    let thisYearTotal = 0, lastYearTotal = 0
    divs.forEach(tx => {
      const d = tx.date ? new Date(tx.date) : null
      if (!d) return
      const amt = convert ? convert(tx.totalAmount ?? 0, tx.currency || 'USD', baseCurrency || 'USD') : (tx.totalAmount ?? 0)
      if (d.getFullYear() === thisYear) thisYearTotal += amt
      if (d.getFullYear() === lastYear) lastYearTotal += amt
    })
    if (lastYearTotal === 0 && thisYearTotal === 0) return null
    const growth = lastYearTotal > 0 ? ((thisYearTotal - lastYearTotal) / lastYearTotal) * 100 : null
    return { thisYear: thisYearTotal, lastYear: lastYearTotal, growth }
  }, [transactions, items, convert, baseCurrency])

  const incomeByType = useMemo(() => {
    const types = { dividend: 0, coupon: 0, interest: 0 }
    projected.sources.forEach((s) => {
      types[s.incomeType || 'dividend'] = (types[s.incomeType || 'dividend'] || 0) + s.annual
    })
    return Object.entries(types).filter(([, v]) => v > 0).map(([type, annual]) => ({
      type,
      annual,
      label: type === 'dividend' ? t('Dividendos', 'Dividends') : type === 'coupon' ? t('Cupones', 'Coupons') : t('Intereses', 'Interest'),
    }))
  }, [projected.sources, lang])

  const incomeByCurrency = useMemo(() => {
    const byCur = {}
    projected.sources.forEach((s) => {
      const cur = s.currency || 'USD'
      if (!byCur[cur]) byCur[cur] = { original: 0, converted: 0 }
      const originalAnnual = s.annual
      const ratio = convert ? convert(1, baseCurrency || 'USD', cur) : 1
      byCur[cur].original += ratio > 0 ? originalAnnual * ratio : originalAnnual
      byCur[cur].converted += originalAnnual
    })
    return Object.entries(byCur)
      .map(([currency, data]) => ({ currency, ...data }))
      .filter(c => c.converted > 0)
      .sort((a, b) => b.converted - a.converted)
  }, [projected.sources, convert, baseCurrency])

  const incomeCalendar = useMemo(() => {
    const monthTotals = Array(12).fill(0)
    projected.sources.forEach((s) => {
      const perPayment = s.annual / (s.months.length || 12)
      s.months.forEach((m) => { monthTotals[m] += perPayment })
    })
    return monthTotals
  }, [projected.sources])

  const hasData = stats.divCount > 0 || projected.annualTotal > 0
  // This card lives inside the collapsible "Ingresos" section — returning null
  // left an expandable header that opened to nothing. Show guidance instead.
  if (!hasData) {
    return (
      <div className="card p-4 sm:p-5">
        <h3 className="card-title mb-3">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {t('INGRESOS PASIVOS', 'PASSIVE INCOME')}
        </h3>
        <p className="text-sm text-slate-500">
          {t('Aún no hay ingresos que mostrar. Configura la tasa o el monto de ingreso de un activo (bono, cuenta, acción con dividendos) al editarlo, o registra un dividendo recibido: aquí verás la proyección anual, el calendario y el historial.',
             'No income to show yet. Set an income rate or amount on an asset (bond, account, dividend stock) when editing it, or record a received dividend: you\'ll see the annual projection, calendar and history here.')}
        </p>
      </div>
    )
  }

  const monthName = (m) => new Date(2024, m).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short' })
  const calendarMax = Math.max(...incomeCalendar, 1)
  // UN solo máximo para las dos tiras de barras. Cada una escalaba contra el
  // suyo, así que una barra de $50 salía alta en la tira floja y baja en la
  // otra: comparar "lo que cobré" con "lo que viene" a ojo, que es para lo que
  // están una encima de la otra, daba la respuesta equivocada.
  const barMax = Math.max(
    stats.maxBar12 || 0,
    ...(projected.next12 || []).map((b) => b.value || 0),
    1
  )

  return (
    <div className="card p-4 sm:p-5">
      <h3 className="card-title mb-4">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
        {t('INGRESOS PASIVOS', 'PASSIVE INCOME')}
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <span className="text-xs text-slate-500 block">{t('Ingreso anual est.', 'Est. Annual Income')}</span>
          <span className="text-h1 font-mono tabular-nums" style={{ color: 'var(--accent-green)' }}>{formatCurrency(estAnnual)}</span>
        </div>
        <div className="text-center">
          <span className="text-xs text-slate-500 block">{t('Rendimiento', 'Yield')}</span>
          <span className="text-h1 font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>{portfolioYield.toFixed(2)}%</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500 block">YTD {t('recibido', 'received')}</span>
          <span className="text-h1 text-white font-mono tabular-nums">{formatCurrency(stats.totalYTD)}</span>
        </div>
      </div>

      {yoyComparison && yoyComparison.lastYear > 0 && (() => {
        const ly = yoyComparison.lastYear
        const ty = yoyComparison.thisYear
        const total = ly + ty
        const leftPct = total > 0 ? (ly / total) * 100 : 50
        const rightPct = total > 0 ? (ty / total) * 100 : 50
        const up = (yoyComparison.growth ?? 0) >= 0
        return (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-500">{new Date().getFullYear() - 1}</span>
              <span className="text-xs text-slate-500">{new Date().getFullYear()} YTD</span>
            </div>
            <div className="relative flex items-center w-full rounded-full overflow-hidden" style={{ height: '24px' }}>
              <div className="h-full flex items-center px-2.5 bar-fill" style={{ width: `${leftPct}%`, backgroundColor: 'var(--bg-tertiary)' }}>
                <span className="text-xs font-medium font-mono tabular-nums truncate" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(ly)}</span>
              </div>
              <div className="h-full flex items-center justify-end px-2.5 bar-fill" style={{ width: `${rightPct}%`, backgroundColor: 'var(--accent-green)' }}>
                <span className="text-xs font-semibold font-mono tabular-nums truncate text-white">{formatCurrency(ty)}</span>
              </div>
              {yoyComparison.growth != null && (
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ color: up ? 'var(--alert-success-icon)' : 'var(--alert-error-icon)', backgroundColor: up ? 'var(--alert-success-bg)' : 'var(--alert-error-bg)', border: '1px solid var(--card-border)' }}>
                  {up ? '▲' : '▼'} {up ? '+' : ''}{yoyComparison.growth.toFixed(0)}% YoY
                </span>
              )}
            </div>
          </div>
        )
      })()}

      <Group>{t('Lo que ya cobraste', 'What you have received')}</Group>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
          <span className="text-xs text-slate-500">{t('Este mes', 'This month')}</span>
          <span className="text-sm font-semibold text-white block">{formatCurrency(stats.totalThisMonth)}</span>
        </div>
        <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
          <span className="text-xs text-slate-500">{t('Pagos', 'Payments')}</span>
          <span className="text-sm font-semibold text-white block">{stats.divCount}</span>
        </div>
      </div>

      {/* Mini bar chart - trailing 12 months */}
      {stats.divCount > 0 && (
        <BarStrip
          bars={stats.monthly12}
          max={barMax}
          color="var(--accent-green)"
          label={t('Historial (12 meses)', 'History (12 months)')}
          monthName={monthName}
          selected={selectedBar}
          onSelect={setSelectedBar}
          lang={lang}
        />
      )}

      <Group>{t('Lo que viene', 'What is coming')}</Group>

      <div className="grid grid-cols-1 gap-3 mb-4">
        <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
          <span className="text-xs text-slate-500">{t('Mensual est.', 'Monthly est.')}</span>
          <span className="text-sm font-semibold text-white block">{formatCurrency(estAnnual / 12)}</span>
        </div>
      </div>

      {/* Projection: what's still coming, not what already arrived — the
          counterpart to "YTD recibido" above and the trailing history chart
          below. */}
      {projected.next12Total > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg p-3 border" style={{ backgroundColor: 'var(--alert-info-bg)', borderColor: 'var(--card-border)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t(`Resto de ${now.getFullYear()} (proyectado)`, `Rest of ${now.getFullYear()} (projected)`)}</span>
            <span className="text-sm font-semibold block" style={{ color: 'var(--accent-blue)' }}>{formatCurrency(projected.restOfYearTotal)}</span>
          </div>
          <div className="rounded-lg p-3 border" style={{ backgroundColor: 'var(--alert-info-bg)', borderColor: 'var(--card-border)' }}>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('Próximos 12 meses (proyectado)', 'Next 12 months (projected)')}</span>
            <span className="text-sm font-semibold block" style={{ color: 'var(--accent-blue)' }}>{formatCurrency(projected.next12Total)}</span>
          </div>
        </div>
      )}

      {/* Upcoming payments */}
      {projected.upcoming.length > 0 && (
        <div className="mb-4">
          <span className="text-xs text-slate-500 mb-2 block">{t('Próximos pagos esperados', 'Upcoming expected payments')}</span>
          <div className="space-y-1">
            {projected.upcoming.map((u, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-theme-base/60">
                <span className="text-slate-400 font-medium w-16 truncate" title={u.label}>{u.label}</span>
                <span className="text-slate-500">{monthName(u.month)} {u.day}</span>
                <span className="font-medium" style={{ color: 'var(--accent-green)' }}>{formatCurrency(u.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mini bar chart - forward-looking 12 months, mirrors the trailing
          history chart above: MISMO eje (`barMax`), dirección opuesta en el
          tiempo, así que "lo que cobré" y "lo que se proyecta" se leen como una
          sola tira continua. El título decía "Próximos 12 meses (proyectado)",
          exactamente el mismo rótulo que la CIFRA de arriba, para dos cosas
          distintas: esa es el total, esta es el reparto mes a mes. */}
      {projected.next12Total > 0 && (
        <BarStrip
          bars={projected.next12}
          max={barMax}
          color="var(--accent-blue)"
          dim
          label={t('Mes a mes (proyectado)', 'Month by month (projected)')}
          monthName={monthName}
          selected={selectedBar}
          onSelect={setSelectedBar}
          lang={lang}
        />
      )}

      {/* 12-month income calendar */}
      {projected.sources.length > 0 && (
        <div className="mb-4">
          <span className="text-xs text-slate-500 mb-2 block">{t('Calendario de ingresos', 'Income calendar')}</span>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
            {incomeCalendar.map((amt, m) => {
              const paid = amt > 0
              return (
                <div key={m} className="text-center p-1.5 rounded-lg border transition-transform hover:scale-[1.03]" style={paid
                  ? { backgroundColor: 'var(--alert-success-bg)', borderColor: 'var(--alert-success-border)' }
                  : { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: 'var(--card-border)' }}>
                  <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{monthName(m)}</span>
                  <span className="text-xs font-semibold" style={{ color: paid ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {paid ? formatCurrency(amt) : '-'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Group>{t('De dónde sale', 'Where it comes from')}</Group>

      {incomeByType.length > 1 && (
        <div className="flex items-center gap-2 mb-3">
          {incomeByType.map((bt) => (
            <div key={bt.type} className="flex-1 bg-theme-base rounded-lg p-2 border border-glass-border/50 text-center">
              <span className="text-xs text-slate-500 block">{bt.label}</span>
              <span className="text-xs font-semibold text-white">{formatCurrency(bt.annual)}/yr</span>
            </div>
          ))}
        </div>
      )}

      {incomeByCurrency.length > 1 && (
        <div className="mb-3 p-2.5 bg-theme-base rounded-lg border border-glass-border/50">
          <span className="text-xs text-slate-500 mb-1.5 block">{t('Ingreso por moneda', 'Income by currency')}</span>
          <div className="space-y-1">
            {incomeByCurrency.map((c) => (
              <div key={c.currency} className="flex items-center justify-between">
                <span className="text-xs font-medium text-white">{c.currency}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{formatCurrency(c.original, c.currency)}/yr</span>
                  {c.currency !== (baseCurrency || 'USD') && (
                    <span className="text-xs text-slate-500">= {formatCurrency(c.converted)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top income sources - from items data + transaction history */}
      {projected.sources.length > 0 && (
        <div className="mb-4">
          <span className="text-xs text-slate-500 mb-2 block">{t('Fuentes de ingreso', 'Income sources')}</span>
          <div className="space-y-1.5">
            {projected.sources.slice(0, 5).map((s) => {
              const pct = estAnnual > 0 ? (s.annual / estAnnual) * 100 : 0
              // La llave es el id y no el rótulo: dos activos pueden llamarse
              // igual (dos fondos "FONDO LÍQUIDO" en instituciones distintas) y
              // ahí React vería dos hijos con la misma llave.
              return (
                <div key={s.id || s.label} className="flex items-center gap-2">
                  <span className="text-xs text-white font-medium w-16 truncate" title={s.label}>{s.label}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <div className="h-full rounded-full bar-fill" style={{ width: `${pct}%`, backgroundColor: 'var(--accent-green)' }} />
                  </div>
                  <span className="text-xs text-slate-400 w-20 text-right">{formatCurrency(s.annual)}/yr</span>
                </div>
              )
            })}
          </div>
        </div>
      )}


      {/* Fallback: top payers from transactions if no projected sources */}
      {projected.sources.length === 0 && stats.topPayers && stats.topPayers.length > 0 && (
        <div>
          <span className="text-xs text-slate-500 mb-2 block">{t('Mayores pagadores', 'Top payers')}</span>
          <div className="space-y-1.5">
            {stats.topPayers.map((p) => {
              const pct = stats.totalAll > 0 ? (p.total / stats.totalAll) * 100 : 0
              return (
                <div key={p.symbol} className="flex items-center gap-2">
                  <span className="text-xs text-white font-medium w-16 truncate" title={p.label}>{p.label}</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                    <div className="h-full rounded-full bar-fill" style={{ width: `${pct}%`, backgroundColor: 'var(--accent-green)' }} />
                  </div>
                  <span className="text-xs text-slate-400 w-16 text-right">{formatCurrency(p.total)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
