'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { safeJson } from '@/lib/authFetch'
import { validateItem } from '@/lib/validation'
import InlineCreateAccount from './InlineCreateAccount'

const CURRENCIES = ['USD','EUR','GBP','MXN','GTQ','COP','CLP','ARS','BRL','PEN','CAD','CHF','JPY','CNY']

const INSTITUTION_CURRENCY = {
  bi: 'GTQ', banrural: 'GTQ', bam: 'GTQ', industrial: 'GTQ', bantrab: 'GTQ',
  'g&t': 'GTQ', gyt: 'GTQ', ficohsa: 'GTQ', promerica: 'GTQ',
  banamex: 'MXN', banorte: 'MXN', azteca: 'MXN', 'hsbc mx': 'MXN',
  bancolombia: 'COP', davivienda: 'COP', 'bbva co': 'COP', nequi: 'COP',
  bcp: 'PEN', interbank: 'PEN', scotiabank: 'PEN',
  itau: 'BRL', bradesco: 'BRL', nubank: 'BRL',
  'banco estado': 'CLP', bci: 'CLP', 'santander cl': 'CLP',
  chase: 'USD', 'wells fargo': 'USD', citi: 'USD', bofa: 'USD',
  schwab: 'USD', fidelity: 'USD', vanguard: 'USD', ibkr: 'USD',
  barclays: 'GBP', lloyds: 'GBP', 'hsbc uk': 'GBP',
}

function detectCurrency(institution) {
  if (!institution) return null
  const lower = institution.toLowerCase().trim()
  for (const [key, cur] of Object.entries(INSTITUTION_CURRENCY)) {
    if (lower.includes(key) || lower === key) return cur
  }
  return null
}

