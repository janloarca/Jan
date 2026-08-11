'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { authFetch, safeJson } from '@/lib/authFetch'
import { validateItem } from '@/lib/validation'
import InlineCreateAccount from './InlineCreateAccount'
import TimelineEditor, { validateTimelineRows } from './TimelineEditor'
import { detectCurrency } from '@/lib/institutionCurrency'
import { getScheduledPayDates, estimateIncomeAmount } from '@/lib/incomeSchedule'
import { InfoTip } from './ui/Tooltip'
import { DEBT_CLARIFICATION } from './dashboard/utils'

const CURRENCIES = ['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY']

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

export default function AddAccountModal({ onClose, onAdd, onAddTransaction, onAddLot, onCreateDestination, existingItems = [], activePortfolio, activeEntity = 'default', lang = 'es' }) {
  const trapRef = useFocusTrap()
  const [step, setStep] = useState(1)
  const [type, setType] = useState('Stock')
  const [subtype, setSubtype] = useState('')
  const [form, setForm] = useState({
    symbol: '', name: '', quantity: '', purchasePrice: '', currentPrice: '',
    institution: '', currency: 'USD', acquisitionDate: new Date().toISOString().split('T')[0],
    accountType: 'taxable',
    incomeAmount: '', incomeMode: 'fixed', incomeRate: '',
    incomePayDay: '', incomeMonths: [],
    capitalReturn: '', incomeDestination: '', capitalDestination: '',
    dividendAction: 'cash',
    sector: '', industry: '', exchangeName: '',
    rateType: 'fixed', rateMin: '', rateMax: '',
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
    debtTerm: '', installmentsTotal: '', installmentsRemaining: '', monthlyPayment: '',
    cardBrand: '', rewardType: '', rewardRate: '', rewardBalance: '',
    entryFee: '', entryFeeMode: 'separate', managementFee: '', managementFeeType: 'percent', expenseRatio: '',
    accruedInterestAtPurchase: '',
  })
  const [isNewMoney, setIsNewMoney] = useState(true)
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
  const payMonthsCount = form.incomeMonths.length > 0 ? form.incomeMonths.length : 12
  const pastDuePayDates = useMemo(() => {
    if (isMarketAsset || !showIncome || form.rateType === 'continuous') return []
    return getScheduledPayDates({
      acquisitionDate: form.acquisitionDate, incomeMonths: form.incomeMonths,
      incomePayDay: form.incomePayDay, rateType: form.rateType,
    })
  }, [isMarketAsset, showIncome, form.rateType, form.acquisitionDate, form.incomeMonths, form.incomePayDay])

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
    try {
      const res = await authFetch(`/api/prices/search?symbol=${encodeURIComponent(result.symbol)}&type=${encodeURIComponent(newType)}`, { signal: searchAbortRef.current.signal })
      if (res.ok) {
        const data = await safeJson(res) || {}
        if (data.quote?.price) {
          if (data.quote.currency) setDetectedCurrency(data.quote.currency)
          setForm(prev => ({
            ...prev,
            purchasePrice: data.quote.price.toString(),
            currency: data.quote.currency || prev.currency,
            sector: data.quote.sector || '',
            industry: data.quote.industry || '',
          }))
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('[quote]', err.message)
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

    if (!form.acquisitionDate) { setError(t('La fecha es obligatoria para calcular rendimientos', 'Date is required for return calculations')); return }
    if (!form.institution && !isProperty && !isDebt) { setError(t('La institución es obligatoria', 'Institution is required')); return }

    const qty = parseFloat(form.quantity) || (isBank || isProperty ? 1 : 0)
    const price = parseFloat(form.purchasePrice) || 0
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
    const curPrice0 = parseFloat(form.currentPrice) || 0
    const tlTotal = isMarketAsset ? qty * price : qty * (curPrice0 || price)
    const useTimeline = isNewMoney && !isDebt && !duplicateWarning && valueTimeline === 'multi' && tlTotal > 0
    let tlRows = []
    if (useTimeline) {
      const tlError = validateTimelineRows(timelineRows, tlTotal, { requireExact: isMarketAsset, lang })
      if (tlError) { setError(tlError); return }
      tlRows = timelineRows
        .filter((r) => (parseFloat(r.amount) || 0) > 0 && r.date)
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
          item.dividendYield = marketDivOverride ? (parseFloat(form.incomeRate) || 0) : divInfo.dividendYield
          item.dividendAction = form.dividendAction || 'cash'
        }
      } else if (isProperty) {
        item.symbol = form.symbol.trim() || form.name.trim().replace(/\s+/g, '-').toUpperCase()
        item.name = form.name.trim()
        item.quantity = 1
        item.purchasePrice = price
        if (form.currentPrice) item.currentPrice = parseFloat(form.currentPrice)
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
        if (form.currentPrice) item.currentPrice = parseFloat(form.currentPrice)
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
      if (!isMarketAsset) item.balanceAsOf = new Date().toISOString().slice(0, 10)

      // Income config
      if (showIncome && !isMarketAsset && (form.incomeAmount || form.incomeRate || form.rateMin || form.rateType === 'continuous')) {
        item.incomeMode = form.incomeMode
        item.rateType = form.rateType
        if (form.rateType === 'variable') {
          item.rateMin = parseFloat(form.rateMin) || 0
          item.rateMax = parseFloat(form.rateMax) || 0
          item.incomeRate = (item.rateMin + item.rateMax) / 2
        } else if (form.incomeMode === 'percent') {
          item.incomeRate = parseFloat(form.incomeRate) || 0
        } else {
          item.incomeAmount = parseFloat(form.incomeAmount) || 0
        }
        if (form.rateType !== 'continuous') {
          item.incomePayDay = parseInt(form.incomePayDay) || 1
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
          item.capitalReturn = parseFloat(form.capitalReturn) || 0
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
        item.entryFee = parseFloat(form.entryFee) || 0
        item.entryFeeMode = form.entryFeeMode || 'separate'
      }
      if (form.managementFee) {
        item.managementFee = parseFloat(form.managementFee) || 0
        item.managementFeeType = form.managementFeeType || 'percent'
      }
      if (form.expenseRatio) item.expenseRatio = parseFloat(form.expenseRatio) || 0
      // Accrued interest paid to the seller at purchase (buying between coupon
      // dates) — informational: surfaced back to the user in the past-due
      // preview above so they know part of the first coupon isn't new gain.
      if (form.accruedInterestAtPurchase) item.accruedInterestAtPurchase = parseFloat(form.accruedInterestAtPurchase) || 0

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
        if (form.safeCap) item.safeCap = parseFloat(form.safeCap) || 0
        if (form.safeDiscount) item.safeDiscount = parseFloat(form.safeDiscount) || 0
      }

      // VC/startup direct-investment fields — purely informational (cap-table
      // context: what stage, at what valuation, how much of the company). None
      // of it feeds the return formula: getItemPrincipalCost/getItemCostBasis
      // (⛔ congeladas) already have everything they need from
      // quantity/purchasePrice/entryFee, same as any other Alternativo.
      if (isAlternative && subtype === 'private_equity') {
        if (form.investmentStage) item.investmentStage = form.investmentStage
        if (form.roundValuation) item.roundValuation = parseFloat(form.roundValuation) || 0
        if (form.ownershipPct) item.ownershipPct = parseFloat(form.ownershipPct) || 0
        if (form.committedCapital) item.committedCapital = parseFloat(form.committedCapital) || 0
      }

      // Debt fields
      if (isDebt) {
        if (subtype === 'receivable') {
          item.isReceivable = true
        } else {
          item.isDebt = true
        }
        if (form.interestRate) item.interestRate = parseFloat(form.interestRate) || 0
        if (form.minimumPayment) item.minimumPayment = parseFloat(form.minimumPayment) || 0
        if (form.monthlyPayment) item.monthlyPayment = parseFloat(form.monthlyPayment) || 0
        if (form.debtTerm) item.debtTerm = form.debtTerm
        if (form.installmentsTotal) item.installmentsTotal = parseInt(form.installmentsTotal) || 0
        if (form.installmentsRemaining) item.installmentsRemaining = parseInt(form.installmentsRemaining) || 0
        const isCreditCard = subtype === 'credit_card'
        if (isCreditCard) {
          if (form.cardBrand) item.cardBrand = form.cardBrand
          if (form.rewardType) item.rewardType = form.rewardType
          if (form.rewardRate) item.rewardRate = parseFloat(form.rewardRate) || 0
          if (form.rewardBalance) item.rewardBalance = parseFloat(form.rewardBalance) || 0
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
      if (isNewMoney && !isDebt) item._newMoneyConfirmed = true

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
          const rowAmt = Math.round((parseFloat(row.amount) || 0) * 100) / 100
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
          : (parseFloat(form.entryFee) || 0)
        const singleDeposit = (isMerge ? lotQty * lotCost : (item.quantity || 1) * (item.purchasePrice || 0)) + feeOnEntry
        if (isNewMoney && onAddTransaction && singleDeposit > 0) {
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

      const totalValue = isMerge ? lotQty * lotCost : (item.quantity || 1) * (item.purchasePrice || 0)

      if (!isNewMoney && form.capitalDestination && totalValue > 0) {
        const source = existingItems.find(it => it.id === form.capitalDestination)
        if (source) {
          const srcBal = (source.currentPrice || source.purchasePrice || 0) - totalValue
          await onAdd({ ...source, currentPrice: Math.max(0, srcBal), purchasePrice: Math.max(0, srcBal) })
        }
      }
      onClose()
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const inputCls = 'w-full min-w-0 px-3 py-2 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg text-sm text-[var(--text-primary,white)] placeholder-[var(--text-muted,#475569)] focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block font-medium'

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
                        <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
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
                        <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      ) : form.purchasePrice ? (
                        <span className="text-xs text-emerald-400 font-medium">{form.currency} {parseFloat(form.purchasePrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      ) : null}
                    </div>
                  </div>
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
                  <input id="add-quantity" value={form.quantity} onChange={e => set('quantity', e.target.value)}
                    placeholder={type === 'Crypto' ? '0.5' : '10'} type="number" step="any" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="add-purchasePrice" className={labelCls}>{t('Precio de entrada', 'Entry price')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                  <input id="add-purchasePrice" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                    placeholder="150.00" type="number" step="any" className={inputCls} title={t('Precio por unidad/acción', 'Price per unit/share')} />
                </div>
              </div>
            )}

            {isProperty && (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="add-propertyPurchasePrice" className={labelCls}>{t('Lo que pagaste', 'What you paid')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                    <input id="add-propertyPurchasePrice" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                      placeholder="85000" type="number" step="any" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-propertyCurrentPrice" className={labelCls}>{t('Valor de hoy', 'Value today')} <span style={{ color: 'var(--text-muted)' }}>({t('opcional', 'optional')})</span></label>
                    <input id="add-propertyCurrentPrice" value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                      placeholder="95000" type="number" step="any" className={inputCls} />
                  </div>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted,#475569)' }}>
                  {t('Si dejas "Valor de hoy" vacío, usamos lo que pagaste.', 'If you leave "Value today" empty, we use what you paid.')}
                </p>
              </div>
            )}

            {isBank && (
              <div>
                <label htmlFor="add-balance" className={labelCls}>{t('Saldo actual', 'Current balance')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                <input id="add-balance" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                  placeholder="5000" type="number" step="any" className={inputCls} />
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
                  placeholder="10000" type="number" step="any" className={inputCls} />
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
                      placeholder="10000" type="number" step="any" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-currentValue" className={labelCls}>{t('Valor de hoy', 'Value today')} <span style={{ color: 'var(--text-muted)' }}>({t('opcional', 'optional')})</span></label>
                    <input id="add-currentValue" value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                      placeholder="10800" type="number" step="any" className={inputCls} />
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
              const invested = parseFloat(form.purchasePrice) || 0
              const entered = parseFloat(form.currentPrice) || 0
              const rate = form.incomeMode === 'percent' ? (parseFloat(form.incomeRate) || 0) : 0
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
                      placeholder="50000" type="number" step="any" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-interestRate" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa de interés %', 'Interest rate %')}</label>
                    <input id="add-interestRate" value={form.interestRate} onChange={e => set('interestRate', e.target.value)}
                      placeholder="7.5" type="number" step="any" className={inputCls} />
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
                      placeholder="24" type="number" step="1" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-installmentsRemaining" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Cuotas rest.', 'Pmts left')}</label>
                    <input id="add-installmentsRemaining" value={form.installmentsRemaining} onChange={e => set('installmentsRemaining', e.target.value)}
                      placeholder="18" type="number" step="1" className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="add-monthlyPayment" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Pago mensual', 'Monthly payment')}</label>
                    <input id="add-monthlyPayment" value={form.monthlyPayment} onChange={e => set('monthlyPayment', e.target.value)}
                      placeholder="500" type="number" step="any" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="add-debtMaturityDate" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Fecha vencimiento', 'Maturity date')}</label>
                    <input id="add-debtMaturityDate" value={form.maturityDate} onChange={e => set('maturityDate', e.target.value)}
                      type="date" className={inputCls} />
                  </div>
                </div>
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
                            placeholder="1.5" type="number" step="any" className={inputCls} />
                        </div>
                        <div>
                          <label htmlFor="add-rewardBalance" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Balance acumulado', 'Accumulated')}</label>
                          <input id="add-rewardBalance" value={form.rewardBalance} onChange={e => set('rewardBalance', e.target.value)}
                            placeholder="5000" type="number" step="any" className={inputCls} />
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
              <select id="add-currency" value={form.currency} onChange={e => set('currency', e.target.value)} className={inputCls}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
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
                <div className="w-3 h-3 border-2 border-[var(--text-muted,#475569)] border-t-transparent rounded-full animate-spin" />
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
                    <p className="text-xs text-[var(--text-muted,#475569)]">{t('Próximo pago', 'Next payment')}</p>
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
                          placeholder={String(divInfo.dividendYield ?? '')} type="number" step="any" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Día de pago', 'Pay day')}</label>
                        <input value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                          placeholder="15" type="number" min="1" max="31" className={inputCls} />
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
                      style={form.dividendAction === 'cash' ? { color: '#22d3ee', backgroundColor: 'rgba(6,182,212,0.2)', borderColor: 'rgba(6,182,212,0.4)' } : undefined}>
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

                {/* Rate inputs */}
                {form.rateType === 'variable' ? (
                  <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label htmlFor="add-rateMin" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa mín %', 'Min rate %')}</label>
                      <input id="add-rateMin" value={form.rateMin} onChange={e => set('rateMin', e.target.value)}
                        placeholder="4.5" type="number" step="any" className={inputCls} />
                    </div>
                    <div>
                      <label htmlFor="add-rateMax" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa máx %', 'Max rate %')}</label>
                      <input id="add-rateMax" value={form.rateMax} onChange={e => set('rateMax', e.target.value)}
                        placeholder="5.5" type="number" step="any" className={inputCls} />
                    </div>
                    <div>
                      <label htmlFor="add-varPayDay" className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Día de pago', 'Pay day')}</label>
                      <input id="add-varPayDay" value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                        placeholder="10" type="number" min="1" max="31" className={inputCls} />
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
                          placeholder={isProperty ? '800' : '48'} type="number" step="any" className={inputCls} />
                      </>) : (<>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa anual %', 'Annual rate %')}</label>
                        <input value={form.incomeRate} onChange={e => set('incomeRate', e.target.value)}
                          placeholder="5.5" type="number" step="any" className={inputCls} />
                      </>)}
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Día de pago', 'Pay day')}</label>
                      <input value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                        placeholder="10" type="number" min="1" max="31" className={inputCls} />
                    </div>
                  </div>
                )}

                {/* Business day rule */}
                {form.rateType !== 'continuous' && (
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
                {form.rateType !== 'continuous' && (
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
                  const qty = parseFloat(form.quantity) || 1
                  const price = parseFloat(form.purchasePrice) || 0
                  const balance = qty * price
                  const estimate = estimateIncomeAmount({
                    balance, incomeMode: form.incomeMode, incomeRate: parseFloat(form.incomeRate) || 0,
                    incomeAmount: parseFloat(form.incomeAmount) || 0, rateType: form.rateType,
                    rateMin: parseFloat(form.rateMin) || 0, rateMax: parseFloat(form.rateMax) || 0,
                    isPerShare: false, qty,
                  }, payMonthsCount)
                  const accrued = parseFloat(form.accruedInterestAtPurchase) || 0
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
                                {estimate > 0 && <span className="text-[var(--text-muted,#64748b)] ml-1.5">~{form.currency} {estimate.toFixed(2)}</span>}
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
                    placeholder="0" type="number" step="any" className={inputCls} />
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
                          placeholder="80" type="number" step="any" className={inputCls} />
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
                          placeholder={form.managementFeeType === 'fixed' ? '50' : '0.50'} type="number" step="any" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Expense %', 'Expense %')} <InfoTip text={t('Ratio de gastos anual, ej. 0.03 = 0.03%/año.', 'Annual expense ratio, e.g. 0.03 = 0.03%/yr.')} /></label>
                        <input value={form.expenseRatio} onChange={e => set('expenseRatio', e.target.value)}
                          placeholder="0.03" type="number" step="any" className={inputCls} />
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
                          placeholder="0" type="number" step="any" className={inputCls} />
                      </div>
                    )}
                    {/* Which side of the purchase value the fee sits on decides
                        how much cash really left the pocket, and that is the
                        denominator of every return % for this asset. */}
                    {parseFloat(form.entryFee) > 0 && (() => {
                      const fee = parseFloat(form.entryFee) || 0
                      const typed = (parseFloat(form.quantity) || 1) * (parseFloat(form.purchasePrice) || 0)
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

                    {(parseFloat(form.entryFee) > 0 || parseFloat(form.managementFee) > 0 || parseFloat(form.expenseRatio) > 0) && (
                      <p className="text-xs mt-1.5" style={{ color: 'color-mix(in srgb, var(--accent-orange) 70%, transparent)' }}>
                        {parseFloat(form.entryFee) > 0 && `${t('Entrada', 'Entry')}: ${form.currency} ${parseFloat(form.entryFee).toFixed(2)}  `}
                        {parseFloat(form.managementFee) > 0 && (form.managementFeeType === 'fixed'
                          ? `${t('Mgmt', 'Mgmt')}: ${form.currency} ${parseFloat(form.managementFee).toFixed(2)}/yr  `
                          : `${t('Mgmt', 'Mgmt')}: ${parseFloat(form.managementFee).toFixed(2)}%/yr  `)}
                        {parseFloat(form.expenseRatio) > 0 && `Expense: ${parseFloat(form.expenseRatio).toFixed(2)}%/yr`}
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
                        style={{ backgroundColor: form.isIlliquid ? '#f59e0b' : 'var(--card-border, #38383A)' }}>
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
                          placeholder="10000000" type="number" step="any" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Descuento %', 'Discount %')}</label>
                        <input value={form.safeDiscount} onChange={e => set('safeDiscount', e.target.value)}
                          placeholder="20" type="number" step="any" className={inputCls} />
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
                          placeholder="10000000" type="number" step="any" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">% {t('de la empresa', 'of the company')}</label>
                        <input value={form.ownershipPct} onChange={e => set('ownershipPct', e.target.value)}
                          placeholder="0.5" type="number" step="any" className={inputCls} />
                      </div>
                      <div>
                        <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">
                          {t('Capital comprometido', 'Committed capital')}
                          {' '}
                          <InfoTip text={t('Si te comprometiste a un monto total que se va llamando por partes (capital calls), ponlo aquí: la tarjeta de métricas VC/PE lo usa para calcular el PIC (qué % del compromiso ya se llamó). Opcional, no afecta el rendimiento.', 'If you committed to a total amount that gets called in pieces (capital calls), put it here: the VC/PE metrics card uses it for PIC (what % of the commitment has been called). Optional, does not affect returns.')} />
                        </label>
                        <input value={form.committedCapital} onChange={e => set('committedCapital', e.target.value)}
                          placeholder="50000" type="number" step="any" className={inputCls} />
                      </div>
                    </div>
                    {/* Suggested %, from what's already typed elsewhere in this
                        form (invested amount) — never auto-filled, just shown
                        so the user doesn't have to do the division by hand. A
                        later round dilutes this; there's no attempt to track
                        that automatically, this is a manual snapshot the user
                        updates whenever they hear about a new round. */}
                    {!form.ownershipPct && parseFloat(form.roundValuation) > 0 && (() => {
                      const invested = (parseFloat(form.quantity) || 1) * (parseFloat(form.purchasePrice) || 0)
                      if (invested <= 0) return null
                      const suggested = (invested / parseFloat(form.roundValuation)) * 100
                      return (
                        <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                          {t(`Sugerido: ${suggested.toFixed(3)}% (invertiste ${form.currency} ${invested.toLocaleString()} sobre una valuación de ${form.currency} ${parseFloat(form.roundValuation).toLocaleString()}).`,
                             `Suggested: ${suggested.toFixed(3)}% (you invested ${form.currency} ${invested.toLocaleString()} against a ${form.currency} ${parseFloat(form.roundValuation).toLocaleString()} valuation).`)}
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

            {/* New money toggle */}
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
              const qty = parseFloat(form.quantity) || (isBank || isProperty ? 1 : 0)
              const price = parseFloat(form.purchasePrice) || 0
              const cur = parseFloat(form.currentPrice) || 0
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
              const qty = parseFloat(form.quantity) || (isBank || isProperty ? 1 : 0)
              const price = parseFloat(form.purchasePrice) || 0
              const cur = parseFloat(form.currentPrice) || 0
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
                {saving ? '...' : t('Registrar', 'Register')}
              </button>
            </div>
          </>)}
        </form>
      </div>
    </div>
  )
}
