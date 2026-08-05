'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { formatCurrency, getBaseCurrency, getTypeCategory, getItemValue, isExcludedFromNetWorth, TYPE_COLORS, CHART_PALETTE } from './utils'
import { InfoTip } from '../ui/Tooltip'

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

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, returnSinceStart, sinceStartDate, dailyChange, convert, lang, netContributions, cashTotal, snapshots, items, contributionWarning, onLogFlow, ytdCalibrated }) {
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

  // Biggest movers of the day — per-asset intraday % change. Sorted SIGNED
  // (biggest gainer first, biggest loss last), the standard gainers-on-top
  // reading, not by absolute magnitude — mixing a -8% and a +7% by |value|
  // reads as noise where a plain descending list reads as a story. Deduped by
  // item id (two distinct holdings sharing a symbol must not shadow each
  // other) and gated by position weight: a $5 position's ±10% shouldn't
  // headline the card.
  const movers = useMemo(() => {
    if (!items || items.length === 0) return []
    const eligible = items.filter((it) => !it.isDebt && !isExcludedFromNetWorth(it))
    const total = eligible.reduce((s, it) => s + Math.abs(getItemValue(it)), 0)
    const minValue = total * 0.005 // ≥0.5% of the portfolio
    const seen = new Set()
    const list = []
    eligible.forEach((it) => {
      if (it.change1d == null || !isFinite(it.change1d)) return
      if (Math.abs(getItemValue(it)) < minValue) return
      const key = it.id || it.symbol || it.name
      const label = it.symbol || it.name
      if (!label || seen.has(key)) return
      seen.add(key)
      list.push({ label, pct: it.change1d })
    })
    const gainers = list.filter((m) => m.pct >= 0).sort((a, b) => b.pct - a.pct)
    const losers = list.filter((m) => m.pct < 0).sort((a, b) => a.pct - b.pct)
    return [...gainers, ...losers].slice(0, 5)
  }, [items])

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
            <span className="font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {hasYTD && ytdChange != null && isFinite(ytdChange) && `${isYTDPositive ? '+' : ''}${formatCurrency(cv(ytdChange), displayCur)} `}
              ({isYTDPositive ? '+' : ''}{displayReturn.toFixed(2)}%)
            </span>
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

      {/* Quiet, non-alarming nudge: big growth with few logged deposits may mean
          unrecorded contributions. A muted tip, NOT an amber warning banner. */}
      {contributionWarning && (
        <div className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="shrink-0">ⓘ</span>
          <span>
            {lang === 'es'
              ? 'Para un retorno más preciso, agrega tus depósitos y retiros.'
              : 'For a more accurate return, add your deposits and withdrawals.'}
            {onLogFlow && (
              <button onClick={onLogFlow} className="ml-1 underline transition-colors" style={{ color: 'var(--accent-blue)' }}>
                {lang === 'es' ? 'Registrar' : 'Log'}
              </button>
            )}
          </span>
        </div>
      )}

      {/* Composition — fills the card, shows where the net worth sits */}
      {allocation.length > 0 && (
        <div className="mt-3 pt-3 border-t border-glass-border/50">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2.5 block">{lang === 'es' ? 'Composición' : 'Composition'}</span>
          {/* Stacked bar */}
          <div className="w-full h-2.5 rounded-full overflow-hidden flex mb-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            {allocation.map((seg) => (
              <div key={seg.name} className="h-full first:rounded-l-full last:rounded-r-full"
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

      {/* Biggest movers of the day — sorted biggest gain to biggest loss.
          Only the arrow carries green/red; the % itself stays plain text so
          five rows of alternating red/green don't fight each other, and
          rows sit close together (fixed gap, not stretched to fill height). */}
      {movers.length > 0 && (
        <div className="mt-3 pt-3 border-t border-glass-border/50">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2 block">{lang === 'es' ? 'Mayores movimientos hoy' : "Today's biggest movers"}</span>
          <div className="space-y-1">
            {movers.map((m) => {
              const up = m.pct >= 0
              return (
                <div key={m.label} className="flex items-center justify-between">
                  <span className="text-sm truncate pr-2" style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                  <span className="text-sm font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                    <span style={{ color: up ? 'var(--accent-green)' : 'var(--text-negative)' }}>{up ? '▲' : '▼'}</span>
                    {' '}{up ? '+' : ''}{m.pct.toFixed(2)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
