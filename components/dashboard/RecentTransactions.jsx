'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, formatDate, formatMonth } from './utils'
import { transferReversalPlan, reversalLines } from '@/lib/transferReversal'

export default function RecentTransactions({ transactions, lang, onExportCSV, onDeleteTransaction, items = [], convert, baseCurrency }) {
  const itemName = (id) => {
    if (!id) return null
    const it = items.find((i) => i.id === id)
    return it ? (it.name || it.symbol) : null
  }
  const [showAll, setShowAll] = useState(false)
  // Two-step delete: a mis-parsed import can put a movement here that wrecks the
  // return, and the user needs to remove it, but a one-tap delete next to every
  // row is how real history gets destroyed by accident.
  const [confirmId, setConfirmId] = useState(null)
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [dateRange, setDateRange] = useState('all')

  // Cost-type rows (fees/taxes/interest) live in the Costs tab, not here — keep
  // Movimientos about trades, flows and dividends so it isn't flooded by hundreds
  // of small broker fee entries.
  const COST_TYPES = new Set(['FEE', 'TAX', 'INTEREST'])

  const all = useMemo(() => {
    let reversed = [...(transactions || [])].filter((tx) => !COST_TYPES.has((tx.type || '').toUpperCase())).reverse()

    if (dateRange !== 'all') {
      const now = new Date()
      const cutoff = new Date()
      if (dateRange === '7d') cutoff.setDate(now.getDate() - 7)
      else if (dateRange === '30d') cutoff.setDate(now.getDate() - 30)
      else if (dateRange === '90d') cutoff.setDate(now.getDate() - 90)
      else if (dateRange === 'ytd') cutoff.setMonth(0, 1)
      reversed = reversed.filter((tx) => tx.date && new Date(tx.date) >= cutoff)
    }

    if (typeFilter === 'ALL') return reversed
    return reversed.filter((tx) => (tx.type || '').toUpperCase() === typeFilter)
  }, [transactions, typeFilter, dateRange])

  const monthlySummary = useMemo(() => {
    if (!transactions || transactions.length === 0) return null
    const months = {}
    transactions.forEach((tx) => {
      if (!tx.date) return
      const key = tx.date.slice(0, 7)
      if (!months[key]) months[key] = { inflow: 0, outflow: 0, count: 0 }
      months[key].count++
      const t = (tx.type || '').toUpperCase()
      // A month can mix currencies (a Q500 withdrawal next to a $26 buy):
      // summing raw amounts adds quetzales to dollars. Convert each movement
      // to the base currency first; the chip is labeled in base by
      // formatCurrency's default. Without a converter (no rates yet) fall
      // back to the raw amount, same fallback the rest of the app uses.
      let amt = tx.totalAmount || 0
      if (convert && tx.currency && baseCurrency && tx.currency !== baseCurrency) {
        const c = convert(amt, tx.currency, baseCurrency)
        if (isFinite(c)) amt = c
      }
      if (t === 'BUY' || t === 'DEPOSIT') months[key].inflow += amt
      else if (t === 'SELL' || t === 'WITHDRAWAL') months[key].outflow += amt
      else if (t === 'DIVIDEND') months[key].inflow += amt
    })
    const sorted = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3)
    return sorted.map(([month, data]) => ({ month, ...data, net: data.inflow - data.outflow }))
  }, [transactions, convert, baseCurrency])

  const display = showAll ? all : all.slice(0, 5)

  const filterOptions = [
    { key: 'ALL', icon: '○', label: lang === 'es' ? 'Todos' : 'All', color: 'blue' },
    { key: 'BUY', icon: '↗', label: lang === 'es' ? 'Compras' : 'Buys', color: 'blue' },
    { key: 'SELL', icon: '↘', label: lang === 'es' ? 'Ventas' : 'Sells', color: 'slate' },
    { key: 'DIVIDEND', icon: '$', label: lang === 'es' ? 'Dividendos' : 'Dividends', color: 'emerald' },
    { key: 'DEPOSIT', icon: '+', label: lang === 'es' ? 'Depósitos' : 'Deposits', color: 'slate' },
    { key: 'WITHDRAWAL', icon: '−', label: lang === 'es' ? 'Retiros' : 'Withdrawals', color: 'slate' },
  ]

  const typeBadgeStyle = (type) => {
    const t = (type || '').toUpperCase()
    const success = { backgroundColor: 'var(--alert-success-bg)', color: 'var(--alert-success-icon)' }
    const error = { backgroundColor: 'var(--alert-error-bg)', color: 'var(--alert-error-icon)' }
    const warn = { backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }
    const neutral = { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }
    if (t === 'BUY') return success
    if (t === 'SELL') return error
    if (t === 'DIVIDEND') return warn
    if (t === 'DEPOSIT') return success
    if (t === 'WITHDRAWAL') return error
    if (t === 'TRANSFER') return { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }
    return neutral
  }

  const typeIcon = (type) => {
    const t = (type || '').toUpperCase()
    if (t === 'BUY') return '↗'
    if (t === 'SELL') return '↘'
    if (t === 'DIVIDEND') return '$'
    if (t === 'DEPOSIT') return '+'
    if (t === 'WITHDRAWAL') return '−'
    if (t === 'TRANSFER') return '⇄'
    return '·'
  }

  // Human trace of how the money moved: "A → B" for transfers (from the linked
  // item ids when present, else the description), source asset for manual yields.
  const flowTrace = (tx) => {
    const t = (tx.type || '').toUpperCase()
    if (t === 'TRANSFER') {
      const from = itemName(tx._originItemId)
      const to = itemName(tx._linkedItemId)
      if (from && to) return `${from} → ${to}`
      const m = (tx.description || '').match(/Transfer:\s*(.+)/)
      return m ? m[1] : null
    }
    if (t === 'DIVIDEND' && tx._origin === 'yield') {
      const src = itemName(tx._linkedItemId)
      const dest = itemName(tx._destinationItemId)
      const base = src ? (lang === 'es' ? `Rendimiento de ${src}` : `Yield from ${src}`) : (lang === 'es' ? 'Rendimiento' : 'Yield')
      return dest ? `${base} → ${dest}` : base
    }
    if ((t === 'DEPOSIT' || t === 'WITHDRAWAL') && tx._origin === 'external') {
      const linked = itemName(tx._linkedItemId)
      if (linked) {
        return lang === 'es'
          ? (t === 'DEPOSIT' ? `Dinero nuevo → ${linked}` : `Desde ${linked} → fuera`)
          : (t === 'DEPOSIT' ? `New money → ${linked}` : `From ${linked} → out`)
      }
      return lang === 'es' ? (t === 'DEPOSIT' ? 'Dinero nuevo' : 'Salió del portafolio') : (t === 'DEPOSIT' ? 'New money' : 'Left portfolio')
    }
    if ((t === 'DEPOSIT' || t === 'WITHDRAWAL') && tx._linkedItemId && !tx._origin) {
      const linked = itemName(tx._linkedItemId)
      if (linked) {
        return lang === 'es'
          ? (t === 'DEPOSIT' ? `Aporte → ${linked}` : `Retiro de ${linked}`)
          : (t === 'DEPOSIT' ? `Contribution → ${linked}` : `Withdrawal from ${linked}`)
      }
    }
    return null
  }

  // "Todos" must count what this card will actually LIST. It counted the raw
  // array instead, so a portfolio with broker fees advertised "Todos 200" and
  // then showed "Ver todas (125)": the 75 cost rows live in the Costs tab, and
  // the mismatch reads as 75 missing movements.
  const txCount = (key) => {
    const visible = (transactions || []).filter((tx) => !COST_TYPES.has((tx.type || '').toUpperCase()))
    if (key === 'ALL') return visible.length
    return visible.filter((tx) => (tx.type || '').toUpperCase() === key).length
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          {lang === 'es' ? 'Transacciones' : 'Transactions'}
        </h3>
        {onExportCSV && transactions && transactions.length > 0 && (
          <button onClick={onExportCSV} className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition-colors" aria-label="Export CSV">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            CSV
          </button>
        )}
      </div>

      {/* Visual filter tabs — compact single-line chips (the stacked icon/label/
          count boxes were 3 lines tall and dominated the card with whitespace) */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {filterOptions.map((opt) => {
          const count = txCount(opt.key)
          const isActive = typeFilter === opt.key
          const activeStyle = {
            backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)',
            borderColor: 'color-mix(in srgb, var(--accent-blue) 35%, transparent)',
            color: 'var(--accent-blue)',
          }
          const inactiveStyle = { backgroundColor: 'transparent', borderColor: 'var(--card-border)', color: 'var(--text-muted)' }
          return (
            <button key={opt.key} onClick={() => { setTypeFilter(opt.key); setShowAll(false) }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-all border text-xs font-medium hover:bg-theme-elevated"
              style={isActive ? activeStyle : inactiveStyle}>
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
              {count > 0 && <span className="font-bold" style={{ color: isActive ? 'var(--accent-blue)' : 'var(--text-secondary)' }}>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-xs text-slate-600 mr-1">{lang === 'es' ? 'Periodo:' : 'Period:'}</span>
        {[
          { key: 'all', label: lang === 'es' ? 'Todo' : 'All' },
          { key: '7d', label: '7d' },
          { key: '30d', label: '30d' },
          { key: '90d', label: '90d' },
          { key: 'ytd', label: 'YTD' },
        ].map((opt) => (
          <button key={opt.key} onClick={() => { setDateRange(opt.key); setShowAll(false) }}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors"
            style={dateRange === opt.key
              ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 35%, transparent)', color: 'var(--accent-blue)' }
              : { backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--text-muted)' }}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Monthly summary — single-line chips instead of 3-line boxes */}
      {monthlySummary && monthlySummary.length > 0 && dateRange === 'all' && typeFilter === 'ALL' && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {monthlySummary.map((m) => (
            <div key={m.month} className="bg-theme-base rounded-lg px-2.5 py-1.5 border border-glass-border/50 flex items-baseline justify-between gap-2">
              <span className="text-xs text-slate-500 shrink-0">{formatMonth(m.month)}</span>
              <span className="text-xs font-semibold font-mono tabular-nums truncate" style={{ color: m.net >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                {m.net >= 0 ? '+' : ''}{formatCurrency(m.net)}
              </span>
              <span className="text-xs text-slate-600 shrink-0 hidden sm:inline">{m.count} txs</span>
            </div>
          ))}
        </div>
      )}

      {display.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-slate-500 text-sm">
            {typeFilter !== 'ALL'
              ? (lang === 'es' ? 'Sin transacciones de este tipo.' : 'No transactions of this type.')
              : (lang === 'es' ? 'Sin transacciones registradas.' : 'No transactions recorded.')}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-0">
            {display.map((tx, i) => (
              <div key={tx.id || i} className="border-b border-glass-border/30 last:border-0">
              <div className="group flex items-center justify-between gap-2 py-2 hover:bg-theme-elevated/30 transition-colors -mx-2 px-2 rounded">
                {/* FASE LH2: min-w-0 en toda la cadena izquierda + truncate en el
                    simbolo. Sin eso, en el estado de CONFIRMACION (que agrega dos
                    botones al lado derecho) la fila no tenia nada que pudiera
                    encoger y desbordaba 28px a 390px (medido en FASE KY,
                    preexistente). El lado derecho va shrink-0: botones y monto
                    son lo que no puede cortarse. */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={typeBadgeStyle(tx.type)}>
                    {typeIcon(tx.type)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-white font-medium truncate">{tx.symbol || tx.description || '-'}</span>
                      <span className="px-1.5 py-0.5 rounded text-xs font-bold uppercase shrink-0" style={typeBadgeStyle(tx.type)}>
                        {tx.type || 'TX'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {formatDate(tx.date)}
                      {flowTrace(tx) && <span className="ml-2" style={{ color: 'var(--text-muted)' }}>· {flowTrace(tx)}</span>}
                    </span>
                  </div>
                </div>
                <div className="text-right flex items-center gap-2 shrink-0">
                  {/* La × de borrar era `opacity-0 group-hover:opacity-60`. En un
                      iPad eso no es "discreto", es inalcanzable: Safari táctil o
                      no dispara `:hover` o lo deja pegado tras el primer toque,
                      así que la × suelta de la captura del usuario quedaba
                      visible sobre UNA fila al azar y ausente en las demás.
                      Ahora se ve siempre, apagada, y solo se realza al pasar el
                      mouse; el objetivo mide 24x24 (WCAG 2.2 SC 2.5.8). El
                      borrado sigue pidiendo confirmación, así que verla no la
                      vuelve peligrosa. */}
                  {onDeleteTransaction && tx.id && (
                    confirmId === tx.id ? (
                      <span className="flex items-center gap-1">
                        <button onClick={() => { onDeleteTransaction(tx.id); setConfirmId(null) }}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--text-negative)', color: 'var(--bg-card)' }}>
                          {lang === 'es' ? 'Borrar' : 'Delete'}
                        </button>
                        <button onClick={() => setConfirmId(null)}
                          className="text-[10px] px-1 py-0.5 rounded" style={{ color: 'var(--text-muted)' }}>
                          {lang === 'es' ? 'No' : 'No'}
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmId(tx.id)}
                        aria-label={lang === 'es' ? 'Borrar movimiento' : 'Delete movement'}
                        className="text-xs px-1 min-w-[24px] min-h-[24px] rounded transition-opacity opacity-40 hover:opacity-100"
                        style={{ color: 'var(--text-muted)' }}>
                        &times;
                      </button>
                    )
                  )}
                  <span className="text-sm font-medium font-mono tabular-nums" style={{ color:
                    (tx.type || '').toUpperCase() === 'SELL' || (tx.type || '').toUpperCase() === 'WITHDRAWAL'
                      ? 'var(--text-negative)'
                      : (tx.type || '').toUpperCase() === 'TRANSFER' ? 'var(--text-secondary)' : 'var(--accent-green)'
                  }}>
                    {/* The row shows the ORIGINAL amount, so it must wear the
                        ORIGINAL currency: a Q500 withdrawal rendered as
                        "$500.00" reads as 7.7x the real movement. */}
                    {formatCurrency(tx.totalAmount ?? 0, tx.currency)}
                  </span>
                  {tx.quantity > 0 && (
                    <div className="text-xs text-slate-500 font-mono tabular-nums">
                      {tx.quantity} x {formatCurrency(tx.pricePerUnit || 0, tx.currency)}
                    </div>
                  )}
                </div>
              </div>
              {/* Borrar una transferencia MUEVE DINERO en dos cuentas, no solo
                  quita una fila del historial, asi que la confirmacion dice
                  cuanto vuelve a cada lado. La redaccion vive en
                  lib/transferReversal.js, compartida con el historial de la
                  cuenta, que es la otra pantalla con este boton. */}
              {confirmId === tx.id && reversalLines(transferReversalPlan(tx, items), lang, formatCurrency).map((line, k) => (
                <div key={k} className="text-xs pb-2 -mt-1 pl-12" style={{ color: 'var(--text-muted)' }}>{line}</div>
              ))}
              </div>
            ))}
          </div>
          {all.length > 5 && (
            <button onClick={() => setShowAll(!showAll)}
              className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-emerald-400 border border-glass-border/50 rounded-lg hover:bg-theme-elevated transition-colors">
              {showAll
                ? (lang === 'es' ? 'Mostrar menos' : 'Show less')
                : (lang === 'es' ? `Ver todas (${all.length})` : `View all (${all.length})`)}
            </button>
          )}
        </>
      )}
    </div>
  )
}
