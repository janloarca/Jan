'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { formatCurrency, getBaseCurrency, getTypeCategory, getItemValue, isExcludedFromNetWorth, TYPE_COLORS, CHART_PALETTE } from './utils'
import { InfoTip } from '../ui/Tooltip'
import { attributionRefusalText } from '@/lib/ytdAttribution'

const QUICK_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

const CATEGORY_LABELS = {
  banks: { es: 'Caja & Bancos', en: 'Cash & Banks' },
  funds: { es: 'Fondos', en: 'Funds' },
  stocks: { es: 'Acciones', en: 'Stocks' },
  crypto: { es: 'Cripto', en: 'Crypto' },
  alternatives: { es: 'Alternativos', en: 'Alternatives' },
  bonds: { es: 'Bonos', en: 'Bonds' },
  realestate: { es: 'Bienes Raíces', en: 'Real Estate' },
  receivables: { es: 'Por Cobrar', en: 'Receivables' },
  other: { es: 'Otros', en: 'Other' },
}

function getGreeting(lang) {
  const hour = new Date().getHours()
  if (hour < 12) return lang === 'es' ? 'Buenos días' : 'Good morning'
  if (hour < 18) return lang === 'es' ? 'Buenas tardes' : 'Good afternoon'
  return lang === 'es' ? 'Buenas noches' : 'Good evening'
}

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, returnSinceStart, sinceStartDate, dailyChange, convert, lang, netContributions, cashTotal, snapshots, items, ytdCalibrated, ytdBreakdown, ytdBreakdownReason, ytdBreakdownDetail }) {
  const hasYTD = returnYTD != null && isFinite(returnYTD)
  const displayReturn = hasYTD ? returnYTD : (returnSinceStart != null && isFinite(returnSinceStart) ? returnSinceStart : null)
  const hasReturn = displayReturn != null
  const isYTDPositive = (displayReturn ?? 0) >= 0
  const isDayPositive = dailyChange ? dailyChange.abs >= 0 : true
  const baseCur = getBaseCurrency()
  const [tempCurrency, setTempCurrency] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!showPicker) return
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const displayCur = tempCurrency || baseCur
  const cv = (val) => tempCurrency && convert ? convert(val, baseCur, tempCurrency) : val
  const displayValue = cv(netWorth)

  const greeting = getGreeting(lang)

  // Asset-class composition of net worth — fills the card and explains where
  // the money sits. Percentages are currency-agnostic; values use cv() so they
  // follow the temporary currency picker like the rest of the card.
  const allocation = useMemo(() => {
    if (!items || items.length === 0) return []
    const byGroup = {}
    let total = 0
    items.forEach((it) => {
      if (it.isDebt || isExcludedFromNetWorth(it)) return
      const val = getItemValue(it)
      if (val <= 0) return
      const key = getTypeCategory(it)
      byGroup[key] = (byGroup[key] || 0) + val
      total += val
    })
    let segs = Object.entries(byGroup)
      .map(([name, value], i) => ({
        name, value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: TYPE_COLORS[name]?.bg || CHART_PALETTE[i % CHART_PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)
    if (segs.length > 5) {
      const tail = segs.slice(4)
      segs = segs.slice(0, 4)
      segs.push({
        name: '_more', isOther: true, count: tail.length,
        value: tail.reduce((s, x) => s + x.value, 0),
        pct: tail.reduce((s, x) => s + x.pct, 0),
        color: 'var(--text-muted)',
      })
    }
    return segs
  }, [items])

  const catLabel = (seg) => seg.isOther
    ? (lang === 'es' ? `Otros (${seg.count})` : `Others (${seg.count})`)
    : (CATEGORY_LABELS[seg.name]?.[lang] || seg.name)

  // Biggest movers of the day, split into two tabs (gainers / losers) instead
  // of one combined list — a portfolio with 5+ gainers used to bury every
  // loser past the slice(0,5) cut, so "biggest movers" only ever showed green.
  // Each row carries the dollar swing AND its impact on the whole portfolio
  // (weight × change1d, same formula as lib/friendsStats.js's movers) — the
  // % you'd otherwise only see is the position's OWN day change, which says
  // nothing about how much it actually moved your net worth. Deduped by item
  // id (two holdings sharing a symbol must not shadow each other) and gated
  // by position weight: a $5 position's ±10% shouldn't headline the card.
  const movers = useMemo(() => {
    if (!items || items.length === 0) return { gainers: [], losers: [] }
    const eligible = items.filter((it) => !it.isDebt && !isExcludedFromNetWorth(it))
    const total = eligible.reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
    const minValue = total * 0.005 // ≥0.5% of the portfolio
    const seen = new Set()
    const list = []
    eligible.forEach((it) => {
      if (it.change1d == null || !isFinite(it.change1d)) return
      const value = getItemValue(it)
      if (Math.abs(value) < minValue) return
      const key = it.id || it.symbol || it.name
      const label = it.symbol || it.name
      if (!label || seen.has(key)) return
      seen.add(key)
      list.push({
        label, pct: it.change1d,
        dollarChange: value * (it.change1d / 100),
        impactPct: total > 0 ? (value / total) * it.change1d : 0,
      })
    })
    const gainers = list.filter((m) => m.pct >= 0).sort((a, b) => b.pct - a.pct).slice(0, 5)
    const losers = list.filter((m) => m.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 5)
    return { gainers, losers }
  }, [items])

  // The YTD figure opens into its own parts: which institutions, and inside
  // them which holdings, actually produced the number. Closed by default so the
  // card stays a headline; one tap turns it into an explanation.
  const [showYTDDetail, setShowYTDDetail] = useState(false)
  const hasBreakdown = !!ytdBreakdown && ytdBreakdown.groups.length > 0
  // También se puede expandir cuando el motor REHUSÓ: antes el tap simplemente
  // no hacía nada y el usuario no tenía forma de saber por qué (FASE HT3). El
  // panel en ese caso explica la razón en vez de mostrar filas.
  const canExpandYTD = hasYTD && (hasBreakdown || !!ytdBreakdownReason)

  const [moversTab, setMoversTab] = useState('gainers')
  // If the tab the user is on empties out (e.g. everything is up today) and
  // the other one has content, land on the one with something to show.
  useEffect(() => {
    if (moversTab === 'gainers' && movers.gainers.length === 0 && movers.losers.length > 0) setMoversTab('losers')
    if (moversTab === 'losers' && movers.losers.length === 0 && movers.gainers.length > 0) setMoversTab('gainers')
  }, [movers, moversTab])

  const touchStartX = useRef(null)
  const onMoversTouchStart = (e) => { touchStartX.current = e.touches[0].clientX }
  const onMoversTouchEnd = (e) => {
    if (touchStartX.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < 40) return // ignore taps/scrolls, only real swipes
    if (dx < 0 && movers.losers.length > 0) setMoversTab('losers')
    if (dx > 0 && movers.gainers.length > 0) setMoversTab('gainers')
  }

  return (
    <div className="bg-gradient-to-br from-theme-card to-theme-surface rounded-2xl p-5 card-hero h-full flex flex-col"
      style={{ backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-elevated)', border: 'var(--glass-border)' }}>
      {/* Greeting + currency picker — the milestone pill (a second colored
          badge next to the picker) is gone: the combined today/YTD line below
          already says whether things are up or down, so a second label
          restating it in a pill was noise, not information. */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{greeting}</span>
        <div className="relative" ref={pickerRef}>
          <button onClick={() => setShowPicker(!showPicker)}
            className="text-xs px-2 py-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            style={{ border: '1px solid transparent', ...(showPicker ? { backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: 'var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.05)' } : {}) }}>
            {displayCur}
          </button>
          {showPicker && (
            <div className="absolute right-0 top-full mt-1 bg-theme-card/80 rounded-lg z-10 p-1 min-w-[80px]"
              style={{ backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-elevated)', border: 'var(--glass-border)' }}>
              {QUICK_CURRENCIES.map((c) => (
                <button key={c} onClick={() => { setTempCurrency(c === baseCur ? null : c); setShowPicker(false) }}
                  className="block w-full text-left px-3 py-1.5 text-xs rounded transition-colors"
                  style={displayCur === c ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.1)' } : { color: 'var(--text-secondary)' }}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KPI: Main value — Level 1 typography, the one hero figure in the
          view. No sparkline beside it: at 60x24px it had no axis, no label
          and no legend, so it read as decoration nobody could interpret —
          the real chart is one tap away in the Valor/Rendimiento card. */}
      <p className="min-w-0 text-[2.25rem] sm:text-[3rem] leading-none text-white tracking-tight font-bold font-mono tabular-nums drop-shadow-sm mb-1.5">{formatCurrency(displayValue, displayCur)}</p>

      {/* Today + YTD, one line. Direction lives ONLY in the small arrow —
          the numbers themselves stay in plain text color, so the line reads
          as one calm sentence instead of two competing red/green claims. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {dailyChange && isFinite(dailyChange.pct) && (
          <span className="whitespace-nowrap">
            <span className="text-[11px] font-semibold tracking-wide mr-1" style={{ color: 'var(--text-muted)' }}>{lang === 'es' ? 'HOY' : 'TODAY'}</span>
            <span style={{ color: isDayPositive ? 'var(--accent-green)' : 'var(--text-negative)' }}>{isDayPositive ? '▲' : '▼'}</span>
            {' '}
            <span className="font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {isDayPositive ? '+' : ''}{formatCurrency(cv(dailyChange.abs), displayCur)} ({isDayPositive ? '+' : ''}{dailyChange.pct.toFixed(2)}%)
            </span>
          </span>
        )}
        {dailyChange && hasReturn && <span aria-hidden="true" style={{ color: 'var(--glass-border)' }}>│</span>}
        {hasReturn && (
          <span className="whitespace-nowrap">
            <span className="text-[11px] font-semibold tracking-wide mr-1" style={{ color: 'var(--text-muted)' }}>
              {hasYTD ? 'YTD' : ((lang === 'es' ? 'DESDE ' : 'SINCE ') + (sinceStartDate ? new Date(sinceStartDate).toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short', year: '2-digit' }) : ''))}
            </span>
            <span style={{ color: isYTDPositive ? 'var(--accent-green)' : 'var(--text-negative)' }}>{isYTDPositive ? '▲' : '▼'}</span>
            {' '}
            {canExpandYTD ? (
              <button type="button" onClick={() => setShowYTDDetail((v) => !v)}
                aria-expanded={showYTDDetail}
                className="font-mono tabular-nums underline decoration-dotted underline-offset-4 cursor-pointer"
                style={{ color: 'var(--text-primary)', textDecorationColor: 'var(--text-muted)' }}
                title={lang === 'es' ? 'Ver de dónde viene este número' : 'See where this number comes from'}>
                {ytdChange != null && isFinite(ytdChange) && `${isYTDPositive ? '+' : ''}${formatCurrency(cv(ytdChange), displayCur)} `}
                ({isYTDPositive ? '+' : ''}{displayReturn.toFixed(2)}%)
                <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{showYTDDetail ? '▴' : '▾'}</span>
              </button>
            ) : (
              <span className="font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {hasYTD && ytdChange != null && isFinite(ytdChange) && `${isYTDPositive ? '+' : ''}${formatCurrency(cv(ytdChange), displayCur)} `}
                ({isYTDPositive ? '+' : ''}{displayReturn.toFixed(2)}%)
              </span>
            )}
            {hasYTD && <InfoTip text={lang === 'es' ? 'Year-to-Date: retorno desde el 1 de enero del año en curso. Calculado con el método Dietz Modificado, que descuenta tus depósitos y retiros para que solo cuente lo que ganaron tus inversiones (no el dinero nuevo que metiste).' : 'Year-to-Date: return since January 1st of the current year. Calculated with the Modified Dietz method, which adjusts for your deposits and withdrawals so only investment performance counts (not new money you put in).'} />}
            {ytdCalibrated && (
              <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}
                title={lang === 'es' ? 'Anclado al % que escribiste de tu broker. La curva intermedia se estima.' : 'Anchored to the % you typed from your broker. The in-between curve is estimated.'}>
                · {lang === 'es' ? 'calibrado' : 'calibrated'}
              </span>
            )}
          </span>
        )}
      </div>

      {/* What is behind the YTD number, by institution and then by holding.
          Each row is (value today − value on Jan 1) minus the money you moved
          in or out of it this year, so financing an account never shows up here
          as a profit. */}
      {canExpandYTD && showYTDDetail && (
        <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es' ? 'De dónde viene tu YTD' : 'Where your YTD comes from'}
            </span>
            <InfoTip text={lang === 'es'
              ? 'Por cada cuenta: valor de hoy menos valor de arranque del año, restando el dinero que metiste o sacaste. Los depósitos nunca cuentan como ganancia, y el dinero que pasa de una cuenta tuya a otra tampoco. El % es el retorno de esa cuenta, el mismo que ves en su gráfica. Las cuentas suman exactamente el YTD de arriba: si no cuadraran, este desglose no se muestra.'
              : 'Per account: today\'s value minus its year-start value, less any money you moved in or out. Deposits never count as gains, and neither does money moved between your own accounts. The % is that account\'s return, the same one its chart shows. The accounts add up to the YTD figure above exactly: if they did not, this breakdown would not be shown.'} />
          </div>
          {/* Motor rehusó: en vez de un tap muerto, el panel dice POR QUÉ no
              hay desglose (FASE HT3). El YTD de arriba sigue siendo correcto:
              lo que falta es el reparto por cuenta, no el número. */}
          {!hasBreakdown && (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {lang === 'es'
                ? `El desglose por cuenta no está disponible ahora mismo: ${attributionRefusalText(ytdBreakdownReason, 'es', ytdBreakdownDetail)}. El YTD de arriba sigue siendo correcto; solo el reparto entre cuentas no pasó las validaciones.`
                : `The per-account breakdown is unavailable right now: ${attributionRefusalText(ytdBreakdownReason, 'en', ytdBreakdownDetail)}. The YTD above is still correct; only the split across accounts did not pass validation.`}
              {/* FASE HY: la regeneración pasiva depende de una docena de gates
                  (la lección de FASE HP), así que el rechazo por ancla vieja
                  nombra la acción que la fuerza en vez de solo pedir paciencia. */}
              {ytdBreakdownReason === 'unexplained-too-large' && (
                lang === 'es'
                  ? ' Podés forzar la regeneración desde "Agregar datos históricos" con el botón "Reparar ahora".'
                  : ' You can force the regeneration from "Add historical data" with the "Repair now" button.'
              )}
            </p>
          )}
          {/* FASE IB: los términos por cuenta del intento que rehusó. Con solo
              el residuo total supimos la ESCALA del problema pero no qué cuenta
              lo causaba; esta lista convierte una captura del teléfono en el
              diagnóstico completo (misma lección que el reporte de "Reparar
              ahora", FASE HP). El asterisco marca un arranque REAL (NAV del
              broker), que el motor nunca ajusta. */}
          {!hasBreakdown && Array.isArray(ytdBreakdownDetail?.accounts) && ytdBreakdownDetail.accounts.length > 0 && (
            <div className="mt-2 space-y-0.5 font-mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              <div>
                {lang === 'es' ? 'Ancla del año' : 'Year anchor'}: {formatCurrency(ytdBreakdownDetail.anchor ?? 0)}
              </div>
              {ytdBreakdownDetail.accounts.map((a) => (
                <div key={a.name}>
                  {a.name}: {lang === 'es' ? 'arranque' : 'start'} {formatCurrency(a.start ?? 0)}{a.real ? '*' : ''}
                  {' · '}{lang === 'es' ? 'hoy' : 'now'} {formatCurrency(a.end ?? 0)}
                  {' · '}{lang === 'es' ? 'flujos' : 'flows'} {formatCurrency(a.flow ?? 0)}
                </div>
              ))}
            </div>
          )}
          {/* One row per ACCOUNT (FASE GR). Every account is listed, including
              ones that contributed nothing: the previous version hid near-zero
              rows and accounts simply looked missing. */}
          <div className="space-y-2">
            {hasBreakdown && ytdBreakdown.groups.map((g) => (
              <div key={g.key} className="flex items-baseline justify-between gap-2">
                <span className="text-sm truncate" style={{ color: g.isUnexplained ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                  {g.isUnexplained
                    ? (lang === 'es' ? 'Sin atribuir' : 'Unattributed')
                    : (g.name || (lang === 'es' ? 'Sin institución' : 'No institution'))}
                </span>
                <span className="text-sm font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                  {/* The account's OWN return, not its share of the total gain.
                      The share read as a return and was not one: a broker up
                      7.40% on the year showed "75%" next to it, which only meant
                      "most of this year's gain came from here". */}
                  {g.ret != null && isFinite(g.ret) && (
                    <span className="mr-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {g.ret >= 0 ? '+' : ''}{g.ret.toFixed(2)}%
                    </span>
                  )}
                  {g.gain >= 0 ? '+' : ''}{formatCurrency(cv(g.gain), displayCur)}
                </span>
              </div>
            ))}
          </div>
          {hasBreakdown && ytdBreakdown.groups.some((g) => g.isUnexplained) && (
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es'
                ? 'Cada cuenta muestra su propio número. Lo que no calza con el total va aparte, sin repartirlo entre las cuentas: viene del valor de arranque estimado de las cuentas sin historial del broker.'
                : 'Each account shows its own figure. Whatever does not match the total is listed separately rather than spread across accounts: it comes from the estimated year-start of accounts without broker history.'}
            </p>
          )}
        </div>
      )}

      {/* Composition — fills the card, shows where the net worth sits */}
      {allocation.length > 0 && (
        <div className="mt-3 pt-3 border-t border-glass-border/50">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2.5 block">{lang === 'es' ? 'Composición' : 'Composition'}</span>
          {/* Stacked bar */}
          {/* 2px of surface between segments: without the gap two adjacent
              fills read as one block wherever their hues are close, which is
              exactly where the eye needs the boundary most. */}
          <div className="w-full h-2.5 rounded-full overflow-hidden flex gap-[2px] mb-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            {allocation.map((seg) => (
              <div key={seg.name} className="h-full rounded-full"
                style={{ width: `${Math.max(seg.pct, 0.5)}%`, backgroundColor: seg.color }}
                title={`${catLabel(seg)} · ${seg.pct.toFixed(1)}%`} />
            ))}
          </div>
          {/* Legend */}
          <div className="grid grid-cols-2 gap-x-5 gap-y-2">
            {allocation.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between gap-2 min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-xs text-slate-400 truncate">{catLabel(seg)}</span>
                </span>
                <span className="text-xs font-medium font-mono tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>{seg.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Biggest movers of the day — a tab per direction (swipe or tap),
          so a green-heavy day no longer buries every loser. Only the arrow
          carries green/red; the $ and portfolio-% stay plain text so rows
          read as one calm list either way. */}
      {(movers.gainers.length > 0 || movers.losers.length > 0) && (() => {
        const activeList = moversTab === 'gainers' ? movers.gainers : movers.losers
        const up = moversTab === 'gainers'
        return (
          <div className="mt-3 pt-3 border-t border-glass-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{lang === 'es' ? 'Mayores movimientos hoy' : "Today's biggest movers"}</span>
              {movers.gainers.length > 0 && movers.losers.length > 0 && (
                <div className="flex gap-0.5 rounded-md p-0.5" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  {[
                    { key: 'gainers', icon: '▲', n: movers.gainers.length },
                    { key: 'losers', icon: '▼', n: movers.losers.length },
                  ].map((tab) => (
                    <button key={tab.key} type="button" onClick={() => setMoversTab(tab.key)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums transition-colors"
                      style={moversTab === tab.key
                        ? { color: tab.key === 'gainers' ? 'var(--accent-green)' : 'var(--text-negative)', backgroundColor: 'var(--bg-card)' }
                        : { color: 'var(--text-muted)' }}>
                      {tab.icon} {tab.n}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1" onTouchStart={onMoversTouchStart} onTouchEnd={onMoversTouchEnd}>
              {activeList.map((m) => (
                <div key={m.label} className="flex items-center justify-between">
                  <span className="text-sm truncate pr-2" style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                  <span className="text-sm font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                    <span style={{ color: up ? 'var(--accent-green)' : 'var(--text-negative)' }}>{up ? '▲' : '▼'}</span>
                    {' '}{up ? '+' : ''}{formatCurrency(cv(m.dollarChange), displayCur)} ({up ? '+' : ''}{m.impactPct.toFixed(2)}%)
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es' ? '% = impacto sobre tu portafolio total' : '% = impact on your total portfolio'}
            </p>
          </div>
        )
      })()}

      {/* Cash available — anchored at the bottom */}
      {cashTotal != null && cashTotal > 0 && (
        <div className="mt-auto pt-3 border-t border-glass-border/50 flex items-center justify-between">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent-cyan)', opacity: 0.6 }} />
            {lang === 'es' ? 'Disponible' : 'Cash available'}
          </span>
          <span className="text-xs font-medium font-mono tabular-nums" style={{ color: 'var(--accent-cyan)' }}>{formatCurrency(cv(cashTotal), displayCur)}</span>
        </div>
      )}
    </div>
  )
}
