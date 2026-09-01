'use client'

import { useState, useMemo, useRef, useEffect, useCallback, Fragment, memo } from 'react'
import { ZoomIn, ZoomOut, FileText, FileSpreadsheet, RefreshCw } from 'lucide-react'
import ChispudoLoader from '@/components/ui/ChispudoLoader'
import { todayLocalISO } from '@/lib/localDate'
import { formatCurrency, getItemValue, getTypeCategory, isExcludedFromNetWorth, isBankLike, TYPE_COLORS, BROKER_NAV_SOURCES, DEBT_CLARIFICATION, CATEGORY_ORDER } from './utils'
import { toRawItem } from '@/lib/rawItem'
import { planCellEdit, editNeedsAnswer, accruesInBalance, canRecordFlow, ANSWER_CORRECTION, ANSWER_RETURN, ANSWER_FLOW } from '@/lib/spreadsheetEdit'
import { balanceDiagnostic, balanceDiagnosticText } from '@/lib/balanceDiagnostic'
import { buildSheetDebtPaymentTransaction } from '@/lib/transferTx'
import { debtBreakdown, debtMonthlyRate } from '@/lib/debtMath'
import { InfoTip } from '../ui/Tooltip'
import { yearEndMonthKeys } from '@/lib/yearOverYear'
import { stripStaleIbkrEntries } from '@/lib/spreadsheetSanitize'
// El MISMO parser que usa todo camino de import. Su cabecera documenta por qué
// existe: las implementaciones por archivo convertían "150,25" en 15025 y
// "1.234,56" en 1.23456, y esos números pasaban validación y aterrizaban en
// Firestore como el dinero real del usuario. Esta celda era el último lugar con
// su propio regex ingenuo.
import { parseAmount } from '@/lib/numberParse'
// El formato del .xlsx, compartido con el adjunto del correo mensual. El
// módulo no arrastra ExcelJS hasta que se llama (import dinámico adentro).
import { renderStyledSheet } from '@/lib/xlsxSheet'

// Must match lib/historicalValues.js's IBKR_UNKNOWN_KEY_PREFIX exactly — not
// imported statically because that file pulls in authFetch → Firebase Auth,
// which breaks under Jest (same reason lib/yearOverYear.js has no imports).
// getHistoricalItemValues is already only ever reached via dynamic import
// below, so this file never actually needs the live binding, just the string.
const IBKR_UNKNOWN_KEY_PREFIX = '__ibkr_unknown__'

// CATEGORY_ORDER ahora viene de utils (compartido con el spreadsheet adjunto
// del correo mensual). CATEGORY_LABELS se queda local A PROPÓSITO: diverge del
// mapa compartido adrede ("Bonos Corporativo", "Bolsa de Valores").
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
  banks: 'var(--text-muted)',
  funds: '#818cf8',
  stocks: 'var(--accent-blue)',
  crypto: '#f97316',
  alternatives: '#a78bfa',
  bonds: 'var(--alert-warn-icon)',
  realestate: 'var(--accent-green)',
  receivables: '#06b6d4',
  debts: 'var(--text-negative)',
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

// Toolbar segmented-control pill states (currency, zoom omitted since it has
// no "active" state, year). Static objects, not computed per render — module
// scope keeps them out of the component's render path entirely. Colors go
// through the app's theme variables (app/globals.css), same convention
// AssetAllocation's own segmented control already uses, so the pill actually
// follows dark mode instead of staying pinned to white/navy (FASE EV).
const pillActiveStyle = { backgroundColor: 'var(--bg-card)', color: 'var(--accent-blue-strong)', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.06)' }
const pillInactiveStyle = { color: 'var(--text-muted)' }

// The "current month" column tint and the "actively editing" cell tint used
// throughout the table body below. color-mix scales each against its own
// theme's card surface instead of a value baked for light mode only (the
// #eff6ff/#dbeafe this replaces were exactly that: fine in light, a flat
// pale-blue square floating on a dark card in dark mode).
const CURRENT_COL_BG = 'color-mix(in srgb, var(--accent-blue) 8%, var(--bg-card))'
const EDITING_CELL_BG = 'color-mix(in srgb, var(--accent-blue) 16%, var(--bg-card))'

function getMonthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthEndOf(mk) { const [y, m] = mk.split('-').map(Number); return Date.UTC(y, m, 0) }

// Same "when did this item start existing" fallback historicalValues.js uses
// (acquisitionDate, else Jan 1 of its add-year) — shared here so the missing-
// months detector below knows which items are even ELIGIBLE for a given month
// instead of just counting raw coverage.
function effAcqTs(it) {
  const a = it.acquisitionDate ? Date.parse(it.acquisitionDate) : NaN
  if (!isNaN(a)) return a
  const c = it.createdAt ? new Date(it.createdAt) : null
  return c && !isNaN(c.getTime()) ? Date.UTC(c.getUTCFullYear(), 0, 1) : null
}

function getMonthLabel(key, lang) {
  const [y, m] = key.split('-')
  const d = new Date(parseInt(y), parseInt(m) - 1, 1)
  const label = d.toLocaleDateString(lang === 'es' ? 'es' : 'en', { month: 'short' })
  return label.charAt(0).toUpperCase() + label.slice(1) + ' ' + y.slice(2)
}

