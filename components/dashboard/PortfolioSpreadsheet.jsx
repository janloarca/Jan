'use client'

import { useState, useMemo, useRef, useEffect, useCallback, Fragment, memo } from 'react'
import { formatCurrency, getItemValue, getTypeCategory, isExcludedFromNetWorth, TYPE_COLORS } from './utils'

const CATEGORY_ORDER = ['banks', 'funds', 'stocks', 'crypto', 'alternatives', 'bonds', 'realestate', 'other', 'receivables', 'debts']
const CATEGORY_LABELS = {
  banks: { es: 'Caja & Bancos', en: 'Cash & Banks' },
  funds: { es: 'Fondos Liquidos', en: 'Liquid Funds' },
  stocks: { es: 'Bolsa de Valores', en: 'Stock Market' },
  crypto: { es: 'Criptoactivos', en: 'Crypto Assets' },
  alternatives: { es: 'Deuda Privada & Alt.', en: 'Private Debt & Alt.' },
  bonds: { es: 'Bonos Corporativo', en: 'Corporate Bonds' },
  realestate: { es: 'Bienes Raices', en: 'Real Estate' },
  receivables: { es: 'Cuentas por Cobrar', en: 'Receivables' },
  debts: { es: 'Pasivos', en: 'Liabilities' },
  other: { es: 'Otros', en: 'Other' },
}

const CATEGORY_ACCENT = {
  banks: '#94a3b8',
  funds: '#818cf8',
  stocks: '#3b82f6',
  crypto: '#f97316',
  alternatives: '#a78bfa',
  bonds: '#f59e0b',
  realestate: '#34d399',
  receivables: '#06b6d4',
  debts: '#ef4444',
  other: '#64748b',
}

const DEBT_TERM_LABELS = {
  '3m': '3 meses',
  '6m': '6 meses',
  '12m': '12 meses',
  '24m': '24 meses',
  '36m': '36 meses',
  payday: 'Día de pago',
  revolving: 'Revolving',
  custom: 'Custom',
}

const REWARD_ICONS = {
  miles: '✈',
  cashback: '$',
  points: '★',
}

function getMonthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function getMonthLabel(key, lang) {
  const [y, m] = key.split('-')
  const d = new Date(parseInt(y), parseInt(m) - 1, 1)
  const label = d.toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short' })
  return label.charAt(0).toUpperCase() + label.slice(1) + ' ' + y.slice(2)
}

function getOriginalValue(item) {
  if (item._originalPrice == null) return getItemValue(item)
  const qty = Number(item.quantity) || 0
  const val = qty * item._originalPrice
  if (!isFinite(val)) return 0
  return item.isDebt ? -Math.abs(val) : val
}

function formatNum(val) {
  if (val == null || !isFinite(val)) return '-'
  return Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isMarketAsset(type) {
  return /stock|crypto|fund|etf/i.test(type) && !/realestate|inmueble/i.test(type)
}

const EditableCell = memo(function EditableCell({ displayValue, editValue, onSave, hint, editLabel, livePreview, isNegative, currency, onEditStart, onEditEnd }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select() }
  }, [editing])

  const startEdit = () => {
    setDraft(editValue)
    setEditing(true)
    onEditStart?.()
  }

  const commit = () => {
    const num = parseFloat(draft.replace(/[^0-9.\-]/g, ''))
    // Same ceiling as file imports (lib/validation MAX_PRICE) — inline edits
    // shouldn't be the one door where absurd values slip in.
    if (isFinite(num) && num >= 0 && num <= 10_000_000) onSave(num)
    setEditing(false)
    onEditEnd?.()
  }

  const cancel = () => {
    setEditing(false)
    onEditEnd?.()
  }

  if (editing) {
    const draftNum = parseFloat(draft.replace(/[^0-9.\-]/g, ''))
    // Floating editor: the label/preview are often wider than the 128px month
    // column, so the open editor renders as an anchored popover with its own
    // solid background instead of bleeding transparently into neighbor cells.
    return (
      <div className="relative" style={{ minHeight: '2rem' }}>
        <div className="absolute right-0 top-0 z-30 min-w-[190px] bg-white border-2 border-blue-400 rounded-lg shadow-lg p-2">
          {editLabel && <p className="text-xs text-blue-500 text-right mb-1 font-medium">{editLabel}</p>}
          <div className="flex items-center gap-1">
            {currency && <span className="text-xs text-blue-500 font-semibold shrink-0">{currency}</span>}
            <input ref={ref} type="text" value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
              className="w-full bg-white border border-blue-300 rounded px-2 py-1.5 text-sm text-slate-900 text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          {livePreview && isFinite(draftNum) && (
            <p className="text-xs text-blue-400 text-right mt-1">{livePreview(draftNum)}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="cursor-pointer rounded px-3 py-1.5 -mx-1 transition-all hover:bg-blue-100 hover:ring-1 hover:ring-blue-300 text-right"
      onClick={startEdit}>
      <span className="font-mono tabular-nums text-sm" style={isNegative ? { color: '#dc2626' } : { color: '#1e293b' }}>{formatNum(displayValue)}</span>
      {currency && <span className="text-xs text-slate-400 ml-1">{currency}</span>}
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
})

