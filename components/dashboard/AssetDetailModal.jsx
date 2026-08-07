'use client'

import { useState, useEffect, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { formatCurrency, formatDate, getItemPrice, isMarketPriced } from './utils'
import { authFetch, safeJson } from '@/lib/authFetch'
import DocumentVault from './DocumentVault'

// Unified with the app-wide market whitelist (isMarketPriced) — the old local
// blacklist disagreed with the movers/quotes filter, so the same asset could
// show "no market data" here while plunging -9.66% in the movers list.

export default function AssetDetailModal({ item, onClose, lang = 'es', uid, transactions = [], convert, baseCurrency = 'USD' }) {
  const trapRef = useFocusTrap()
  const [chartData, setChartData] = useState(null)
  const [chartError, setChartError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('1M')
  const [hoverIdx, setHoverIdx] = useState(null)

  const t = (es, en) => lang === 'es' ? es : en
  const ranges = ['1W', '1M', '3M', '6M', '1Y', 'ALL']
  const isStatic = !isMarketPriced(item)

  // Reinvested interest/dividends paid by THIS asset, as step-ups (in base currency).
  // For market assets reinvested shares already raise qty; for bonds the interest
  // raises the carried value, so we layer it onto the series below.
  const assetIncome = useMemo(() => {
    const sym = (item.symbol || item.name || '').toUpperCase()
    return (transactions || [])
      .filter((tx) => (tx.type || '').toUpperCase() === 'DIVIDEND')
      .filter((tx) => tx._linkedItemId === item.id || (!tx._linkedItemId && (tx.symbol || '').toUpperCase() === sym))
      .map((tx) => {
        const amtRaw = Number(tx.totalAmount ?? tx.amount ?? 0)
        const cur = tx.currency || baseCurrency
        const amount = convert ? convert(amtRaw, cur, baseCurrency) : amtRaw
        const reinvested = tx._reinvested === true || item.dividendAction === 'reinvest'
        return { ts: tx.date ? new Date(tx.date).getTime() : 0, amount, reinvested }
      })
      .filter((e) => e.ts > 0 && e.amount > 0 && e.reinvested)
      .sort((a, b) => a.ts - b.ts)
  }, [transactions, item, convert, baseCurrency])

  const cumIncomeAt = (ts) => assetIncome.reduce((s, e) => (e.ts <= ts ? s + e.amount : s), 0)

  const rangeMap = { '1W': '5d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', 'ALL': '5y' }

  useEffect(() => {
    if (isStatic || !item.symbol) { setLoading(false); return }
    let cancelled = false
    async function fetchChart() {
      setLoading(true)
      setChartError(null)
      try {
        const sym = encodeURIComponent(item.symbol)
        const interval = range === '1W' ? '15m' : range === '1M' ? '1d' : '1wk'
        const r = rangeMap[range]
        const isCrypto = /crypto|cripto/i.test(item.type || '') || item._source === 'ledger' || item._source === 'blockchain'
        const res = await authFetch(`/api/prices/chart?symbol=${sym}&range=${r}&interval=${interval}${isCrypto ? '&type=crypto' : ''}`)
        if (!res.ok) throw new Error('fetch failed')
        const data = await safeJson(res)
        if (!cancelled) setChartData(data)
      } catch {
        if (!cancelled) { setChartData(null); setChartError(true) }
      }
      if (!cancelled) setLoading(false)
    }
    fetchChart()
    return () => { cancelled = true }
  }, [item.symbol, range, isStatic])

  const currentPrice = getItemPrice(item)
  const totalValue = (item.quantity || 0) * currentPrice
  const cost = (item.quantity || 0) * (item.purchasePrice || 0)
  const pnl = totalValue - cost
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0

  // Project an array of {ts, value, date} onto the SVG canvas.
  function project(rawSeries) {
    // A missing FX rate (convert → NaN) or a null close mid-series would put
    // NaN into min/max and break every path coordinate (CLAUDE.md rule).
    const series = (rawSeries || []).filter((s) => isFinite(s.value))
    if (series.length < 2) return null
    const min = Math.min(...series.map((s) => s.value)) * 0.98
    const max = Math.max(...series.map((s) => s.value)) * 1.02
    const rng = max - min || 1
    const w = 600, h = 200
    const pad = { top: 16, right: 12, bottom: 24, left: 0 }
    const cw = w - pad.left - pad.right
    const ch = h - pad.top - pad.bottom
    return series.map((s, i) => ({
      x: pad.left + (i / Math.max(series.length - 1, 1)) * cw,
      y: pad.top + ch - ((s.value - min) / rng) * ch,
      close: s.value,
      date: s.date,
    }))
  }

  // Market assets: value = qty × price(t) + reinvested income to date.
  const points = useMemo(() => {
    if (!chartData?.prices || chartData.prices.length < 2) return null
    const qty = item.quantity || 0
    const priceCur = chartData.currency || item._originalCurrency || 'USD'
    const series = chartData.prices.map((p) => {
      const ts = p.date ? new Date(p.date).getTime() : 0
      let v = qty * (p.close || 0)
      if (convert && priceCur !== baseCurrency) v = convert(v, priceCur, baseCurrency)
      return { ts, date: p.date, value: v + cumIncomeAt(ts) }
    })
    return project(series)
  }, [chartData, item.quantity, assetIncome, convert, baseCurrency])

  // Income-bearing bonds: flat carried value that steps up on each reinvested payment.
  const staticPoints = useMemo(() => {
    if (!isStatic || assetIncome.length === 0) return null
    let baseVal = (item.quantity || 1) * (item.purchasePrice || getItemPrice(item) || 0)
    if (convert && item._originalCurrency && item._originalCurrency !== baseCurrency) {
      // purchasePrice on enriched items is already base; only convert if raw.
      if (item._originalPurchasePrice != null) {
        baseVal = (item.quantity || 1) * item._originalPurchasePrice
        baseVal = convert(baseVal, item._originalCurrency, baseCurrency)
      }
    }
    const acq = item.acquisitionDate ? new Date(item.acquisitionDate).getTime() : assetIncome[0].ts
    const stamps = [acq, ...assetIncome.map((e) => e.ts), Date.now()]
      .filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)
    const series = stamps.map((ts) => ({ ts, date: new Date(ts).toISOString(), value: baseVal + cumIncomeAt(ts) }))
    return project(series)
  }, [isStatic, assetIncome, item, convert, baseCurrency])

  const renderPts = isStatic ? staticPoints : points
  const isPositive = renderPts ? renderPts[renderPts.length - 1].close >= renderPts[0].close : pnl >= 0
  const lineColor = isPositive ? 'var(--accent-green)' : 'var(--text-negative)'

  // Straight segments keep bond interest step-ups crisp (vs the smoothed curve).
  function linePath(pts) {
    if (!pts || pts.length < 2) return ''
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  }

  function smoothPath(pts) {
    if (!pts || pts.length < 2) return ''
    if (pts.length < 3) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
    const tension = 0.3
    let d = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      d += ` C ${p1.x + (p2.x - p0.x) * tension / 3} ${p1.y + (p2.y - p0.y) * tension / 3}, ${p2.x - (p3.x - p1.x) * tension / 3} ${p2.y - (p3.y - p1.y) * tension / 3}, ${p2.x} ${p2.y}`
    }
    return d
  }

  const hp = hoverIdx != null && renderPts ? renderPts[hoverIdx] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="asset-detail-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <div>
            <h2 id="asset-detail-title" className="text-lg font-bold text-white">{item.name || item.symbol}</h2>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.symbol} · {item.type}{item.subtype ? `/${item.subtype}` : ''} {item.institution ? `· ${item.institution}` : ''}</span>
          </div>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
              <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Precio actual', 'Current price')}</span>
              {/* Values here are base-converted — say so, or a EUR asset reads as
                  an unlabeled dollar figure */}
              <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(currentPrice)}<span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>{baseCurrency}</span></span>
            </div>
            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
              <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Valor total', 'Total value')}</span>
              <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{formatCurrency(totalValue)}<span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>{baseCurrency}</span></span>
            </div>
            <div className="bg-theme-base rounded-lg p-3 border border-glass-border/50">
              <span className="text-xs block" style={{ color: 'var(--text-muted)' }}>P&L</span>
              <span className="text-lg font-bold" style={{ color: pnl >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
              </span>
              <span className="text-xs block" style={{ color: pnlPct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
              </span>
            </div>
          </div>

          {/* Position details */}
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span>{t('Cantidad', 'Qty')}: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{item.quantity?.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></span>
            <span>{t('Costo', 'Cost')}: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatCurrency(item.purchasePrice)}</span></span>
            {item.change7d != null && (
              <span style={{ color: item.change7d >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                7d: {item.change7d >= 0 ? '+' : ''}{item.change7d.toFixed(1)}%
              </span>
            )}
          </div>

          {/* Extra details */}
          {(item.maturityDate || item.incomeRate || item.rateType === 'variable' || item.custodyType || item.taxJurisdiction || item.notes) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {/* formatDate() en vez del string crudo o un toLocaleDateString()
                  sin locale: ese último cae al formato numérico por defecto
                  del navegador (MM/DD/YYYY en uno en-US), y el string crudo
                  mostraba el ISO tal cual ("2027-06-15") sin formatear. */}
              {item.maturityDate && (
                <span>{t('Vence', 'Matures')}: <span className="font-medium" style={{ color: 'var(--accent-orange)' }}>{formatDate(item.maturityDate)}</span></span>
              )}
              {item.rateType === 'variable' && item.rateMin > 0 && (
                <span>{t('Tasa', 'Rate')}: <span className="font-medium" style={{ color: 'var(--accent-blue)' }}>{item.rateMin}% - {item.rateMax}%</span></span>
              )}
              {item.rateType === 'continuous' && item.incomeRate > 0 && (
                <span>{t('Tasa continua', 'Continuous rate')}: <span className="font-medium" style={{ color: 'var(--accent-cyan)' }}>{item.incomeRate}%</span></span>
              )}
              {item.rateType !== 'variable' && item.rateType !== 'continuous' && item.incomeRate > 0 && (
                <span>{t('Tasa', 'Rate')}: <span className="font-medium" style={{ color: 'var(--accent-green)' }}>{item.incomeRate}%</span></span>
              )}
              {item.custodyType && (
                <span>{item.custodyType === 'self_custody' ? '🔐' : item.custodyType === 'defi_protocol' ? '🌐' : '🏦'} {item.custodyDetails || item.custodyType}</span>
              )}
              {item.taxJurisdiction && (
                <span>🏛 {item.taxJurisdiction}</span>
              )}
              {item.isIlliquid && (
                <span style={{ color: 'var(--accent-orange)' }}>{t('Ilíquido', 'Illiquid')}</span>
              )}
              {item.notes && (
                <span className="italic w-full mt-1" style={{ color: 'var(--text-muted)' }}>{item.notes}</span>
              )}
            </div>
          )}

          {/* Chart */}
          <div>
            {isStatic && assetIncome.length === 0 ? (
              <div className="h-[120px] bg-theme-base rounded-lg flex flex-col items-center justify-center gap-2">
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('Este activo no tiene datos de mercado', 'This asset has no market data')}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('Su valor se mantiene al precio ingresado manualmente', 'Its value stays at the manually entered price')}
                </span>
              </div>
            ) : (
            <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('Histórico de valor', 'Value history')}</span>
              {!isStatic && (
                <div className="flex gap-0.5 bg-theme-base rounded-lg p-0.5">
                  {ranges.map((r) => (
                    <button key={r} onClick={() => setRange(r)}
                      className="px-2 py-1 text-xs font-medium rounded-md transition-all"
                      style={range === r
                        ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff' }
                        : { color: 'var(--text-muted)' }
                      }>
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loading && !isStatic ? (
              <div className="h-[200px] bg-theme-base rounded-lg animate-pulse flex items-center justify-center">
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando...', 'Loading...')}</span>
              </div>
            ) : renderPts ? (
              <div className="relative">
                <svg viewBox="0 0 600 200" className="w-full" preserveAspectRatio="xMidYMid meet"
                  onMouseLeave={() => setHoverIdx(null)}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const mx = ((e.clientX - rect.left) / rect.width) * 600
                    let closest = 0, minD = Infinity
                    renderPts.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < minD) { minD = d; closest = i } })
                    setHoverIdx(closest)
                  }}>
                  <defs>
                    <linearGradient id="assetGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity="0.15" />
                      <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path d={`${(isStatic ? linePath : smoothPath)(renderPts)} L ${renderPts[renderPts.length-1].x} 192 L ${renderPts[0].x} 192 Z`}
                    fill="url(#assetGrad)" />
                  <path d={(isStatic ? linePath : smoothPath)(renderPts)} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" />
                  {/* Cost / break-even reference line — gain/loss visible on the
                      chart itself, not only in the tiles. The value→y mapping is
                      derived from two rendered points (project() doesn't expose
                      its scale); skipped when it falls outside the plot. */}
                  {(() => {
                    if (cost <= 0 || renderPts.length < 2) return null
                    const a = renderPts[0]
                    const b = renderPts.find((p) => p.close !== a.close)
                    if (!b) return null
                    const costY = a.y + (cost - a.close) * ((b.y - a.y) / (b.close - a.close))
                    if (!isFinite(costY) || costY < 16 || costY > 192) return null
                    return (
                      <g>
                        <line x1={renderPts[0].x} y1={costY} x2={renderPts[renderPts.length - 1].x} y2={costY}
                          stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="5 4" opacity="0.6" />
                        <text x={renderPts[renderPts.length - 1].x} y={costY - 4} textAnchor="end" fill="var(--text-muted)" fontSize="9" fontFamily="system-ui">
                          {t('Costo', 'Cost')}
                        </text>
                      </g>
                    )
                  })()}
                  {hp && (
                    <g>
                      <line x1={hp.x} y1={16} x2={hp.x} y2={192} stroke="#475569" strokeDasharray="4 3" />
                      <circle cx={hp.x} cy={hp.y} r="4" fill={lineColor} stroke="var(--bg-card)" strokeWidth="2" />
                    </g>
                  )}
                </svg>
                {hp && (
                  <div className="absolute pointer-events-none text-xs rounded-lg px-3 py-2 shadow-xl"
                    style={{ left: `${(hp.x / 600) * 100}%`, top: `${(hp.y / 200) * 100 - 15}%`, transform: 'translate(-50%, -100%)', backgroundColor: 'var(--bg-card)', border: '1px solid var(--card-border)', color: 'var(--text-primary)' }}>
                    <div className="font-bold">{formatCurrency(hp.close)}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>{formatDate(hp.date)}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-[200px] bg-theme-base rounded-lg flex items-center justify-center">
                <span className="text-sm" style={{ color: chartError ? 'rgba(248,113,113,0.7)' : 'var(--text-muted)' }}>
                  {chartError ? t('Error cargando datos', 'Failed to load data') : t('Sin datos de precio disponibles', 'No price data available')}
                </span>
              </div>
            )}
            </>
            )}
          </div>

          {uid && item.id && (
            <DocumentVault uid={uid} itemId={item.id} lang={lang} />
          )}
        </div>
      </div>
    </div>
  )
}
