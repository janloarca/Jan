'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { authFetch, safeJson } from '@/lib/authFetch'
import { validateItem } from '@/lib/validation'
import InlineCreateAccount from './InlineCreateAccount'
import TimelineEditor, { validateTimelineRows } from './TimelineEditor'
import { detectCurrency } from '@/lib/institutionCurrency'
import { getScheduledPayDates, estimateIncomeAmount } from '@/lib/incomeSchedule'
import DebtBreakdownPreview from './DebtBreakdownPreview'
import { buildLoanProceedsTransaction, buildLoanProceedsOutsideTransaction } from '@/lib/transferTx'
import { buildContributionFields, isBankLikeItem } from '@/lib/contributions'
import { ACCRUAL_DAILY, dailyAccrualScheduleFields } from '@/lib/dailyAccrual'
import { InfoTip } from './ui/Tooltip'
import { DEBT_CLARIFICATION } from './dashboard/utils'
import { currencyOptions } from '@/lib/currencies'
import { parseAmount, parseQuantity } from '@/lib/numberParse'
import { debtOptions } from '@/lib/propertyEquity'
import GuidedAssetSteps, { guidedFieldsFor } from './GuidedAssetSteps'
import BusyLabel, { BusyRing } from '@/components/ui/BusyLabel'
import { todayLocalISO } from '@/lib/localDate'


const TYPES = [
  { key: 'Stock', icon: '📈', es: 'Acción', en: 'Stock', subtypes: [
    { key: 'common', es: 'Común', en: 'Common' },
    { key: 'preferred', es: 'Preferente', en: 'Preferred' },
    // Común y preferente de empresa PRIVADA son dos subtipos propios (no un
    // solo "Privada" genérico) para poder tener las dos a la vez, ej. un
    // fundador con acciones comunes y un inversionista con preferentes del
    // mismo cap table. Sin cotización pública que buscar: isMarketAsset las
    // excluye más abajo y entran manual, con la misma lógica de comisión de
    // entrada/costBasis/dividendo a otra cuenta que el Bono (ver isPrivateStock).
    { key: 'private_common', es: 'Privada Común', en: 'Private Common' },
    { key: 'private_preferred', es: 'Privada Preferente', en: 'Private Preferred' },
  ]},
  { key: 'Crypto', icon: '₿', es: 'Crypto', en: 'Crypto', subtypes: [
    { key: 'holding', es: 'Holding', en: 'Holding' },
    { key: 'staking', es: 'Staking', en: 'Staking' },
    { key: 'defi_yield', es: 'DeFi Yield', en: 'DeFi Yield' },
    { key: 'lending', es: 'Préstamo', en: 'Lending' },
  ]},
  { key: 'Fund', icon: '💼', es: 'Fondo/ETF', en: 'Fund/ETF', subtypes: [
    { key: 'etf', es: 'ETF', en: 'ETF' },
    { key: 'mutual', es: 'Fondo Mutuo', en: 'Mutual Fund' },
    { key: 'liquid_fund', es: 'Fondo Líquido', en: 'Liquid Fund' },
    { key: 'money_market', es: 'Mercado Monetario', en: 'Money Market' },
  ]},
  { key: 'Bond', icon: '🏛', es: 'Bono/Instrumento', en: 'Bond/Instrument', subtypes: [
    { key: 'corporate', es: 'Corporativo', en: 'Corporate' },
    { key: 'government', es: 'Gobierno', en: 'Government' },
    { key: 'convertible', es: 'Convertible', en: 'Convertible' },
    { key: 'private_debt', es: 'Deuda Privada', en: 'Private Debt' },
  ]},
  { key: 'Bank', icon: '🏦', es: 'Banco', en: 'Bank', subtypes: [
    { key: 'checking', es: 'Corriente', en: 'Checking' },
    { key: 'savings', es: 'Ahorro', en: 'Savings' },
    { key: 'cd', es: 'Depósito a Plazo', en: 'CD' },
  ]},
  { key: 'RealEstate', icon: '🏠', es: 'Inmueble', en: 'Real Estate', subtypes: [
    { key: 'property', es: 'Propiedad', en: 'Property' },
    { key: 'reit', es: 'REIT', en: 'REIT' },
    { key: 'crowdfunding', es: 'Crowdfunding', en: 'Crowdfunding' },
  ]},
  { key: 'Alternative', icon: '🔮', es: 'Alternativo', en: 'Alternative', subtypes: [
    { key: 'club_deal', es: 'Club Deal', en: 'Club Deal' },
    { key: 'safe_note', es: 'SAFE Note', en: 'SAFE Note' },
    { key: 'vc_fund', es: 'Fondo VC', en: 'VC Fund' },
    { key: 'private_equity', es: 'PE / Capital Privado', en: 'PE / Private Equity' },
    { key: 'collectible', es: 'Coleccionable', en: 'Collectible' },
    { key: 'other', es: 'Otro', en: 'Other' },
  ]},
  { key: 'Debt', icon: '💳', es: 'Deuda/Pasivo', en: 'Debt/Liability', subtypes: [
    { key: 'mortgage', es: 'Hipoteca', en: 'Mortgage' },
    { key: 'personal_loan', es: 'Préstamo Personal', en: 'Personal Loan' },
    { key: 'credit_card', es: 'Tarjeta de Crédito', en: 'Credit Card' },
    { key: 'financing', es: 'Financiamiento', en: 'Financing' },
    { key: 'auto_loan', es: 'Préstamo Auto', en: 'Auto Loan' },
    { key: 'student_loan', es: 'Préstamo Estudiantil', en: 'Student Loan' },
    { key: 'receivable', es: 'Cuenta por Cobrar', en: 'Receivable' },
    { key: 'other', es: 'Otro', en: 'Other' },
  ]},
]

const ACCOUNT_TYPES = [
  { key: 'taxable', es: 'Tributaria', en: 'Taxable' },
  { key: 'retirement', es: 'Retiro', en: 'Retirement' },
  { key: 'tax-free', es: 'Libre', en: 'Tax-free' },
]

// Subtipo por defecto del modo guiado. El formulario largo deja el subtipo
// vacío a propósito (el usuario lo elige); el guiado no pregunta, así que
// necesita uno razonable. Ninguno cambia una fórmula: para Stock se elige
// 'common' EXPRESAMENTE porque los private_* son los únicos que cambian de
// naturaleza (dejan de ser activo de mercado, ver isPrivateStock).
const GUIDED_SUBTYPE = {
  Stock: 'common', Crypto: 'holding', Fund: 'etf', Bond: 'corporate',
  Bank: 'savings', RealEstate: 'property', Alternative: 'other', Debt: 'other',
}