export default function PortfolioSpreadsheet({ items, snapshots, lang, onUpdateItem, onEditItem, returnYTD, netWorth, convert, baseCurrency, onSaveItemSnapshots, onLoadItemSnapshots, lots, transactions }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [showOriginal, setShowOriginal] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const historyFetchedRef = useRef(false)

  const ZOOM_LEVELS = [0.75, 0.875, 1, 1.125, 1.25]
  const [zoom, setZoom] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = parseFloat(localStorage.getItem('chispudo-spreadsheet-zoom'))
      if (ZOOM_LEVELS.includes(saved)) return saved
    }
    return 1
  })
  const zoomIn = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom)
    if (idx < ZOOM_LEVELS.length - 1) {
      const next = ZOOM_LEVELS[idx + 1]
      setZoom(next)
      localStorage.setItem('chispudo-spreadsheet-zoom', next)
    }
  }
  const zoomOut = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom)
    if (idx > 0) {
      const next = ZOOM_LEVELS[idx - 1]
      setZoom(next)
      localStorage.setItem('chispudo-spreadsheet-zoom', next)
    }
  }

  const now = new Date()
  const currentMonthKey = getMonthKey(now)

  const earliestYear = useMemo(() => {
    let earliest = now.getFullYear() - 1
    items.forEach(it => {
      const dateStr = it.acquisitionDate || it.createdAt
      if (dateStr) {
        const y = new Date(dateStr).getFullYear()
        if (y >= 2000 && y < earliest) earliest = y
      }
    })
    return earliest
  }, [items])

  const availableYears = useMemo(() => {
    const years = []
    for (let y = earliestYear; y <= now.getFullYear(); y++) years.push(y)
    return years
  }, [earliestYear])

  const [selectedYear, setSelectedYear] = useState(now.getFullYear())

  const months = useMemo(() => {
    const result = []
    const endMonth = selectedYear === now.getUTCFullYear() ? now.getUTCMonth() : 11
    for (let m = 0; m <= endMonth; m++) {
      result.push(getMonthKey(new Date(Date.UTC(selectedYear, m, 1))))
    }
    return result
  }, [selectedYear])

  const [historicalItems, setHistoricalItems] = useState({})

  const monthlyTotals = useMemo(() => {
    const base = baseCurrency || 'USD'
    // Snapshot NAV per month — used as a fallback for months that have no per-item
    // reconstruction yet. IBKR equityHistory snapshots (_source:'ibkr') are broker
    // NAV and omit manually added assets (bonds, crypto, cash), so a month that
    // falls back to one would undercount; we augment it below.
    const snapByMonth = {}
    const ibkrSourceByMonth = {}
    if (snapshots && snapshots.length) {
      const dates = {}
      snapshots.forEach(s => {
        if (!s.date) return
        const key = getMonthKey(new Date(s.date))
        const val = s.netWorthUSD ?? s.totalActivosUSD ?? 0
        if (val === 0) return
        const sDate = new Date(s.date)
        if (!dates[key] || sDate > dates[key]) {
          dates[key] = sDate
          snapByMonth[key] = convert ? convert(val, 'USD', base) : val
          ibkrSourceByMonth[key] = s._source === 'ibkr'
        }
      })
      const keys = Object.keys(snapByMonth).sort()
      for (let i = 1; i < keys.length - 1; i++) {
        const prev = snapByMonth[keys[i - 1]], cur = snapByMonth[keys[i]], next = snapByMonth[keys[i + 1]]
        if (prev > 0 && next > 0 && cur < prev * 0.55 && cur < next * 0.55) {
          delete snapByMonth[keys[i]]
        }
      }
    }

    // Non-IBKR (manually-added) assets that an IBKR-only snapshot leaves out.
    // Held flat at their current value, gated by an effective acquisition date so a
    // bond bought in June doesn't inflate May. This mirrors what the per-item
    // reconstruction produces (IBKR scaled to NAV + manual assets held flat).
    const monthEndOf = (mk) => { const [y, m] = mk.split('-').map(Number); return Date.UTC(y, m, 0) }
    const effAcqTs = (it) => {
      const a = it.acquisitionDate ? Date.parse(it.acquisitionDate) : NaN
      if (!isNaN(a)) return a
      const c = it.createdAt ? new Date(it.createdAt) : null
      return c && !isNaN(c.getTime()) ? Date.UTC(c.getUTCFullYear(), 0, 1) : null
    }
    const nonIbkrItems = items
      .filter(it => it._source !== 'ibkr' && it.id && !isExcludedFromNetWorth(it))
      .map(it => ({ value: getItemValue(it), acqTs: effAcqTs(it) }))
      .filter(it => it.value)
    const nonIbkrValueAtMonth = (mk) => {
      const end = monthEndOf(mk)
      let sum = 0
      for (const it of nonIbkrItems) if (it.acqTs == null || it.acqTs <= end) sum += it.value
      return sum
    }

    // Prefer summing the per-item reconstruction: IBKR items are already scaled to
    // the snapshot NAV and summed together with manually-added static assets, so
    // the TOTAL row matches the sum of the category rows AND includes assets the
    // broker-only snapshots leave out (a bond, a cash fund). Fall back to the raw
    // snapshot NAV for any month not reconstructed yet — augmenting IBKR-only
    // snapshots with the manual assets so the fallback never undercounts.
    const result = {}
    const allKeys = new Set([...Object.keys(snapByMonth), ...Object.keys(historicalItems)])
    allKeys.forEach(mk => {
      const hist = historicalItems[mk]
      if (hist && Object.keys(hist).length > 0) {
        let sum = 0
        const seen = new Set()
        items.forEach(it => {
          if (it.id && hist[it.id]) {
            sum += (it.isDebt ? -1 : 1) * (hist[it.id].value || 0)
            seen.add(it.id)
          }
        })
        Object.entries(hist).forEach(([id, v]) => {
          if (!seen.has(id)) sum += v.value || 0
        })
        result[mk] = sum
      } else if (snapByMonth[mk] != null) {
        let total = snapByMonth[mk]
        if (ibkrSourceByMonth[mk] && nonIbkrItems.length) total += nonIbkrValueAtMonth(mk)
        result[mk] = total
      }
    })
    return result
  }, [snapshots, convert, baseCurrency, historicalItems, items])

  // Months whose TOTAL comes from a snapshot NAV fallback (no per-item breakdown):
  // the category rows show "—" there while the TOTAL shows a figure, so we mark
  // those cells instead of leaving a column that visibly doesn't add up.
  const fallbackMonths = useMemo(() => {
    const s = new Set()
    Object.keys(monthlyTotals).forEach(mk => {
      const hist = historicalItems[mk]
      if (!hist || Object.keys(hist).length === 0) s.add(mk)
    })
    return s
  }, [monthlyTotals, historicalItems])

  // Any displayed historical cell reconstructed as a held-flat estimate → show the
  // "~" legend so users know which numbers are inferred vs price/NAV-backed.
  const hasEstimated = useMemo(() =>
    months.some(mk => mk !== currentMonthKey && Object.values(historicalItems[mk] || {}).some(c => c?.estimated)),
    [months, currentMonthKey, historicalItems]
  )

  const itemSnapshotSavedRef = useRef(false)
  const lastFetchedYearRef = useRef(null)

  const snapshotSig = snapshots?.length ?? 0
  const txSig = transactions?.length ?? 0
  const lotSig = lots?.length ?? 0
  // Content signature over the edit-sensitive item fields. Counts alone miss in-place
  // edits (quantity/symbol/date/cost), which must invalidate the cached history or
  // past columns keep showing stale values. Live price ticks are deliberately
  // excluded (currentPrice changes constantly and doesn't affect reconstruction
  // inputs); purchasePrice uses the raw original so FX refreshes don't wipe it.
  const itemContentSig = useMemo(() => (items || []).map(it =>
    `${it.id}:${it.symbol || ''}:${it.quantity || 0}:${it._originalPurchasePrice ?? it.purchasePrice ?? 0}:${it.acquisitionDate || ''}`
  ).sort().join('|'), [items])
  useEffect(() => {
    lastFetchedYearRef.current = null
    setHistoricalItems({})
  }, [snapshotSig, txSig, lotSig, itemContentSig])

  useEffect(() => {
    if (!onLoadItemSnapshots || months.length === 0) return
    const toLoad = months.filter(mk => mk !== currentMonthKey)
    if (toLoad.length === 0) return
    let cancelled = false
    const base = baseCurrency || 'USD'
    onLoadItemSnapshots(toLoad).then(data => {
      if (cancelled || !data) return
      const { __currencies = {}, ...monthData } = data
      setHistoricalItems(prev => {
        const next = { ...prev }
        toLoad.forEach(mk => {
          if (!monthData[mk]) delete next[mk]
        })
        Object.entries(monthData).forEach(([mk, itemsForMonth]) => {
          const savedCur = __currencies[mk]
          if (savedCur && savedCur !== base && convert) {
            next[mk] = Object.fromEntries(Object.entries(itemsForMonth).map(([id, v]) =>
              [id, { ...v, value: convert(v.value, savedCur, base) }]
            ))
          } else {
            next[mk] = itemsForMonth
          }
        })
        return next
      })
    })
    return () => { cancelled = true }
  }, [onLoadItemSnapshots, months, currentMonthKey, baseCurrency, convert])

  useEffect(() => {
    if (!onSaveItemSnapshots || !items || items.length === 0) return
    // Key on id+qty+symbol+price — a price-sum alone misses quantity/symbol edits
    // that leave the sum unchanged, so the current month's snapshot never re-saved.
    const itemHash = items.map(it => `${it.id}:${it.symbol || ''}:${it.quantity || 0}:${(it.currentPrice || 0).toFixed(4)}`).sort().join('|')
    const saveKey = `${currentMonthKey}-${itemHash}`
    if (itemSnapshotSavedRef.current === saveKey) return
    itemSnapshotSavedRef.current = saveKey
    const data = {}
    items.forEach(it => {
      const val = getItemValue(it)
      if (it.id) data[it.id] = { value: val, symbol: it.symbol || it.name || '', category: getTypeCategory(it), institution: it.institution || '' }
    })
    onSaveItemSnapshots(currentMonthKey, data, baseCurrency || 'USD')
  }, [onSaveItemSnapshots, items, currentMonthKey, baseCurrency])

  useEffect(() => {
    if (!items || items.length === 0) return
    if (!onSaveItemSnapshots) return
    if (lastFetchedYearRef.current === selectedYear) return
    // IBKR items are reconstructed from equity snapshots — wait for them to load
    // before computing/caching, so we never bake unscaled values into the cache.
    const hasIBKR = items.some(it => it._source === 'ibkr')
    if (hasIBKR && (!snapshots || snapshots.length === 0)) return
    const pastMonths = months.filter(mk => mk !== currentMonthKey)
    if (pastMonths.length === 0) return

    const itemsWithIds = items.filter(it => it.id)

    const missingMonths = pastMonths.filter(mk => {
      const monthData = historicalItems[mk]
      if (!monthData || Object.keys(monthData).length === 0) return true
      const covered = itemsWithIds.filter(it => monthData[it.id])
      return covered.length < itemsWithIds.length * 0.7
    })
    if (missingMonths.length === 0) {
      lastFetchedYearRef.current = selectedYear
      return
    }
    setLoadingHistory(true)

    const itemsWithCategory = items.map(it => ({ ...it, _category: getTypeCategory(it) }))
    const fetchYear = selectedYear

    let cancelled = false
    import('@/lib/historicalValues').then(({ getHistoricalItemValues }) => {
      getHistoricalItemValues(itemsWithCategory, missingMonths, convert, baseCurrency, lots, transactions, snapshots).then(async (data) => {
        if (cancelled) return
        lastFetchedYearRef.current = fetchYear
        setHistoricalItems(prev => {
          const merged = { ...prev }
          Object.entries(data).forEach(([mk, itemData]) => {
            merged[mk] = { ...(merged[mk] || {}), ...itemData }
          })
          return merged
        })
        for (const mk of Object.keys(data)) {
          if (cancelled) break
          if (Object.keys(data[mk]).length > 0) {
            try { await onSaveItemSnapshots(mk, data[mk], baseCurrency || 'USD') } catch {}
          }
        }
        if (!cancelled) setLoadingHistory(false)
      }).catch(() => { if (!cancelled) setLoadingHistory(false) })
    }).catch(() => { if (!cancelled) setLoadingHistory(false) })
    return () => { cancelled = true }
  }, [items, months, currentMonthKey, historicalItems, convert, baseCurrency, onSaveItemSnapshots, lots, transactions, selectedYear, snapshots])

  const itemValue = useCallback((item) => {
    return showOriginal ? getOriginalValue(item) : getItemValue(item)
  }, [showOriginal])

  const itemCurrency = useCallback((item) => {
    if (showOriginal) return item._originalCurrency || item.currency || 'USD'
    return baseCurrency || 'USD'
  }, [showOriginal, baseCurrency])

  const { categories, totalAssets, totalDebt, currencyBreakdown } = useMemo(() => {
    const catMap = {}
    let totalA = 0
    let totalD = 0
    const curBreak = {}

    items.forEach(it => {
      const cat = getTypeCategory(it)
      if (!catMap[cat]) catMap[cat] = { institutions: {}, total: 0 }
      const inst = it.institution || t('Sin institucion', 'No institution')
      if (!catMap[cat].institutions[inst]) catMap[cat].institutions[inst] = []
      catMap[cat].institutions[inst].push(it)

      const val = getItemValue(it)
      catMap[cat].total += val

      if (!isExcludedFromNetWorth(it)) {
        if (val < 0) totalD += Math.abs(val)
        else totalA += val
      }

      const cur = it._originalCurrency || it.currency || 'USD'
      const isUSD = cur === 'USD' || cur === '$'
      const bucket = isUSD ? 'USD' : cur
      const origVal = getOriginalValue(it)
      curBreak[bucket] = curBreak[bucket] || { usd: 0, original: 0 }
      curBreak[bucket].usd += Math.abs(val)
      curBreak[bucket].original += Math.abs(origVal)
    })

    const ordered = CATEGORY_ORDER
      .filter(cat => catMap[cat])
      .map(cat => ({
        key: cat,
        label: CATEGORY_LABELS[cat]?.[lang] || cat,
        total: catMap[cat].total,
        excludedFromTotal: cat === 'receivables' && catMap[cat] ?
          Object.values(catMap[cat].institutions).flat().some(it => isExcludedFromNetWorth(it)) : false,
        institutions: Object.entries(catMap[cat].institutions)
          .map(([name, its]) => ({
            name,
            items: its.sort((a, b) => Math.abs(getItemValue(b)) - Math.abs(getItemValue(a))),
            total: its.reduce((s, it) => s + getItemValue(it), 0),
          }))
          .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
      }))

    return { categories: ordered, totalAssets: totalA, totalDebt: totalD, currencyBreakdown: curBreak }
  }, [items, lang])

  const grandTotal = totalAssets - totalDebt
  const [collapsed, setCollapsed] = useState({})
  const [collapsedInst, setCollapsedInst] = useState({})
  const [editingItemId, setEditingItemId] = useState(null)
  const [blockMsg, setBlockMsg] = useState(null)
  const [saveMsg, setSaveMsg] = useState(null)

  const toggleCat = (key) => setCollapsed(p => ({ ...p, [key]: !p[key] }))
  const toggleInst = (key) => setCollapsedInst(p => ({ ...p, [key]: !p[key] }))

  const handleValueUpdate = useCallback((item, newVal) => {
    if (!onUpdateItem || !item.id) return
    if (isMarketAsset(item.type)) {
      const hasOpenLots = lots && lots.some(l =>
        (l.symbol || '').toUpperCase() === (item.symbol || '').toUpperCase() &&
        (l.institution || '') === (item.institution || '') &&
        l.status !== 'closed'
      )
      if (hasOpenLots) {
        setBlockMsg(lang === 'es'
          ? `${item.symbol}: cantidad controlada por lots: edita desde el detalle del activo`
          : `${item.symbol}: quantity managed by lots: edit from asset detail`)
        setTimeout(() => setBlockMsg(null), 4000)
        return
      }
      // The cell displays the total VALUE, so the user edits value — derive the
      // quantity from it at the current (raw-currency) price instead of making
      // them type a share count into a dollar-looking cell.
      const price = item._originalPrice ?? item.currentPrice ?? item.purchasePrice ?? 0
      if (!(price > 0)) {
        setBlockMsg(lang === 'es'
          ? `${item.symbol}: sin precio actual: no se puede derivar la cantidad`
          : `${item.symbol}: no current price: cannot derive quantity`)
        setTimeout(() => setBlockMsg(null), 4000)
        return
      }
      const cur = item._originalCurrency || item.currency || 'USD'
      const base = baseCurrency || 'USD'
      const valInOriginal = showOriginal ? newVal : (convert ? convert(newVal, base, cur) : newVal)
      onUpdateItem(item.id, { quantity: valInOriginal / price })
    } else {
      const qty = item.quantity || 1
      if (showOriginal) {
        onUpdateItem(item.id, { currentPrice: newVal / qty })
      } else {
        const cur = item._originalCurrency || item.currency || 'USD'
        const base = baseCurrency || 'USD'
        const originalVal = convert ? convert(newVal, base, cur) : newVal
        onUpdateItem(item.id, { currentPrice: originalVal / qty })
      }
    }
    setSaveMsg(lang === 'es' ? `${item.symbol || item.name}: guardado` : `${item.symbol || item.name}: saved`)
    setTimeout(() => setSaveMsg(null), 2000)
  }, [onUpdateItem, showOriginal, convert, baseCurrency, lots, lang])

  // CSV of the reconstructed monthly matrix — the dashboard export only covers
  // current items + transactions, not this per-month history.
  const handleExportCsv = useCallback(() => {
    const esc = (s) => {
      const str = String(s ?? '')
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
    }
    const rows = []
    rows.push([t('Categoría', 'Category'), t('Activo', 'Asset'), ...months].map(esc).join(','))
    categories.forEach(cat => {
      cat.institutions.forEach(inst => {
        inst.items.forEach(it => {
          const cells = months.map(mk => {
            if (mk === currentMonthKey) return getItemValue(it).toFixed(2)
            const v = historicalItems[mk]?.[it.id]?.value
            return v != null ? v.toFixed(2) : ''
          })
          rows.push([cat.label, it.symbol || it.name || '', ...cells].map(esc).join(','))
        })
      })
    })
    rows.push(['TOTAL', '', ...months.map(mk => {
      const v = mk === currentMonthKey ? grandTotal : monthlyTotals[mk]
      return v != null ? v.toFixed(2) : ''
    })].map(esc).join(','))
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chispudo-spreadsheet-${selectedYear}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [categories, months, currentMonthKey, historicalItems, monthlyTotals, grandTotal, selectedYear, lang])

  // Same data walk as the CSV, as a real workbook: month labels as headers,
  // numbers as numbers (not strings), fallback-month totals flagged with * and
  // a footnote. xlsx is already a dependency (dashboard export uses it).
  const handleExportXlsx = useCallback(async () => {
    const XLSX = await import('xlsx')
    const header = [t('Categoría', 'Category'), t('Activo', 'Asset'), ...months.map((mk) => getMonthLabel(mk, lang))]
    const rows = [header]
    categories.forEach(cat => {
      cat.institutions.forEach(inst => {
        inst.items.forEach(it => {
          const cells = months.map(mk => {
            if (mk === currentMonthKey) return Math.round(getItemValue(it) * 100) / 100
            const v = historicalItems[mk]?.[it.id]?.value
            return v != null ? Math.round(v * 100) / 100 : null
          })
          rows.push([cat.label, it.symbol || it.name || '', ...cells])
        })
      })
    })
    rows.push(['TOTAL', '', ...months.map(mk => {
      const v = mk === currentMonthKey ? grandTotal : monthlyTotals[mk]
      if (v == null) return null
      const rounded = Math.round(v * 100) / 100
      // Fallback months carry the snapshot NAV without per-item breakdown —
      // keep the asterisk convention from the on-screen table.
      return fallbackMonths.has(mk) ? `${rounded}*` : rounded
    })])
    if ([...fallbackMonths].some((mk) => months.includes(mk))) {
      rows.push([])
      rows.push([t('* Total del snapshot: sin desglose por categoría', '* Snapshot total: no per-category breakdown')])
    }
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 18 }, { wch: 22 }, ...months.map(() => ({ wch: 12 }))]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `${t('Matriz', 'Matrix')} ${selectedYear}`)
    XLSX.writeFile(wb, `chispudo-spreadsheet-${selectedYear}.xlsx`)
  }, [categories, months, currentMonthKey, historicalItems, monthlyTotals, grandTotal, fallbackMonths, selectedYear, lang])

  const isCurrentYear = selectedYear === now.getFullYear()
  const prevMonthKey = months.length >= 2 ? months[months.length - 2] : null
  const prevTotal = prevMonthKey ? monthlyTotals[prevMonthKey] : null
  const monthlyReturn = isCurrentYear && prevTotal && grandTotal > 0 ? ((grandTotal - prevTotal) / prevTotal) * 100 : null

  const janKey = `${selectedYear}-01`
  const janTotal = monthlyTotals[janKey]

  const currentItemIds = useMemo(() => new Set(items.map(it => it.id).filter(Boolean)), [items])

  const removedItems = useMemo(() => {
    const found = {}
    Object.entries(historicalItems).forEach(([mk, monthData]) => {
      Object.entries(monthData).forEach(([itemId, data]) => {
        if (!currentItemIds.has(itemId) && data.value != null) {
          if (!found[itemId]) found[itemId] = { symbol: data.symbol || itemId, months: {} }
          found[itemId].months[mk] = data.value
        }
      })
    })
    return Object.entries(found)
      .map(([id, info]) => ({ id, symbol: info.symbol, months: info.months }))
      .sort((a, b) => {
        const maxA = Math.max(...Object.values(a.months).map(Math.abs))
        const maxB = Math.max(...Object.values(b.months).map(Math.abs))
        return maxB - maxA
      })
  }, [historicalItems, currentItemIds])

  const [showRemoved, setShowRemoved] = useState(false)

  return (
    <div className="bg-[#f8fafc] border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-bold text-slate-900">{t('Portfolio Spreadsheet', 'Portfolio Spreadsheet')}</h2>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 rounded-md border border-slate-200 p-0.5">
            <button onClick={() => setShowOriginal(false)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${!showOriginal ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              {baseCurrency || 'USD'}
            </button>
            <button onClick={() => setShowOriginal(true)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${showOriginal ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              {t('Original', 'Original')}
            </button>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-md border border-slate-200 p-0.5">
            <button onClick={zoomOut} disabled={zoom <= ZOOM_LEVELS[0]}
              className="w-6 h-6 flex items-center justify-center text-xs rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              −
            </button>
            <span className="text-xs text-slate-400 w-8 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button onClick={zoomIn} disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              className="w-6 h-6 flex items-center justify-center text-xs rounded text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              +
            </button>
          </div>
          <div className="flex bg-slate-100 rounded-md border border-slate-200 p-0.5">
            {availableYears.map(y => (
              <button key={y} onClick={() => setSelectedYear(y)}
                className={`px-2 py-1 text-xs rounded transition-colors ${selectedYear === y ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                {y}
              </button>
            ))}
          </div>
          <button onClick={handleExportCsv}
            className="px-2.5 py-1 text-xs rounded-md border border-slate-200 bg-slate-100 text-slate-500 hover:bg-white hover:text-slate-900 transition-colors"
            title={t('Descargar la matriz mensual como CSV', 'Download the monthly matrix as CSV')}>
            CSV
          </button>
          <button onClick={handleExportXlsx}
            className="px-2.5 py-1 text-xs rounded-md border border-slate-200 bg-slate-100 text-slate-500 hover:bg-white hover:text-slate-900 transition-colors"
            title={t('Descargar la matriz mensual como Excel', 'Download the monthly matrix as Excel')}>
            Excel
          </button>
          {loadingHistory && (
            <span className="text-xs text-blue-500 animate-pulse">{t('Calculando historial...', 'Calculating history...')}</span>
          )}
          <span className="text-xs text-slate-400">{t('Click para editar', 'Click to edit')}</span>
        </div>
      </div>

      {blockMsg && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg text-xs font-medium animate-pulse"
          style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: '#eab308', border: '1px solid rgba(234,179,8,0.25)' }}>
          {blockMsg}
        </div>
      )}
      {saveMsg && !blockMsg && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ backgroundColor: 'rgba(52,211,153,0.1)', color: 'var(--accent-green)', border: '1px solid rgba(52,211,153,0.25)' }}>
          &#10003; {saveMsg}
        </div>
      )}
      <div className="overflow-x-auto">
        {/* CSS zoom (not transform: scale) — a transform creates a containing
            block that disables position:sticky on the name column at zoom ≠ 1. */}
        <div style={{ zoom }}>
        <table className="w-full text-sm border-collapse min-w-[600px]">
          <caption className="sr-only">{t('Valores históricos del portafolio por mes', 'Historical portfolio values by month')}</caption>
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50">
              <th scope="col" className="text-left py-2.5 pl-4 pr-2 text-slate-500 font-semibold text-xs uppercase tracking-wide sticky left-0 bg-slate-50 z-20 min-w-[140px] max-w-[200px]" />
              <th scope="col" className="text-right py-2.5 px-1 text-slate-400 font-semibold text-xs w-8">%</th>
              {showOriginal && <th scope="col" className="text-center py-2.5 px-1 text-slate-400 font-semibold text-xs w-10">{t('Mon', 'Cur')}</th>}
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                return (
                  <th scope="col" key={mk} className="text-right py-2.5 px-2 font-semibold text-xs w-32" style={isCurrent ? { backgroundColor: '#eff6ff', color: 'var(--accent-blue-strong)' } : { color: '#94a3b8' }}>
                    {getMonthLabel(mk, lang)}
                    {isCurrent && <div className="text-xs font-normal text-blue-400">{t('actual', 'current')}</div>}
                  </th>
                )
              })}
            </tr>
          </thead>

          {categories.map(cat => {
            const pct = grandTotal !== 0 ? (cat.total / grandTotal) * 100 : 0
            const isCollapsed = collapsed[cat.key]
            const accent = CATEGORY_ACCENT[cat.key] || '#64748b'

            return (
              <tbody key={cat.key}>
                <tr className="cursor-pointer hover:bg-slate-100 transition-colors border-t border-slate-200 bg-white"
                  onClick={() => toggleCat(cat.key)}>
                  <td className="py-3 pl-4 pr-2 sticky left-0 bg-white z-10" style={{ borderLeft: `3px solid ${accent}` }}>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs w-3">{isCollapsed ? '>' : 'v'}</span>
                      <span className="text-slate-900 font-bold text-sm">{cat.label}</span>
                      <span className="text-slate-400 text-xs">({cat.institutions.reduce((s, i) => s + i.items.length, 0)})</span>
                      {cat.excludedFromTotal && <span className="text-xs text-cyan-500 ml-1">{t('(no incluido en total)', '(not in total)')}</span>}
                    </div>
                  </td>
                  <td className="text-right py-3 px-1 text-slate-500 font-semibold text-sm">{Math.abs(pct).toFixed(0)}%</td>
                  {showOriginal && <td className="text-center py-3 px-1 text-slate-400 text-xs">{baseCurrency || 'USD'}</td>}
                  {months.map(mk => {
                    const isCurrent = mk === currentMonthKey
                    if (isCurrent) {
                      return <td key={mk} className="text-right py-3 px-2 font-bold tabular-nums font-mono text-sm" style={{ backgroundColor: '#eff6ff', color: '#0f172a' }}>{formatCurrency(cat.total)}</td>
                    }
                    const histMonth = historicalItems[mk]
                    let catHistTotal = null
                    if (histMonth) {
                      catHistTotal = 0
                      cat.institutions.forEach(inst => {
                        inst.items.forEach(it => {
                          if (it.id && histMonth[it.id]) catHistTotal += histMonth[it.id].value || 0
                        })
                      })
                      Object.entries(histMonth).forEach(([itemId, data]) => {
                        if (!currentItemIds.has(itemId) && data.category === cat.key) {
                          catHistTotal += data.value || 0
                        }
                      })
                    }
                    if (catHistTotal != null && catHistTotal !== 0) {
                      return (
                        <td key={mk} className="text-right py-3 px-2 tabular-nums font-mono text-sm text-slate-600">
                          {formatNum(catHistTotal)}
                        </td>
                      )
                    }
                    // No real per-item history for this category/month → show a dash
                    // instead of a pro-rata estimate. The platform must not invent
                    // historical values (e.g. cash balances have no price history).
                    return (
                      <td key={mk} className="text-right py-3 px-2 tabular-nums font-mono text-sm" style={{ color: '#cbd5e1' }}>
                        -
                      </td>
                    )
                  })}
                </tr>

                {!isCollapsed && cat.institutions.map(inst => {
                  const instKey = `${cat.key}:${inst.name}`
                  const isInstCollapsed = collapsedInst[instKey]
                  const showInst = inst.items.length > 1

                  const instCurrencies = [...new Set(inst.items.map(it => it._originalCurrency || it.currency || 'USD'))]
                  const singleCurrency = instCurrencies.length === 1 ? instCurrencies[0] : null
                  const instOrigTotal = showOriginal && singleCurrency
                    ? inst.items.reduce((s, it) => s + getOriginalValue(it), 0)
                    : null

                  return (
                    <Fragment key={instKey}>
                      {showInst && (
                        <tr className="cursor-pointer hover:bg-slate-50 transition-colors bg-white border-t border-slate-100"
                          onClick={() => toggleInst(instKey)}>
                          <td className="py-2 pl-8 pr-2 sticky left-0 bg-white z-10">
                            <span className="text-slate-700 font-semibold text-sm">{inst.name}</span>
                            <span className="text-slate-400 text-xs ml-1.5">{isInstCollapsed ? '>' : 'v'}</span>
                          </td>
                          <td />
                          {showOriginal && <td className="text-center py-2 px-1 text-slate-400 text-xs">
                            {singleCurrency || baseCurrency || 'USD'}
                          </td>}
                          {months.map(mk => {
                            const isCurrent = mk === currentMonthKey
                            const displayVal = showOriginal && instOrigTotal != null ? instOrigTotal : inst.total
                            if (isCurrent) {
                              return <td key={mk} className="text-right py-2 px-2 font-medium tabular-nums font-mono text-sm" style={{ backgroundColor: '#eff6ff', color: '#334155' }}>{formatNum(displayVal)}</td>
                            }
                            const histMonth = historicalItems[mk]
                            let instHistTotal = null
                            if (histMonth) {
                              instHistTotal = 0
                              inst.items.forEach(it => {
                                if (it.id && histMonth[it.id]) instHistTotal += histMonth[it.id].value || 0
                              })
                            }
                            return (
                              <td key={mk} className="text-right py-2 px-2 font-medium tabular-nums font-mono text-sm text-slate-500">
                                {instHistTotal != null ? formatNum(instHistTotal) : ''}
                              </td>
                            )
                          })}
                        </tr>
                      )}

                      {(!showInst || !isInstCollapsed) && inst.items.map((item, idx) => {
                        const val = itemValue(item)
                        const cur = itemCurrency(item)
                        const market = isMarketAsset(item.type)
                        const qty = item.quantity || 0
                        const qtyLabel = market && qty ? qty.toLocaleString(undefined, { maximumFractionDigits: 4 }) : null
                        // The cell shows the total value, so the editor edits value
                        // too (quantity is derived from the price on save).
                        const editVal = Math.abs(val).toFixed(2)
                        const rawPrice = item._originalPrice ?? item.currentPrice ?? item.purchasePrice ?? 0
                        const valToOriginal = (v) => showOriginal ? v : (convert ? convert(v, baseCurrency || 'USD', itemCurrency(item)) : v)
                        const livePreview = market && rawPrice > 0
                          ? (v) => `≈ ${(valToOriginal(v) / rawPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${item.symbol || ''}`
                          : null
                        const editLabel = t(`Valor de ${item.symbol || item.name || ''}`, `Value of ${item.symbol || item.name || ''}`)
                        const isEditing = editingItemId === item.id
                        const rowStyle = isEditing ? { backgroundColor: '#eff6ff', boxShadow: 'inset 0 0 0 2px #93c5fd' } : { backgroundColor: '#ffffff' }
                        const stickyStyle = isEditing ? { backgroundColor: '#eff6ff' } : { backgroundColor: '#ffffff' }
                        return (
                          <Fragment key={item.id || idx}>
                          <tr className="hover:bg-slate-50 transition-colors border-t border-slate-100/60" style={rowStyle}>
                            <td className={`py-2.5 ${showInst ? 'pl-12' : 'pl-8'} pr-2 sticky left-0 z-10`} style={stickyStyle}>
                              <div className="flex items-center gap-2 min-w-0">
                                {onEditItem ? (
                                  <button className="text-sm truncate text-left hover:underline transition-colors" style={{ color: isEditing ? '#1d4ed8' : '#1e293b', fontWeight: isEditing ? 600 : undefined }} onClick={(e) => { e.stopPropagation(); onEditItem(item) }}>
                                    {item.name || item.symbol}
                                  </button>
                                ) : (
                                  <span className="text-sm truncate" style={{ color: isEditing ? '#1d4ed8' : '#1e293b', fontWeight: isEditing ? 600 : undefined }}>{item.name || item.symbol}</span>
                                )}
                                {qtyLabel && (
                                  <span className="text-slate-400 text-xs shrink-0">{qtyLabel}</span>
                                )}
                                <span className="text-xs font-semibold shrink-0" style={{ color: isEditing ? '#3b82f6' : '#94a3b8' }}>{cur}</span>
                                {item.rewardType && REWARD_ICONS[item.rewardType] && (
                                  <span className="text-xs bg-cyan-50 text-cyan-600 px-1 rounded shrink-0" title={item.rewardType}>
                                    {REWARD_ICONS[item.rewardType]}
                                  </span>
                                )}
                                {item.isReceivable && !item.countInNetWorth && (
                                  <span className="text-xs text-cyan-400 shrink-0">*</span>
                                )}
                              </div>
                            </td>
                            <td />
                            {showOriginal && <td className="text-center py-2.5 px-1 text-xs" style={{ color: isEditing ? '#3b82f6' : '#94a3b8', fontWeight: isEditing ? 600 : undefined }}>{cur}</td>}
                            {months.map(mk => {
                              const isCurrent = mk === currentMonthKey
                              if (!isCurrent) {
                                const histMonth = historicalItems[mk]
                                const cell = histMonth && item.id ? histMonth[item.id] : null
                                const histVal = cell?.value ?? null
                                const isEst = histVal != null && cell?.estimated
                                return (
                                  <td key={mk} className="text-right py-2.5 px-2 tabular-nums font-mono text-sm" style={{ color: histVal != null ? '#64748b' : '#cbd5e1' }}>
                                    {histVal != null ? (
                                      <>
                                        {isEst && (
                                          <span title={t('Valor estimado: mantenido plano; sin precio histórico real', 'Estimated: held flat; no real historical price')} style={{ color: '#cbd5e1', marginRight: '1px' }}>~</span>
                                        )}
                                        {formatNum(histVal)}
                                      </>
                                    ) : '-'}
                                  </td>
                                )
                              }
                              return (
                                <td key={mk} className="text-right py-1 px-1" style={{ backgroundColor: isEditing ? '#dbeafe' : '#eff6ff' }}>
                                  {onUpdateItem ? (
                                    <EditableCell
                                      displayValue={val}
                                      editValue={editVal}
                                      onSave={(v) => handleValueUpdate(item, v)}
                                      editLabel={editLabel}
                                      livePreview={livePreview}
                                      isNegative={val < 0}
                                      currency={cur}
                                      onEditStart={() => setEditingItemId(item.id)}
                                      onEditEnd={() => setEditingItemId(null)}
                                    />
                                  ) : (
                                    <span className="font-mono tabular-nums text-sm font-medium" style={val < 0 ? { color: '#dc2626' } : { color: '#1e293b' }}>
                                      {formatNum(val)}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                          {(item.isDebt || item.isReceivable) && (item.debtTerm || item.interestRate || item.monthlyPayment || item.installmentsRemaining) && (
                            <tr className="bg-slate-50/50 border-t-0">
                              <td className={`py-0.5 ${showInst ? 'pl-12' : 'pl-8'} pr-2 sticky left-0 bg-slate-50/50 z-10`} colSpan={2 + (showOriginal ? 1 : 0) + months.length}>
                                <div className="flex items-center gap-3 text-xs text-slate-400">
                                  {item.debtTerm && <span>{DEBT_TERM_LABELS[item.debtTerm] || item.debtTerm}</span>}
                                  {item.interestRate > 0 && <span>{item.interestRate}% {t('int.', 'int.')}</span>}
                                  {item.monthlyPayment > 0 && <span>${item.monthlyPayment.toLocaleString()}/{t('mes', 'mo')}</span>}
                                  {item.installmentsRemaining > 0 && (
                                    <span>{item.installmentsRemaining} {t('cuotas rest.', 'pmts left')}</span>
                                  )}
                                  {item.maturityDate && <span>{t('Vence', 'Due')}: {item.maturityDate}</span>}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            )
          })}

          {removedItems.length > 0 && (
            <tbody>
              <tr className="cursor-pointer hover:bg-amber-50/50 transition-colors border-t-2 border-dashed border-slate-300 bg-slate-50"
                onClick={() => setShowRemoved(p => !p)}>
                <td className="py-2.5 pl-4 pr-2 sticky left-0 bg-slate-50 z-10" colSpan={2 + (showOriginal ? 1 : 0)}>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs w-3">{showRemoved ? 'v' : '>'}</span>
                    <span className="text-slate-500 font-semibold text-xs">{t('Activos anteriores', 'Previous assets')}</span>
                    <span className="text-slate-400 text-xs">({removedItems.length})</span>
                  </div>
                </td>
                {months.map(mk => (
                  <td key={mk} className="py-2.5 px-2" style={mk === currentMonthKey ? { backgroundColor: '#eff6ff' } : undefined} />
                ))}
              </tr>
              {showRemoved && removedItems.map(ri => (
                <tr key={ri.id} className="bg-amber-50/30 hover:bg-amber-50/60 transition-colors border-t border-slate-100/60">
                  <td className="py-2 pl-8 pr-2 sticky left-0 bg-amber-50/30 z-10">
                    <span className="text-slate-500 text-sm">{ri.symbol}</span>
                  </td>
                  <td />
                  {showOriginal && <td />}
                  {months.map(mk => {
                    const isCurrent = mk === currentMonthKey
                    const val = ri.months[mk]
                    return (
                      <td key={mk} className="text-right py-2 px-2 tabular-nums font-mono text-sm" style={isCurrent ? { backgroundColor: '#eff6ff', color: '#cbd5e1' } : { color: val != null ? '#64748b' : '#cbd5e1' }}>
                        {isCurrent ? '-' : val != null ? formatNum(val) : '-'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          )}

          <tfoot>
            {Object.entries(currencyBreakdown)
              .sort((a, b) => b[1].usd - a[1].usd)
              .map(([cur, data]) => {
                const pct = grandTotal > 0 ? (data.usd / grandTotal) * 100 : 0
                const displayVal = showOriginal ? data.original : data.usd
                const rate = data.original > 0 && cur !== 'USD' ? (data.usd / data.original) : null
                return (
                  <tr key={cur} className="text-slate-400 border-t border-slate-100 bg-white">
                    <td className="py-1.5 pl-8 pr-2 sticky left-0 bg-white z-10 text-xs">
                      {cur}
                      {showOriginal && rate != null && (
                        <span className="text-slate-300 ml-1.5">1 {cur} = {rate.toFixed(4)} USD</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-1 text-xs">{pct.toFixed(0)}%</td>
                    {showOriginal && <td className="text-center py-1.5 px-1 text-xs">{cur}</td>}
                    {months.map(mk => {
                      const isCurrent = mk === currentMonthKey
                      return (
                        <td key={mk} className="text-right py-1.5 px-2 text-xs tabular-nums font-mono" style={isCurrent ? { backgroundColor: '#eff6ff' } : undefined}>
                          {isCurrent ? formatNum(displayVal) : ''}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}

            <tr className="border-t-2 border-slate-300 bg-slate-100">
              <td className="py-3.5 pl-4 pr-2 sticky left-0 bg-slate-100 z-10">
                <span className="text-slate-900 font-black text-base">TOTAL</span>
                {showOriginal && (
                  <span className="text-slate-400 text-xs ml-2 font-normal">({baseCurrency || 'USD'})</span>
                )}
              </td>
              <td className="text-right py-3.5 px-1 text-slate-700 font-bold text-sm">100%</td>
              {showOriginal && <td className="text-center py-3.5 px-1 text-slate-500 font-bold text-xs">{baseCurrency || 'USD'}</td>}
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                const isFallback = !isCurrent && val != null && fallbackMonths.has(mk)
                return (
                  <td key={mk} className="text-right py-3.5 px-2 font-black tabular-nums font-mono text-base" style={isCurrent ? { backgroundColor: '#eff6ff', color: '#0f172a' } : { color: val ? '#475569' : '#cbd5e1' }}
                    title={isFallback ? t('Valor total del snapshot (sin desglose por categoría para este mes)', 'Snapshot total (no per-category breakdown for this month)') : undefined}>
                    {val ? formatCurrency(val) : '-'}{isFallback ? <span style={{ color: '#94a3b8' }}>*</span> : null}
                  </td>
                )
              })}
            </tr>

            {months.length >= 2 && (
              <tr className="bg-white border-t border-slate-100">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-white z-10 text-slate-500 text-xs">
                  {t('Retorno Mensual (bruto)', 'Monthly Return (gross)')}
                </td>
                <td />
                {showOriginal && <td />}
                {months.map((mk, i) => {
                  const isCurrent = mk === currentMonthKey
                  const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                  const prevMk = i > 0 ? months[i - 1] : null
                  const prevVal = prevMk ? (prevMk === currentMonthKey ? grandTotal : (monthlyTotals[prevMk] || null)) : null
                  const ret = val && prevVal && prevVal > 0 ? ((val - prevVal) / prevVal) * 100 : null
                  return (
                    <td key={mk} className="text-right py-2 px-2 text-sm tabular-nums font-mono" style={isCurrent ? { backgroundColor: '#eff6ff' } : undefined}>
                      {ret != null ? (
                        <span className="font-semibold" style={{ color: ret >= 0 ? '#059669' : '#dc2626' }}>
                          {ret >= 0 ? '+' : ''}{ret.toFixed(1)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
            {returnYTD != null && (
              <tr className="bg-white border-t border-slate-100">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-white z-10 text-slate-500 text-xs">
                  Return YTD
                </td>
                <td />
                {showOriginal && <td />}
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  return (
                    <td key={mk} className="text-right py-2 px-2 text-sm tabular-nums font-mono" style={isCurrent ? { backgroundColor: '#eff6ff' } : undefined}>
                      {isCurrent ? (
                        <span className="font-semibold" style={{ color: returnYTD >= 0 ? '#059669' : '#dc2626' }}>
                          {returnYTD >= 0 ? '+' : ''}{returnYTD.toFixed(2)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
            {janTotal && grandTotal > 0 && (
              <tr className="bg-white border-t border-slate-100">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-white z-10 text-slate-500 text-xs">
                  {t('Crecimiento Portafolio', 'Portfolio Growth')}
                </td>
                <td />
                {showOriginal && <td />}
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                  const growth = val && janTotal > 0 ? ((val - janTotal) / janTotal) * 100 : null
                  return (
                    <td key={mk} className="text-right py-2 px-3 text-sm tabular-nums font-mono" style={isCurrent ? { backgroundColor: '#eff6ff' } : undefined}>
                      {growth != null ? (
                        <span className="font-semibold" style={{ color: growth >= 0 ? '#059669' : '#dc2626' }}>
                          {growth >= 0 ? '+' : ''}{growth.toFixed(0)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
          </tfoot>
        </table>
        </div>
        {months.some(mk => mk !== currentMonthKey && monthlyTotals[mk] != null && fallbackMonths.has(mk)) && (
          <p className="text-xs px-4 py-2" style={{ color: '#94a3b8' }}>
            * {t('Total del snapshot de ese mes: aún sin desglose por categoría (las filas muestran "-").',
                 'Snapshot total for that month: no per-category breakdown yet (rows show "-").')}
          </p>
        )}
        {hasEstimated && (
          <p className="text-xs px-4 py-2" style={{ color: '#94a3b8' }}>
            ~ {t('Valor estimado: reconstruido manteniendo el saldo/posición plano (sin precio histórico de mercado).',
                 'Estimated: reconstructed by holding the balance/position flat (no historical market price).')}
          </p>
        )}
      </div>
    </div>
  )
}