// FASE ER. A year-over-year column's key is still "YYYY-MM" under the hood
// (December, or currentMonthKey for the year in progress) — same shape every
// other helper here already expects — but it should READ as just the year.
function getColumnLabel(key, lang, viewMode) {
  if (viewMode === 'yoy') return key.split('-')[0]
  return getMonthLabel(key, lang)
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

const EditableCell = memo(function EditableCell({ displayValue, editValue, onSave, onReject, hint, editLabel, livePreview, isNegative, currency, onEditStart, onEditEnd }) {
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
    // `parseAmount` lee las dos convenciones latinoamericanas (punto y coma
    // decimal). El regex viejo (`replace(/[^0-9.\-]/g, '')`) dejaba "12.500,00"
    // como "12.500.00", que parseFloat resuelve a 12.5: doce con cincuenta en
    // vez de doce mil quinientos, guardado con el banner verde de confirmación.
    const num = parseAmount(draft)
    // Same ceiling as file imports (lib/validation MAX_PRICE) — inline edits
    // shouldn't be the one door where absurd values slip in.
    if (isFinite(num) && num >= 0 && num <= 10_000_000) {
      onSave(num)
    } else if (String(draft).trim() !== '') {
      // Un valor rechazado se descartaba en SILENCIO absoluto: el popover se
      // cerraba y el número viejo seguía ahí. Una deuda tecleada en negativo o
      // un inmueble sobre el tope se leían como "no pasó nada".
      onReject?.(num)
    }
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
        <div className="absolute right-0 top-0 z-30 min-w-[190px] bg-theme-card border-2 border-blue-400 rounded-lg shadow-lg p-2">
          {editLabel && <p className="text-xs text-right mb-1 font-medium" style={{ color: 'var(--accent-blue)' }}>{editLabel}</p>}
          <div className="flex items-center gap-1">
            {currency && <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--accent-blue)' }}>{currency}</span>}
            <input ref={ref} type="text" value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
              className="w-full bg-theme-input border border-blue-300 rounded px-2 py-1.5 text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-300" style={{ color: 'var(--text-primary)' }} />
          </div>
          {livePreview && isFinite(draftNum) && (
            <p className="text-xs text-right mt-1" style={{ color: 'var(--accent-blue-soft)' }}>{livePreview(draftNum)}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="cursor-pointer rounded px-3 py-1.5 -mx-1 transition-all hover:bg-[var(--alert-info-bg)] hover:ring-1 hover:ring-[var(--accent-blue-soft)] text-right"
      onClick={startEdit}>
      <span className="font-mono tabular-nums text-sm" style={isNegative ? { color: 'var(--text-negative)' } : { color: 'var(--text-primary)' }}>{formatNum(displayValue)}</span>
      {currency && <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>{currency}</span>}
      {hint && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  )
})

export default function PortfolioSpreadsheet({ items, snapshots, lang, onUpdateItem, onEditItem, onAddTransaction, returnYTD, netWorth, convert, baseCurrency, onSaveItemSnapshots, onLoadItemSnapshots, lots, transactions, onRegisterRecalculate }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [showOriginal, setShowOriginal] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const historyFetchedRef = useRef(false)

  // 0.5/0.6 added below the old 0.75 floor so a full year (12 monthly columns,
  // or all 6 year-over-year columns) can fit on screen without horizontal
  // scroll on a normal laptop width — 75% alone still clipped Oct-Dec.
  const ZOOM_LEVELS = [0.5, 0.6, 0.75, 0.875, 1, 1.125, 1.25]
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

  // The earliest year the picker offers must reflect what history actually
  // EXISTS, not just what an item's own date claims — a Flex Query import or a
  // transcribed quarterly NAV can reach back further than any single item's
  // acquisitionDate (which, for IBKR items, is often just the sync date and
  // unreliable anyway). Without this, importing years of real history left the
  // year selector still capped at whatever the items themselves implied.
  const earliestYear = useMemo(() => {
    let earliest = now.getFullYear() - 1
    items.forEach(it => {
      const dateStr = it.acquisitionDate || it.createdAt
      if (dateStr) {
        const y = new Date(dateStr).getFullYear()
        if (y >= 2000 && y < earliest) earliest = y
      }
    })
    ;(snapshots || []).forEach(s => {
      if (!s || !s.date) return
      const y = new Date(s.date).getFullYear()
      if (y >= 2000 && y < earliest) earliest = y
    })
    return earliest
  }, [items, snapshots])

  const availableYears = useMemo(() => {
    const years = []
    for (let y = earliestYear; y <= now.getFullYear(); y++) years.push(y)
    return years
  }, [earliestYear])

  const [selectedYear, setSelectedYear] = useState(now.getFullYear())

  // 'monthly' = the existing month-by-month matrix for one year. 'yoy' = one
  // column per YEAR instead, reusing every row/footer/export below unchanged
  // (see the `months` branch right below): the whole rest of this component
  // only ever asks "what does historicalItems/monthlyTotals say for column
  // key mk, and is mk === currentMonthKey", so handing it year-end keys
  // instead of month keys is enough to turn the exact same table into a
  // year-over-year view, no second render tree needed (FASE ER).
  const [viewMode, setViewMode] = useState('monthly')

  const months = useMemo(() => {
    if (viewMode === 'yoy') return yearEndMonthKeys(availableYears, currentMonthKey)
    const result = []
    const endMonth = selectedYear === now.getUTCFullYear() ? now.getUTCMonth() : 11
    for (let m = 0; m <= endMonth; m++) {
      result.push(getMonthKey(new Date(Date.UTC(selectedYear, m, 1))))
    }
    return result
  }, [selectedYear, viewMode, availableYears, currentMonthKey])

  const [historicalItems, setHistoricalItems] = useState({})

  // Las keys de bucket sintético que un item de IBKR VIVO produciría hoy. Se
  // arma con la misma expresión que `cacheKeyFor` (más abajo) para que no puedan
  // derivar: si esa cambia, esta tiene que cambiar con ella. La consumen el
  // TOTAL y las filas de categoría, que antes tenían reglas distintas sobre qué
  // entrada sin dueño cuenta.
  const liveIbkrBucketKeys = useMemo(() => new Set(
    (items || [])
      .filter((it) => it && it._source === 'ibkr')
      .map((it) => `${IBKR_UNKNOWN_KEY_PREFIX}${it.institution || ''}__${getTypeCategory(it)}`)
  ), [items])

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
          // Both a synced daily NAV and a transcribed quarterly one hold ONLY the
          // broker's slice (no manually-added assets), so both need the top-up below.
          ibkrSourceByMonth[key] = BROKER_NAV_SOURCES.includes(s._source)
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
        // FASE GN. Un cache entry sin dueño solo cuenta si es el bucket
        // sintético de IBKR (FASE FH) Y el portafolio TODAVÍA tiene items de
        // IBKR. Sin ese segundo requisito, borrar la cuenta desde Settings
        // dejaba las entradas huérfanas (ids de items borrados + el bucket)
        // sumando al TOTAL mientras las filas de categoría ya no las
        // renderizaban: TOTAL de abril $22,072 sobre categorías que sumaban
        // ~$12.4K, "el spreadsheet no funciona" (reporte real, dos veces).
        // Borrar una cuenta = nunca aparece en el historial (FASE GL), y eso
        // incluye esta suma.
        // Y solo el bucket de una institución+categoría que TODAVÍA existe. La
        // key lleva el nombre de la institución adentro
        // (`__ibkr_unknown__{inst}__{cat}`), así que renombrar la cuenta de "IB"
        // a "Interactive Brokers" hace que el recompute escriba una key nueva y
        // el merge deje la vieja al lado. Sumando por prefijo se contaba el NAV
        // del broker DOS VECES en cada mes pasado, mientras la fila de
        // institución (que lee la key exacta) solo mostraba una: categorías
        // sumando menos que el TOTAL, la mecánica de FASE FT reabierta por una
        // acción normal del usuario en vez de un cambio de lógica.
        Object.entries(hist).forEach(([id, v]) => {
          if (seen.has(id)) return
          if (!liveIbkrBucketKeys.has(id)) return
          sum += v.value || 0
        })
        result[mk] = sum
      } else if (snapByMonth[mk] != null) {
        let total = snapByMonth[mk]
        if (ibkrSourceByMonth[mk] && nonIbkrItems.length) total += nonIbkrValueAtMonth(mk)
        result[mk] = total
      }
    })
    return result
  }, [snapshots, convert, baseCurrency, historicalItems, items, liveIbkrBucketKeys])

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
  // FASE EL. A plain count missed the exact case that started this: editing a
  // dividend's date/amount, or relinking it to a different account, changes
  // NOTHING about how many transactions exist — deleting one is the only edit
  // a length-based signature could ever catch. An in-place edit left the
  // spreadsheet's cache untouched and every past month kept showing the
  // pre-edit numbers ("cuando se intenta editar es cuando se pone loco").
  // Same fix as itemContentSig below, over the fields indexBalanceEvents
  // (historicalValues.js) actually reads to decide which transaction moves
  // which item's balance.
  const txSig = useMemo(() => (transactions || []).map(tx =>
    `${tx.id || ''}:${tx.type || ''}:${tx.date || ''}:${tx.totalAmount ?? tx.amount ?? 0}:${tx.currency || ''}:${tx._linkedItemId || ''}:${tx._destinationItemId || ''}`
  ).sort().join('|'), [transactions])
  // Same reasoning as txSig: editing a lot's quantity/acquisition/close date in
  // place doesn't change how many lots exist.
  const lotSig = useMemo(() => (lots || []).map(l =>
    `${l.id || ''}:${l.symbol || ''}:${l.quantity || 0}:${l.acquisitionDate || ''}:${l.status || ''}:${l.closedDate || ''}`
  ).sort().join('|'), [lots])
  // Content signature over the edit-sensitive item fields. Counts alone miss in-place
  // edits (quantity/symbol/date/cost), which must invalidate the cached history or
  // past columns keep showing stale values. Live price ticks are deliberately
  // excluded (currentPrice changes constantly and doesn't affect reconstruction
  // inputs); purchasePrice uses the raw original so FX refreshes don't wipe it.
  const itemContentSig = useMemo(() => (items || []).map(it =>
    `${it.id}:${it.symbol || ''}:${it.quantity || 0}:${it._originalPurchasePrice ?? it.purchasePrice ?? 0}:${it.acquisitionDate || ''}`
  ).sort().join('|'), [items])
  // FASE EQ. This used to also do `setHistoricalItems({})` — wiping every
  // past-month column to blank the INSTANT any of these signatures changed,
  // even for an edit to a single dividend in one account. The recompute below
  // (a live fetch, sometimes seconds) then had to repopulate the WHOLE table
  // from nothing, so every edit made the spreadsheet flash to "-" across every
  // month and every row, reading as broken rather than as "updating" — exactly
  // the complaint ("se queda en blanco... da la sensación que no funciona").
  // The numbers on screen stay put now (briefly one edit stale, never wrong for
  // long) while `generation` tells the effect below which cached months are
  // still trustworthy; genuinely stale ones get silently replaced once the
  // live recompute lands, never blanked first. Skips its own mount (nothing
  // to invalidate yet, and bumping here would force every cold load into a
  // live recompute even when the Firestore cache is already sufficient).
  const contentMountedRef = useRef(false)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (!contentMountedRef.current) { contentMountedRef.current = true; return }
    lastFetchedYearRef.current = null
    setGeneration((g) => g + 1)
  }, [snapshotSig, txSig, lotSig, itemContentSig])

  // Ids de los items IBKR ACTUALES, leídos vía ref para que ninguno de los dos
  // merges de abajo tenga que depender de la identidad de `items` (la
  // enfermedad de FASE DW/DY: se recrea con cada tick de precio). Solo se usa
  // para sanear residuo del caché, nunca para decidir recomputos.
  const ibkrIdsRef = useRef(new Set())
  ibkrIdsRef.current = new Set((items || []).filter(it => it && it._source === 'ibkr').map(it => it.id))

  useEffect(() => {
    if (!onLoadItemSnapshots || months.length === 0) return
    const toLoad = months.filter(mk => mk !== currentMonthKey)
    if (toLoad.length === 0) return
    let cancelled = false
    const base = baseCurrency || 'USD'
    onLoadItemSnapshots(toLoad).then(data => {
      // Gate-opening comes FIRST, before every early return: the compute
      // effect below waits for this first settlement (cacheProbed) before
      // evaluating missingMonths on a cold mount, and it must open on EVERY
      // outcome (data, no data, cancelled mid-flight) or the spreadsheet
      // would sit on "-" forever waiting for an answer that already came.
      setCacheProbed(true)
      if (cancelled || !data) return
      const { __currencies = {}, ...monthData } = data
      setHistoricalItems(prev => {
        const next = { ...prev }
        toLoad.forEach(mk => {
          if (!monthData[mk]) delete next[mk]
        })
        Object.entries(monthData).forEach(([mk, itemsForMonth]) => {
          const savedCur = __currencies[mk]
          let entries = itemsForMonth
          if (savedCur && savedCur !== base && convert) {
            entries = Object.fromEntries(Object.entries(itemsForMonth).map(([id, v]) =>
              [id, { ...v, value: convert(v.value, savedCur, base) }]
            ))
          }
          // FASE FT: un doc que trae el bucket sintético de FH junto a las
          // acciones por-item cacheadas bajo la lógica anterior sumaría ambos
          // (la categoría al doble). El bump a v23 mata los docs ya
          // envenenados; esto evita que la misma mezcla vuelva a renderizar
          // doble si un merge futuro la recrea.
          next[mk] = stripStaleIbkrEntries(entries, ibkrIdsRef.current, IBKR_UNKNOWN_KEY_PREFIX)
        })
        return next
      })
      // Re-check "what's still missing" now that the cache landed, WITHOUT
      // making historicalItems itself a dependency of the compute effect (see
      // historicalItemsRef). One bump per resolved load, so the compute effect
      // gets its cache-first pass and then settles instead of restarting.
      setCacheEpoch((n) => n + 1)
    }).catch(() => {
      // A failed cache read (e.g. Firebase init hiccup) is not a reason to
      // never compute: open the gate so the live recompute takes over, same
      // as if the cache had answered empty.
      setCacheProbed(true)
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
      // El caché guarda MAGNITUDES; el signo lo aplica cada lector
      // (`monthlyTotals` acá, `lib/monthlySpreadsheet.js:143` del lado del
      // correo, y ambos con `(it.isDebt ? -1 : 1) * value`). El motor histórico
      // (`valueInBase`, lib/historicalValues.js) siempre escribió así.
      //
      // Este escritor era el único que guardaba el valor YA firmado, y como el
      // lector niega igual, la doble negación volvía la deuda POSITIVA: una
      // tarjeta de $5,000 inflaba el TOTAL de ese mes en $10,000. Solo se veía
      // en el mes recién cerrado (el mes en curso lee de `items`, no del
      // caché), y no se autocorregía nunca porque ese mes figura como completo
      // y jamás se recomputa. De ahí el bump a SNAPSHOT_VERSION: los docs ya
      // escritos con signo no se reparan por merge.
      const val = it.isDebt ? -getItemValue(it) : getItemValue(it)
      if (it.id) data[it.id] = { value: val, symbol: it.symbol || it.name || '', category: getTypeCategory(it), institution: it.institution || '' }
    })
    onSaveItemSnapshots(currentMonthKey, data, baseCurrency || 'USD')
  }, [onSaveItemSnapshots, items, currentMonthKey, baseCurrency])

  // What the compute effect below READS to decide which months are missing, kept
  // in a ref on purpose. `historicalItems` cannot be a dependency of that effect:
  // the effect itself calls setHistoricalItems, and the load-from-cache effect
  // above sets it too, so every write re-ran the effect and its cleanup marked
  // the in-flight fetch `cancelled` — which returns BEFORE setLoadingHistory
  // (false) and before lastFetchedYearRef is stamped. The result was a fetch that
  // restarted forever: "Calculando historial..." pinned on screen and every past
  // month stuck on "-" (FASE DW). The 70% coverage bar used to paper over this by
  // emptying missingMonths almost immediately; the stricter per-item test of FASE
  // DS removed that accident and exposed the real loop.
  const historicalItemsRef = useRef({})
  useEffect(() => { historicalItemsRef.current = historicalItems }, [historicalItems])
  const [cacheEpoch, setCacheEpoch] = useState(0)
  // FASE FO. Has the Firestore itemSnapshots cache had its FIRST chance to
  // answer? On a cold mount the compute effect below used to evaluate
  // missingMonths against a still-empty historicalItemsRef IN PARALLEL with
  // the cache read: with a slow network the fetch got discarded when the
  // cache's epoch bump re-ran the effect (a wasted Yahoo/CoinGecko call every
  // cold load), and with a FAST network the fetch landed first, stamped
  // lastFetchedYearRef, and an empty cache answer then DELETED those freshly
  // computed months with no recompute ever coming (the fetchKey guard was
  // already stamped): past months stuck on "-". Waiting for the first
  // settlement makes the order deterministic: cache always answers first,
  // then one recompute for whatever is genuinely missing. Opens exactly once
  // (success, empty, rejection or cancelled alike) and never closes again,
  // so every later interaction (year switch, edits, epoch bumps) behaves
  // exactly as before this fix. State, not a ref, on purpose: the false->true
  // transition must re-run the compute effect even when the cache resolves
  // without bumping cacheEpoch (no data / rejection).
  const [cacheProbed, setCacheProbed] = useState(false)
  // FASE EQ. Which generation each month's cached data was last LIVE-recomputed
  // at — the freshness half of the fix above. Only the live recompute below
  // tags a month here, never the Firestore cache-load effect: a month loaded
  // from Firestore after an edit (e.g. switching to a year not touched yet) must
  // still count as stale and get recomputed, exactly like today, just without
  // ever blanking the screen to get there. generation stays 0 until the first
  // real edit, so cold mount (nothing to distrust yet) is untouched — the
  // presence-only check below is exactly what ran before this fix.
  const monthGenRef = useRef({})

  // yoy's target months don't depend on selectedYear at all (every year
  // shows at once), so it gets its own constant key — without this, toggling
  // INTO yoy right after monthly had already finished fetching selectedYear
  // made this guard think "nothing to do" and yoy's December columns never
  // fetched at all.
  const fetchKey = viewMode === 'yoy' ? 'yoy' : `monthly:${selectedYear}`

  useEffect(() => {
    if (!items || items.length === 0) return
    if (!onSaveItemSnapshots) return
    if (lastFetchedYearRef.current === fetchKey) return
    // IBKR items are reconstructed from equity snapshots — wait for them to load
    // before computing/caching, so we never bake unscaled values into the cache.
    const hasIBKR = items.some(it => it._source === 'ibkr')
    if (hasIBKR && (!snapshots || snapshots.length === 0)) return
    const pastMonths = months.filter(mk => mk !== currentMonthKey)
    if (pastMonths.length === 0) return
    // Cold-mount gate (FASE FO, see cacheProbed above): don't evaluate
    // missingMonths, flip the spinner, or fire the network fetch until the
    // Firestore cache had its first chance to answer. Callers with no cache
    // wired (no onLoadItemSnapshots prop) skip the wait entirely. The prop is
    // read but deliberately NOT a dependency: this effect keys off content
    // signatures, never identities (see the dep-array comment below), and
    // cacheProbed alone drives the one re-run this gate needs.
    if (onLoadItemSnapshots && !cacheProbed) return

    const itemsWithIds = items.filter(it => it.id)

    // A month needs (re)fetching if ANY item that already existed by that
    // month's end is missing from the cache — never a blanket percentage of
    // the whole portfolio. A percentage bar let one item added after the rest
    // (e.g. a bond added months later, alongside its own destination account)
    // get stuck uncovered forever: the other 80-90% of the portfolio already
    // "passed" that month, so it was never marked missing and never re-fetched
    // (FASE DS — this is what left Bonos Corporativos/VITALI blank for months
    // it demonstrably existed).
    // getHistoricalItemValues never writes an IBKR item under its OWN id (see
    // IBKR_UNKNOWN_KEY_PREFIX) — it collapses every IBKR position into one
    // synthetic per-institution bucket instead. Checking `monthData[it.id]`
    // for those items would never find anything, so every IBKR-eligible month
    // read as permanently "missing" and got re-fetched (and re-saved) on every
    // render that touched this effect's deps, however long it had already been
    // computed correctly — the cache literally could never catch up.
    const cacheKeyFor = (it) => it._source === 'ibkr'
      ? `${IBKR_UNKNOWN_KEY_PREFIX}${it.institution || ''}__${getTypeCategory(it)}`
      : it.id
    const cached = historicalItemsRef.current || {}
    const missingMonths = pastMonths.filter(mk => {
      if (generation > 0 && monthGenRef.current[mk] !== generation) return true
      const monthData = cached[mk]
      if (!monthData) return true
      const end = monthEndOf(mk)
      const eligible = itemsWithIds.filter(it => {
        const acq = effAcqTs(it)
        return acq == null || acq <= end
      })
      return eligible.some(it => !monthData[cacheKeyFor(it)])
    })
    if (missingMonths.length === 0) {
      lastFetchedYearRef.current = fetchKey
      return
    }
    setLoadingHistory(true)

    const itemsWithCategory = items.map(it => ({ ...it, _category: getTypeCategory(it) }))
    const fetchedKey = fetchKey

    let cancelled = false
    import('@/lib/historicalValues').then(({ getHistoricalItemValues }) => {
      getHistoricalItemValues(itemsWithCategory, missingMonths, convert, baseCurrency, lots, transactions, snapshots).then(async (data) => {
        if (cancelled) return
        lastFetchedYearRef.current = fetchedKey
        Object.keys(data).forEach((mk) => { monthGenRef.current[mk] = generation })
        setHistoricalItems(prev => {
          const merged = { ...prev }
          Object.entries(data).forEach(([mk, itemData]) => {
            // FASE FT: mismo saneo que el merge del caché. Si lo recién
            // computado trae el bucket sintético y `prev` traía las acciones
            // por-item del caché viejo, el merge crudo las sumaría doble.
            merged[mk] = stripStaleIbkrEntries(
              { ...(merged[mk] || {}), ...itemData },
              ibkrIdsRef.current,
              IBKR_UNKNOWN_KEY_PREFIX
            )
          })
          return merged
        })
        // The spinner is turned off BEFORE the cache writes: the numbers are
        // already on screen at this point, and letting a cancel mid-save skip
        // this line is what pinned "Calculando historial..." on forever.
        setLoadingHistory(false)
        for (const mk of Object.keys(data)) {
          if (Object.keys(data[mk]).length > 0) {
            try { await onSaveItemSnapshots(mk, data[mk], baseCurrency || 'USD') } catch {}
          }
        }
      }).catch(() => { setLoadingHistory(false) })
    }).catch(() => { setLoadingHistory(false) })
    return () => { cancelled = true }
    // Depends on CONTENT signatures, never on the array identities. `items`,
    // `transactions`, `snapshots` and `lots` get new identities on every price
    // tick and every Firestore event, and each re-run's cleanup marks the
    // in-flight fetch cancelled — which returns before setLoadingHistory(false)
    // and before lastFetchedYearRef is stamped, so the fetch restarted forever
    // and every past month stayed on "-" (FASE DY, the other half of DW). The
    // sigs deliberately exclude currentPrice, so a price refresh no longer
    // throws away work in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemContentSig, txSig, lotSig, snapshotSig, months, currentMonthKey, convert, baseCurrency, onSaveItemSnapshots, fetchKey, cacheEpoch, cacheProbed, generation])

  // "Recalcular": el MISMO cómputo del efecto de arriba, pero disparable y con
  // reporte.
  //
  // El efecto vive detrás de seis compuertas (cacheProbed, fetchKey, generation,
  // monthGenRef, missingMonths, lastFetchedYearRef) y no tiene ninguna señal
  // visible, así que desde afuera "recalculó y esta es la respuesta" y "nunca
  // recalculó" se ven idénticos. Es la lección de FASE HP: si el arreglo corre
  // en un efecto de fondo, hacerlo disparable y que DIGA qué hizo, en vez de
  // gastar otra ronda deduciéndolo de una captura.
  //
  // Dos diferencias con el efecto, las dos deliberadas:
  //  · recalcula TODOS los meses pasados, no solo los que faltan;
  //  · y por eso puede escribir con `replace`: conoce el mes completo, así que
  //    una entrada que ya no corresponde (un activo borrado, uno cuya fecha se
  //    movió hacia adelante) por fin desaparece. El efecto automático NO puede
  //    hacer eso: computa un subconjunto y borraría lo que no recomputó.
  const [recalcReport, setRecalcReport] = useState(null)
  const [recalculating, setRecalculating] = useState(false)

  const handleRecalculate = useCallback(async () => {
    if (recalculating) return
    const pastMonths = months.filter(mk => mk !== currentMonthKey)
    if (!onSaveItemSnapshots || !items || items.length === 0 || pastMonths.length === 0) {
      setRecalcReport({ error: t('No hay meses pasados que recalcular.', 'There are no past months to recompute.') })
      return
    }
    setRecalculating(true)
    setRecalcReport(null)
    try {
      const itemsWithCategory = items.map(it => ({ ...it, _category: getTypeCategory(it) }))
      const diag = {}
      const { getHistoricalItemValues } = await import('@/lib/historicalValues')
      const data = await getHistoricalItemValues(
        itemsWithCategory, pastMonths, convert, baseCurrency, lots, transactions, snapshots, diag,
      )
      setHistoricalItems(prev => {
        const merged = { ...prev }
        Object.entries(data).forEach(([mk, itemData]) => {
          // Reemplazo, no merge: es el punto entero del botón.
          merged[mk] = stripStaleIbkrEntries(itemData, ibkrIdsRef.current, IBKR_UNKNOWN_KEY_PREFIX)
        })
        return merged
      })
      let written = 0
      for (const mk of Object.keys(data)) {
        if (Object.keys(data[mk]).length === 0) continue
        try {
          await onSaveItemSnapshots(mk, data[mk], baseCurrency || 'USD', { replace: true })
          written++
        } catch { /* best-effort: un mes que no se pudo guardar se recomputa la próxima */ }
      }
      // El siguiente render del efecto automático no debe deshacer esto.
      Object.keys(data).forEach((mk) => { monthGenRef.current[mk] = generation })
      lastFetchedYearRef.current = fetchKey
      setRecalcReport({ months: written, sources: Object.values(diag) })
    } catch (err) {
      setRecalcReport({ error: err?.message || String(err) })
    }
    setRecalculating(false)
  }, [recalculating, months, currentMonthKey, onSaveItemSnapshots, items, convert, baseCurrency, lots, transactions, snapshots, generation, fetchKey, t])

  // El botón de refrescar del header de /spreadsheet dispara lo MISMO, que es
  // literalmente lo que pidió el usuario ("o utilizar el botón de refresh propio
  // para que recapacite y repare la tabla"). Se expone por ref para no obligar a
  // la página a levantar este estado.
  useEffect(() => {
    if (!onRegisterRecalculate) return
    onRegisterRecalculate(handleRecalculate)
    return () => onRegisterRecalculate(null)
  }, [onRegisterRecalculate, handleRecalculate])

  const itemValue = useCallback((item) => {
    return showOriginal ? getOriginalValue(item) : getItemValue(item)
  }, [showOriginal])

  const itemCurrency = useCallback((item) => {
    if (showOriginal) return item._originalCurrency || item.currency || 'USD'
    return baseCurrency || 'USD'
  }, [showOriginal, baseCurrency])

  // FASE HV5. El caché de meses históricos SIEMPRE guarda en moneda BASE (se
  // convierte a base al cargarlo, ver `__currencies` arriba), pero la columna
  // del mes actual en modo "Original" imprime la moneda propia del activo. Sin
  // convertir de vuelta, la MISMA fila mezcla dos monedas sin avisar.
  //
  // El caso real: un fondo en quetzales imprimía "393.47" en julio (dólares) y
  // "2,500.00" en agosto (quetzales), que se lee como un salto de 6x cuando en
  // realidad el fondo BAJÓ de 393.47 a 327.89 dólares, exactamente los 500
  // quetzales que se retiraron. Con las dos cifras en la misma moneda, la
  // historia se lee sola.
  const toDisplayCurrency = useCallback((v, cur) => {
    if (v == null) return v
    const base = baseCurrency || 'USD'
    if (!showOriginal || !convert || !cur || cur === base) return v
    const out = convert(v, base, cur)
    return Number.isFinite(out) ? out : v
  }, [showOriginal, convert, baseCurrency])

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
  // La edición queda EN ESPERA hasta que el usuario diga qué significa. Ver
  // lib/spreadsheetEdit.js: la app no puede saberlo, solo quien teclea.
  const [pendingEdit, setPendingEdit] = useState(null)
  // El diagnóstico de campos: por qué existe está en lib/balanceDiagnostic.js.
  // Tres rondas sobre la MISMA cuenta se fueron en deducir los campos guardados
  // desde capturas; esto los deja leer.
  const [showDiag, setShowDiag] = useState(false)
  const [diagCopied, setDiagCopied] = useState(false)
  const diagRows = useMemo(() => (showDiag ? balanceDiagnostic(items) : []), [showDiag, items])

  const toggleCat = (key) => setCollapsed(p => ({ ...p, [key]: !p[key] }))
  const toggleInst = (key) => setCollapsedInst(p => ({ ...p, [key]: !p[key] }))

  // La escritura, compartida por la edición directa y por la respuesta a la
  // pregunta. Confirmar DESPUÉS de que Firestore acepte, nunca antes:
  // `updateItem` es optimista (pinta el valor nuevo, y si la escritura falla
  // revierte y lanza), así que el banner verde en la misma vuelta síncrona
  // hacía que el usuario leyera "guardado" y un segundo después la celda
  // volviera sola al número viejo, indistinguible de "la app me borró la
  // corrección".
  const commitPatch = useCallback(async (item, patch, income, flow, debtPayment) => {
    const label = item.symbol || item.name
    try {
      await onUpdateItem(item.id, patch)
      // Un pago de deuda registrado desde la celda (FASE LT): la forma
      // compartida de lib/transferTx.js, sin cuenta origen porque una celda no
      // sabe de dónde salió el dinero. El historial del préstamo lo rebobina
      // (indexBalanceEvents) y se borra con reversa, igual que un pago hecho
      // desde Movimiento.
      if (debtPayment && onAddTransaction) {
        const tx = buildSheetDebtPaymentTransaction({ debtItem: item, amount: debtPayment.amount, date: debtPayment.date })
        if (tx) await onAddTransaction(tx)
      }
      // El ingreso va DESPUÉS del saldo y aparte: si falla, el saldo ya quedó
      // bien y lo que se pierde es el registro del movimiento, no la corrección.
      if (income && onAddTransaction) {
        await onAddTransaction({
          date: income.date,
          type: income.type,
          symbol: item.symbol || item.name || '',
          description: `${t('Rendimiento de', 'Yield from')} ${item.name || item.symbol}`,
          totalAmount: income.amount,
          currency: income.currency,
          _source: income.source,
          _linkedItemId: item.id,
          _reinvested: income.reinvested,
        })
      }
      // El movimiento que explica de dónde salió (o a dónde fue) el dinero. Sin
      // él, un retiro se lee como pérdida y un depósito como rendimiento.
      if (flow && onAddTransaction) {
        const entra = flow.type === 'DEPOSIT'
        await onAddTransaction({
          date: flow.date,
          type: flow.type,
          symbol: item.symbol || item.name || '',
          description: `${entra ? t('Aporte a', 'Contribution to') : t('Retiro de', 'Withdrawal from')} ${item.name || item.symbol}`,
          totalAmount: flow.amount,
          currency: flow.currency,
          _source: flow.source,
          _linkedItemId: item.id,
        })
      }
      const extra = income
        ? (lang === 'es' ? ' y rendimiento registrado' : ', yield recorded')
        : debtPayment
          ? (lang === 'es' ? ' y pago registrado' : ', payment recorded')
          : flow
            ? (flow.type === 'DEPOSIT'
                ? (lang === 'es' ? ' y aporte registrado' : ', contribution recorded')
                : (lang === 'es' ? ' y retiro registrado' : ', withdrawal recorded'))
            : ''
      setSaveMsg((lang === 'es' ? `${label}: guardado` : `${label}: saved`) + extra)
      setTimeout(() => setSaveMsg(null), 2600)
    } catch (e) {
      console.error('[spreadsheet] no se pudo guardar', e)
      setBlockMsg(lang === 'es'
        ? `${label}: no se pudo guardar. Revisá tu conexión e intentá de nuevo.`
        : `${label}: could not save. Check your connection and try again.`)
      setTimeout(() => setBlockMsg(null), 6000)
    }
  }, [onUpdateItem, onAddTransaction, lang])

  // La respuesta a la pregunta. `balanceAsOf` se estampa en las DOS ramas y no
  // es un detalle: es el campo que le dice al motor de rendimiento deducido
  // (lib/liquidYield.js) desde cuándo es cierto el saldo. Add/EditAccountModal
  // ya lo estampan al guardar un estático; la Hoja, que es la tercera puerta
  // que corrige saldos, no lo hacía, así que una corrección desde acá dejaba al
  // motor midiendo contra una fecha vieja.
  const answerPendingEdit = useCallback(async (answer) => {
    if (!pendingEdit) return
    const { item, oldValue, newValue } = pendingEdit
    setPendingEdit(null)
    // ⛔ CRUDO, no el enriquecido. `planCellEdit` y `buildContributionFields`
    // suman el delta (que viene en moneda ORIGINAL, porque `oldValue`/
    // `newValue` salen de `_originalPrice`) sobre los campos de precio del
    // item. En el enriquecido esos campos ya estan convertidos a moneda BASE,
    // asi que sumarlos mezcla dos monedas y ESCRIBE el resultado como si fuera
    // crudo: con base USD, teclear Q5,200 sobre una cuenta de Q5,000 guardaba
    // Q849.35. Ver lib/rawItem.js.
    const plan = planCellEdit({ item: toRawItem(item), oldValue, newValue, answer })
    if (!plan) return
    // ⛔ FASE MS. El DIA LOCAL, la misma regla que las otras dos puertas que
    // sellan este campo: `toISOString()` devuelve el dia UTC, que en Guatemala
    // rota a las 6pm, asi que corregir un saldo de noche lo sellaba con la
    // fecha de MAÑANA y un cupon del dia siguiente quedaba "dentro de la foto".
    const patch = { ...plan.patch, balanceAsOf: todayLocalISO() }
    await commitPatch(item, patch, plan.income, plan.flow, plan.debtPayment)
  }, [pendingEdit, commitPatch])

  const handleValueUpdate = useCallback(async (item, newVal) => {
    if (!onUpdateItem || !item.id) return
    let patch
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
      patch = { quantity: valInOriginal / price }
    } else {
      const qty = item.quantity || 1
      let price
      if (showOriginal) {
        price = newVal / qty
      } else {
        const cur = item._originalCurrency || item.currency || 'USD'
        const base = baseCurrency || 'USD'
        const originalVal = convert ? convert(newVal, base, cur) : newVal
        price = originalVal / qty
      }
      // ⛔ Acá vivía la decisión que el usuario nunca tomaba. Una cuenta de
      // banco escribía los DOS campos (toda corrección = "dato equivocado", y
      // el rendimiento real desaparecía) y un bono o un inmueble solo el valor
      // (toda corrección = ganancia o pérdida, y un número mal tecleado se leía
      // como pérdida). La app no puede saber cuál de las dos es: se pregunta.
      // ⛔ ESTE `|| 1` ES CORRECTO. Investigado y NO cambiado (FASE MQ), porque
      // "unificarlo con la convención del lector" es la conclusión natural y es
      // FALSA, y llegar hasta acá cuesta una ronda entera.
      //
      // El planteo: la celda se pinta con `getOriginalValue`, que usa la
      // convención del LECTOR (`Number(qty) || 0`) y la cascada completa de
      // precio; esta línea usa la del ESCRITOR (`|| 1`) y una cascada más
      // corta. Divergen en dos formas, medidas ejecutando las funciones:
      //
      //   cantidad 0 con precio 240      celda 0.00 · esta línea 240
      //   cantidad 1 con residuo en cost celda 240  · esta línea 0
      //
      // Y parece que la celda tiene razón, porque es lo que el usuario mira.
      // No la tiene: en las DOS formas la app ya decidió lo contrario, y lo
      // decidió escribiendo. `zeroQuantityBalanceFixes` sana la primera
      // poniendo cantidad 1 (o sea: ese saldo es REAL, estaba escrito
      // ilegible) y `resurrectedBalanceFixes` sana la segunda poniendo
      // cantidad 0 (o sea: ese residuo NO es el saldo). Después de sanar, el
      // valor leído es 240 y 0 respectivamente, que es exactamente lo que esta
      // línea ya decía. El 0.00 de la celda es la ventana transitoria ANTES de
      // que el sanador corra, no la verdad.
      //
      // Seguir a la celda archivaría capital que no se movió: sobre la primera
      // forma, teclear 500 registraría un DEPOSIT de 500 cuando entraron 260, y
      // un DEPOSIT se netea del retorno.
      //
      // Lo único que queda abierto y NO se tocó: un BONO con cantidad 0 no lo
      // cubre ningún sanador (su alcance es `isBankLike`, más angosto que el
      // `isBankLikeItem` de esta rama), así que ahí la divergencia es
      // permanente. Ensanchar un sanador que ESCRIBE cantidad es justo lo que
      // FASE LW/MA rehusaron hacer (en un activo de mercado la cantidad 0 es
      // una posición VENDIDA y "sanarla" resucita dinero), así que se nombra en
      // vez de decidirse de paso.
      const qtyNow = item.quantity || 1
      const oldValue = (Number(item._originalPrice ?? item.currentPrice ?? item.purchasePrice) || 0) * qtyNow
      const newValueOriginal = price * qtyNow
      if (editNeedsAnswer({ item, oldValue, newValue: newValueOriginal, isMarket: false })) {
        setPendingEdit({ item, oldValue, newValue: newValueOriginal })
        return
      }
      // Sin pregunta (ítem sincronizado, demo, cambio de redondeo, o una DEUDA
      // que SUBE: intereses acumulados, más préstamo o corrección escriben lo
      // mismo, así que preguntar sería una elección falsa) se conserva el
      // comportamiento previo a la pregunta: una cuenta líquida escribe los
      // DOS campos (el saldo ES su costo: dejar el costo atrás inventaría una
      // ganancia), una deuda también (no tiene ganancia que preservar y un
      // purchasePrice viejo solo es un campo mintiendo), y todo lo demás solo
      // el valor.
      patch = (isBankLike(item) || item.isDebt) ? { currentPrice: price, purchasePrice: price } : { currentPrice: price }
    }

    await commitPatch(item, patch, null, null)
  }, [onUpdateItem, showOriginal, convert, baseCurrency, lots, lang, commitPatch])

  // Un valor que el editor RECHAZA (negativo, no numérico, sobre el tope) se
  // descartaba en silencio: el popover se cerraba y el número viejo seguía ahí.
  const handleValueReject = useCallback((item) => {
    const label = item.symbol || item.name
    setBlockMsg(lang === 'es'
      ? `${label}: ese valor no se pudo leer. Usá solo números, sin signo negativo.`
      : `${label}: could not read that value. Use numbers only, no minus sign.`)
    setTimeout(() => setBlockMsg(null), 5000)
  }, [lang])

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
            // El mes en curso ya viene firmado de `getItemValue`; el caché
            // guarda magnitudes y hay que firmarlo acá. Sin esto una hipoteca
            // salía "800.00, 800.00, ..., -800.00": once columnas positivas y
            // una negativa, en un CSV cuyo TOTAL sí la resta, o sea un archivo
            // cuyas filas no suman su propio total.
            if (mk === currentMonthKey) return getItemValue(it).toFixed(2)
            const v = historicalItems[mk]?.[it.id]?.value
            return v != null ? ((it.isDebt ? -1 : 1) * v).toFixed(2) : ''
          })
          rows.push([cat.label, it.symbol || it.name || '', ...cells].map(esc).join(','))
        })
        const ibkrUnknownKey = `${IBKR_UNKNOWN_KEY_PREFIX}${inst.name}__${cat.key}`
        const unknownCells = months.map(mk => mk === currentMonthKey ? '' : (historicalItems[mk]?.[ibkrUnknownKey]?.value?.toFixed(2) ?? ''))
        if (unknownCells.some(c => c !== '')) {
          rows.push([cat.label, t('Posiciones no identificadas', 'Unidentified positions'), ...unknownCells].map(esc).join(','))
        }
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
    a.download = viewMode === 'yoy' ? 'chispudo-spreadsheet-anual.csv' : `chispudo-spreadsheet-${selectedYear}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [categories, months, currentMonthKey, historicalItems, monthlyTotals, grandTotal, selectedYear, lang, viewMode])

  // El MISMO recorrido de datos que el CSV (mismas fuentes, mismos números),
  // escrito con el formato compartido de lib/xlsxSheet.js: el archivo que se
  // descarga aquí y el que viaja adjunto en el correo mensual salen idénticos.
  //
  // FASE IE5: antes usaba la librería `xlsx`, cuya edición community IGNORA
  // los estilos de celda al escribir, así que el archivo era una rejilla de
  // números crudos por más formato que se le pidiera. Nada de la TABLA en
  // pantalla cambia: solo cómo se escribe el archivo.
  const handleExportXlsx = useCallback(async () => {
    const rows = []
    categories.forEach(cat => {
      // Subtotal por categoría, sumando exactamente las filas que se imprimen
      // debajo: un subtotal que no cuadra con lo que se ve es peor que no
      // tenerlo. La deuda entra NEGATIVA (getItemValue ya la firma; el caché
      // histórico guarda magnitudes, así que ahí se firma al leer).
      const catAcc = months.map(() => null)
      const catRows = []
      const bump = (i, v) => { catAcc[i] = (catAcc[i] || 0) + v }

      cat.institutions.forEach(inst => {
        inst.items.forEach(it => {
          const sign = it.isDebt ? -1 : 1
          const cells = months.map((mk, i) => {
            if (mk === currentMonthKey) {
              const v = Math.round(getItemValue(it) * 100) / 100
              bump(i, v)
              return v
            }
            const raw = historicalItems[mk]?.[it.id]?.value
            if (raw == null) return null
            const v = Math.round(sign * raw * 100) / 100
            bump(i, v)
            return v
          })
          const label = inst.name && inst.name !== t('Sin institucion', 'No institution')
            ? `${it.symbol || it.name || ''}  ·  ${inst.name}`
            : (it.symbol || it.name || '')
          catRows.push({ kind: 'item', label, values: cells })
        })

        const ibkrUnknownKey = `${IBKR_UNKNOWN_KEY_PREFIX}${inst.name}__${cat.key}`
        const unknownCells = months.map((mk, i) => {
          if (mk === currentMonthKey) return null
          const v = historicalItems[mk]?.[ibkrUnknownKey]?.value
          if (v == null) return null
          const r = Math.round(v * 100) / 100
          bump(i, r)
          return r
        })
        if (unknownCells.some(c => c != null)) {
          catRows.push({
            kind: 'item', muted: true,
            label: `${t('Posiciones no identificadas', 'Unidentified positions')}  ·  ${inst.name}`,
            values: unknownCells,
          })
        }
      })

      if (catRows.length > 0) {
        rows.push({ kind: 'category', label: cat.label, values: catAcc.map(v => (v == null ? null : Math.round(v * 100) / 100)) })
        rows.push(...catRows)
      }
    })

    rows.push({
      kind: 'total', label: 'TOTAL',
      values: months.map(mk => {
        const v = mk === currentMonthKey ? grandTotal : monthlyTotals[mk]
        return v == null ? null : Math.round(v * 100) / 100
      }),
    })

    // La convención del asterisco de la tabla se conserva, pero en el RÓTULO
    // de la columna, no pegado al número: un "19350.98*" es texto y perdería
    // el formato numérico (y con él poder sumar u ordenar esa columna).
    const hasFallback = [...fallbackMonths].some((mk) => months.includes(mk))
    const columns = months.map((mk) => {
      const label = getColumnLabel(mk, lang, viewMode)
      const star = fallbackMonths.has(mk) ? ' *' : ''
      const current = mk === currentMonthKey ? ` (${t('actual', 'current')})` : ''
      return `${label}${current}${star}`
    })
    const notes = hasFallback
      ? [t('* Total del snapshot: sin desglose por categoría', '* Snapshot total: no per-category breakdown')]
      : []

    const isYoy = viewMode === 'yoy'
    const ab = await renderStyledSheet({
      title: t('Hoja de cartera', 'Portfolio Spreadsheet'),
      subtitle: `${isYoy ? t('Año a año', 'Year over year') : selectedYear}  ·  ${t('Valores en', 'Values in')} ${baseCurrency || 'USD'}`,
      sheetName: isYoy ? t('Año a año', 'Year over year') : `${t('Matriz', 'Matrix')} ${selectedYear}`,
      labels: [t('Categoría', 'Category'), t('Activo', 'Asset')],
      columns,
      rows,
      notes,
    })

    const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = isYoy ? 'chispudo-spreadsheet-anual.xlsx' : `chispudo-spreadsheet-${selectedYear}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }, [categories, months, currentMonthKey, historicalItems, monthlyTotals, grandTotal, fallbackMonths, selectedYear, lang, viewMode, baseCurrency])

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
        // The synthetic IBKR "unknown positions" bucket (getHistoricalItemValues)
        // is a STILL-HELD group, not a removed one — it's keyed off the current
        // items too, just not by a real item id (see IBKR_UNKNOWN_KEY_PREFIX).
        if (data._syntheticIbkr) return
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

  // Placed after every hook above (never between them) — an empty portfolio
  // otherwise rendered as a wall of blank category rows with nothing to click.
  if (!items || items.length === 0) {
    return (
      <div className="bg-theme-tertiary border border-[var(--border-color)] rounded-lg py-16 px-6 text-center">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('Todavía no hay activos', 'No assets yet')}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('Agrega una cuenta o activo para ver su historial mes a mes aquí.', 'Add an account or asset to see its month-by-month history here.')}</p>
      </div>
    )
  }

  return (
    <div className="bg-theme-tertiary border border-[var(--border-color)] overflow-hidden">
      {/* Toolbar: grouped into clusters (currency, zoom, year, export) with
          dividers instead of one long undifferentiated row of buttons, and
          wraps onto a second line on narrow screens instead of forcing a
          horizontal scroll or squishing every control down to unreadable. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 border-b border-[var(--border-color)] bg-theme-surface">
        <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('Portfolio Spreadsheet', 'Portfolio Spreadsheet')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 pr-2 border-r border-[var(--border-color)] last:border-r-0 last:pr-0">
            {/* Active state gets a light-blue tint (not just white/shadow) so
                the current pick reads at a glance instead of blending into the
                same gray as everything else in the group. Color-by-state goes
                through inline style, not a conditional Tailwind class — the
                house rule (CLAUDE.md) that keeps state-dependent color out of
                Next.js's aggressively-cached JS chunks. */}
            <div className="flex bg-theme-tertiary rounded-md border border-[var(--border-color)] p-0.5">
              <button onClick={() => setShowOriginal(false)}
                className="px-2.5 py-1 text-xs rounded font-semibold transition-colors hover:text-[var(--text-secondary)]"
                style={!showOriginal ? pillActiveStyle : pillInactiveStyle}>
                {baseCurrency || 'USD'}
              </button>
              <button onClick={() => setShowOriginal(true)}
                className="px-2.5 py-1 text-xs rounded font-semibold transition-colors hover:text-[var(--text-secondary)]"
                style={showOriginal ? pillActiveStyle : pillInactiveStyle}>
                {t('Original', 'Original')}
              </button>
            </div>
            <div className="flex items-center gap-0.5 bg-theme-tertiary rounded-md border border-[var(--border-color)] p-0.5"
              role="group" aria-label={t('Zoom', 'Zoom')}>
              <button onClick={zoomOut} disabled={zoom <= ZOOM_LEVELS[0]}
                aria-label={t('Reducir zoom', 'Zoom out')}
                className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ZoomOut size={13} strokeWidth={2} />
              </button>
              <span className="text-xs w-8 text-center tabular-nums" style={{ color: 'var(--text-muted)' }}>{Math.round(zoom * 100)}%</span>
              <button onClick={zoomIn} disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                aria-label={t('Aumentar zoom', 'Zoom in')}
                className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ZoomIn size={13} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 pr-2 border-r border-[var(--border-color)] last:border-r-0 last:pr-0">
            {/* Mensual/Año a año picks WHICH axis months means (see the
                `months` useMemo above); the year picker only makes sense in
                Mensual (Año a año already shows every year at once), so it
                swaps out instead of sitting there disabled. */}
            <div className="flex bg-theme-tertiary rounded-md border border-[var(--border-color)] p-0.5">
              <button onClick={() => setViewMode('monthly')}
                className="px-2.5 py-1 text-xs rounded font-semibold transition-colors hover:text-[var(--text-secondary)]"
                style={viewMode === 'monthly' ? pillActiveStyle : pillInactiveStyle}>
                {t('Mensual', 'Monthly')}
              </button>
              <button onClick={() => setViewMode('yoy')}
                className="px-2.5 py-1 text-xs rounded font-semibold transition-colors hover:text-[var(--text-secondary)]"
                style={viewMode === 'yoy' ? pillActiveStyle : pillInactiveStyle}>
                {t('Año a año', 'Year over year')}
              </button>
            </div>
            {viewMode === 'monthly' && (
              <div className="flex bg-theme-tertiary rounded-md border border-[var(--border-color)] p-0.5">
                {availableYears.map(y => (
                  <button key={y} onClick={() => setSelectedYear(y)}
                    className="px-2.5 py-1 text-xs rounded font-semibold transition-colors hover:text-[var(--text-secondary)]"
                    style={selectedYear === y ? pillActiveStyle : pillInactiveStyle}>
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* CSV and Excel now carry their own icon + a light tint apiece
              (blue for CSV, the spreadsheet green Excel itself uses) instead
              of two identical flat-gray boxes a user had to read the letters
              on to tell apart. The tint reuses the app's info/success alert
              tokens (already theme-aware) instead of fixed blue-50/emerald-50,
              which stayed a pale white-mode chip no matter the theme. */}
          <div className="flex items-center gap-2">
            <button onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--alert-info-border)] bg-[var(--alert-info-bg)] hover:brightness-110 transition-[filter]"
              style={{ color: 'var(--accent-blue-strong)' }}
              title={t('Descargar la matriz mensual como CSV', 'Download the monthly matrix as CSV')}>
              <FileText size={13} strokeWidth={2} /> CSV
            </button>
            <button onClick={handleExportXlsx}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--alert-success-border)] bg-[var(--alert-success-bg)] hover:brightness-110 transition-[filter]"
              style={{ color: 'var(--accent-green)' }}
              title={t('Descargar la matriz mensual como Excel', 'Download the monthly matrix as Excel')}>
              <FileSpreadsheet size={13} strokeWidth={2} /> Excel
            </button>
            <button onClick={handleRecalculate} disabled={recalculating || loadingHistory}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--card-border)] bg-theme-tertiary hover:brightness-110 transition-[filter] disabled:opacity-40"
              style={{ color: 'var(--text-secondary)' }}
              title={t('Volver a calcular los meses pasados con la información de hoy',
                       'Recompute past months with today’s data')}>
              <RefreshCw size={13} strokeWidth={2} className={recalculating ? 'animate-spin' : undefined} />
              {recalculating ? t('Recalculando...', 'Recomputing...') : t('Recalcular', 'Recompute')}
            </button>
            <button onClick={() => setShowDiag((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-[var(--card-border)] bg-theme-tertiary hover:brightness-110 transition-[filter]"
              style={{ color: showDiag ? 'var(--accent-blue)' : 'var(--text-muted)' }}
              title={t('Ver qué hay guardado en cada cuenta de saldo',
                       'See what is actually stored in each balance account')}>
              {t('Diagnóstico', 'Diagnostic')}
            </button>
          </div>
          {loadingHistory && (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--alert-info-bg)] border border-[var(--alert-info-border)]">
              <ChispudoLoader mode="inline" size="small" state="section-loading" delay={0}
                message={t('Calculando historial...', 'Calculating history...')} showLabel
                className="text-xs font-medium text-[var(--accent-blue)]" />
            </span>
          )}
          <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-muted)' }}>{t('Click para editar', 'Click to edit')}</span>
        </div>
      </div>

      {showDiag && (
        <div className="mb-3 rounded-lg border p-3 overflow-x-auto"
          style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--card-border)' }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {t('Qué hay guardado en cada cuenta de saldo', 'What is stored in each balance account')}
            </span>
            <button
              onClick={async () => {
                const build = typeof window !== 'undefined' ? window.__CHISPU_BUILD : null
                try {
                  await navigator.clipboard.writeText(balanceDiagnosticText(diagRows, { build, lang }))
                  setDiagCopied(true)
                  setTimeout(() => setDiagCopied(false), 2200)
                } catch (e) { console.error('[diag] copy', e) }
              }}
              className="text-xs px-2 py-0.5 rounded border shrink-0"
              style={{ borderColor: 'var(--card-border)', color: 'var(--accent-blue)' }}>
              {diagCopied ? t('Copiado', 'Copied') : t('Copiar para reportar', 'Copy to report')}
            </button>
          </div>
          {diagRows.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('No hay cuentas de saldo en este portafolio.', 'No balance accounts in this portfolio.')}
            </p>
          ) : (
            <div className="space-y-2">
              {diagRows.map((r) => (
                <div key={r.id} className="text-xs">
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.label}</span>
                  {r.institution ? <span style={{ color: 'var(--text-muted)' }}> · {r.institution}</span> : null}
                  <div className="font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {Object.entries(r.fields).map(([k, v]) => `${k}=${v}`).join(' · ') || t('sin campos numéricos', 'no numeric fields')}
                  </div>
                  <div className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {t('precio leído', 'read price')}={r.price} · {t('VALOR', 'VALUE')}={r.value}
                  </div>
                  {r.verdict && (
                    <div style={{ color: r.verdict.ok ? 'var(--accent-green)' : 'var(--alert-warn-icon)' }}>
                      {r.verdict.ok ? '✓' : '⚠'} {lang === 'es' ? r.verdict.es : r.verdict.en}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {pendingEdit && pendingEdit.item.isDebt && (() => {
        // Una DEUDA que bajó no "perdió valor" ni le "sacaste dinero": o
        // hiciste un pago o el número estaba mal (FASE LT). Y es el lugar del
        // desglose que faltaba: cuánto del mes es interés, para que "el saldo
        // bajó X" y "pagué X" dejen de confundirse cuando el pago traía
        // intereses encima.
        const { item, oldValue, newValue } = pendingEdit
        const delta = newValue - oldValue
        const cur = item._originalCurrency || item.currency || 'USD'
        const fmtC = (v) => `${cur} ${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        const amt = fmtC(delta)
        const rMonthly = debtMonthlyRate(item)
        const interesMes = oldValue * rMonthly
        return (
          <div className="mx-4 mb-2 px-3 py-3 rounded-lg text-xs space-y-2"
            style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)' }}>
            <p className="font-medium" style={{ color: 'var(--alert-warn-icon)' }}>
              {t(`${item.symbol || item.name}: la deuda bajó ${amt}. ¿Qué pasó?`,
                 `${item.symbol || item.name}: the debt went down by ${amt}. What happened?`)}
            </p>
            <div className="flex flex-wrap gap-2 pt-0.5">
              <button type="button" onClick={() => answerPendingEdit(ANSWER_FLOW)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
                {t('Hice un pago', 'I made a payment')}
              </button>
              <button type="button" onClick={() => answerPendingEdit(ANSWER_CORRECTION)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border"
                style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
                {t('El número anterior estaba mal', 'The previous number was wrong')}
              </button>
              <button type="button" onClick={() => setPendingEdit(null)}
                className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('Cancelar', 'Cancel')}
              </button>
            </div>
            <p style={{ color: 'var(--text-muted)' }}>
              {t('Un pago queda registrado en el historial del préstamo (y se puede borrar). ',
                 'A payment is recorded in the loan history (and can be deleted). ')}
              {interesMes > 0.005 && t(
                `Ojo: lo que bajó es CAPITAL. Al ${item.interestRate}% ${item.ratePeriod === 'monthly' ? 'mensual' : 'anual'}, el interés del mes sobre ${fmtC(oldValue)} es ~${fmtC(interesMes)}: si también lo pagaste, tu pago total fue ~${fmtC(Math.abs(delta) + interesMes)}. `,
                `Note: what went down is PRINCIPAL. At ${item.interestRate}% ${item.ratePeriod === 'monthly' ? 'monthly' : 'yearly'}, this month's interest on ${fmtC(oldValue)} is ~${fmtC(interesMes)}: if you paid it too, your total payment was ~${fmtC(Math.abs(delta) + interesMes)}. `)}
              {t('Si el pago salió de una de tus cuentas registradas, mejor usa Movimiento → Pago de deuda, para que esa cuenta también baje.',
                 'If the payment came from one of your tracked accounts, use Movement → Debt payment instead, so that account goes down too.')}
            </p>
          </div>
        )
      })()}
      {pendingEdit && !pendingEdit.item.isDebt && (() => {
        const { item, oldValue, newValue } = pendingEdit
        const delta = newValue - oldValue
        const cur = item._originalCurrency || item.currency || 'USD'
        const amt = `${cur} ${Math.abs(delta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        const subio = delta > 0
        const liquida = accruesInBalance(item) && subio
        const conFlujo = canRecordFlow(item)
        return (
          <div className="mx-4 mb-2 px-3 py-3 rounded-lg text-xs space-y-2"
            style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)' }}>
            <p className="font-medium" style={{ color: 'var(--alert-warn-icon)' }}>
              {t(`${item.symbol || item.name}: ${subio ? 'subió' : 'bajó'} ${amt}. ¿Qué pasó?`,
                 `${item.symbol || item.name}: ${subio ? 'went up' : 'went down'} by ${amt}. What happened?`)}
            </p>
            <div className="flex flex-wrap gap-2 pt-0.5">
              {/* Entró o salió dinero: NO es ganancia ni pérdida, es capital
                  tuyo moviéndose. Sin esta opción un retiro se registraba como
                  pérdida y un depósito como intereses. */}
              {conFlujo && (
                <button type="button" onClick={() => answerPendingEdit(ANSWER_FLOW)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
                  {subio ? t('Metí dinero', 'I put money in') : t('Saqué dinero', 'I took money out')}
                </button>
              )}
              <button type="button" onClick={() => answerPendingEdit(ANSWER_RETURN)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border"
                style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
                {liquida
                  ? t('Son intereses que ganó', 'It earned interest')
                  : subio ? t('Ganó valor', 'It gained value') : t('Perdió valor', 'It lost value')}
              </button>
              <button type="button" onClick={() => answerPendingEdit(ANSWER_CORRECTION)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border"
                style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
                {t('El número anterior estaba mal', 'The previous number was wrong')}
              </button>
              <button type="button" onClick={() => setPendingEdit(null)}
                className="px-3 py-1.5 rounded-lg text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('Cancelar', 'Cancel')}
              </button>
            </div>
            {/* Decir la consecuencia de CADA respuesta, no solo nombrarlas: sin
                esto las dos se leen como sinónimos y la elección es un volado. */}
            <p style={{ color: 'var(--text-muted)' }}>
              {conFlujo && (subio
                ? t('Meter dinero no es ganancia: se registra como aporte y no infla tu retorno. ',
                    'Putting money in is not a gain: it is recorded as a contribution so it does not inflate your return. ')
                : t('Sacar dinero no es pérdida: se registra como retiro y no desinfla tu retorno. ',
                    'Taking money out is not a loss: it is recorded as a withdrawal so it does not deflate your return. '))}
              {liquida
                ? t('Los intereses sí se registran como ingreso y aparecen en Ingresos Pasivos. Corregir un número no mueve tu ganancia ni tu pérdida.',
                    'Interest is recorded as income and shows up in Passive Income. Correcting a number does not move your gain or loss.')
                : t('Un cambio de valor real sí mueve tu ganancia. Corregir un número no la mueve.',
                    'A real change in value does move your gain. Correcting a number does not.')}
              {!conFlujo && t(' Si metiste o sacaste dinero, registralo desde Movimiento.',
                              ' If you added or withdrew money, record it from Movimiento.')}
            </p>
          </div>
        )
      })()}

      {blockMsg && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg text-xs font-medium animate-pulse"
          style={{ backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)', border: '1px solid var(--alert-warn-border)' }}>
          {blockMsg}
        </div>
      )}
      {saveMsg && !blockMsg && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ backgroundColor: 'var(--alert-success-bg)', color: 'var(--accent-green)', border: '1px solid var(--alert-success-border)' }}>
          &#10003; {saveMsg}
        </div>
      )}
      {/* El reporte del recálculo. Un "nada que corregir" cierra la pregunta
          igual que un "8 meses reescritos": lo que no puede volver a pasar es
          que la respuesta sea invisible. Y decir de dónde salió CADA activo es
          lo que distingue "se mantiene plano porque no hubo precio" de "se
          mantiene plano porque está roto", que hasta hoy se veían igual. */}
      {recalcReport && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg text-xs" data-testid="recalc-report"
          style={recalcReport.error
            ? { backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)', border: '1px solid var(--alert-warn-border)' }
            : { backgroundColor: 'var(--alert-info-bg)', color: 'var(--text-primary)', border: '1px solid var(--alert-info-border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {recalcReport.error ? (
                <span className="font-medium">{recalcReport.error}</span>
              ) : (
                <>
                  <span className="font-medium">
                    {recalcReport.months > 0
                      ? t(`Recalculé ${recalcReport.months} ${recalcReport.months === 1 ? 'mes' : 'meses'}.`,
                          `Recomputed ${recalcReport.months} ${recalcReport.months === 1 ? 'month' : 'months'}.`)
                      : t('Nada que corregir.', 'Nothing to correct.')}
                  </span>
                  {recalcReport.sources.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {recalcReport.sources.map((s, i) => (
                        <li key={`${s.name}-${i}`}>
                          <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.name}</strong>
                          {': '}
                          {s.source === 'market'
                            ? t('precio de mercado real.', 'real market price.')
                            : s.source === 'events'
                              ? t('reconstruido de tus movimientos.', 'rebuilt from your transactions.')
                              : t(`sin precio histórico${s.symbol ? ` para ${s.symbol}` : ''}, se mantiene plano.`,
                                  `no historical price${s.symbol ? ` for ${s.symbol}` : ''}, held flat.`)}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <button onClick={() => setRecalcReport(null)} className="shrink-0 font-medium"
              style={{ color: 'var(--text-muted)' }}>
              {t('Cerrar', 'Dismiss')}
            </button>
          </div>
        </div>
      )}
      {/* This div HAS to be a real, self-contained 2D scroll container, not just
          "horizontal only": the CSS overflow spec says that whenever overflow-x
          is set to anything but visible, the browser computes overflow-y as auto
          too, no matter what — an explicit overflow-y:visible here gets silently
          overridden back to auto by that rule, so fighting it is not an option.
          Left half-fixed, that quirk makes THIS div count as the nearest
          scrolling ancestor for the table's own `sticky top-0` header row and
          `sticky left-0` name column, while spreadsheet/page.jsx's outer wrapper
          is the one that actually receives wheel scroll and moves — so the
          sticky header/column never had a moving scroll offset to stick against
          and just scrolled away with everything else. Confirmed with a live
          scroll test: max-h + overflow-auto here (own scrollbar, own sticky
          reference frame) fixes both the silently-broken sticky header AND the
          "scroll down doesn't work on some computers" report in one shot,
          because both trace back to the same accidental second scroll
          container. A small portfolio that already fits on screen is
          unaffected: max-height only ever caps what would otherwise overflow. */}
      <div className="overflow-auto max-h-[75vh]">
        {/* CSS zoom (not transform: scale) — a transform creates a containing
            block that disables position:sticky on the name column at zoom ≠ 1. */}
        <div style={{ zoom }}>
        <table className="w-full text-sm border-collapse min-w-[600px]">
          <caption className="sr-only">{t('Valores históricos del portafolio por mes', 'Historical portfolio values by month')}</caption>
          <thead>
            {/* Sticky vertically (top-0) same as the name column is sticky
                horizontally (left-0) — with 10+ category/institution rows the
                month labels used to scroll out of view immediately, forcing a
                scroll back up just to remember which column is which. The
                corner cell is sticky on both axes so it stays put either way;
                it needs the highest z-index for the moment it visually
                overlaps both the stuck header row and the stuck name column. */}
            <tr className="border-b border-[var(--border-color)] bg-theme-tertiary">
              <th scope="col" className="text-left py-2.5 pl-4 pr-2 font-semibold text-xs uppercase tracking-wide sticky left-0 top-0 bg-theme-tertiary z-30 min-w-[140px] max-w-[200px]" style={{ color: 'var(--text-muted)' }} />
              <th scope="col" className="text-right py-2.5 px-1 font-semibold text-xs w-8 sticky top-0 bg-theme-tertiary z-20" style={{ color: 'var(--text-muted)' }}>%</th>
              {showOriginal && <th scope="col" className="text-center py-2.5 px-1 font-semibold text-xs w-10 sticky top-0 bg-theme-tertiary z-20" style={{ color: 'var(--text-muted)' }}>{t('Mon', 'Cur')}</th>}
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                return (
                  <th scope="col" key={mk} className="text-right py-2.5 px-2 font-semibold text-xs w-32 sticky top-0 bg-theme-tertiary z-20" style={isCurrent ? { backgroundColor: CURRENT_COL_BG, color: 'var(--accent-blue-strong)' } : { color: 'var(--text-muted)' }}>
                    {getColumnLabel(mk, lang, viewMode)}
                    {isCurrent && <div className="text-xs font-normal" style={{ color: 'var(--accent-blue-soft)' }}>{t('actual', 'current')}</div>}
                  </th>
                )
              })}
            </tr>
          </thead>

          {categories.map(cat => {
            const pct = grandTotal !== 0 ? (cat.total / grandTotal) * 100 : 0
            const isCollapsed = collapsed[cat.key]
            const accent = CATEGORY_ACCENT[cat.key] || '#64748b'

            // Pasivos no es una categoría de inversión: es lo único de la tabla
            // que RESTA del patrimonio en vez de sumar retorno. Un separador
            // visible (borde superior más grueso, en vez del mismo filete fino
            // que separa dos categorías de inversión entre sí) más el InfoTip
            // marcan que esta fila es de otra naturaleza, no solo otro tipo
            // más en la lista. Ya existe una pestaña "Deudas" dedicada
            // (app/spreadsheet/page.jsx); esta fila se queda porque el TOTAL
            // de esta tabla sí necesita restarla para dar el patrimonio neto.
            const isDebtsRow = cat.key === 'debts'

            return (
              <tbody key={cat.key}>
                <tr className={`cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors bg-theme-surface ${isDebtsRow ? 'border-t-2' : 'border-t'}`}
                  style={{ borderTopColor: isDebtsRow ? accent : 'var(--border-color)' }}
                  onClick={() => toggleCat(cat.key)}>
                  <td className="py-3 pl-4 pr-2 sticky left-0 bg-theme-surface z-10" style={{ borderLeft: `3px solid ${accent}` }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-3" style={{ color: 'var(--text-muted)' }}>{isCollapsed ? '>' : 'v'}</span>
                      <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{cat.label}</span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({cat.institutions.reduce((s, i) => s + i.items.length, 0)})</span>
                      {cat.excludedFromTotal && <span className="text-xs ml-1" style={{ color: 'var(--accent-cyan)' }}>{t('(no incluido en total)', '(not in total)')}</span>}
                      {isDebtsRow && <InfoTip text={DEBT_CLARIFICATION[lang]} />}
                    </div>
                  </td>
                  <td className="text-right py-3 px-1 font-semibold text-sm" style={{ color: 'var(--text-muted)' }}>{Math.abs(pct).toFixed(0)}%</td>
                  {showOriginal && <td className="text-center py-3 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>{baseCurrency || 'USD'}</td>}
                  {months.map(mk => {
                    const isCurrent = mk === currentMonthKey
                    if (isCurrent) {
                      return <td key={mk} className="text-right py-3 px-2 font-bold tabular-nums font-mono text-sm" style={{ backgroundColor: CURRENT_COL_BG, color: 'var(--text-primary)' }}>{formatCurrency(cat.total)}</td>
                    }
                    const histMonth = historicalItems[mk]
                    let catHistTotal = 0
                    // Track whether any real per-item entry actually contributed,
                    // separately from the sum itself — a category whose reconstructed
                    // total legitimately IS 0 (e.g. everything sold off) must still
                    // show "0", not fall through to "-" as if there were no data at
                    // all (FASE DS: `!== 0` used to conflate "no data" with "data that
                    // happens to sum to zero").
                    let foundAny = false
                    if (histMonth) {
                      cat.institutions.forEach(inst => {
                        inst.items.forEach(it => {
                          if (it.id && histMonth[it.id]) {
                            // Firmar la deuda, igual que el TOTAL y que el
                            // lector del correo. Sin esto la fila Pasivos
                            // imprimía (5,000.00) en la columna del mes actual
                            // y 5,000.00 en las once pasadas, en el mismo gris
                            // que "Bolsa de Valores": cambiaba de convención a
                            // mitad de su propia fila y se leía como si la
                            // deuda sumara.
                            catHistTotal += (it.isDebt ? -1 : 1) * (histMonth[it.id].value || 0)
                            foundAny = true
                          }
                        })
                      })
                      // Huérfanas: misma regla que el TOTAL (FASE GN). Solo el
                      // bucket sintético de una cuenta de IBKR viva. Antes esta
                      // fila sumaba CUALQUIER entrada sin dueño de su
                      // categoría, así que borrar una de tres cuentas hacía que
                      // las categorías sumaran MÁS que el TOTAL, y ese mismo
                      // número volvía a aparecer en "Activos anteriores".
                      Object.entries(histMonth).forEach(([itemId, data]) => {
                        if (currentItemIds.has(itemId)) return
                        if (!liveIbkrBucketKeys.has(itemId)) return
                        if (data.category !== cat.key) return
                        catHistTotal += data.value || 0
                        foundAny = true
                      })
                    }
                    if (foundAny) {
                      return (
                        <td key={mk} className="text-right py-3 px-2 tabular-nums font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {formatNum(catHistTotal)}
                        </td>
                      )
                    }
                    // No real per-item history for this category/month → show a dash
                    // instead of a pro-rata estimate. The platform must not invent
                    // historical values (e.g. cash balances have no price history).
                    return (
                      <td key={mk} className="text-right py-3 px-2 tabular-nums font-mono text-sm" style={{ color: 'var(--text-muted)' }}>
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
                  // getHistoricalItemValues (lib/historicalValues.js) writes IBKR
                  // history under this synthetic key instead of a real item id —
                  // see IBKR_UNKNOWN_KEY_PREFIX's comment above for why.
                  const ibkrUnknownKey = `${IBKR_UNKNOWN_KEY_PREFIX}${inst.name}__${cat.key}`
                  const hasIbkrUnknown = months.some(mk => mk !== currentMonthKey && historicalItems[mk]?.[ibkrUnknownKey])

                  return (
                    <Fragment key={instKey}>
                      {showInst && (
                        <tr className="cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors bg-theme-surface border-t border-[var(--border-subtle)]"
                          onClick={() => toggleInst(instKey)}>
                          <td className="py-2 pl-8 pr-2 sticky left-0 bg-theme-surface z-10">
                            <span className="font-semibold text-sm" style={{ color: 'var(--text-secondary)' }}>{inst.name}</span>
                            <span className="text-xs ml-1.5" style={{ color: 'var(--text-muted)' }}>{isInstCollapsed ? '>' : 'v'}</span>
                          </td>
                          <td />
                          {showOriginal && <td className="text-center py-2 px-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {singleCurrency || baseCurrency || 'USD'}
                          </td>}
                          {months.map(mk => {
                            const isCurrent = mk === currentMonthKey
                            const displayVal = showOriginal && instOrigTotal != null ? instOrigTotal : inst.total
                            if (isCurrent) {
                              return <td key={mk} className="text-right py-2 px-2 font-medium tabular-nums font-mono text-sm" style={{ backgroundColor: CURRENT_COL_BG, color: 'var(--text-secondary)' }}>{formatNum(displayVal)}</td>
                            }
                            const histMonth = historicalItems[mk]
                            let instHistTotal = null
                            if (histMonth) {
                              instHistTotal = 0
                              inst.items.forEach(it => {
                                // Mismo signo que el TOTAL y que la fila de categoría.
                                if (it.id && histMonth[it.id]) instHistTotal += (it.isDebt ? -1 : 1) * (histMonth[it.id].value || 0)
                              })
                              if (histMonth[ibkrUnknownKey]) instHistTotal += histMonth[ibkrUnknownKey].value || 0
                            }
                            return (
                              <td key={mk} className="text-right py-2 px-2 font-medium tabular-nums font-mono text-sm" style={{ color: 'var(--text-muted)' }}>
                                {instHistTotal != null ? formatNum(toDisplayCurrency(instHistTotal, instOrigTotal != null ? singleCurrency : null)) : ''}
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
                        // Sub-unit crypto amounts (0.00000547 BTC) round to "0"
                        // at 4 decimals and read as a missing quantity: give
                        // fractional amounts room before falling back.
                        const qtyLabel = market && qty ? qty.toLocaleString(undefined, { maximumFractionDigits: qty < 1 ? 8 : 4 }) : null
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
                        const rowStyle = isEditing ? { backgroundColor: CURRENT_COL_BG, boxShadow: 'inset 0 0 0 2px var(--accent-blue-soft)' } : { backgroundColor: 'var(--bg-secondary)' }
                        const stickyStyle = isEditing ? { backgroundColor: CURRENT_COL_BG } : { backgroundColor: 'var(--bg-secondary)' }
                        return (
                          <Fragment key={item.id || idx}>
                          <tr className="hover:bg-[var(--bg-card-hover)] transition-colors border-t border-[var(--border-subtle)]" style={rowStyle}>
                            <td className={`py-2.5 ${showInst ? 'pl-12' : 'pl-8'} pr-2 sticky left-0 z-10`} style={stickyStyle}>
                              <div className="flex items-center gap-2 min-w-0">
                                {onEditItem ? (
                                  <button className="text-sm truncate text-left hover:underline transition-colors" style={{ color: isEditing ? 'var(--accent-blue-strong)' : 'var(--text-primary)', fontWeight: isEditing ? 600 : undefined }} onClick={(e) => { e.stopPropagation(); onEditItem(item) }}>
                                    {item.name || item.symbol}
                                  </button>
                                ) : (
                                  <span className="text-sm truncate" style={{ color: isEditing ? 'var(--accent-blue-strong)' : 'var(--text-primary)', fontWeight: isEditing ? 600 : undefined }}>{item.name || item.symbol}</span>
                                )}
                                {qtyLabel && (
                                  <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{qtyLabel}</span>
                                )}
                                <span className="text-xs font-semibold shrink-0" style={{ color: isEditing ? 'var(--accent-blue)' : 'var(--text-muted)' }}>{cur}</span>
                                {item.rewardType && REWARD_ICONS[item.rewardType] && (
                                  <span className="text-xs px-1 rounded shrink-0" style={{ backgroundColor: 'var(--alert-info-bg)', color: 'var(--accent-cyan)' }} title={item.rewardType}>
                                    {REWARD_ICONS[item.rewardType]}
                                  </span>
                                )}
                                {item.isReceivable && !item.countInNetWorth && (
                                  <span className="text-xs shrink-0" style={{ color: 'var(--accent-cyan)' }}>*</span>
                                )}
                              </div>
                            </td>
                            <td />
                            {showOriginal && <td className="text-center py-2.5 px-1 text-xs" style={{ color: isEditing ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: isEditing ? 600 : undefined }}>{cur}</td>}
                            {months.map(mk => {
                              const isCurrent = mk === currentMonthKey
                              if (!isCurrent) {
                                const histMonth = historicalItems[mk]
                                const cell = histMonth && item.id ? histMonth[item.id] : null
                                const histVal = cell?.value ?? null
                                const isEst = histVal != null && cell?.estimated
                                return (
                                  <td key={mk} className="text-right py-2.5 px-2 tabular-nums font-mono text-sm" style={{ color: histVal != null ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                                    {histVal != null ? (
                                      <>
                                        {isEst && (
                                          <span title={t('Valor estimado: mantenido plano; sin precio histórico real', 'Estimated: held flat; no real historical price')} style={{ color: 'var(--text-muted)', marginRight: '1px' }}>~</span>
                                        )}
                                        {formatNum(toDisplayCurrency(histVal, cur))}
                                      </>
                                    ) : '-'}
                                  </td>
                                )
                              }
                              return (
                                <td key={mk} className="text-right py-1 px-1" style={{ backgroundColor: isEditing ? EDITING_CELL_BG : CURRENT_COL_BG }}>
                                  {onUpdateItem ? (
                                    <EditableCell
                                      displayValue={val}
                                      editValue={editVal}
                                      onSave={(v) => handleValueUpdate(item, v)}
                                      onReject={() => handleValueReject(item)}
                                      editLabel={editLabel}
                                      livePreview={livePreview}
                                      isNegative={val < 0}
                                      currency={cur}
                                      onEditStart={() => setEditingItemId(item.id)}
                                      onEditEnd={() => setEditingItemId(null)}
                                    />
                                  ) : (
                                    <span className="font-mono tabular-nums text-sm font-medium" style={val < 0 ? { color: 'var(--text-negative)' } : { color: 'var(--text-primary)' }}>
                                      {formatNum(val)}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                          {(item.isDebt || item.isReceivable) && (item.debtTerm || item.interestRate || item.monthlyPayment || item.installmentsRemaining) && (() => {
                            // El desglose que faltaba (FASE LT): la fila decía
                            // "1.5% int." y el saldo NETO, sin decir nunca
                            // cuánto interés genera el mes ni cuánto se debe
                            // CON intereses. El saldo va en la moneda ORIGINAL
                            // del ítem (los enriquecidos traen el precio
                            // convertido a base, `_originalPrice` es el crudo).
                            const rawBalance = item.isDebt
                              ? Math.abs((Number(item._originalPrice ?? item.currentPrice ?? item.purchasePrice) || 0) * (Number(item.quantity) || 1))
                              : 0
                            const bd = item.isDebt ? debtBreakdown(item, { balance: rawBalance }) : null
                            const dCur = item._originalCurrency || item.currency || 'USD'
                            const fmtD = (v) => `${dCur} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            return (
                            <tr className="bg-theme-tertiary border-t-0">
                              <td className={`py-0.5 ${showInst ? 'pl-12' : 'pl-8'} pr-2 sticky left-0 bg-theme-tertiary z-10`} colSpan={2 + (showOriginal ? 1 : 0) + months.length}>
                                <div className="flex items-center gap-3 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                                  {item.debtTerm && <span>{DEBT_TERM_LABELS[item.debtTerm] || item.debtTerm}</span>}
                                  {item.interestRate > 0 && <span>{item.interestRate}% {item.ratePeriod === 'monthly' ? t('mensual', 'monthly') : t('anual', 'yearly')}</span>}
                                  {/* FASE ME2: la cuota iba con `$` fijo al lado del interés en
                                      fmtD (la moneda REAL): dos monedas en la misma fila. La cuota
                                      se teclea en la moneda del ítem, igual que el resto. */}
                                  {item.monthlyPayment > 0 && <span>{fmtD(item.monthlyPayment)}/{t('mes', 'mo')}</span>}
                                  {item.installmentsRemaining > 0 && (
                                    <span>{item.installmentsRemaining} {t('cuotas rest.', 'pmts left')}</span>
                                  )}
                                  {item.maturityDate && <span>{t('Vence', 'Due')}: {item.maturityDate}</span>}
                                  {bd && bd.monthlyInterest > 0.005 && (
                                    <span>{t('interés', 'interest')} ~{fmtD(bd.monthlyInterest)}/{t('mes', 'mo')}</span>
                                  )}
                                  {bd && bd.totalToPay != null && (
                                    <span>{t('total c/intereses', 'total w/interest')} ~{fmtD(bd.totalToPay)}</span>
                                  )}
                                  {bd && bd.paymentTooSmall && (
                                    <span style={{ color: 'var(--alert-warn-icon)' }}>
                                      ⚠ {t('el pago no cubre ni el interés del mes', 'the payment does not even cover monthly interest')}
                                    </span>
                                  )}
                                </div>
                              </td>
                            </tr>
                            )
                          })()}
                          </Fragment>
                        )
                      })}

                      {/* Past months of an IBKR account are NEVER a real per-stock
                          breakdown (getHistoricalItemValues only ever knows the
                          account's TOTAL for a past month, never which of today's
                          named positions it was split across) — one honest row
                          instead of pretending today's 18 tickers were held back
                          then. Never shown for the current month: that column is
                          each item's own real, live value above. */}
                      {(!showInst || !isInstCollapsed) && hasIbkrUnknown && (
                        <tr className="border-t border-[var(--border-subtle)]" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                          <td className={`py-2.5 ${showInst ? 'pl-12' : 'pl-8'} pr-2 sticky left-0 z-10`} style={{ backgroundColor: 'var(--bg-secondary)' }}>
                            <span className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
                              {t('Posiciones no identificadas', 'Unidentified positions')}
                            </span>
                          </td>
                          <td />
                          {showOriginal && <td />}
                          {months.map(mk => {
                            const isCurrent = mk === currentMonthKey
                            if (isCurrent) {
                              return <td key={mk} className="text-right py-2.5 px-2" style={{ backgroundColor: CURRENT_COL_BG }} />
                            }
                            const cell = historicalItems[mk]?.[ibkrUnknownKey]
                            const histVal = cell?.value ?? null
                            const isEst = histVal != null && cell?.estimated
                            return (
                              <td key={mk} className="text-right py-2.5 px-2 tabular-nums font-mono text-sm" style={{ color: histVal != null ? 'var(--text-muted)' : 'var(--text-muted)' }}>
                                {histVal != null ? (
                                  <>
                                    {isEst && (
                                      <span title={t('Valor estimado: reconstruido, no es el NAV real sincronizado de ese mes', 'Estimated: reconstructed, not that month\'s real synced NAV')} style={{ color: 'var(--text-muted)', marginRight: '1px' }}>~</span>
                                    )}
                                    {formatNum(histVal)}
                                  </>
                                ) : '-'}
                              </td>
                            )
                          })}
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            )
          })}

          {removedItems.length > 0 && (
            <tbody>
              <tr className="cursor-pointer transition-colors border-t-2 border-dashed border-[var(--border-color)] bg-theme-tertiary hover:brightness-95"
                onClick={() => setShowRemoved(p => !p)}>
                <td className="py-2.5 pl-4 pr-2 sticky left-0 bg-theme-tertiary z-10" colSpan={2 + (showOriginal ? 1 : 0)}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-3" style={{ color: 'var(--text-muted)' }}>{showRemoved ? 'v' : '>'}</span>
                    <span className="font-semibold text-xs" style={{ color: 'var(--text-muted)' }}>{t('Activos anteriores', 'Previous assets')}</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({removedItems.length})</span>
                  </div>
                </td>
                {months.map(mk => (
                  <td key={mk} className="py-2.5 px-2" style={mk === currentMonthKey ? { backgroundColor: CURRENT_COL_BG } : undefined} />
                ))}
              </tr>
              {showRemoved && removedItems.map(ri => (
                <tr key={ri.id} className="transition-colors border-t border-[var(--border-subtle)] hover:brightness-95" style={{ backgroundColor: 'var(--alert-warn-bg)' }}>
                  <td className="py-2 pl-8 pr-2 sticky left-0 z-10" style={{ backgroundColor: 'var(--alert-warn-bg)' }}>
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{ri.symbol}</span>
                  </td>
                  <td />
                  {showOriginal && <td />}
                  {months.map(mk => {
                    const isCurrent = mk === currentMonthKey
                    const val = ri.months[mk]
                    return (
                      <td key={mk} className="text-right py-2 px-2 tabular-nums font-mono text-sm" style={isCurrent ? { backgroundColor: CURRENT_COL_BG, color: 'var(--text-muted)' } : { color: val != null ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
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
                  <tr key={cur} className="border-t border-[var(--border-subtle)] bg-theme-surface" style={{ color: 'var(--text-muted)' }}>
                    <td className="py-1.5 pl-8 pr-2 sticky left-0 bg-theme-surface z-10 text-xs">
                      {cur}
                      {showOriginal && rate != null && (
                        <span className="ml-1.5" style={{ color: 'var(--text-muted)' }}>1 {cur} = {rate.toFixed(4)} USD</span>
                      )}
                    </td>
                    <td className="text-right py-1.5 px-1 text-xs">{pct.toFixed(0)}%</td>
                    {showOriginal && <td className="text-center py-1.5 px-1 text-xs">{cur}</td>}
                    {months.map(mk => {
                      const isCurrent = mk === currentMonthKey
                      return (
                        <td key={mk} className="text-right py-1.5 px-2 text-xs tabular-nums font-mono" style={isCurrent ? { backgroundColor: CURRENT_COL_BG } : undefined}>
                          {isCurrent ? formatNum(displayVal) : ''}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}

            <tr className="border-t-2 border-[var(--border-color)] bg-theme-tertiary">
              <td className="py-3.5 pl-4 pr-2 sticky left-0 bg-theme-tertiary z-10">
                <span className="font-black text-base" style={{ color: 'var(--text-primary)' }}>TOTAL</span>
                {showOriginal && (
                  <span className="text-xs ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>({baseCurrency || 'USD'})</span>
                )}
              </td>
              <td className="text-right py-3.5 px-1 font-bold text-sm" style={{ color: 'var(--text-secondary)' }}>100%</td>
              {showOriginal && <td className="text-center py-3.5 px-1 font-bold text-xs" style={{ color: 'var(--text-muted)' }}>{baseCurrency || 'USD'}</td>}
              {months.map(mk => {
                const isCurrent = mk === currentMonthKey
                const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                const isFallback = !isCurrent && val != null && fallbackMonths.has(mk)
                return (
                  <td key={mk} className="text-right py-3.5 px-2 font-bold tabular-nums font-mono text-base" style={isCurrent ? { backgroundColor: CURRENT_COL_BG, color: 'var(--text-primary)' } : { color: val ? 'var(--text-secondary)' : 'var(--text-muted)' }}
                    title={isFallback ? t('Valor total del snapshot (sin desglose por categoría para este mes)', 'Snapshot total (no per-category breakdown for this month)') : undefined}>
                    {val ? formatCurrency(val) : '-'}{isFallback ? <span style={{ color: 'var(--text-muted)' }}>*</span> : null}
                  </td>
                )
              })}
            </tr>

            {months.length >= 2 && (
              <tr className="bg-theme-surface border-t border-[var(--border-subtle)]">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-theme-surface z-10 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {viewMode === 'yoy' ? t('Retorno Anual (bruto)', 'Annual Return (gross)') : t('Retorno Mensual (bruto)', 'Monthly Return (gross)')}
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
                    <td key={mk} className="text-right py-2 px-2 text-sm tabular-nums font-mono" style={isCurrent ? { backgroundColor: CURRENT_COL_BG } : undefined}>
                      {ret != null ? (
                        <span className="font-semibold" style={{ color: ret >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                          {ret >= 0 ? '+' : ''}{ret.toFixed(1)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
            {returnYTD != null && (
              <tr className="bg-theme-surface border-t border-[var(--border-subtle)]">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-theme-surface z-10 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Return YTD
                </td>
                <td />
                {showOriginal && <td />}
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  return (
                    <td key={mk} className="text-right py-2 px-2 text-sm tabular-nums font-mono" style={isCurrent ? { backgroundColor: CURRENT_COL_BG } : undefined}>
                      {isCurrent ? (
                        <span className="font-semibold" style={{ color: returnYTD >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                          {returnYTD >= 0 ? '+' : ''}{returnYTD.toFixed(2)}%
                        </span>
                      ) : ''}
                    </td>
                  )
                })}
              </tr>
            )}
            {/* Jan-anchored, so it only means something inside ONE selected
                year — Año a año already shows the equivalent (this column vs
                last) via Retorno Anual above, so this row steps aside there
                instead of repeating a January that isn't even on screen. */}
            {viewMode === 'monthly' && janTotal && grandTotal > 0 && (
              <tr className="bg-theme-surface border-t border-[var(--border-subtle)]">
                <td className="py-2 pl-8 pr-2 sticky left-0 bg-theme-surface z-10 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('Crecimiento Portafolio', 'Portfolio Growth')}
                </td>
                <td />
                {showOriginal && <td />}
                {months.map(mk => {
                  const isCurrent = mk === currentMonthKey
                  const val = isCurrent ? grandTotal : (monthlyTotals[mk] || null)
                  const growth = val && janTotal > 0 ? ((val - janTotal) / janTotal) * 100 : null
                  return (
                    <td key={mk} className="text-right py-2 px-3 text-sm tabular-nums font-mono" style={isCurrent ? { backgroundColor: CURRENT_COL_BG } : undefined}>
                      {growth != null ? (
                        <span className="font-semibold" style={{ color: growth >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
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
          <p className="text-xs px-4 py-2" style={{ color: 'var(--text-muted)' }}>
            * {t('Total del snapshot de ese mes: aún sin desglose por categoría (las filas muestran "-").',
                 'Snapshot total for that month: no per-category breakdown yet (rows show "-").')}
          </p>
        )}
        {hasEstimated && (
          <p className="text-xs px-4 py-2" style={{ color: 'var(--text-muted)' }}>
            ~ {t('Valor estimado: reconstruido manteniendo el saldo/posición plano (sin precio histórico de mercado).',
                 'Estimated: reconstructed by holding the balance/position flat (no historical market price).')}
          </p>
        )}
      </div>
    </div>
  )
}