export default function AddAccountModal({ onClose, onAdd, onAddTransaction, onAddLot, onCreateDestination, onExecuteContribution, existingItems = [], activePortfolio, activeEntity = 'default', lang = 'es',
  // ---- Modo guiado (onboarding de usuario nuevo) ----
  // guidedType fija el tipo y cambia SOLO el render: una pregunta por pantalla
  // en vez del formulario de 2 pasos. El estado, la búsqueda de símbolo y
  // handleSubmit son exactamente los mismos, así que el depósito de apertura
  // (⛔ superficie G de lib/assetLogic/corporateBondWithEntryFee.js) se sigue
  // escribiendo en un solo lugar.
  guidedType = null, guidedProgress = null, onSaved = null, onExitGuided = null }) {
  const trapRef = useFocusTrap()
  const [step, setStep] = useState(1)
  const [type, setType] = useState(guidedType || 'Stock')
  const [subtype, setSubtype] = useState(guidedType ? (GUIDED_SUBTYPE[guidedType] || '') : '')
  const [guidedIndex, setGuidedIndex] = useState(0)
  const [form, setForm] = useState({
    symbol: '', name: '', quantity: '', purchasePrice: '', currentPrice: '',
    institution: '', currency: 'USD',
    // El alta guiada NO rellena la fecha con hoy: pregunta 2 o 3 cosas por
    // activo a propósito, y estampar "hoy" en algo que se compró hace años es
    // inventar un dato, no ahorrarle trabajo a nadie. Peor: esa fecha manda en
    // el rebobinado histórico y, desde FASE KV, también fecha el depósito de
    // apertura. Vacía, el hallazgo `no-acq-date` la pide después con una
    // sugerencia real (la fecha del primer movimiento), que es justo el bulletin
    // que el usuario echaba de menos. El formulario largo sí la ofrece prellena:
    // ahí el campo está a la vista y se corrige de un vistazo.
    acquisitionDate: guidedType ? '' : new Date().toISOString().split('T')[0],
    accountType: 'taxable',
    incomeAmount: '', incomeMode: 'fixed', incomeRate: '',
    incomePayDay: '', incomeMonths: [],
    capitalReturn: '', incomeDestination: '', capitalDestination: '',
    dividendAction: 'cash',
    sector: '', industry: '', exchangeName: '',
    rateType: 'fixed', rateMin: '', rateMax: '',
    // 'monthly' (de siempre) | 'daily' (devenga diario, asienta a fin de mes)
    accrual: 'monthly',
    accrualMethod: 'simple', paymentSchedule: 'monthly',
    businessDayRule: 'exact',
    maturityDate: '', maturityAction: 'return_capital', conversionDetails: '',
    isIlliquid: false,
    custodyType: '', custodyDetails: '',
    notes: '',
    taxJurisdiction: '', assetCountry: '',
    safeCap: '', safeDiscount: '', safeType: 'post_money',
    investmentStage: '', roundValuation: '', ownershipPct: '', committedCapital: '',
    interestRate: '', minimumPayment: '',
    // FASE LT: el período de la tasa (en LatAm los préstamos se cotizan al mes:
    // 1.5% mensual NO es 1.5% anual, es 12x), el esquema de pago y el monto
    // original del préstamo. Ver lib/debtMath.js.
    ratePeriod: 'annual', debtScheme: '', originalPrincipal: '',
    // Inmueble: el enganche, el préstamo que lo financia, y los dos costos
    // fijos de tenerlo. Ver lib/propertyEquity.js: de estos cuatro más la deuda
    // vinculada salen "cuánto llevas pagado", "cuánto falta" y el capital
    // propio, sin teclear nada dos veces. ⛔ Ninguno toca el patrimonio.
    downPayment: '', linkedDebtId: '', adminFeeMonthly: '', propertyTaxAnnual: '',
    debtTerm: '', installmentsTotal: '', installmentsRemaining: '', monthlyPayment: '',
    cardBrand: '', rewardType: '', rewardRate: '', rewardBalance: '',
    entryFee: '', entryFeeMode: 'separate', managementFee: '', managementFeeType: 'percent', expenseRatio: '',
    accruedInterestAtPurchase: '',
  })
  const [isNewMoney, setIsNewMoney] = useState(true)
  // FASE LT: a dónde llegó el dinero de un préstamo nuevo. 'outside' de
  // default (ya está contado en un activo, o se usó fuera de la app): escribe
  // el registro que hace que pedir prestado no se lea como pérdida. El alta
  // guiada no muestra la pregunta y hereda este default.
  const [loanProceeds, setLoanProceeds] = useState('outside')
  // Pay dates the schedule implies already happened (acquisitionDate + months
  // configured are in the past) that the user says they did NOT actually
  // receive. Everything else in that list is assumed received by default —
  // matching what the automatic backfill already assumes today — so this only
  // needs a click when reality differs from the schedule.
  const [excludedPayDates, setExcludedPayDates] = useState([])
  // How the value was built: one lump at acquisitionDate (default) or several
  // dated contributions captured in a timeline (rows explain the total).
  const [valueTimeline, setValueTimeline] = useState('single')
  const [timelineRows, setTimelineRows] = useState([])
  const [detectedCurrency, setDetectedCurrency] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [divInfo, setDivInfo] = useState(null)
  const [divLoading, setDivLoading] = useState(false)
  // Auto-detected dividend (divInfo, from Yahoo) is the default for a market
  // asset; this lets the user correct it by hand if Yahoo's schedule is wrong
  // or incomplete, without losing the auto-detected values as a starting
  // point — seeded into form.incomeRate/incomeMonths when toggled on.
  const [marketDivOverride, setMarketDivOverride] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [fetchingQuote, setFetchingQuote] = useState(false)
  // El proveedor no devolvió precio para el símbolo elegido. Se muestra en vez
  // de callarse porque el usuario tiene que teclearlo: guardar con costo 0
  // produce un retorno inventado de miles por ciento.
  const [quoteFailed, setQuoteFailed] = useState(false)
  const [showIncome, setShowIncome] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)
  const searchAbortRef = useRef(null)

  const t = (es, en) => lang === 'es' ? es : en
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))
  const [creatingDest, setCreatingDest] = useState(null) // 'income' | 'capital' | null
  const [extraItems, setExtraItems] = useState([])
  const destItems = useMemo(() => [...existingItems, ...extraItems], [existingItems, extraItems])
  const handleDestCreated = (field, newId, newItem) => {
    setExtraItems(prev => [...prev, { id: newId, ...newItem }])
    set(field, newId)
    setCreatingDest(null)
  }
  // Acción común/preferente de empresa PRIVADA: no tiene ticker que buscar
  // (subtype lo distingue de la acción pública de mercado). Se trata como el
  // Bono: entrada manual, sin isMarketAsset, con su propia sección de
  // comisión de entrada/liquidez más abajo (⛔ lógica congelada consumida,
  // no reescrita: getItemCostBasis/getItemPrincipalCost/getDividendIncomeByItem
  // en components/dashboard/utils.js ya son genéricas por item, no por tipo).
  const isPrivateStock = type === 'Stock' && (subtype === 'private_common' || subtype === 'private_preferred')
  const isMarketAsset = (type === 'Stock' && !isPrivateStock) || type === 'Crypto' || type === 'Fund'
  const isProperty = type === 'RealEstate'
  // Las deudas que se le pueden ofrecer a un inmueble, hipotecas primero.
  const propertyDebtOptions = useMemo(() => debtOptions(existingItems), [existingItems])
  const isBank = type === 'Bank'
  const isBond = type === 'Bond'
  const isAlternative = type === 'Alternative'
  const isCrypto = type === 'Crypto'
  const isDebt = type === 'Debt'
  const currentTypeInfo = TYPES.find(tp => tp.key === type)

  // If the schedule the user just configured (months + pay day) plus the
  // acquisition date imply payments that already fell due before today, ask
  // about them now instead of letting the automatic backfill guess silently
  // after save. Market assets have their own detected dividend schedule
  // (divInfo) and aren't covered here.
  // Un 29, 30 o 31 no cabe en todos los meses. La app paga el último día real
  // de cada mes (clampPayDay), y eso hay que DECIRLO: si no, un 31 se lee como
  // una promesa que la app no puede cumplir en febrero.
  const payDayHint = (parseInt(form.incomePayDay, 10) || 0) >= 29
    ? t('En los meses más cortos se paga el último día.', 'In shorter months it pays on the last day.')
    : null

  const payMonthsCount = form.incomeMonths.length > 0 ? form.incomeMonths.length : 12
  // Devengo diario: el calendario deja de ser una eleccion (son los 12 meses,
  // el ultimo dia de cada uno), asi que se derivan los campos en vez de
  // pedirlos. Un solo lugar los define: dailyAccrualScheduleFields.
  const isDaily = form.accrual === ACCRUAL_DAILY
  const pastDuePayDates = useMemo(() => {
    if (isMarketAsset || !showIncome || form.rateType === 'continuous') return []
    const sched = isDaily
      ? dailyAccrualScheduleFields()
      : { incomeMonths: form.incomeMonths, incomePayDay: form.incomePayDay }
    return getScheduledPayDates({
      acquisitionDate: form.acquisitionDate, rateType: form.rateType,
      incomeMonths: sched.incomeMonths, incomePayDay: sched.incomePayDay,
    })
  }, [isMarketAsset, showIncome, form.rateType, form.acquisitionDate, form.incomeMonths, form.incomePayDay, isDaily])

  // Drop stale exclusions if the schedule changed underneath them (e.g. the
  // user removed a month after marking that date "not received").
  useEffect(() => {
    setExcludedPayDates(prev => prev.filter(d => pastDuePayDates.includes(d)))
  }, [pastDuePayDates])

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  // En modo guiado el tipo puede cambiar solo: elegir un resultado de la
  // búsqueda lo re-clasifica (handleSelectSymbol). El subtipo por defecto tiene
  // que seguirlo, o una acción quedaría guardada con el subtipo de cripto.
  useEffect(() => {
    if (!guidedType) return
    setSubtype(GUIDED_SUBTYPE[type] || '')
  }, [type, guidedType])

  const usedInstitutions = useMemo(() => {
    const insts = new Set()
    existingItems.forEach(it => { if (it.institution) insts.add(it.institution) })
    return Array.from(insts)
  }, [existingItems])

  const [showInstSuggestions, setShowInstSuggestions] = useState(false)
  const filteredInstitutions = useMemo(() => {
    if (!form.institution) return usedInstitutions
    const lower = form.institution.toLowerCase()
    return usedInstitutions.filter(i => i.toLowerCase().includes(lower))
  }, [form.institution, usedInstitutions])

  // Symbol search
  useEffect(() => {
    if (!isMarketAsset || !form.symbol || form.symbol.length < 1) {
      setSearchResults([]); setShowDropdown(false); return
    }
    const timer = setTimeout(async () => {
      const q = form.symbol.trim()
      if (q.length < 1) return
      searchAbortRef.current?.abort()
      searchAbortRef.current = new AbortController()
      setSearchLoading(true)
      try {
        const res = await authFetch(`/api/prices/search?q=${encodeURIComponent(q)}`, { signal: searchAbortRef.current.signal })
        if (res.ok) {
          const data = await safeJson(res) || {}
          setSearchResults(data.results || [])
          setShowDropdown(data.results?.length > 0)
        }
      } catch (err) {
        if (err.name !== 'AbortError') console.error('[search]', err.message)
      }
      setSearchLoading(false)
    }, 400)
    return () => clearTimeout(timer)
  }, [form.symbol, isMarketAsset])

  // Click outside search dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelectSymbol = useCallback(async (result) => {
    setShowDropdown(false)
    setSearchResults([])
    const newType = result.type === 'Crypto' ? 'Crypto' : result.type === 'Fund' ? 'Fund' : 'Stock'
    setType(newType)
    setForm(prev => ({ ...prev, symbol: result.symbol, name: result.name || '', exchangeName: result.exchange || '' }))

    searchAbortRef.current?.abort()
    searchAbortRef.current = new AbortController()
    setFetchingQuote(true)
    setQuoteFailed(false)
    try {
      const res = await authFetch(`/api/prices/search?symbol=${encodeURIComponent(result.symbol)}&type=${encodeURIComponent(newType)}`, { signal: searchAbortRef.current.signal })
      const data = res.ok ? (await safeJson(res) || {}) : {}
      if (data.quote?.price) {
        if (data.quote.currency) setDetectedCurrency(data.quote.currency)
        setForm(prev => ({
          ...prev,
          purchasePrice: data.quote.price.toString(),
          currency: data.quote.currency || prev.currency,
          sector: data.quote.sector || '',
          industry: data.quote.industry || '',
        }))
      } else {
        // Este `else` faltaba, y su ausencia era el bug caro: sin él, el precio
        // (y el sector, y la moneda detectada) de la selección ANTERIOR se queda
        // en el formulario y se guarda como el costo de ESTA. Un ETF de $56
        // elegido antes terminaba archivado como el precio de compra de
        // Ethereum. Un precio heredado se ve idéntico a uno bueno, así que es
        // peor que no tener ninguno: mejor vaciarlo y decirlo.
        setDetectedCurrency(null)
        setQuoteFailed(true)
        setForm(prev => ({ ...prev, purchasePrice: '', sector: '', industry: '' }))
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[quote]', err.message)
        setDetectedCurrency(null)
        setQuoteFailed(true)
        setForm(prev => ({ ...prev, purchasePrice: '', sector: '', industry: '' }))
      }
    }
    setFetchingQuote(false)
  }, [])

  // Dividend fetch
  useEffect(() => {
    if (!isMarketAsset || !form.symbol || form.symbol.length < 1) { setDivInfo(null); setMarketDivOverride(false); return }
    // A new symbol lookup starting invalidates any manual override made for
    // the PREVIOUS symbol — otherwise switching AAPL → MSFT mid-form could
    // silently keep AAPL's hand-edited rate/months on the new pick.
    setMarketDivOverride(false)
    const timer = setTimeout(async () => {
      const sym = form.symbol.trim().toUpperCase()
      if (sym.length < 1) return
      setDivLoading(true)
      try {
        const res = await authFetch(`/api/prices/dividends?symbol=${encodeURIComponent(sym)}`)
        if (res.ok) setDivInfo(await safeJson(res))
      } catch {}
      setDivLoading(false)
    }, 800)
    return () => clearTimeout(timer)
  }, [form.symbol, isMarketAsset])

  const goToStep2 = () => {
    setError('')
    if (isMarketAsset && !form.symbol) { setError(t('Busca y selecciona un activo', 'Search and select an asset')); return }
    if (!isMarketAsset && !form.name && !isBank) { setError(t('Ingresa el nombre', 'Enter the name')); return }
    if (isBank && !form.institution) { setError(t('Ingresa el banco', 'Enter the bank')); return }

    // Duplicate detection — match by symbol/name; if both have institution, also match that
    const existing = existingItems.find(ei => {
      if (isMarketAsset) {
        const sameSymbol = (ei.symbol || '').toUpperCase() === (form.symbol || '').toUpperCase()
        if (!sameSymbol) return false
        if (form.institution && ei.institution) return (ei.institution || '').toLowerCase() === (form.institution || '').toLowerCase()
        return true
      }
      const sameName = (ei.name || '').toLowerCase() === (form.name || '').toLowerCase()
      if (!sameName) return false
      if (form.institution && ei.institution) return (ei.institution || '').toLowerCase() === (form.institution || '').toLowerCase()
      return true
    })
    if (existing && !duplicateWarning) {
      setDuplicateWarning(existing)
      return
    }
    setDuplicateWarning(null)
    setStep(2)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (saving) return
    setError('')

    // La fecha es obligatoria en el formulario LARGO, donde el campo está a la
    // vista y dejarlo en blanco es un descuido. En el recorrido guiado NO hay
    // paso de fecha a propósito (se pregunta lo mínimo y el resto lo reclama
    // Enrich Data después), así que exigirla ahí es pedir algo que la pantalla
    // nunca dio forma de contestar: el recorrido quedaba imposible de terminar.
    // Vacía es seguro y está verificado abajo: el depósito de apertura y su lote
    // caen a hoy con su propio `|| new Date()`, y `effectiveAcqDate` cae a enero
    // del año de `createdAt`. El ítem se queda sin fecha, que es justo lo que
    // hace disparar `no-acq-date` en el boletín.
    if (!form.acquisitionDate && !guidedType) { setError(t('La fecha es obligatoria para calcular rendimientos', 'Date is required for return calculations')); return }
    if (!form.institution && !isProperty && !isDebt) { setError(t('La institución es obligatoria', 'Institution is required')); return }

    const qty = parseQuantity(form.quantity) || (isBank || isProperty ? 1 : 0)
    const price = parseAmount(form.purchasePrice)
    if (!isBank && price <= 0) { setError(t('El precio debe ser mayor a 0', 'Price must be greater than 0')); return }
    if (isMarketAsset && qty <= 0) { setError(t('La cantidad debe ser mayor a 0', 'Quantity must be greater than 0')); return }
    if (form.maturityDate && form.acquisitionDate && form.maturityDate < form.acquisitionDate) { setError(t('La fecha de vencimiento debe ser posterior a la de compra', 'Maturity date must be after acquisition date')); return }
    // At least one past payment is confirmed received, in cash: make sure
    // there's somewhere for that money to land, or it silently vanishes from
    // the destination account's balance.
    if (showIncome && !isMarketAsset && form.dividendAction !== 'reinvest' &&
        pastDuePayDates.some(d => !excludedPayDates.includes(d)) && !form.incomeDestination) {
      setError(t('Marcaste pagos como recibidos: elige a dónde llegó ese dinero', 'You marked payments as received: choose where that money went'))
      return
    }

    // Timeline mode: rows explain how the value was built over time. Validate
    // them and anchor the item's acquisitionDate on the earliest contribution.
    const curPrice0 = parseAmount(form.currentPrice)
    const tlTotal = isMarketAsset ? qty * price : qty * (curPrice0 || price)
    const useTimeline = isNewMoney && !isDebt && !duplicateWarning && valueTimeline === 'multi' && tlTotal > 0
    let tlRows = []
    if (useTimeline) {
      const tlError = validateTimelineRows(timelineRows, tlTotal, { requireExact: isMarketAsset, lang })
      if (tlError) { setError(tlError); return }
      tlRows = timelineRows
        .filter((r) => (parseAmount(r.amount)) > 0 && r.date)
        .sort((a, b) => a.date.localeCompare(b.date))
    }
    const effectiveAcqDate = useTimeline ? tlRows[0].date : form.acquisitionDate

    setSaving(true)
    try {
      const item = {
        type, currency: form.currency, institution: form.institution.trim(),
        acquisitionDate: effectiveAcqDate, accountType: form.accountType,
      }

      if (form.sector) item.sector = form.sector
      if (form.industry) item.industry = form.industry
      if (form.exchangeName) item.exchangeName = form.exchangeName

      if (isMarketAsset) {
        item.symbol = form.symbol.trim().toUpperCase()
        item.name = form.name.trim() || item.symbol
        item.quantity = qty
        item.purchasePrice = price
        if (divInfo?.hasDividend) {
          // marketDivOverride: the user corrected Yahoo's auto-detected
          // schedule by hand (¿cuándo paga?) — form.incomeRate/incomeMonths
          // win over divInfo. Same field names either way (incomeAmount/
          // incomeMonths/incomeFrequency/dividendYield), so nothing
          // downstream (EditAccountModal's `item.dividendYield > 0` gate,
          // projectItemAnnualIncome, getEffectiveYield) needs to know which
          // source it came from.
          item.incomeAmount = marketDivOverride ? 0 : (divInfo.lastAmount || 0)
          item.incomeMonths = marketDivOverride
            ? (form.incomeMonths.length > 0 ? form.incomeMonths : (divInfo.paymentMonths || []))
            : (divInfo.paymentMonths || [])
          item.incomeFrequency = divInfo.frequency
          item.dividendYield = marketDivOverride ? (parseAmount(form.incomeRate) || 0) : divInfo.dividendYield
          item.dividendAction = form.dividendAction || 'cash'
        }
      } else if (isProperty) {
        item.symbol = form.symbol.trim() || form.name.trim().replace(/\s+/g, '-').toUpperCase()
        item.name = form.name.trim()
        item.quantity = 1
        item.purchasePrice = price
        if (form.currentPrice) item.currentPrice = parseAmount(form.currentPrice)
        // Los cuatro campos del inmueble. Solo se escriben si tienen valor, y
        // NINGUNO entra a getItemValue: el vínculo con la hipoteca es de solo
        // lectura y el patrimonio no se mueve (lib/propertyEquity.js).
        if (form.downPayment) item.downPayment = parseAmount(form.downPayment)
        if (form.linkedDebtId) item.linkedDebtId = form.linkedDebtId
        if (form.adminFeeMonthly) item.adminFeeMonthly = parseAmount(form.adminFeeMonthly)
        if (form.propertyTaxAnnual) item.propertyTaxAnnual = parseAmount(form.propertyTaxAnnual)
      } else if (isBank) {
        item.symbol = form.symbol.trim() || `${form.institution.trim().replace(/\s+/g, '-').toUpperCase()}-${(form.name.trim() || 'CUENTA').replace(/\s+/g, '-').toUpperCase()}`
        item.name = form.name.trim() || `${form.institution.trim()} - ${t('Cuenta', 'Account')}`
        item.quantity = 1
        item.purchasePrice = price
        item.currentPrice = price
      } else {
        item.symbol = form.symbol.trim() || form.name.trim().replace(/\s+/g, '-').toUpperCase()
        item.name = form.name.trim()
        item.quantity = qty || 1
        item.purchasePrice = price
        if (form.currentPrice) item.currentPrice = parseAmount(form.currentPrice)
      }

      // Subtype
      if (subtype) item.subtype = subtype

      // FASE HV. El valor guardado de un activo que no cotiza es una FOTO de un
      // momento, y hasta ahora esa foto no llevaba fecha: la app aproximaba con
      // "¿el pago es del mes en curso o de un mes ya cerrado?", que falla en los
      // dos bordes (un cupón de hace tres días se acredita encima de un saldo
      // que ya lo contenía; un saldo tecleado hace dos meses no recibe ninguno
      // de los cupones posteriores). `balanceAsOf` responde la pregunta exacta:
      // desde cuándo es cierto lo que está guardado. Se sella al teclearlo, o
      // sea hoy, que es lo que el usuario pidió.
      // ⛔ FASE MS. El DIA LOCAL, nunca `toISOString()`, que devuelve el dia
      // UTC. La spec dice literal que este sello significa "hoy: el usuario
      // esta mirando el campo y apretando Guardar", y eso es el dia que el
      // usuario esta viviendo. En Guatemala (UTC-6) el dia UTC rota a las 6pm,
      // asi que guardar un saldo de noche lo sellaba con la fecha de MAÑANA, y
      // la regla del saldo es "HASTA balanceAsOf manda el saldo": un cupon del
      // dia siguiente quedaba dentro de la foto y NO se acreditaba nunca.
      // Reproducido: guardar a las 7pm del 31 de agosto sellaba 2026-09-01.
      if (!isMarketAsset) item.balanceAsOf = todayLocalISO()

      // Income config
      if (showIncome && !isMarketAsset && (form.incomeAmount || form.incomeRate || form.rateMin || form.rateType === 'continuous')) {
        item.incomeMode = form.incomeMode
        item.rateType = form.rateType
        if (form.rateType === 'variable') {
          item.rateMin = parseAmount(form.rateMin) || 0
          item.rateMax = parseAmount(form.rateMax) || 0
          item.incomeRate = (item.rateMin + item.rateMax) / 2
        } else if (form.incomeMode === 'percent') {
          item.incomeRate = parseAmount(form.incomeRate) || 0
        } else {
          item.incomeAmount = parseAmount(form.incomeAmount) || 0
        }
        if (isDaily && form.rateType !== 'continuous') {
          // FASE KT. El devengo diario no elige calendario: son los 12 meses,
          // el ultimo dia de cada uno. Los campos salen del helper compartido
          // para que el alta y la edicion no puedan escribir cosas distintas.
          item.accrual = ACCRUAL_DAILY
          Object.assign(item, dailyAccrualScheduleFields())
          item.businessDayRule = 'exact'
        } else if (form.rateType !== 'continuous') {
          // Acotado a 1..31: `min`/`max` de un input numérico no impiden TECLEAR
          // un 45. Un 31 sí es válido y significa "el último día del mes":
          // `clampPayDay` (lib/incomeSchedule.js) lo recorta mes a mes.
          item.incomePayDay = Math.min(31, Math.max(1, parseInt(form.incomePayDay) || 1))
          // incomeMonthsExplicit drives backfill of past payments and exempts the
          // asset from the duplicate-cleanup that would otherwise delete legit
          // semi-annual payments. Without it, a bond paying May/Nov never gets its
          // historical payments generated (matches EditAccountModal behavior).
          item.incomeMonthsExplicit = form.incomeMonths.length > 0
          item.incomeMonths = form.incomeMonths.length > 0 ? form.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
          item.businessDayRule = form.businessDayRule
        } else {
          item.accrualMethod = 'compound_continuous'
          item.incomeMonths = [0,1,2,3,4,5,6,7,8,9,10,11]
          item.incomeMonthsExplicit = true
        }
        item.paymentSchedule = form.paymentSchedule
        item.dividendAction = form.dividendAction || 'cash'
        if (form.dividendAction !== 'reinvest' && form.incomeDestination) item.incomeDestination = form.incomeDestination
        if (form.capitalReturn) {
          item.capitalReturn = parseAmount(form.capitalReturn) || 0
          if (form.capitalDestination) item.capitalDestination = form.capitalDestination
        }
        // Past-due payments the user marked "not received" — the automatic
        // backfill (useDashboardData) skips these dates instead of assuming
        // they happened just because the schedule says so.
        if (excludedPayDates.length > 0) item.excludedPayDates = excludedPayDates
      }

      // Costs — entry commission (one-time), management fee (recurring, nets
      // out of future income), expense ratio. Same fields EditAccountModal
      // already collects; only missing here at creation time.
      if (form.entryFee) {
        item.entryFee = parseAmount(form.entryFee) || 0
        item.entryFeeMode = form.entryFeeMode || 'separate'
      }
      if (form.managementFee) {
        item.managementFee = parseAmount(form.managementFee) || 0
        item.managementFeeType = form.managementFeeType || 'percent'
      }
      if (form.expenseRatio) item.expenseRatio = parseAmount(form.expenseRatio) || 0
      // Accrued interest paid to the seller at purchase (buying between coupon
      // dates) — informational: surfaced back to the user in the past-due
      // preview above so they know part of the first coupon isn't new gain.
      if (form.accruedInterestAtPurchase) item.accruedInterestAtPurchase = parseAmount(form.accruedInterestAtPurchase) || 0

      // Maturity
      if (form.maturityDate) {
        item.maturityDate = form.maturityDate
        item.maturityAction = form.maturityAction
        if (form.conversionDetails) item.conversionDetails = form.conversionDetails
      }

      // Illiquid
      if (form.isIlliquid) {
        item.isIlliquid = true
        item.valuationMethod = 'manual'
      }

      // Custody
      if (form.custodyType) {
        item.custodyType = form.custodyType
        if (form.custodyDetails) item.custodyDetails = form.custodyDetails
      }

      // Notes
      if (form.notes) item.notes = form.notes

      // Tax jurisdiction
      if (form.taxJurisdiction) item.taxJurisdiction = form.taxJurisdiction
      if (form.assetCountry) item.assetCountry = form.assetCountry

      // SAFE Note fields
      if (isAlternative && subtype === 'safe_note') {
        item.safeType = form.safeType
        if (form.safeCap) item.safeCap = parseAmount(form.safeCap) || 0
        if (form.safeDiscount) item.safeDiscount = parseAmount(form.safeDiscount) || 0
      }

      // VC/startup direct-investment fields — purely informational (cap-table
      // context: what stage, at what valuation, how much of the company). None
      // of it feeds the return formula: getItemPrincipalCost/getItemCostBasis
      // (⛔ congeladas) already have everything they need from
      // quantity/purchasePrice/entryFee, same as any other Alternativo.
      if (isAlternative && subtype === 'private_equity') {
        if (form.investmentStage) item.investmentStage = form.investmentStage
        if (form.roundValuation) item.roundValuation = parseAmount(form.roundValuation) || 0
        if (form.ownershipPct) item.ownershipPct = parseAmount(form.ownershipPct) || 0
        if (form.committedCapital) item.committedCapital = parseAmount(form.committedCapital) || 0
      }

      // Debt fields
      if (isDebt) {
        if (subtype === 'receivable') {
          item.isReceivable = true
        } else {
          item.isDebt = true
        }
        if (form.interestRate) item.interestRate = parseAmount(form.interestRate) || 0
        // El período viaja SIEMPRE que hay tasa: una tasa sin período es la
        // ambigüedad exacta que dejó un préstamo al 1.5% mensual leyéndose
        // como 1.5% anual (12x menos interés). FASE LT.
        if (form.interestRate) item.ratePeriod = form.ratePeriod === 'monthly' ? 'monthly' : 'annual'
        if (form.debtScheme) item.debtScheme = form.debtScheme
        if (form.originalPrincipal) item.originalPrincipal = parseAmount(form.originalPrincipal) || 0
        if (form.minimumPayment) item.minimumPayment = parseAmount(form.minimumPayment) || 0
        if (form.monthlyPayment) item.monthlyPayment = parseAmount(form.monthlyPayment) || 0
        if (form.debtTerm) item.debtTerm = form.debtTerm
        if (form.installmentsTotal) item.installmentsTotal = parseInt(form.installmentsTotal) || 0
        if (form.installmentsRemaining) item.installmentsRemaining = parseInt(form.installmentsRemaining) || 0
        const isCreditCard = subtype === 'credit_card'
        if (isCreditCard) {
          if (form.cardBrand) item.cardBrand = form.cardBrand
          if (form.rewardType) item.rewardType = form.rewardType
          if (form.rewardRate) item.rewardRate = parseAmount(form.rewardRate) || 0
          if (form.rewardBalance) item.rewardBalance = parseAmount(form.rewardBalance) || 0
        }
      }

      // Merge with existing if duplicate accepted
      if (duplicateWarning) {
        item.id = duplicateWarning.id
        if (isMarketAsset && item.quantity > 0) {
          const oldQty = duplicateWarning.quantity || 0
          const oldPrice = duplicateWarning.purchasePrice || 0
          item.quantity = oldQty + qty
          item.purchasePrice = oldQty + qty > 0 ? (oldQty * oldPrice + qty * price) / (oldQty + qty) : oldPrice
        }
      }

      // Dividend destination for a market asset (stock/crypto/fund): the user
      // picks it explicitly below (marketDivDestination), same widget as the
      // non-market flow (destItems + "crear cuenta nueva"). This used to
      // silently auto-create a generic "{Institution}-Cash" account and route
      // there without asking — correct for nothing but IBKR (which already
      // knows the real destination from its own cash transactions and never
      // reaches this branch: isMarketAsset here is only the manual-add flow).
      // Left unset, `income-no-dest` in lib/dataCompleteness.js already
      // surfaces this later via Enrich Data — better than inventing a
      // destination the user never chose.
      if (isMarketAsset && divInfo?.hasDividend && form.dividendAction === 'cash' && form.incomeDestination) {
        item.incomeDestination = form.incomeDestination
      }

      if (activePortfolio && activePortfolio !== '__all__') {
        item.portfolioId = activePortfolio
      }
      if (activeEntity && activeEntity !== 'default') {
        item.entityId = activeEntity
      }

      // The user already answered "¿de dónde vino este dinero?" right here in
      // this form — the data-completeness engine (lib/dataCompleteness.js)
      // must never ask it again for this item, no matter what happens to the
      // linked DEPOSIT transaction afterward (edited, or lost to some future
      // dedup pass). Answering once should mean once, or "Capturar historia"
      // reads as the app not having listened, and worse, invites a real
      // duplicate deposit from a well-meaning second click.
      // En el alta guiada NO se estampa: la marca existe para que la pregunta
      // "¿de dónde vino este dinero?" no vuelva después de haberla contestado
      // EXPLÍCITAMENTE, y el modo guiado nunca la muestra. El depósito de
      // apertura que se escribe abajo ya explica el saldo en el caso normal, así
      // que el hallazgo sigue callado; lo que se recupera es que vuelva a
      // preguntar cuando ese depósito falta o no alcanza, que es su trabajo.
      if (isNewMoney && !isDebt && !guidedType) item._newMoneyConfirmed = true

      // Same guardrails as file imports (future dates, absurd values, bad currency) —
      // manual entry previously skipped them entirely.
      const validationErrors = validateItem(item)
      if (validationErrors.length > 0) {
        setError(validationErrors.join(' · '))
        setSaving(false)
        return
      }

      const itemId = await onAdd(item)

      // On an "Add to position" merge the item now carries the COMBINED quantity
      // and weighted-average cost — the lot and the DEPOSIT must record only THIS
      // purchase, or the historical share count double-counts (old lots + combined).
      const isMerge = !!duplicateWarning && isMarketAsset
      const lotQty = isMerge ? qty : item.quantity
      const lotCost = isMerge ? price : item.purchasePrice

      if (useTimeline) {
        // One DEPOSIT (and one lot for share-based) PER contribution row, so
        // history steps up at each real date. The entered total IS the current
        // balance — rows explain it, nothing gets re-credited.
        for (const row of tlRows) {
          const rowAmt = Math.round((parseAmount(row.amount)) * 100) / 100
          if (onAddLot && item.symbol && isMarketAsset && price > 0 && !item.isDebt) {
            await onAddLot({
              symbol: (item.symbol || '').toUpperCase(),
              quantity: rowAmt / price,
              costBasis: price,
              currency: item.currency || 'USD',
              acquisitionDate: row.date,
              ...(activePortfolio && activePortfolio !== '__all__' ? { portfolioId: activePortfolio } : {}),
            })
          }
          if (onAddTransaction) {
            await onAddTransaction({
              type: 'DEPOSIT', symbol: item.symbol || '',
              description: `${item.name || item.symbol} - ${t('Aporte', 'Contribution')}`,
              date: row.date,
              totalAmount: rowAmt, currency: item.currency || 'USD',
              ...(itemId ? { _linkedItemId: itemId } : {}),
              ...(activeEntity && activeEntity !== 'default' ? { entityId: activeEntity } : {}),
              _source: 'manual_new_account',
            })
          }
        }
      } else {
        if (onAddLot && item.symbol && lotQty > 0 && lotCost > 0 && !item.isDebt) {
          await onAddLot({
            symbol: (item.symbol || '').toUpperCase(),
            quantity: lotQty,
            costBasis: lotCost,
            currency: item.currency || 'USD',
            acquisitionDate: item.acquisitionDate || new Date().toISOString().split('T')[0],
            ...(activePortfolio && activePortfolio !== '__all__' ? { portfolioId: activePortfolio } : {}),
          })
        }

        // Entry fee/brokerage cost adds to the DEPOSIT (the true cash that left
        // your pocket) but never to the item's own tracked value — so the return
        // calc sees "you put in 6098, the bond is worth 6000" and starts $98
        // down from day one, using the existing Modified Dietz math untouched
        // (deposits already net out of gain; no separate fee-aware code path).
        // 'deducted' means the fee came OUT of the amount typed, so the cash
        // that left the pocket is already that amount: adding it again would
        // overstate the deposit (and understate every return measured against it).
        // ⛔ LÓGICA CONGELADA (G). El DEPOSIT de apertura vale principal +
        // comisión y DEBE llevar _linkedItemId (el wrapper de onAdd tiene que
        // devolver el id, si no nace huérfano). Ver
        // lib/assetLogic/corporateBondWithEntryFee.js: PREGUNTAR antes de
        // cambiar esto.
        const feeOnEntry = (isMerge || form.entryFeeMode === 'deducted')
          ? 0
          : (parseAmount(form.entryFee) || 0)
        const singleDeposit = (isMerge ? lotQty * lotCost : (item.quantity || 1) * (item.purchasePrice || 0)) + feeOnEntry
        // ⛔ FASE LT: `!item.isDebt` no es un detalle. Este bloque NO tenía
        // guard de deuda, así que crear un préstamo escribía un DEPOSIT de
        // "dinero nuevo" por el saldo COMPLETO de la deuda: para el Dietz eso
        // es patrimonio que bajó B con un flujo de +B, o sea una "pérdida" de
        // 2B (crear una deuda de 4,000 se leía como perder 8,000, medido en el
        // YTD real del usuario). Una deuda registra su lado del dinero abajo,
        // con la pregunta de a dónde llegó el préstamo.
        if (isNewMoney && !item.isDebt && onAddTransaction && singleDeposit > 0) {
          await onAddTransaction({
            type: 'DEPOSIT', symbol: item.symbol || '',
            description: `${item.name || item.symbol} - ${t('Dinero nuevo', 'New money')}${feeOnEntry > 0 ? ` (${t('incl. corretaje', 'incl. brokerage')})` : ''}`,
            date: item.acquisitionDate || new Date().toISOString().split('T')[0],
            totalAmount: Math.round(singleDeposit * 100) / 100, currency: item.currency || 'USD',
            ...(itemId ? { _linkedItemId: itemId } : {}),
            ...(activeEntity && activeEntity !== 'default' ? { entityId: activeEntity } : {}),
            _source: 'manual_new_account',
          })
        }
      }

      // FASE LT: el lado del DINERO de un préstamo nuevo. Pedir prestado no
      // puede leerse como pérdida: o el dinero llegó a una cuenta registrada
      // (se acredita ahí y el registro es un TRANSFER, neto cero) o quedó
      // fuera del perímetro (un WITHDRAWAL lo dice y el Dietz queda en cero).
      // 'none' es la escotilla explícita: no registrar nada.
      if (item.isDebt && !duplicateWarning) {
        const debtAmt = (item.quantity || 1) * (item.purchasePrice || 0)
        const debtForTx = { ...item, id: itemId }
        const proceedsDate = item.acquisitionDate || new Date().toISOString().split('T')[0]
        if (debtAmt > 0 && itemId && onAddTransaction && loanProceeds !== 'none') {
          const destAcct = loanProceeds !== 'outside' ? existingItems.find(it => it.id === loanProceeds) : null
          if (destAcct && onExecuteContribution) {
            const { itemFields } = buildContributionFields({ item: destAcct, amount: debtAmt, date: proceedsDate, isAdd: true, currency: item.currency || 'USD' })
            await onExecuteContribution({ itemId: destAcct.id, itemFields })
            const tx = buildLoanProceedsTransaction({ debtItem: debtForTx, toItem: destAcct, amount: debtAmt, date: proceedsDate })
            if (tx) await onAddTransaction({ ...tx, ...(activeEntity && activeEntity !== 'default' ? { entityId: activeEntity } : {}) })
          } else {
            const tx = buildLoanProceedsOutsideTransaction({ debtItem: debtForTx, amount: debtAmt, date: proceedsDate })
            if (tx) await onAddTransaction({ ...tx, ...(activeEntity && activeEntity !== 'default' ? { entityId: activeEntity } : {}) })
          }
        }
      }

      const totalValue = isMerge ? lotQty * lotCost : (item.quantity || 1) * (item.purchasePrice || 0)

      if (!isNewMoney && form.capitalDestination && totalValue > 0) {
        const source = existingItems.find(it => it.id === form.capitalDestination)
        if (source) {
          const srcBal = (source.currentPrice || source.purchasePrice || 0) - totalValue
          await onAdd({ ...source, currentPrice: Math.max(0, srcBal), purchasePrice: Math.max(0, srcBal) })
        }
      }
      // En modo guiado el orquestador (GuidedSetup) decide qué sigue: avanzar al
      // activo siguiente o mostrar el cierre. Cerrar aquí lo sacaría del flujo.
      if (onSaved) onSaved(item)
      else onClose()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const inputCls = 'w-full min-w-0 px-3 py-2 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg text-sm text-[var(--text-primary,white)] placeholder-[var(--text-muted,#475569)] focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block font-medium'

  // ---- MODO GUIADO ----
  // Va DESPUÉS de todos los hooks a propósito: un return temprano entre hooks
  // cambia el conteo entre renders y tumba el árbol (regla dura de CLAUDE.md).
  if (guidedType) {
    const guidedFields = guidedFieldsFor({ type, isMarketAsset })
    const idx = Math.min(guidedIndex, guidedFields.length - 1)
    const exit = onExitGuided || onClose
    const goNext = () => {
      if (idx < guidedFields.length - 1) { setError(''); setGuidedIndex(idx + 1); return }
      handleSubmit({ preventDefault: () => {} })
    }
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={exit} role="dialog" aria-modal="true"
        style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
        <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <GuidedAssetSteps ctx={{
            t, form, set, type,
            typeLabel: currentTypeInfo ? t(currentTypeInfo.es, currentTypeInfo.en) : type,
            typeIcon: currentTypeInfo?.icon || '',
            isMarketAsset, isBank, isDebt, isProperty,
            fieldIndex: idx, fields: guidedFields, goNext,
            goBack: () => { setError(''); setGuidedIndex(Math.max(0, idx - 1)) },
            onExit: exit,
            searchResults, showDropdown, setShowDropdown, searchLoading, fetchingQuote, quoteFailed,
            handleSelectSymbol, inputRef, dropdownRef,
            filteredInstitutions, showInstSuggestions, setShowInstSuggestions,
            saving, error, progress: guidedProgress,
          }} />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-account-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#38383A)]">
          <div className="flex items-center gap-3">
            {step === 2 && <button onClick={() => setStep(1)} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-sm">←</button>}
            <h2 id="add-account-title" className="text-lg font-bold text-[var(--text-primary,white)]">
              {step === 1 ? t('Agregar Activo', 'Add Asset') : t('Detalles', 'Details')}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: step >= 1 ? 'var(--accent-blue-soft)' : 'var(--card-border, #38383A)' }} />
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: step >= 2 ? 'var(--accent-blue-soft)' : 'var(--card-border, #38383A)' }} />
            </div>
            <button onClick={onClose} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-xl leading-none" aria-label="Close add asset modal">&times;</button>
          </div>
        </div>

        <form onSubmit={step === 1 ? (e) => { e.preventDefault(); goToStep2() } : handleSubmit} className="p-6 space-y-4">
          {error && <div role="alert" aria-live="assertive" className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--text-negative) 10%, transparent)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--text-negative) 20%, transparent)', color: 'var(--text-negative)' }}>{error}</div>}

          {/* === STEP 1 === */}
          {step === 1 && (<>
            <div>
              <label className={labelCls}>{t('Tipo de activo', 'Asset type')}</label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {TYPES.map(tp => (
                  <button key={tp.key} type="button" onClick={() => { setType(tp.key); setSubtype(''); setForm(prev => ({ ...prev, symbol: '', name: '', purchasePrice: '', currentPrice: '', sector: '', industry: '', isIlliquid: false, custodyType: '', maturityDate: '' })); setDivInfo(null); setMarketDivOverride(false); setValueTimeline('single'); setTimelineRows([]); setExcludedPayDates([]) }}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-all text-center border ${
                      type !== tp.key ? 'bg-[var(--input-bg,#000000)] border-[var(--card-border,#38383A)] text-[var(--text-secondary,#94a3b8)] hover:border-[var(--text-secondary,#94a3b8)]' : ''
                    }`}
                    style={type === tp.key ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : undefined}>
                    <span className="text-lg">{tp.icon}</span>
                    <span className="text-xs font-medium">{lang === 'es' ? tp.es : tp.en}</span>
                  </button>
                ))}
              </div>
              {currentTypeInfo?.subtypes && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {currentTypeInfo.subtypes.map(st => (
                    <button key={st.key} type="button" onClick={() => setSubtype(st.key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all border ${
                        subtype !== st.key ? 'bg-[var(--input-bg,#000000)] text-[var(--text-muted,#475569)] border-[var(--card-border,#38383A)] hover:border-[var(--text-secondary,#94a3b8)]' : ''
                      }`}
                      style={subtype === st.key ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : undefined}>
                      {lang === 'es' ? st.es : st.en}
                    </button>
                  ))}
                </div>
              )}
              {/* Un pasivo no es un activo de inversión más entre las opciones
                  de arriba: es la única categoría que RESTA del patrimonio y
                  nunca tiene retorno. Mismo texto que la fila "Pasivos" del
                  Spreadsheet (components/dashboard/utils.js DEBT_CLARIFICATION),
                  para no decir dos cosas distintas del mismo concepto. */}
              {type === 'Debt' && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  {DEBT_CLARIFICATION[lang]}
                </p>
              )}
            </div>

            {/* Market asset search */}
            {isMarketAsset && (
              <div className="space-y-3">
                <div className="relative">
                  <label htmlFor="add-symbol" className={labelCls}>
                    {t('Buscar activo', 'Search asset')} *
                    <span className="text-[var(--text-muted,#475569)] ml-1 font-normal">
                      {type === 'Stock' ? '(AAPL, Apple...)' : type === 'Crypto' ? '(BTC, Bitcoin...)' : '(VOO, Vanguard...)'}
                    </span>
                  </label>
                  <div className="relative">
                    <input id="add-symbol" ref={inputRef} value={form.symbol}
                      onChange={e => { set('symbol', e.target.value); setShowDropdown(true) }}
                      onFocus={() => { if (searchResults.length > 0) setShowDropdown(true) }}
                      placeholder={type === 'Stock' ? 'AAPL' : type === 'Crypto' ? 'BTC' : 'VOO'}
                      autoComplete="off" className={inputCls + ' pr-8'} />
                    {(searchLoading || fetchingQuote) && (
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                        <BusyRing size="14px" style={{ color: 'var(--accent-blue)' }} />
                      </div>
                    )}
                  </div>
                  {showDropdown && searchResults.length > 0 && (
                    <div ref={dropdownRef} className="absolute z-50 w-full mt-1 bg-[var(--card-bg,#1C1C1E)] border border-[var(--card-border,#475569)] rounded-lg shadow-xl max-h-56 overflow-y-auto">
                      {searchResults.map((r, i) => (
                        <button key={`${r.symbol}-${i}`} type="button" onClick={() => handleSelectSymbol(r)}
                          className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-[var(--input-bg,#2C2C2E)] transition-colors text-left border-b border-[var(--card-border,#38383A)]/50 last:border-0">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xs font-bold shrink-0 px-1.5 py-0.5 rounded" style={{
                              color: r.type === 'Crypto' ? 'var(--accent-orange)' : r.type === 'Fund' ? 'var(--accent-purple)' : 'var(--accent-blue-soft)',
                              backgroundColor: r.type === 'Crypto' ? 'color-mix(in srgb, var(--accent-orange) 20%, transparent)' : r.type === 'Fund' ? 'color-mix(in srgb, var(--accent-purple) 20%, transparent)' : 'color-mix(in srgb, var(--accent-blue) 20%, transparent)',
                            }}>{r.symbol}</span>
                            <span className="text-xs text-[var(--text-secondary,#cbd5e1)] truncate">{r.name}</span>
                          </div>
                          <span className="text-xs text-[var(--text-muted,#475569)] shrink-0 ml-2">{r.exchange}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {form.name && (
                  <div className="flex items-center justify-between bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg px-3 py-2">
                    <span className="text-sm text-[var(--text-primary,white)]">{form.name}</span>
                    <div className="flex items-center gap-2">
                      {form.sector && <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' }}>{form.sector}</span>}
                      {fetchingQuote ? (
                        <BusyRing size="12px" style={{ color: 'var(--accent-blue)' }} />
                      ) : form.purchasePrice ? (
                        <span className="text-xs font-medium" style={{ color: 'var(--accent-green)' }}>{form.currency} {parseAmount(form.purchasePrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      ) : null}
                    </div>
                  </div>
                )}
                {quoteFailed && !fetchingQuote && (
                  <p className="text-xs" style={{ color: 'var(--alert-warn-icon)' }}>
                    {t(`No pudimos traer el precio de ${form.symbol}. Ponelo a mano abajo.`,
                       `We could not fetch a price for ${form.symbol}. Enter it by hand below.`)}
                  </p>
                )}
              </div>
            )}

            {/* Non-market: name */}
            {!isMarketAsset && (
              <div>
                <label htmlFor="add-name" className={labelCls}>
                  {isBank ? t('Banco', 'Bank') : t('Nombre / Descripción', 'Name / Description')} *
                </label>
                {isBank ? (
                  <input id="add-name" value={form.institution} onChange={e => { set('institution', e.target.value); const hint = detectCurrency(e.target.value); if (hint) set('currency', hint) }}
                    placeholder={t('BAM, BI, Banrural...', 'Chase, BoA...')} className={inputCls} />
                ) : (
                  <input id="add-name" value={form.name} onChange={e => set('name', e.target.value)}
                    placeholder={isDebt ? t('Hipoteca casa, Tarjeta...', 'Home mortgage, Credit card...') : isBond ? t('Bono Corporativo IDC', 'IDC Corporate Bond') : isAlternative ? t('Club Cash In', 'Club Cash In') : isProperty ? t('Apartamento Centro', 'Downtown Apartment') : t('CDT Banco Industrial', 'Certificate of Deposit')}
                    className={inputCls} />
                )}
              </div>
            )}

            {isBank && (
              <div>
                <label htmlFor="add-accountName" className={labelCls}>{t('Nombre de cuenta', 'Account name')}</label>
                <input id="add-accountName" value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder={t('Cuenta de ahorro', 'Savings account')} className={inputCls} />
              </div>
            )}

            {/* Institution with autocomplete (for non-bank, since bank already shows it) */}
            {!isBank && (
              <div className="relative">
                <label htmlFor="add-institution" className={labelCls}>{t('Institución / Broker', 'Institution / Broker')} *</label>
                <input id="add-institution" value={form.institution} onChange={e => { set('institution', e.target.value); setShowInstSuggestions(true); const hint = detectCurrency(e.target.value); if (hint && form.currency === 'USD') set('currency', hint) }}
                  onFocus={() => setShowInstSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowInstSuggestions(false), 200)}
                  placeholder={isProperty ? t('Propio, Inmobiliaria...', 'Self, Agency...') : 'IBKR, Fidelity, Binance...'}
                  className={inputCls} />
                {showInstSuggestions && filteredInstitutions.length > 0 && form.institution !== filteredInstitutions[0] && (
                  <div className="absolute z-40 w-full mt-1 bg-[var(--card-bg,#1C1C1E)] border border-[var(--card-border,#475569)] rounded-lg shadow-xl max-h-32 overflow-y-auto">
                    {filteredInstitutions.map(inst => (
                      <button key={inst} type="button" onClick={() => { set('institution', inst); setShowInstSuggestions(false) }}
                        className="w-full px-3 py-2 text-left text-sm text-[var(--text-secondary,#cbd5e1)] hover:bg-[var(--input-bg,#2C2C2E)] transition-colors">
                        {inst}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Duplicate warning */}
            {duplicateWarning && (
              <div className="p-3 rounded-lg space-y-2" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-orange) 10%, transparent)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--accent-orange) 30%, transparent)' }}>
                <p className="text-xs font-medium" style={{ color: 'var(--accent-orange)' }}>{t('Este activo ya existe en tu portafolio', 'This asset already exists in your portfolio')}</p>
                <p className="text-xs text-[var(--text-secondary,#94a3b8)]">{duplicateWarning.name} ({duplicateWarning.institution || '-'}): {duplicateWarning.quantity} @ {duplicateWarning.currency}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setStep(2) }}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-orange) 20%, transparent)', color: 'var(--accent-orange)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--accent-orange) 40%, transparent)' }}>
                    <span className="block">{t('Agregar a posición', 'Add to position')}</span>
                    <span className="block text-xs opacity-70 mt-0.5">{t('Combina cantidades y recalcula costo', 'Combines quantities and recalculates cost')}</span>
                  </button>
                  <button type="button" onClick={() => { setDuplicateWarning(null); setStep(2) }}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded bg-[var(--input-bg,#000000)] text-[var(--text-secondary,#94a3b8)] border border-[var(--card-border,#38383A)]">
                    <span className="block">{t('Crear separado', 'Create separate')}</span>
                    <span className="block text-xs opacity-70 mt-0.5">{t('Ej. mismo activo en otro broker', 'E.g. same asset at another broker')}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 border border-[var(--card-border,#38383A)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-[var(--input-bg,#2C2C2E)] transition-colors text-sm">
                {t('Cancelar', 'Cancel')}
              </button>
              <button type="submit"
                className="flex-1 py-2.5 bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium" style={{ color: '#ffffff' }}>
                {t('Siguiente', 'Next')} →
              </button>
            </div>
          </>)}

          {/* === STEP 2 === */}
          {step === 2 && (<>
            {/* Position details */}
            {isMarketAsset && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-quantity" className={labelCls}>{t('Cantidad', 'Quantity')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                  {/* Todos los campos de monto de este formulario son type="text"
                      + inputMode="decimal", nunca type="number": con teclado en
                      español el separador decimal es COMA, y un input numérico
                      devuelve '' ante lo que no puede parsear, o sea se borra
                      solo tecla por tecla ("BTC no me dejaba poner 0.0001").
                      Quien LEE es parseQuantity/parseAmount, que entienden las
                      dos convenciones; las dos mitades van juntas o no sirve. */}
                  <input id="add-quantity" value={form.quantity} onChange={e => set('quantity', e.target.value)}
                    placeholder={type === 'Crypto' ? '0.5' : '10'} type="text" inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="add-purchasePrice" className={labelCls}>{t('Precio de entrada', 'Entry price')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                  <input id="add-purchasePrice" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                    placeholder="150.00" type="text" inputMode="decimal" className={inputCls} title={t('Precio por unidad/acción', 'Price per unit/share')} />
                </div>
              </div>
            )}

            {isProperty && (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="add-propertyPurchasePrice" className={labelCls}>{t('Lo que pagaste', 'What you paid')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                    <input id="add-propertyPurchasePrice" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                      placeholder="85000" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-propertyCurrentPrice" className={labelCls}>{t('Valor de hoy', 'Value today')} <span style={{ color: 'var(--text-muted)' }}>({t('opcional', 'optional')})</span></label>
                    <input id="add-propertyCurrentPrice" value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                      placeholder="95000" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted,#475569)' }}>
                  {t('Si dejas "Valor de hoy" vacío, usamos lo que pagaste.', 'If you leave "Value today" empty, we use what you paid.')}
                </p>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label htmlFor="add-downPayment" className={labelCls}>
                      {t('Enganche', 'Down payment')} <span style={{ color: 'var(--text-muted)' }}>({t('opcional', 'optional')})</span>
                    </label>
                    <input id="add-downPayment" value={form.downPayment} onChange={e => set('downPayment', e.target.value)}
                      placeholder="20000" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-linkedDebtId" className={labelCls}>
                      {t('Préstamo que la financia', 'Loan financing it')}
                      <InfoTip text={t('Si la compraste con un préstamo, vinculalo y calculamos solos cuánto llevas pagado, cuánto falta y tu capital propio. No cambia tu patrimonio: la deuda ya resta por su cuenta.',
                                       'If you bought it with a loan, link it and we work out how much you have paid, how much is left, and your equity. It does not change your net worth: the debt already subtracts on its own.')} />
                    </label>
                    {propertyDebtOptions.length > 0 ? (
                      <select id="add-linkedDebtId" value={form.linkedDebtId}
                        onChange={e => set('linkedDebtId', e.target.value)} className={inputCls}>
                        <option value="">{t('-- Sin préstamo --', '-- No loan --')}</option>
                        {propertyDebtOptions.map(d => (
                          <option key={d.id} value={d.id}>
                            {d.name || d.symbol}{d.subtype === 'mortgage' ? ` (${t('hipoteca', 'mortgage')})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      /* Sin ninguna deuda cargada no se ofrece "crear una": el
                         widget que existe (InlineCreateAccount) crea un ACTIVO,
                         no una deuda, así que ofrecerlo llevaría al lugar
                         equivocado. Se dice dónde está el camino real. */
                      <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>
                        {t('Todavía no tienes ningún préstamo cargado. Agregalo con "Nuevo → Deuda" y después vinculalo desde aquí.',
                           'You have no loan on file yet. Add it with "New → Debt" and link it from here afterwards.')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label htmlFor="add-adminFeeMonthly" className={labelCls}>
                      {t('Admin / mantenimiento', 'HOA / upkeep')} <span style={{ color: 'var(--text-muted)' }}>({t('al mes', 'monthly')})</span>
                    </label>
                    <input id="add-adminFeeMonthly" value={form.adminFeeMonthly} onChange={e => set('adminFeeMonthly', e.target.value)}
                      placeholder="150" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-propertyTaxAnnual" className={labelCls}>
                      {t('Impuesto', 'Property tax')} <span style={{ color: 'var(--text-muted)' }}>({t('al año', 'yearly')})</span>
                    </label>
                    <input id="add-propertyTaxAnnual" value={form.propertyTaxAnnual} onChange={e => set('propertyTaxAnnual', e.target.value)}
                      placeholder="1200" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted,#475569)' }}>
                  {t('Las reparaciones no van aquí: son irregulares, se registran una por una como gasto y quedan con su fecha.',
                     'Repairs do not go here: they are irregular, you log each one as an expense and it keeps its date.')}
                </p>
              </div>
            )}

            {isBank && (
              <div>
                <label htmlFor="add-balance" className={labelCls}>{t('Saldo actual', 'Current balance')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                <input id="add-balance" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                  placeholder="5000" type="text" inputMode="decimal" className={inputCls} />
              </div>
            )}

            {/* Bonds: one fixed amount, no "today's value" — a bond doesn't
                trade at a changing mark for this user's holding, it sits at
                face value until maturity and pays out through the interest
                schedule below into whatever account you route it to. */}
            {isBond && (
              <div>
                <label htmlFor="add-amountInvested" className={labelCls}>{t('Monto del bono', 'Bond amount')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                <input id="add-amountInvested" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                  placeholder="10000" type="text" inputMode="decimal" className={inputCls} />
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted,#475569)' }}>
                  {t('Se mantiene fijo hasta el vencimiento. Los pagos de interés van a la cuenta que elijas más abajo.', 'Stays fixed until maturity. Interest payments go to the account you pick below.')}
                </p>
              </div>
            )}

            {isAlternative && (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="add-amountInvested" className={labelCls}>{t('Lo que invertiste', 'What you invested')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                    <input id="add-amountInvested" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                      placeholder="10000" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-currentValue" className={labelCls}>{t('Valor de hoy', 'Value today')} <span style={{ color: 'var(--text-muted)' }}>({t('opcional', 'optional')})</span></label>
                    <input id="add-currentValue" value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                      placeholder="10800" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted,#475569)' }}>
                  {t('Si dejas "Valor de hoy" vacío, usamos lo que invertiste.', 'If you leave "Value today" empty, we use what you invested.')}
                </p>
              </div>
            )}

            {/* Soft double-check: does the entered current value match what the rate implies?
                Non-blocking — the user can save regardless or leave the field empty. Bonds
                no longer have a "today value" input, so this is Alternative-only now. */}
            {isAlternative && (() => {
              const invested = parseAmount(form.purchasePrice)
              const entered = parseAmount(form.currentPrice)
              const rate = form.incomeMode === 'percent' ? (parseAmount(form.incomeRate) || 0) : 0
              if (!entered || !invested || !rate || !form.acquisitionDate) return null
              const yearsHeld = Math.max(0, (Date.now() - new Date(form.acquisitionDate).getTime()) / (365.25 * 86400000))
              const implied = invested + invested * (rate / 100) * yearsHeld
              if (implied <= 0) return null
              const diffPct = Math.abs(entered - implied) / implied * 100
              if (diffPct <= 5) return null
              return (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-orange)' }}>
                  ⚠ {t(
                    `El valor actual (${entered.toLocaleString()}) no coincide con lo que implica la tasa (~${implied.toFixed(0)}). Puedes guardarlo igual.`,
                    `Current value (${entered.toLocaleString()}) doesn't match what the rate implies (~${implied.toFixed(0)}). You can still save.`
                  )}
                </p>
              )
            })()}

            {/* Debt fields */}
            {isDebt && (
              <div className="rounded-lg p-3 space-y-3" style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--text-negative) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--text-negative) 5%, transparent)' }}>
                <p className="text-xs font-medium" style={{ color: 'var(--text-negative)' }}>
                  {subtype === 'receivable' ? t('Cuenta por Cobrar', 'Receivable') : t('Deuda / Pasivo', 'Debt / Liability')}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="add-debtBalance" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Saldo actual', 'Current balance')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                    <input id="add-debtBalance" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                      placeholder="50000" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-interestRate" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa de interés %', 'Interest rate %')}</label>
                    <div className="flex gap-2">
                      <input id="add-interestRate" value={form.interestRate} onChange={e => set('interestRate', e.target.value)}
                        placeholder="7.5" type="text" inputMode="decimal" className={inputCls} />
                      {/* El período NO es decoración: un préstamo familiar al
                          1.5% MENSUAL leído como anual calcula 12x menos
                          interés. FASE LT. */}
                      <select aria-label={t('Período de la tasa', 'Rate period')} value={form.ratePeriod} onChange={e => set('ratePeriod', e.target.value)} className={inputCls} style={{ maxWidth: '7.5rem' }}>
                        <option value="annual">{t('% anual', '% yearly')}</option>
                        <option value="monthly">{t('% mensual', '% monthly')}</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="add-debtScheme" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('¿Cómo se paga?', 'How is it paid?')}</label>
                    <select id="add-debtScheme" value={form.debtScheme} onChange={e => set('debtScheme', e.target.value)} className={inputCls}>
                      <option value="">{t('-- Automático --', '-- Automatic --')}</option>
                      <option value="amortizing">{t('Cuota fija (banco)', 'Fixed installment (bank)')}</option>
                      <option value="interest_only">{t('Interés sobre saldo, capital libre', 'Interest on balance, principal free')}</option>
                      <option value="revolving">{t('Revolvente (tarjeta)', 'Revolving (card)')}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="add-originalPrincipal" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Monto original (opcional)', 'Original amount (optional)')}</label>
                    <input id="add-originalPrincipal" value={form.originalPrincipal} onChange={e => set('originalPrincipal', e.target.value)}
                      placeholder="50000" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="add-debtTerm" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Plazo', 'Term')}</label>
                    <select id="add-debtTerm" value={form.debtTerm} onChange={e => set('debtTerm', e.target.value)} className={inputCls}>
                      <option value="">{t('-- Plazo --', '-- Term --')}</option>
                      <option value="3m">3 {t('meses', 'months')}</option>
                      <option value="6m">6 {t('meses', 'months')}</option>
                      <option value="12m">12 {t('meses', 'months')}</option>
                      <option value="24m">24 {t('meses', 'months')}</option>
                      <option value="36m">36 {t('meses', 'months')}</option>
                      <option value="payday">{t('Día de pago', 'Payday')}</option>
                      <option value="revolving">Revolving</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="add-installmentsTotal" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Cuotas total', 'Total pmts')}</label>
                    <input id="add-installmentsTotal" value={form.installmentsTotal} onChange={e => set('installmentsTotal', e.target.value)}
                      placeholder="24" type="number" inputMode="numeric" step="1" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-installmentsRemaining" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Cuotas rest.', 'Pmts left')}</label>
                    <input id="add-installmentsRemaining" value={form.installmentsRemaining} onChange={e => set('installmentsRemaining', e.target.value)}
                      placeholder="18" type="number" inputMode="numeric" step="1" className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="add-monthlyPayment" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Pago mensual', 'Monthly payment')}</label>
                    <input id="add-monthlyPayment" value={form.monthlyPayment} onChange={e => set('monthlyPayment', e.target.value)}
                      placeholder="500" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-debtMaturityDate" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Fecha vencimiento', 'Maturity date')}</label>
                    <input id="add-debtMaturityDate" value={form.maturityDate} onChange={e => set('maturityDate', e.target.value)}
                      type="date" className={inputCls} />
                  </div>
                </div>
                {subtype !== 'receivable' && (
                  <DebtBreakdownPreview
                    lang={lang}
                    currency={form.currency || 'USD'}
                    balance={parseAmount(form.purchasePrice) || 0}
                    draft={{
                      isDebt: true,
                      subtype,
                      interestRate: parseAmount(form.interestRate) || 0,
                      ratePeriod: form.ratePeriod,
                      debtScheme: form.debtScheme || undefined,
                      monthlyPayment: parseAmount(form.monthlyPayment) || 0,
                      minimumPayment: parseAmount(form.minimumPayment) || 0,
                      installmentsRemaining: parseInt(form.installmentsRemaining) || 0,
                      maturityDate: form.maturityDate || '',
                    }}
                  />
                )}
                {subtype === 'credit_card' && (
                  <div className="border-t pt-3 space-y-3" style={{ borderColor: 'color-mix(in srgb, var(--text-negative) 10%, transparent)' }}>
                    <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-negative)' }}>{t('Tarjeta de crédito', 'Credit Card')}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="add-cardBrand" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Marca', 'Brand')}</label>
                        <select id="add-cardBrand" value={form.cardBrand} onChange={e => set('cardBrand', e.target.value)} className={inputCls}>
                          <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                          <option value="visa">Visa</option>
                          <option value="mastercard">Mastercard</option>
                          <option value="amex">American Express</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="add-rewardType" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tipo reward', 'Reward type')}</label>
                        <select id="add-rewardType" value={form.rewardType} onChange={e => set('rewardType', e.target.value)} className={inputCls}>
                          <option value="">{t('Ninguno', 'None')}</option>
                          <option value="miles">{t('Millas', 'Miles')}</option>
                          <option value="cashback">Cashback</option>
                          <option value="points">{t('Puntos', 'Points')}</option>
                        </select>
                      </div>
                    </div>
                    {form.rewardType && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="add-rewardRate" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa reward %', 'Reward rate %')}</label>
                          <input id="add-rewardRate" value={form.rewardRate} onChange={e => set('rewardRate', e.target.value)}
                            placeholder="1.5" type="text" inputMode="decimal" className={inputCls} />
                        </div>
                        <div>
                          <label htmlFor="add-rewardBalance" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Balance acumulado', 'Accumulated')}</label>
                          <input id="add-rewardBalance" value={form.rewardBalance} onChange={e => set('rewardBalance', e.target.value)}
                            placeholder="5000" type="text" inputMode="decimal" className={inputCls} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Currency (account type moved into Advanced: the taxable/retirement
                distinction confused most users and 'taxable' is the right default) */}
            <div>
              <label htmlFor="add-currency" className={labelCls}>
                {t('Moneda', 'Currency')} <span style={{ color: 'var(--text-negative)' }}>*</span>
              </label>
              {/* FASE IF (lo ÚNICO que el usuario pidió aquí): al registrar a
                  mano una acción de otro país, el campo tiene que mostrar la
                  moneda de ESE país. La moneda detectada del quote (ej. 'GBp'
                  de la Bolsa de Londres) puede no estar en la lista fija, y un
                  <select> con un value fuera de sus opciones RENDERIZA la
                  primera (USD): se leía "USD · Auto-detected" sobre un precio
                  de Londres, y cualquiera concluye que la plataforma está
                  leyendo mal la moneda. La opción detectada se agrega al frente
                  para que lo que se ve sea siempre lo que se guarda. Cambio de
                  DISPLAY: no toca ninguna conversión. */}
              <select id="add-currency" value={form.currency} onChange={e => set('currency', e.target.value)} className={inputCls}>
                {currencyOptions(form.currency).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {detectedCurrency && form.currency === detectedCurrency && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-green)' }}>✓ {t('Detectada automáticamente', 'Auto-detected')}</p>
              )}
            </div>

            {/* Acquisition date */}
            <div>
              <label htmlFor="add-acquisitionDate" className={labelCls}>
                {isBank ? t('Fecha de apertura', 'Opening date') : t('Fecha de compra', 'Purchase date')} <span style={{ color: 'var(--text-negative)' }}>*</span>
              </label>
              <input id="add-acquisitionDate" value={form.acquisitionDate} onChange={e => set('acquisitionDate', e.target.value)}
                type="date" max={new Date().toISOString().split('T')[0]} className={inputCls}
                disabled={valueTimeline === 'multi'} />
              {valueTimeline === 'multi' && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-blue)' }}>
                  {t('Se toma de la primera fila del historial de aportes.', 'Taken from the first row of the contribution history.')}
                </p>
              )}
              {/* The default is TODAY — if the user already held this asset and
                  keeps the default, every history engine treats it as nonexistent
                  before today (flat/empty past + wrong returns). Nudge hard. */}
              <p className="text-xs mt-1" style={{ color: 'var(--accent-orange)' }}>
                {t('Si ya lo tenías desde antes, usa la fecha REAL: el historial y los retornos arrancan en esta fecha.',
                   'If you already held this, use the REAL date: history and returns start from this date.')}
              </p>
            </div>

            {/* Dividend info for market assets */}
            {isMarketAsset && divLoading && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted,#475569)] py-1">
                <BusyRing size="12px" />
                {t('Buscando dividendos...', 'Looking up dividends...')}
              </div>
            )}
            {isMarketAsset && divInfo?.hasDividend && (
              <div className="rounded-lg p-3 space-y-3" style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 5%, transparent)' }}>
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-400 text-xs font-medium">💰 {t('Dividendo detectado', 'Dividend detected')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-[var(--text-muted,#475569)]">{t('Rendimiento', 'Yield')}</p>
                    <p className="text-sm font-semibold text-emerald-400">{divInfo.dividendYield}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-muted,#475569)]">{t('Frecuencia', 'Frequency')}</p>
                    <p className="text-sm font-semibold text-[var(--text-primary,white)] capitalize">
                      {{ monthly: t('Mensual','Monthly'), quarterly: t('Trimestral','Quarterly'), semiannual: t('Semestral','Semiannual'), annual: t('Anual','Annual') }[divInfo.frequency] || divInfo.frequency}
                    </p>
                  </div>
                  <div>
                    {/* FASE II: la etiqueta dice qué fecha ES. Cuando Yahoo da
                        la fecha de PAGO real (calendarEvents), se muestra como
                        "Próximo pago". Cuando solo hay la proyección desde el
                        historial, esa fecha es el EX-DIVIDENDO (el dinero
                        llega de 0 días a ~3 meses después, según el mercado:
                        verificado en 5 bolsas) y rotularla "pago" mentía. */}
                    <p className="text-xs text-[var(--text-muted,#475569)]">
                      {divInfo.paymentDateIsReal ? t('Próximo pago', 'Next payment') : t('Próx. ex-dividendo', 'Next ex-dividend')}
                    </p>
                    <p className="text-sm font-semibold text-[var(--text-primary,white)]">{divInfo.nextPaymentDate?.slice(5)}</p>
                  </div>
                </div>

                {/* Automático por default; el link solo aparece si Yahoo trae
                    algo mal o incompleto y hace falta corregirlo a mano.
                    Seedea con lo detectado para no partir de campos vacíos. */}
                {!marketDivOverride ? (
                  <button type="button" onClick={() => {
                    set('incomeMode', 'percent')
                    set('incomeRate', divInfo.dividendYield ?? '')
                    set('incomeMonths', divInfo.paymentMonths || [])
                    if (divInfo.nextPaymentDate) {
                      const day = parseInt(divInfo.nextPaymentDate.slice(8, 10), 10)
                      if (day) set('incomePayDay', day)
                    }
                    setMarketDivOverride(true)
                  }} className="text-xs underline" style={{ color: 'var(--text-muted,#475569)' }}>
                    ✏️ {t('Editar manualmente (si Yahoo trae algo mal)', 'Edit manually (if Yahoo has it wrong)')}
                  </button>
                ) : (
                  <div className="space-y-2 pt-1 border-t border-glass-border/50">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Rendimiento anual %', 'Annual yield %')}</label>
                        <input value={form.incomeRate} onChange={e => set('incomeRate', e.target.value)}
                          placeholder={String(divInfo.dividendYield ?? '')} type="text" inputMode="decimal" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Día de pago', 'Pay day')}</label>
                        <input value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                          placeholder="15" type="number" inputMode="numeric" min="1" max="31" className={inputCls} />
                      {payDayHint && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{payDayHint}</p>}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-muted,#475569)] mb-1.5 block">{t('¿En qué meses paga?', 'Which months does it pay?')}</label>
                      <div className="flex flex-wrap gap-1">
                        {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((label, i) => {
                          const active = form.incomeMonths.includes(i)
                          return (
                            <button key={i} type="button"
                              onClick={() => set('incomeMonths', active ? form.incomeMonths.filter(x => x !== i) : [...form.incomeMonths, i].sort((a, b) => a - b))}
                              className="px-2 py-1 text-xs font-medium rounded transition-all border"
                              style={active ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 25%, transparent)', color: 'var(--accent-blue)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <button type="button" onClick={() => setMarketDivOverride(false)}
                      className="text-xs underline" style={{ color: 'var(--text-muted,#475569)' }}>
                      {t('Usar lo detectado automáticamente', 'Use the auto-detected values')}
                    </button>
                  </div>
                )}

                <div>
                  <p className="text-xs text-[var(--text-muted,#475569)] mb-1">{t('¿Qué hacer con dividendos?', 'What to do with dividends?')}</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => set('dividendAction', 'cash')}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border ${form.dividendAction !== 'cash' ? 'bg-[var(--input-bg,#000000)] text-[var(--text-muted,#475569)] border-[var(--card-border,#38383A)]' : ''}`}
                      style={form.dividendAction === 'cash' ? { color: 'var(--accent-cyan)', backgroundColor: 'rgba(6,182,212,0.2)', borderColor: 'rgba(6,182,212,0.4)' } : undefined}>
                      💵 {t('Efectivo', 'Cash')}
                    </button>
                    <button type="button" onClick={() => set('dividendAction', 'reinvest')}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border ${form.dividendAction !== 'reinvest' ? 'bg-[var(--input-bg,#000000)] text-[var(--text-muted,#475569)] border-[var(--card-border,#38383A)]' : ''}`}
                      style={form.dividendAction === 'reinvest' ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : undefined}>
                      🔄 {t('Reinvertir', 'Reinvest')}
                    </button>
                  </div>
                </div>

                {/* Opcional a propósito: sin flex query de por medio nadie
                    sabe todavía a qué cuenta cae el efectivo, y adivinar acá
                    (auto-crear una cuenta genérica) es peor que preguntar
                    después. Dejarlo en blanco es válido: el hallazgo
                    income-no-dest de Enrich Data (lib/dataCompleteness.js)
                    lo agarra más adelante, con la misma pregunta. IBKR nunca
                    llega a este flujo: su Flex Query ya trae el destino real
                    de cada dividendo como una transacción de cash propia. */}
                {form.dividendAction === 'cash' && (
                  <div>
                    <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('¿A dónde llega el efectivo?', 'Where does the cash land?')}</label>
                    <select value={form.incomeDestination}
                      onChange={e => { if (e.target.value === '__new__') { setCreatingDest('income'); return } set('incomeDestination', e.target.value) }}
                      className={inputCls}>
                      <option value="">{t('-- Sin definir todavía --', '-- Not set yet --')}</option>
                      {destItems.map(it => <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}</option>)}
                      {onCreateDestination && <option value="__new__">+ {t('Crear cuenta nueva', 'Create new account')}</option>}
                    </select>
                    {creatingDest === 'income' && onCreateDestination && (
                      <InlineCreateAccount onCreate={onCreateDestination} onCancel={() => setCreatingDest(null)}
                        onCreated={(id, it) => handleDestCreated('incomeDestination', id, it)} lang={lang} defaultCurrency={form.currency}
                        sourceAcquisitionDate={form.acquisitionDate || null} />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Income config toggle for non-market */}
            {!isMarketAsset && (
              <button type="button" onClick={() => setShowIncome(!showIncome)}
                className="w-full text-left px-3 py-2 border border-[var(--card-border,#38383A)] rounded-lg text-xs text-[var(--text-secondary,#94a3b8)] hover:border-blue-500/30 transition-colors flex items-center justify-between">
                <span>💰 {isProperty ? t('¿Genera renta?', 'Does it generate rent?') : isBank ? t('¿Genera intereses?', 'Does it earn interest?') : t('¿Genera rendimiento o pagos?', 'Does it generate yield or payments?')}</span>
                <span className="text-lg">{showIncome ? '−' : '+'}</span>
              </button>
            )}

            {showIncome && !isMarketAsset && (
              <div className="border border-[var(--card-border,#38383A)] rounded-lg p-3 space-y-3">
                {/* Rate type selector */}
                <div>
                  <label className="text-xs text-[var(--text-muted,#475569)] mb-1.5 block">{t('Tipo de tasa', 'Rate type')}</label>
                  <div className="flex gap-1">
                    {[
                      { key: 'fixed', es: 'Fija (siempre igual)', en: 'Fixed (same rate)' },
                      { key: 'variable', es: 'Variable (cambia)', en: 'Variable (changes)' },
                      { key: 'continuous', es: 'Capitalización', en: 'Compounding' },
                    ].map(rt => (
                      <button key={rt.key} type="button" onClick={() => set('rateType', rt.key)}
                        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border ${form.rateType !== rt.key ? 'bg-[var(--input-bg,#000000)] text-[var(--text-muted,#475569)] border-[var(--card-border,#38383A)]' : ''}`}
                        style={form.rateType === rt.key ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : undefined}>
                        {lang === 'es' ? rt.es : rt.en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Income mode: fixed amount vs percent */}
                <div className="flex gap-1">
                  <button type="button" onClick={() => set('incomeMode', 'fixed')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border ${form.incomeMode !== 'fixed' ? 'bg-[var(--input-bg,#000000)] text-[var(--text-muted,#475569)] border-[var(--card-border,#38383A)]' : ''}`}
                    style={form.incomeMode === 'fixed' ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : undefined}>
                    {t('Monto fijo mensual', 'Fixed monthly amount')}
                  </button>
                  <button type="button" onClick={() => set('incomeMode', 'percent')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border ${form.incomeMode !== 'percent' ? 'bg-[var(--input-bg,#000000)] text-[var(--text-muted,#475569)] border-[var(--card-border,#38383A)]' : ''}`}
                    style={form.incomeMode === 'percent' ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : undefined}>
                    {t('% anual del saldo', 'Annual % of balance')}
                  </button>
                </div>

                {/* Frecuencia de devengo. Solo con tasa: un monto fijo mensual
                    no devenga, se paga, y ahi "diario" no significa nada. */}
                {form.incomeMode !== 'fixed' && form.rateType !== 'continuous' && (
                  <div>
                    <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('¿Con qué frecuencia acumula?', 'How often does it accrue?')}</label>
                    <div className="flex gap-1">
                      {[{ k: 'monthly', es: 'Mensual', en: 'Monthly' }, { k: ACCRUAL_DAILY, es: 'Diario', en: 'Daily' }].map(o => (
                        <button key={o.k} type="button" onClick={() => set('accrual', o.k)}
                          className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border ${form.accrual !== o.k ? 'bg-[var(--input-bg,#000000)] text-[var(--text-muted,#475569)] border-[var(--card-border,#38383A)]' : ''}`}
                          style={form.accrual === o.k ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : undefined}>
                          {t(o.es, o.en)}
                        </button>
                      ))}
                    </div>
                    {isDaily && (
                      <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {t('Acumula todos los días, y se registra UN movimiento el último día de cada mes con lo acumulado. No se anota día por día: serían cientos de movimientos al año.',
                           'It accrues every day, and ONE movement is recorded on the last day of each month with the total accrued. Not day by day: that would be hundreds of movements a year.')}
                      </p>
                    )}
                  </div>
                )}

                {/* Rate inputs */}
                {form.rateType === 'variable' ? (
                  <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label htmlFor="add-rateMin" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa mín %', 'Min rate %')}</label>
                      <input id="add-rateMin" value={form.rateMin} onChange={e => set('rateMin', e.target.value)}
                        placeholder="4.5" type="text" inputMode="decimal" className={inputCls} />
                    </div>
                    <div>
                      <label htmlFor="add-rateMax" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa máx %', 'Max rate %')}</label>
                      <input id="add-rateMax" value={form.rateMax} onChange={e => set('rateMax', e.target.value)}
                        placeholder="5.5" type="text" inputMode="decimal" className={inputCls} />
                    </div>
                    <div>
                      <label htmlFor="add-varPayDay" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Día de pago', 'Pay day')}</label>
                      <input id="add-varPayDay" value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                        placeholder="10" type="number" inputMode="numeric" min="1" max="31" className={inputCls} />
                      {payDayHint && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{payDayHint}</p>}
                    </div>
                  </div>
                  {form.rateMin && !form.rateMax && (
                    <p className="text-xs" style={{ color: 'var(--accent-orange)' }}>⚠ {t('Falta la tasa máxima: el ingreso se calculará como 0.', 'Missing max rate: income will be calculated as 0.')}</p>
                  )}
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      {form.incomeMode === 'fixed' ? (<>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Monto por pago', 'Per payment')}</label>
                        <input value={form.incomeAmount} onChange={e => set('incomeAmount', e.target.value)}
                          placeholder={isProperty ? '800' : '48'} type="text" inputMode="decimal" className={inputCls} />
                      </>) : (<>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa anual %', 'Annual rate %')}</label>
                        <input value={form.incomeRate} onChange={e => set('incomeRate', e.target.value)}
                          placeholder="5.5" type="text" inputMode="decimal" className={inputCls} />
                      </>)}
                    </div>
                    {isDaily ? (
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Se registra', 'Recorded on')}</label>
                        <p className="text-xs pt-2" style={{ color: 'var(--text-secondary)' }}>
                          {t('El último día de cada mes', 'The last day of each month')}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Día de pago', 'Pay day')}</label>
                        <input value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                          placeholder="10" type="number" inputMode="numeric" min="1" max="31" className={inputCls} />
                        {payDayHint && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{payDayHint}</p>}
                      </div>
                    )}
                  </div>
                )}

                {/* Business day rule */}
                {form.rateType !== 'continuous' && !isDaily && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[var(--text-muted,#475569)]">{t('Día hábil:', 'Business day:')}</label>
                    <select value={form.businessDayRule} onChange={e => set('businessDayRule', e.target.value)}
                      className="px-2 py-1 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded text-xs text-[var(--text-primary,white)]">
                      <option value="exact">{t('Día exacto', 'Exact day')}</option>
                      <option value="next_business_day">{t('Siguiente día hábil', 'Next business day')}</option>
                    </select>
                  </div>
                )}

                {/* Payment months */}
                {form.rateType !== 'continuous' && !isDaily && (
                  <div>
                    <label className="text-xs text-[var(--text-muted,#475569)] mb-1.5 block">{t('¿En qué meses te pagan?', 'Which months do you get paid?')}</label>
                    <div className="flex flex-wrap gap-1">
                      {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((label, i) => {
                        const active = form.incomeMonths.includes(i)
                        return (
                          <button key={i} type="button"
                            onClick={() => set('incomeMonths', active ? form.incomeMonths.filter(x => x !== i) : [...form.incomeMonths, i].sort((a, b) => a - b))}
                            className="px-2 py-1 text-xs font-medium rounded transition-all border"
                            style={active ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 25%, transparent)', color: 'var(--accent-blue)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                            {label}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      <button type="button" onClick={() => set('incomeMonths', [0,1,2,3,4,5,6,7,8,9,10,11])}
                        className="text-xs text-[var(--text-muted,#475569)] hover:text-emerald-400 transition-colors">{t('Todos', 'All')}</button>
                      <button type="button" onClick={() => set('incomeMonths', [])}
                        className="text-xs text-[var(--text-muted,#475569)] hover:text-emerald-400 transition-colors">{t('Ninguno', 'None')}</button>
                    </div>
                  </div>
                )}

                {/* What happens with each payment — reinvest available for any
                    income asset, not just dividend stocks */}
                <div>
                  <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('¿Qué haces con los pagos?', 'What do you do with payments?')}</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => set('dividendAction', 'cash')}
                      className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                      style={form.dividendAction !== 'reinvest' ? { backgroundColor: 'color-mix(in srgb, var(--accent-cyan) 20%, transparent)', color: 'var(--accent-cyan)', borderColor: 'color-mix(in srgb, var(--accent-cyan) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                      💵 {t('Los recibo', 'I receive them')}
                    </button>
                    <button type="button" onClick={() => set('dividendAction', 'reinvest')}
                      className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                      style={form.dividendAction === 'reinvest' ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.2)', borderColor: 'rgba(37,99,235,0.4)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                      🔄 {t('Se reinvierten', 'They reinvest')}
                    </button>
                  </div>
                </div>

                {/* Income destination — irrelevant while reinvesting */}
                {form.dividendAction === 'reinvest' ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted,#475569)' }}>
                    {t('Cada pago se reinvierte en este mismo activo (aumenta tu posición).', 'Each payment is reinvested into this same asset (grows your position).')}
                  </p>
                ) : (
                  <div>
                    <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('¿Dónde llega el rendimiento?', 'Where does the yield go?')}</label>
                    <select value={form.incomeDestination}
                      onChange={e => { if (e.target.value === '__new__') { setCreatingDest('income'); return } set('incomeDestination', e.target.value) }}
                      className={inputCls}>
                      <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                      {destItems.map(it => <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}</option>)}
                      {onCreateDestination && <option value="__new__">+ {t('Crear cuenta nueva', 'Create new account')}</option>}
                    </select>
                    {creatingDest === 'income' && onCreateDestination && (
                      <InlineCreateAccount onCreate={onCreateDestination} onCancel={() => setCreatingDest(null)}
                        onCreated={(id, it) => handleDestCreated('incomeDestination', id, it)} lang={lang} defaultCurrency={form.currency}
                        sourceAcquisitionDate={form.acquisitionDate || null} />
                    )}
                  </div>
                )}

                {/* Past-due payments — the schedule + acquisition date imply
                    payments that already happened. Ask now, instead of the
                    automatic backfill silently assuming they were all
                    received once the account is saved. */}
                {pastDuePayDates.length > 0 && (() => {
                  const qty = parseQuantity(form.quantity) || 1
                  const price = parseAmount(form.purchasePrice)
                  const balance = qty * price
                  // Con devengo diario cada mes vale distinto (28 dias no son
                  // 31), asi que la estimacion se hace POR FECHA en vez de una
                  // sola para todas. Y desde FASE KY el primer periodo se
                  // prorratea, que tambien depende de la fecha: el calendario y
                  // el dia de pago viajan para que esta vista previa diga el
                  // MISMO numero que el motor va a escribir.
                  const estimateFor = (d) => estimateIncomeAmount({
                    balance, incomeMode: form.incomeMode, incomeRate: parseAmount(form.incomeRate) || 0,
                    incomeAmount: parseAmount(form.incomeAmount) || 0, rateType: form.rateType,
                    rateMin: parseAmount(form.rateMin) || 0, rateMax: parseAmount(form.rateMax) || 0,
                    isPerShare: false, qty,
                    accrual: form.accrual, acquisitionDay: form.acquisitionDate, payDate: d,
                    incomeMonths: form.incomeMonths, incomePayDay: form.incomePayDay || 1,
                  }, payMonthsCount)
                  const estimate = estimateFor(pastDuePayDates[0])
                  const accrued = parseAmount(form.accruedInterestAtPurchase) || 0
                  const toggle = (d) => setExcludedPayDates(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
                  return (
                    <div className="rounded-lg p-3 space-y-2" style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: 'color-mix(in srgb, var(--accent-orange) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent-orange) 6%, transparent)' }}>
                      <p className="text-xs font-medium" style={{ color: 'var(--accent-orange)' }}>
                        ⏱ {t(
                          `Según este calendario, ya deberían haberte pagado ${pastDuePayDates.length} vez${pastDuePayDates.length > 1 ? 'es' : ''}`,
                          `Based on this schedule, you should have already been paid ${pastDuePayDates.length} time${pastDuePayDates.length > 1 ? 's' : ''}`
                        )}
                      </p>
                      <div className="space-y-1">
                        {pastDuePayDates.map((d, i) => {
                          const excluded = excludedPayDates.includes(d)
                          return (
                            <div key={d} className="flex items-center justify-between gap-2 text-xs bg-[var(--input-bg,#000000)] rounded px-2 py-1.5">
                              <span className="text-[var(--text-secondary,#cbd5e1)]">
                                {new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'es' ? 'es' : 'en', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {estimateFor(d) > 0 && <span className="text-[var(--text-muted,#64748b)] ml-1.5">~{form.currency} {estimateFor(d).toFixed(2)}</span>}
                                {i === 0 && estimate > 0 && accrued > 0 && (
                                  <InfoTip text={t(
                                    `De este pago, aprox. ${form.currency} ${Math.min(accrued, estimate).toFixed(2)} ya era tuyo desde antes de comprar (interés corrido): no es ganancia nueva.`,
                                    `Of this payment, approx. ${form.currency} ${Math.min(accrued, estimate).toFixed(2)} was already yours before you bought (accrued interest): not new gain.`
                                  )} />
                                )}
                              </span>
                              <button type="button" onClick={() => toggle(d)}
                                className="px-2 py-0.5 rounded text-xs font-medium shrink-0 border transition-colors"
                                style={excluded
                                  ? { color: 'var(--text-negative)', backgroundColor: 'color-mix(in srgb, var(--text-negative) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--text-negative) 30%, transparent)' }
                                  : { color: 'var(--accent-green)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-green) 30%, transparent)' }}>
                                {excluded ? t('No recibido', 'Not received') : t('✓ Recibido', '✓ Received')}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-muted,#64748b)' }}>
                        {form.dividendAction === 'reinvest'
                          ? t('Los marcados como recibidos se reinvierten automáticamente al guardar.', 'Ones marked received reinvest automatically once saved.')
                          : t('Los marcados como recibidos se agregan a tu historial y a la cuenta de destino al guardar.', 'Ones marked received are added to your history and destination account once saved.')}
                      </p>
                    </div>
                  )
                })()}

                {/* Capital return */}
                <div>
                  <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('¿Te devuelven capital cada pago?', 'Capital returned per payment?')}</label>
                  <input value={form.capitalReturn} onChange={e => set('capitalReturn', e.target.value)}
                    placeholder="0" type="text" inputMode="decimal" className={inputCls} />
                </div>
              </div>
            )}

            {/* Advanced Options toggle */}
            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm w-full py-2 mt-1 transition-colors"
              style={{ color: 'var(--accent-blue)' }}>
              <svg className="w-4 h-4 transition-transform" style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {t('Opciones avanzadas', 'Advanced options')}
            </button>

            {/* Grouped into small labeled sections (icon + uppercase header,
                divider between groups) instead of one flat pile of fields —
                each group answers one question, so it scans instead of reads
                like a form dump. */}
            {showAdvanced && (
              <div className="space-y-4">
                {/* Cuenta */}
                <div>
                  <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>🏦 {t('Cuenta', 'Account')}</span>
                  <select id="add-accountType" value={form.accountType} onChange={e => set('accountType', e.target.value)} className={inputCls}>
                    {ACCOUNT_TYPES.map(at => <option key={at.key} value={at.key}>{lang === 'es' ? at.es : at.en}</option>)}
                  </select>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {form.accountType === 'taxable' ? t('Paga impuestos (ej. cuenta de bolsa normal)', 'Pays taxes (e.g. regular brokerage)') :
                     form.accountType === 'retirement' ? t('Ahorro para retiro (ej. 401k, IRA, AFP)', 'Retirement savings (e.g. 401k, IRA)') :
                     t('Exenta de impuestos (ej. Roth IRA)', 'Tax-exempt (e.g. Roth IRA)')}
                  </p>
                </div>

                {/* Vencimiento (bonds/alternatives) */}
                {(isBond || isAlternative) && (
                  <div className="pt-3.5 border-t border-glass-border/50">
                    <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>📅 {t('Vencimiento', 'Maturity')}</span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>{t('Fecha', 'Date')}</label>
                        <input value={form.maturityDate} onChange={e => set('maturityDate', e.target.value)}
                          type="date" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{t('Al vencer', 'At maturity')}</label>
                        <select value={form.maturityAction} onChange={e => set('maturityAction', e.target.value)} className={inputCls}>
                          <option value="return_capital">{t('Devolver capital', 'Return capital')}</option>
                          <option value="auto_renew">{t('Renovar', 'Auto-renew')}</option>
                          <option value="convert_equity">{t('Convertir a acciones', 'Convert to equity')}</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Costos y comisiones — entry fee, ongoing management fee,
                    plus (bonds only) interest already accrued at purchase.
                    Extendido a isPrivateStock: misma comisión de entrada que
                    un Bono (ronda con carried interest o fee de originación),
                    no una fórmula nueva. */}
                {(isBond || isAlternative || isPrivateStock) && (
                  <div className="pt-3.5 border-t border-glass-border/50">
                    <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>💰 {t('Costos y comisiones', 'Costs & fees')}</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">
                          {t('Corretaje/entrada', 'Brokerage/entry')} <InfoTip text={t('Monto fijo, no porcentaje. Comisión o costo que pagaste una sola vez al comprar.', 'Fixed amount, not a percentage. One-time commission or cost you paid on purchase.')} />
                        </label>
                        <input value={form.entryFee} onChange={e => set('entryFee', e.target.value)}
                          placeholder="80" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">
                          {t('Mgmt fee', 'Mgmt fee')}
                          {' '}
                          <button type="button" onClick={() => set('managementFeeType', form.managementFeeType === 'fixed' ? 'percent' : 'fixed')}
                            className="text-xs px-1.5 py-0.5 rounded bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)]" style={{ color: 'var(--accent-blue)' }}>
                            {form.managementFeeType === 'fixed' ? '$' : '%'}
                          </button>
                        </label>
                        <input value={form.managementFee} onChange={e => set('managementFee', e.target.value)}
                          placeholder={form.managementFeeType === 'fixed' ? '50' : '0.50'} type="text" inputMode="decimal" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Expense %', 'Expense %')} <InfoTip text={t('Ratio de gastos anual, ej. 0.03 = 0.03%/año.', 'Annual expense ratio, e.g. 0.03 = 0.03%/yr.')} /></label>
                        <input value={form.expenseRatio} onChange={e => set('expenseRatio', e.target.value)}
                          placeholder="0.03" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                    </div>
                    {isBond && (
                      <div className="mt-2">
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">
                          {t('Interés ya devengado al comprar', 'Interest already accrued at purchase')}
                          {' '}
                          <InfoTip text={t('Si el bono se emitió antes de que lo compraras (ej. emitido en enero, tú entraste en marzo), le pagaste al vendedor el interés acumulado desde la emisión. Te lo devuelven en tu primer pago, pero no es ganancia nueva: ponlo aquí para que el resumen lo aclare.', 'If the bond was issued before you bought it (e.g. issued January, you bought March), you paid the seller the interest already accrued since issuance. You get it back in your first payment, but it isn\'t new gain: enter it here so the summary flags it.')} />
                        </label>
                        <input value={form.accruedInterestAtPurchase} onChange={e => set('accruedInterestAtPurchase', e.target.value)}
                          placeholder="0" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                    )}
                    {/* Which side of the purchase value the fee sits on decides
                        how much cash really left the pocket, and that is the
                        denominator of every return % for this asset. */}
                    {parseAmount(form.entryFee) > 0 && (() => {
                      const fee = parseAmount(form.entryFee) || 0
                      const typed = (parseQuantity(form.quantity) || 1) * (parseAmount(form.purchasePrice))
                      const fmtM = (v) => `${form.currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      return (
                        <div className="mt-2">
                          <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">
                            {t('¿Cómo se cobró?', 'How was it charged?')}
                            {' '}
                            <InfoTip text={t(
                              'Cambia cuánto dinero salió realmente de tu bolsillo, que es contra lo que se mide tu rendimiento. "Se pagó aparte": mandaste el monto de compra Y ADEMÁS la comisión. "Se descontó del monto": mandaste solo el monto de compra y la comisión salió de ahí, así que al activo entró menos.',
                              'It changes how much money actually left your pocket, which is what your return is measured against. "Paid separately": you sent the purchase amount AND the fee on top. "Deducted from amount": you sent just the purchase amount and the fee came out of it, so less actually bought the asset.'
                            )} />
                          </label>
                          <div className="flex gap-1.5">
                            {[
                              { key: 'separate', es: 'Se pagó aparte', en: 'Paid separately' },
                              { key: 'deducted', es: 'Se descontó del monto', en: 'Deducted from amount' },
                            ].map(m => (
                              <button key={m.key} type="button" onClick={() => set('entryFeeMode', m.key)}
                                className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                                style={form.entryFeeMode === m.key
                                  ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' }
                                  : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                                {lang === 'es' ? m.es : m.en}
                              </button>
                            ))}
                          </div>
                          {typed > 0 && (
                            <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                              {form.entryFeeMode === 'deducted'
                                ? t(`Sales con ${fmtM(typed)} en total, y al activo entran ${fmtM(typed - fee)}.`,
                                    `${fmtM(typed)} leaves your pocket in total, and ${fmtM(typed - fee)} actually goes into the asset.`)
                                : t(`Sales con ${fmtM(typed + fee)} en total: ${fmtM(typed)} al activo más ${fmtM(fee)} de comisión.`,
                                    `${fmtM(typed + fee)} leaves your pocket in total: ${fmtM(typed)} into the asset plus ${fmtM(fee)} in fees.`)}
                            </p>
                          )}
                        </div>
                      )
                    })()}

                    {(parseAmount(form.entryFee) > 0 || parseAmount(form.managementFee) > 0 || parseAmount(form.expenseRatio) > 0) && (
                      <p className="text-xs mt-1.5" style={{ color: 'color-mix(in srgb, var(--accent-orange) 70%, transparent)' }}>
                        {parseAmount(form.entryFee) > 0 && `${t('Entrada', 'Entry')}: ${form.currency} ${parseAmount(form.entryFee).toFixed(2)}  `}
                        {parseAmount(form.managementFee) > 0 && (form.managementFeeType === 'fixed'
                          ? `${t('Mgmt', 'Mgmt')}: ${form.currency} ${parseAmount(form.managementFee).toFixed(2)}/yr  `
                          : `${t('Mgmt', 'Mgmt')}: ${parseAmount(form.managementFee).toFixed(2)}%/yr  `)}
                        {parseAmount(form.expenseRatio) > 0 && `Expense: ${parseAmount(form.expenseRatio).toFixed(2)}%/yr`}
                      </p>
                    )}
                  </div>
                )}

                {/* Liquidez */}
                {(isProperty || isAlternative || isPrivateStock || (isBond && subtype === 'private_debt')) && (
                  <div className="pt-3.5 border-t border-glass-border/50">
                    <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>💧 {t('Liquidez', 'Liquidity')}</span>
                    <div className="flex items-center gap-3 px-3 py-2 border border-[var(--card-border,#38383A)] rounded-lg">
                      <button type="button" onClick={() => set('isIlliquid', !form.isIlliquid)}
                        className="w-8 h-4 rounded-full transition-colors relative shrink-0"
                        style={{ backgroundColor: form.isIlliquid ? 'var(--accent-orange)' : 'var(--card-border, #38383A)' }}>
                        <span className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${form.isIlliquid ? 'left-4' : 'left-0.5'}`} />
                      </button>
                      <div>
                        <span className="text-xs text-[var(--text-primary,white)] font-medium">{t('Activo ilíquido', 'Illiquid asset')}</span>
                        <p className="text-xs text-[var(--text-muted,#475569)]">
                          {t('Sin precio de mercado disponible', 'No market price available')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Custodia (crypto) */}
                {isCrypto && (
                  <div className="pt-3.5 border-t border-glass-border/50">
                    <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>🔐 {t('Custodia', 'Custody')}</span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <select value={form.custodyType} onChange={e => set('custodyType', e.target.value)} className={inputCls}>
                          <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                          <option value="custodial">{t('Exchange/Custodia', 'Exchange/Custodial')}</option>
                          <option value="self_custody">{t('Self-Custody', 'Self-Custody')}</option>
                          <option value="defi_protocol">{t('Protocolo DeFi', 'DeFi Protocol')}</option>
                        </select>
                      </div>
                      <div>
                        <input value={form.custodyDetails} onChange={e => set('custodyDetails', e.target.value)}
                          placeholder={form.custodyType === 'self_custody' ? 'Ledger Nano X' : form.custodyType === 'defi_protocol' ? 'Osmosis, Aave...' : 'Binance, Kraken...'}
                          className={inputCls} />
                      </div>
                    </div>
                  </div>
                )}

                {/* SAFE Note */}
                {isAlternative && subtype === 'safe_note' && (
                  <div className="pt-3.5 border-t border-glass-border/50">
                    <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>🔮 SAFE Note</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tipo', 'Type')}</label>
                        <select value={form.safeType} onChange={e => set('safeType', e.target.value)} className={inputCls}>
                          <option value="post_money">Post-Money</option>
                          <option value="pre_money">Pre-Money</option>
                          <option value="mfn">MFN</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Cap', 'Cap')}</label>
                        <input value={form.safeCap} onChange={e => set('safeCap', e.target.value)}
                          placeholder="10000000" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Descuento %', 'Discount %')}</label>
                        <input value={form.safeDiscount} onChange={e => set('safeDiscount', e.target.value)}
                          placeholder="20" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                    </div>
                  </div>
                )}

                {/* VC / startup direct investment: cap-table context, purely
                    informational (never feeds the return formula). */}
                {isAlternative && subtype === 'private_equity' && (
                  <div className="pt-3.5 border-t border-glass-border/50">
                    <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                      🚀 {t('Ronda de inversión', 'Investment round')}
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Etapa', 'Stage')}</label>
                        <select value={form.investmentStage} onChange={e => set('investmentStage', e.target.value)} className={inputCls}>
                          <option value="">{t('-- Opcional --', '-- Optional --')}</option>
                          <option value="pre_seed">Pre-seed</option>
                          <option value="seed">Seed</option>
                          <option value="series_a">Series A</option>
                          <option value="series_b">Series B</option>
                          <option value="series_c_plus">Series C+</option>
                          <option value="growth">{t('Growth / Late stage', 'Growth / Late stage')}</option>
                          <option value="buyout">Buyout / PE</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">
                          {t('Valuación de la ronda', 'Round valuation')}
                          {' '}
                          <InfoTip text={t('La valuación post-money de la ronda en la que entraste: se usa solo para calcular tu % de la empresa aquí abajo, no afecta el rendimiento del activo.', 'The round\'s post-money valuation: used only to calculate your % of the company below, it does not affect the asset\'s return.')} />
                        </label>
                        <input value={form.roundValuation} onChange={e => set('roundValuation', e.target.value)}
                          placeholder="10000000" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">% {t('de la empresa', 'of the company')}</label>
                        <input value={form.ownershipPct} onChange={e => set('ownershipPct', e.target.value)}
                          placeholder="0.5" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">
                          {t('Capital comprometido', 'Committed capital')}
                          {' '}
                          <InfoTip text={t('Si te comprometiste a un monto total que se va llamando por partes (capital calls), ponlo aquí: la tarjeta de métricas VC/PE lo usa para calcular el PIC (qué % del compromiso ya se llamó). Opcional, no afecta el rendimiento.', 'If you committed to a total amount that gets called in pieces (capital calls), put it here: the VC/PE metrics card uses it for PIC (what % of the commitment has been called). Optional, does not affect returns.')} />
                        </label>
                        <input value={form.committedCapital} onChange={e => set('committedCapital', e.target.value)}
                          placeholder="50000" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                    </div>
                    {/* Suggested %, from what's already typed elsewhere in this
                        form (invested amount) — never auto-filled, just shown
                        so the user doesn't have to do the division by hand. A
                        later round dilutes this; there's no attempt to track
                        that automatically, this is a manual snapshot the user
                        updates whenever they hear about a new round. */}
                    {!form.ownershipPct && parseAmount(form.roundValuation) > 0 && (() => {
                      const invested = (parseQuantity(form.quantity) || 1) * (parseAmount(form.purchasePrice))
                      if (invested <= 0) return null
                      const suggested = (invested / parseAmount(form.roundValuation)) * 100
                      return (
                        <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                          {t(`Sugerido: ${suggested.toFixed(3)}% (invertiste ${form.currency} ${invested.toLocaleString()} sobre una valuación de ${form.currency} ${parseAmount(form.roundValuation).toLocaleString()}).`,
                             `Suggested: ${suggested.toFixed(3)}% (you invested ${form.currency} ${invested.toLocaleString()} against a ${form.currency} ${parseAmount(form.roundValuation).toLocaleString()} valuation).`)}
                          {' '}
                          <button type="button" onClick={() => set('ownershipPct', suggested.toFixed(3))}
                            className="underline" style={{ color: 'var(--accent-blue)' }}>
                            {t('usar', 'use')}
                          </button>
                        </p>
                      )
                    })()}
                  </div>
                )}

                {/* Fiscal + país del activo */}
                <div className="pt-3.5 border-t border-glass-border/50">
                  <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>🌍 {t('Fiscal', 'Tax')}</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Jurisdicción fiscal', 'Tax jurisdiction')}</label>
                      <select value={form.taxJurisdiction} onChange={e => set('taxJurisdiction', e.target.value)} className={inputCls}>
                        <option value="">{t('-- Opcional --', '-- Optional --')}</option>
                        <option value="GT">Guatemala</option>
                        <option value="MX">México</option>
                        <option value="US">USA</option>
                        <option value="CO">Colombia</option>
                        <option value="CL">Chile</option>
                        <option value="BR">Brasil</option>
                        <option value="PE">Perú</option>
                        <option value="AR">Argentina</option>
                        <option value="OTHER">{t('Otro', 'Other')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">
                        {t('País del activo', 'Asset country')}
                        {' '}
                        <InfoTip text={t('De dónde es la empresa/activo en sí, para "Asignación de activos > Geo". Sin esto, un símbolo que no reconocemos (típico en bonos, alternativos o acciones privadas) se asume EE.UU. por defecto, no por la moneda en que lo tengas.', 'Where the company/asset itself is from, for "Asset Allocation > Geo". Without this, a symbol we don\'t recognize (typical for bonds, alternatives or private stock) defaults to the US, not based on the currency it\'s held in.')} />
                      </label>
                      <select value={form.assetCountry} onChange={e => set('assetCountry', e.target.value)} className={inputCls}>
                        <option value="">{t('-- Opcional --', '-- Optional --')}</option>
                        <option value="GT">Guatemala</option>
                        <option value="MX">México</option>
                        <option value="US">USA</option>
                        <option value="CO">Colombia</option>
                        <option value="CL">Chile</option>
                        <option value="BR">Brasil</option>
                        <option value="PE">Perú</option>
                        <option value="AR">Argentina</option>
                        <option value="CR">Costa Rica</option>
                        <option value="PA">Panamá</option>
                        <option value="ES">España</option>
                        <option value="UK">UK</option>
                        <option value="DE">Alemania</option>
                        <option value="CH">Suiza</option>
                        <option value="JP">Japón</option>
                        <option value="CN">China</option>
                        <option value="KR">Corea del Sur</option>
                        <option value="HK">Hong Kong</option>
                        <option value="SG">Singapur</option>
                        <option value="AU">Australia</option>
                        <option value="CA">Canadá</option>
                        <option value="GLOBAL">{t('Global / Multi-país', 'Global / Multi-country')}</option>
                        <option value="OTHER">{t('Otro', 'Other')}</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notas */}
                {(isBond || isAlternative || isProperty) && (
                  <div className="pt-3.5 border-t border-glass-border/50">
                    <span className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>📝 {t('Notas', 'Notes')}</span>
                    <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                      placeholder={t('Detalles adicionales...', 'Additional details...')}
                      rows={2} className={inputCls + ' resize-none'} />
                  </div>
                )}
              </div>
            )}

            {/* FASE LT: para una DEUDA la pregunta correcta no es "¿es dinero
                nuevo?" sino "¿a dónde llegó el dinero del préstamo?". Sin
                registro, el Dietz lee el alta como pérdida (el patrimonio baja
                por el saldo de la deuda sin ningún flujo que lo netee). */}
            {isDebt && subtype !== 'receivable' && !duplicateWarning && (
              <div className="px-3 py-2 border border-[var(--card-border,#38383A)] rounded-lg space-y-1.5">
                <label htmlFor="add-loan-proceeds" className="text-xs font-medium block" style={{ color: 'var(--text-primary)' }}>
                  {t('¿A dónde llegó el dinero del préstamo?', 'Where did the loan money go?')}
                </label>
                <select id="add-loan-proceeds" value={loanProceeds} onChange={e => setLoanProceeds(e.target.value)} className={inputCls}>
                  <option value="outside">{t('Ya está contado, o lo usé fuera de la app', 'Already counted, or used outside the app')}</option>
                  {onExecuteContribution && existingItems
                    .filter(it => it?.id && !it.isDebt && !it.isReceivable && isBankLikeItem(it)
                      && String(it.currency || 'USD').toUpperCase() === String(form.currency || 'USD').toUpperCase())
                    .map(it => (
                      <option key={it.id} value={it.id}>
                        {t('Acaba de llegar a', 'It just arrived in')}: {it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}
                      </option>
                    ))}
                  <option value="none">{t('No registrar nada', 'Record nothing')}</option>
                </select>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('Pedir prestado no es perder dinero: este registro evita que tu retorno del año lea la deuda nueva como pérdida. Si llegó a una cuenta registrada, esa cuenta sube y todo queda neto.',
                     'Borrowing is not losing money: this record keeps your yearly return from reading the new debt as a loss. If it arrived in a tracked account, that account goes up and everything nets out.')}
                </p>
              </div>
            )}

            {/* New money toggle */}
            {!(isDebt && subtype !== 'receivable') && (
            <div className="flex items-center gap-3 px-3 py-2 border border-[var(--card-border,#38383A)] rounded-lg">
              <button type="button" onClick={() => setIsNewMoney(!isNewMoney)}
                className="w-8 h-4 rounded-full transition-colors relative"
                style={{ backgroundColor: isNewMoney ? 'var(--accent-blue)' : 'var(--card-border,#38383A)' }}>
                <span className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${isNewMoney ? 'left-4' : 'left-0.5'}`} />
              </button>
              <div>
                <span className="text-xs text-[var(--text-primary,white)] font-medium">{t('Es dinero nuevo para mi portafolio', 'This is new money for my portfolio')}</span>
                <p className="text-xs text-[var(--text-muted,#475569)]">
                  {isNewMoney ? t('Viene de fuera (salario, venta, etc.): no es ganancia', 'Comes from outside (salary, sale, etc.): not a gain') : t('Ya estaba en otra cuenta de mi portafolio', 'Was already in another account in my portfolio')}
                </p>
              </div>
            </div>
            )}

            {!isNewMoney && (
              <div>
                <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('¿De dónde sale?', 'Source account?')}</label>
                <select value={form.capitalDestination}
                  onChange={e => { if (e.target.value === '__new__') { setCreatingDest('capital'); return } set('capitalDestination', e.target.value) }}
                  className={inputCls}>
                  <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                  {destItems.map(it => <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''} - {it.currency}</option>)}
                  {onCreateDestination && <option value="__new__">+ {t('Crear cuenta nueva', 'Create new account')}</option>}
                </select>
                {creatingDest === 'capital' && onCreateDestination && (
                  <InlineCreateAccount onCreate={onCreateDestination} onCancel={() => setCreatingDest(null)}
                    onCreated={(id, it) => handleDestCreated('capitalDestination', id, it)} lang={lang} defaultCurrency={form.currency}
                    sourceAcquisitionDate={form.acquisitionDate || null} />
                )}
              </div>
            )}

            {/* Value timeline — only for external money (transfers between own
                accounts belong in Movimientos, mixing them here would inflate
                the deposit math). Rows EXPLAIN the total, they don't add to it. */}
            {isNewMoney && !isDebt && !duplicateWarning && (() => {
              const qty = parseQuantity(form.quantity) || (isBank || isProperty ? 1 : 0)
              const price = parseAmount(form.purchasePrice)
              const cur = parseAmount(form.currentPrice)
              // Market: rows must cover the COST (shares don't grow on their own).
              // Balance assets: rows explain the current balance; any shortfall
              // is growth (interest earned along the way).
              const tlTotal = isMarketAsset ? qty * price : qty * (cur || price)
              if (!(tlTotal > 0)) return null
              return (
                <div className="border border-[var(--card-border,#38383A)] rounded-lg p-3 space-y-2">
                  <label className="text-xs text-[var(--text-primary,white)] font-medium block">
                    {t('¿Cómo llegó a este valor?', 'How did it reach this value?')}
                  </label>
                  <div className="flex gap-2">
                    {[
                      { key: 'single', label: t('En una fecha', 'On one date') },
                      { key: 'multi', label: t('En varias fechas', 'On several dates') },
                    ].map((o) => (
                      <button key={o.key} type="button"
                        onClick={() => {
                          setValueTimeline(o.key)
                          if (o.key === 'multi' && timelineRows.length === 0) {
                            setTimelineRows([{ date: form.acquisitionDate || new Date().toISOString().split('T')[0], amount: String(tlTotal) }])
                          }
                        }}
                        className="flex-1 px-2 py-2 text-xs font-medium leading-tight rounded-lg border transition-colors"
                        style={valueTimeline === o.key
                          ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.15)', borderColor: 'rgba(37,99,235,0.5)' }
                          : { color: 'var(--text-secondary)', borderColor: 'rgba(71,85,105,0.5)' }}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                  {valueTimeline === 'multi' && (
                    <>
                      <p className="text-xs text-[var(--text-muted,#475569)]">
                        {t('Registra cada aporte con su fecha: así el historial muestra cómo creció desde el principio.',
                           'Log each contribution with its date: history will show how it grew from the start.')}
                      </p>
                      <TimelineEditor rows={timelineRows} onChange={setTimelineRows}
                        total={tlTotal} currency={form.currency} requireExact={isMarketAsset} lang={lang} />
                    </>
                  )}
                </div>
              )
            })()}

            {(() => {
              const qty = parseQuantity(form.quantity) || (isBank || isProperty ? 1 : 0)
              const price = parseAmount(form.purchasePrice)
              const cur = parseAmount(form.currentPrice)
              const total = isDebt ? price : qty * (cur || price)
              const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              if (total > 0) {
                const warnings = []
                if (total > 10000000) warnings.push(t('⚠ Valor muy alto: verifica los datos', '⚠ Very high value: check your data'))
                if (isMarketAsset && qty > 0 && price > 0 && qty === price) warnings.push(t('⚠ Cantidad y precio son iguales: ¿es correcto?', '⚠ Quantity and price are the same: is this correct?'))
                return (
                  <div className="p-3 rounded-lg border text-xs"
                    style={warnings.length > 0 ? { backgroundColor: 'color-mix(in srgb, var(--accent-orange) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-orange) 20%, transparent)' } : { backgroundColor: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-green) 20%, transparent)' }}>
                    <div className="font-medium" style={{ color: warnings.length > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>
                      {isDebt ? t('Deuda', 'Debt') : t('Valor total', 'Total value')}: {form.currency} {fmt(total)}
                    </div>
                    {isMarketAsset && qty > 0 && price > 0 && (
                      <div className="text-[var(--text-muted,#64748b)] mt-0.5">{qty} × {form.currency} {fmt(price)} {t('por unidad', 'per unit')}</div>
                    )}
                    {warnings.map((w, i) => <div key={i} className="mt-1" style={{ color: 'var(--accent-orange)' }}>{w}</div>)}
                  </div>
                )
              }
              return null
            })()}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setStep(1)}
                className="flex-1 py-2.5 border border-[var(--card-border,#38383A)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-[var(--input-bg,#2C2C2E)] transition-colors text-sm">
                ← {t('Atrás', 'Back')}
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 py-2.5 bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium" style={{ color: '#ffffff' }}>
                {<BusyLabel busy={saving} lang={lang}>{t('Registrar', 'Register')}</BusyLabel>}
              </button>
            </div>
          </>)}
        </form>
      </div>
    </div>
  )
}