const TYPES = [
  { key: 'Stock', icon: '📈', es: 'Acción', en: 'Stock', subtypes: [
    { key: 'common', es: 'Común', en: 'Common' },
    { key: 'preferred', es: 'Preferente', en: 'Preferred' },
    { key: 'private', es: 'Privada', en: 'Private' },
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
    { key: 'private_equity', es: 'Capital Privado', en: 'Private Equity' },
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
    taxJurisdiction: '',
    safeCap: '', safeDiscount: '', safeType: 'post_money',
    interestRate: '', minimumPayment: '',
    debtTerm: '', installmentsTotal: '', installmentsRemaining: '', monthlyPayment: '',
    cardBrand: '', rewardType: '', rewardRate: '', rewardBalance: '',
  })
  const [isNewMoney, setIsNewMoney] = useState(true)
  const [detectedCurrency, setDetectedCurrency] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [divInfo, setDivInfo] = useState(null)
  const [divLoading, setDivLoading] = useState(false)
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
  const isMarketAsset = type === 'Stock' || type === 'Crypto' || type === 'Fund'
  const isProperty = type === 'RealEstate'
  const isBank = type === 'Bank'
  const isBond = type === 'Bond'
  const isAlternative = type === 'Alternative'
  const isCrypto = type === 'Crypto'
  const isDebt = type === 'Debt'
  const currentTypeInfo = TYPES.find(tp => tp.key === type)

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
        const res = await fetch(`/api/prices/search?q=${encodeURIComponent(q)}`, { signal: searchAbortRef.current.signal })
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
      const res = await fetch(`/api/prices/search?symbol=${encodeURIComponent(result.symbol)}&type=${encodeURIComponent(newType)}`, { signal: searchAbortRef.current.signal })
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
    if (!isMarketAsset || !form.symbol || form.symbol.length < 1) { setDivInfo(null); return }
    const timer = setTimeout(async () => {
      const sym = form.symbol.trim().toUpperCase()
      if (sym.length < 1) return
      setDivLoading(true)
      try {
        const res = await fetch(`/api/prices/dividends?symbol=${encodeURIComponent(sym)}`)
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

    setSaving(true)
    try {
      const item = {
        type, currency: form.currency, institution: form.institution.trim(),
        acquisitionDate: form.acquisitionDate, accountType: form.accountType,
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
          item.incomeAmount = divInfo.lastAmount || 0
          item.incomeMonths = divInfo.paymentMonths || []
          item.incomeFrequency = divInfo.frequency
          item.dividendYield = divInfo.dividendYield
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
        if (form.incomeDestination) item.incomeDestination = form.incomeDestination
        if (form.capitalReturn) {
          item.capitalReturn = parseFloat(form.capitalReturn) || 0
          if (form.capitalDestination) item.capitalDestination = form.capitalDestination
        }
      }

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

      // SAFE Note fields
      if (isAlternative && subtype === 'safe_note') {
        item.safeType = form.safeType
        if (form.safeCap) item.safeCap = parseFloat(form.safeCap) || 0
        if (form.safeDiscount) item.safeDiscount = parseFloat(form.safeDiscount) || 0
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

      // Auto-create cash account for stock dividends
      if (isMarketAsset && divInfo?.hasDividend && form.dividendAction === 'cash' && form.institution.trim()) {
        const inst = form.institution.trim()
        const cashSymbol = `${inst.replace(/\s+/g, '').toUpperCase()}-CASH`
        const cashExists = existingItems.some(ei =>
          (ei.symbol || '').toUpperCase() === cashSymbol ||
          ((ei.type || '').toLowerCase() === 'bank' && (ei.institution || '').toLowerCase() === inst.toLowerCase() && /cash/i.test(ei.name || ei.symbol || ''))
        )
        if (!cashExists) {
          // Inherit the source asset's purchase date so the cash account has real
          // history (income paid into it can step up from the right month) instead
          // of appearing to start the day it was auto-created.
          await onAdd({ type: 'Bank', symbol: cashSymbol, name: `${inst} - Cash`, institution: inst, currency: form.currency, quantity: 1, purchasePrice: 0, currentPrice: 0, accountType: form.accountType, acquisitionDate: form.acquisitionDate || new Date().toISOString().split('T')[0], ...(activeEntity && activeEntity !== 'default' ? { entityId: activeEntity } : {}) })
        }
        item.incomeDestination = cashSymbol
      }

      if (activePortfolio && activePortfolio !== '__all__') {
        item.portfolioId = activePortfolio
      }
      if (activeEntity && activeEntity !== 'default') {
        item.entityId = activeEntity
      }

      // Same guardrails as file imports (future dates, absurd values, bad currency) —
      // manual entry previously skipped them entirely.
      const validationErrors = validateItem(item)
      if (validationErrors.length > 0) {
        setError(validationErrors.join(' · '))
        setSaving(false)
        return
      }

      const itemId = await onAdd(item)

      if (onAddLot && item.symbol && item.quantity > 0 && item.purchasePrice > 0 && !item.isDebt) {
        await onAddLot({
          symbol: (item.symbol || '').toUpperCase(),
          quantity: item.quantity,
          costBasis: item.purchasePrice,
          currency: item.currency || 'USD',
          acquisitionDate: item.acquisitionDate || new Date().toISOString().split('T')[0],
          ...(activePortfolio && activePortfolio !== '__all__' ? { portfolioId: activePortfolio } : {}),
        })
      }

      const totalValue = (item.quantity || 1) * (item.purchasePrice || 0)
      if (isNewMoney && onAddTransaction && totalValue > 0) {
        await onAddTransaction({
          type: 'DEPOSIT', symbol: item.symbol || '',
          description: `${item.name || item.symbol} - ${t('Dinero nuevo', 'New money')}`,
          date: form.acquisitionDate || new Date().toISOString().split('T')[0],
          totalAmount: Math.round(totalValue * 100) / 100, currency: item.currency || 'USD',
          ...(itemId ? { _linkedItemId: itemId } : {}),
          ...(activeEntity && activeEntity !== 'default' ? { entityId: activeEntity } : {}),
          _source: 'manual_new_account',
        })
      }

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

  const inputCls = 'w-full px-3 py-2 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg text-sm text-[var(--text-primary,white)] placeholder-[var(--text-muted,#475569)] focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block font-medium'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-account-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
              <div className="grid grid-cols-4 gap-2">
                {TYPES.map(tp => (
                  <button key={tp.key} type="button" onClick={() => { setType(tp.key); setSubtype(''); setForm(prev => ({ ...prev, symbol: '', name: '', purchasePrice: '', currentPrice: '', sector: '', industry: '', isIlliquid: false, custodyType: '', maturityDate: '' })); setDivInfo(null) }}
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
                <p className="text-xs text-[var(--text-secondary,#94a3b8)]">{duplicateWarning.name} ({duplicateWarning.institution || '—'}) — {duplicateWarning.quantity} @ {duplicateWarning.currency}</p>
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
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium">
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-propertyPurchasePrice" className={labelCls}>{t('Valor de compra', 'Purchase value')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                  <input id="add-propertyPurchasePrice" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                    placeholder="85000" type="number" step="any" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="add-propertyCurrentPrice" className={labelCls}>{t('Valor actual', 'Current value')}</label>
                  <input id="add-propertyCurrentPrice" value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                    placeholder="95000" type="number" step="any" className={inputCls} />
                </div>
              </div>
            )}

            {isBank && (
              <div>
                <label htmlFor="add-balance" className={labelCls}>{t('Saldo actual', 'Current balance')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                <input id="add-balance" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                  placeholder="5000" type="number" step="any" className={inputCls} />
              </div>
            )}

            {(isBond || isAlternative) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-amountInvested" className={labelCls}>{t('Monto invertido', 'Amount invested')} <span style={{ color: 'var(--text-negative)' }}>*</span></label>
                  <input id="add-amountInvested" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                    placeholder="10000" type="number" step="any" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="add-currentValue" className={labelCls}>{t('Valor actual', 'Current value')} <span style={{ color: 'var(--text-muted)' }}>({t('opcional', 'optional')})</span></label>
                  <input id="add-currentValue" value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                    placeholder="10800" type="number" step="any" className={inputCls} />
                </div>
              </div>
            )}

            {/* Soft double-check: does the entered current value match what the rate implies?
                Non-blocking — the user can save regardless or leave the field empty. */}
            {(isBond || isAlternative) && (() => {
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
                <div className="grid grid-cols-3 gap-3">
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

            {/* Currency + Account Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="add-currency" className={labelCls}>
                  {t('Moneda', 'Currency')} <span style={{ color: 'var(--text-negative)' }}>*</span>
                  {detectedCurrency && form.currency === detectedCurrency && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-medium" style={{ color: 'var(--accent-green)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 15%, transparent)' }}>
                      {t('Detectada', 'Detected')}
                    </span>
                  )}
                </label>
                <select id="add-currency" value={form.currency} onChange={e => set('currency', e.target.value)} className={inputCls}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="add-accountType" className={labelCls}>{t('Tipo de cuenta', 'Account type')}</label>
                <select id="add-accountType" value={form.accountType} onChange={e => set('accountType', e.target.value)} className={inputCls}>
                  {ACCOUNT_TYPES.map(at => <option key={at.key} value={at.key}>{lang === 'es' ? at.es : at.en}</option>)}
                </select>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {form.accountType === 'taxable' ? t('Paga impuestos (ej. cuenta de bolsa normal)', 'Pays taxes (e.g. regular brokerage)') :
                   form.accountType === 'retirement' ? t('Ahorro para retiro (ej. 401k, IRA, AFP)', 'Retirement savings (e.g. 401k, IRA)') :
                   t('Exenta de impuestos (ej. Roth IRA)', 'Tax-exempt (e.g. Roth IRA)')}
                </p>
              </div>
            </div>

            {/* Acquisition date */}
            <div>
              <label htmlFor="add-acquisitionDate" className={labelCls}>
                {isBank ? t('Fecha de apertura', 'Opening date') : t('Fecha de compra', 'Purchase date')} <span style={{ color: 'var(--text-negative)' }}>*</span>
              </label>
              <input id="add-acquisitionDate" value={form.acquisitionDate} onChange={e => set('acquisitionDate', e.target.value)}
                type="date" max={new Date().toISOString().split('T')[0]} className={inputCls} />
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
                <div className="grid grid-cols-3 gap-2 text-center">
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
                  <div className="grid grid-cols-3 gap-2">
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
                    <p className="text-xs" style={{ color: 'var(--accent-orange)' }}>⚠ {t('Falta la tasa máxima — el ingreso se calculará como 0.', 'Missing max rate — income will be calculated as 0.')}</p>
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

                {/* Income destination */}
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
                      onCreated={(id, it) => handleDestCreated('incomeDestination', id, it)} lang={lang} defaultCurrency={form.currency} />
                  )}
                </div>

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

            {showAdvanced && (
              <div className="space-y-3 pl-1 ml-1" style={{ borderLeft: '2px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}>
                {/* Maturity date for bonds/alternatives */}
                {(isBond || isAlternative) && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t('Fecha de vencimiento', 'Maturity date')}</label>
                      <input value={form.maturityDate} onChange={e => set('maturityDate', e.target.value)}
                        type="date" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t('Al vencimiento', 'At maturity')}</label>
                      <select value={form.maturityAction} onChange={e => set('maturityAction', e.target.value)} className={inputCls}>
                        <option value="return_capital">{t('Devolver capital', 'Return capital')}</option>
                        <option value="auto_renew">{t('Renovar', 'Auto-renew')}</option>
                        <option value="convert_equity">{t('Convertir a acciones', 'Convert to equity')}</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Illiquid asset toggle */}
                {(isProperty || isAlternative || (isBond && subtype === 'private_debt')) && (
                  <div className="flex items-center gap-3 px-3 py-2 border border-[var(--card-border,#38383A)] rounded-lg">
                    <button type="button" onClick={() => set('isIlliquid', !form.isIlliquid)}
                      className="w-8 h-4 rounded-full transition-colors relative"
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
                )}

                {/* Custody type for crypto */}
                {isCrypto && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t('Custodia', 'Custody')}</label>
                      <select value={form.custodyType} onChange={e => set('custodyType', e.target.value)} className={inputCls}>
                        <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                        <option value="custodial">{t('Exchange/Custodia', 'Exchange/Custodial')}</option>
                        <option value="self_custody">{t('Self-Custody', 'Self-Custody')}</option>
                        <option value="defi_protocol">{t('Protocolo DeFi', 'DeFi Protocol')}</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t('Detalles', 'Details')}</label>
                      <input value={form.custodyDetails} onChange={e => set('custodyDetails', e.target.value)}
                        placeholder={form.custodyType === 'self_custody' ? 'Ledger Nano X' : form.custodyType === 'defi_protocol' ? 'Osmosis, Aave...' : 'Binance, Kraken...'}
                        className={inputCls} />
                    </div>
                  </div>
                )}

                {/* SAFE Note fields */}
                {isAlternative && subtype === 'safe_note' && (
                  <div className="border border-pink-500/20 bg-pink-500/5 rounded-lg p-3 space-y-3">
                    <p className="text-xs text-pink-400 font-medium">SAFE Note</p>
                    <div className="grid grid-cols-3 gap-2">
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

                {/* Tax jurisdiction */}
                <div>
                  <label className={labelCls}>{t('Jurisdicción fiscal', 'Tax jurisdiction')}</label>
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

                {/* Notes */}
                {(isBond || isAlternative || isProperty) && (
                  <div>
                    <label className={labelCls}>{t('Notas', 'Notes')}</label>
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
                style={{ backgroundColor: isNewMoney ? '#3b82f6' : 'var(--card-border,#38383A)' }}>
                <span className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${isNewMoney ? 'left-4' : 'left-0.5'}`} />
              </button>
              <div>
                <span className="text-xs text-[var(--text-primary,white)] font-medium">{t('Es dinero nuevo para mi portafolio', 'This is new money for my portfolio')}</span>
                <p className="text-xs text-[var(--text-muted,#475569)]">
                  {isNewMoney ? t('Viene de fuera (salario, venta, etc.) — no es ganancia', 'Comes from outside (salary, sale, etc.) — not a gain') : t('Ya estaba en otra cuenta de mi portafolio', 'Was already in another account in my portfolio')}
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
                    onCreated={(id, it) => handleDestCreated('capitalDestination', id, it)} lang={lang} defaultCurrency={form.currency} />
                )}
              </div>
            )}

            {(() => {
              const qty = parseFloat(form.quantity) || (isBank || isProperty ? 1 : 0)
              const price = parseFloat(form.purchasePrice) || 0
              const cur = parseFloat(form.currentPrice) || 0
              const total = isDebt ? price : qty * (cur || price)
              const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              if (total > 0) {
                const warnings = []
                if (total > 10000000) warnings.push(t('⚠ Valor muy alto — verifica los datos', '⚠ Very high value — check your data'))
                if (isMarketAsset && qty > 0 && price > 0 && qty === price) warnings.push(t('⚠ Cantidad y precio son iguales — ¿es correcto?', '⚠ Quantity and price are the same — is this correct?'))
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
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
                {saving ? '...' : t('Registrar', 'Register')}
              </button>
            </div>
          </>)}
        </form>
      </div>
    </div>
  )
}
