'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

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
    { key: 'auto_loan', es: 'Préstamo Auto', en: 'Auto Loan' },
    { key: 'student_loan', es: 'Préstamo Estudiantil', en: 'Student Loan' },
    { key: 'other', es: 'Otro', en: 'Other' },
  ]},
]

const ACCOUNT_TYPES = [
  { key: 'taxable', es: 'Tributaria', en: 'Taxable' },
  { key: 'retirement', es: 'Retiro', en: 'Retirement' },
  { key: 'tax-free', es: 'Libre', en: 'Tax-free' },
]

export default function AddAccountModal({ onClose, onAdd, onAddTransaction, existingItems = [], lang = 'es' }) {
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
  })
  const [isNewMoney, setIsNewMoney] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [divInfo, setDivInfo] = useState(null)
  const [divLoading, setDivLoading] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [fetchingQuote, setFetchingQuote] = useState(false)
  const [showIncome, setShowIncome] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)
  const searchAbortRef = useRef(null)

  const t = (es, en) => lang === 'es' ? es : en
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))
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
          const data = await res.json()
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
        const data = await res.json()
        if (data.quote?.price) {
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
        if (res.ok) setDivInfo(await res.json())
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

    // Duplicate detection
    const existing = existingItems.find(ei => {
      if (isMarketAsset) return (ei.symbol || '').toUpperCase() === (form.symbol || '').toUpperCase() && (ei.institution || '').toLowerCase() === (form.institution || '').toLowerCase()
      return (ei.name || '').toLowerCase() === (form.name || '').toLowerCase() && (ei.institution || '').toLowerCase() === (form.institution || '').toLowerCase()
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
    setError('')

    if (!form.acquisitionDate) { setError(t('La fecha es obligatoria para calcular rendimientos', 'Date is required for return calculations')); return }
    if (!form.institution && !isProperty && !isDebt) { setError(t('La institución es obligatoria', 'Institution is required')); return }

    const qty = parseFloat(form.quantity) || (isBank || isProperty ? 1 : 0)
    const price = parseFloat(form.purchasePrice) || 0
    if (!isBank && price <= 0) { setError(t('El precio debe ser mayor a 0', 'Price must be greater than 0')); return }
    if (isMarketAsset && qty <= 0) { setError(t('La cantidad debe ser mayor a 0', 'Quantity must be greater than 0')); return }

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
          item.incomeMonths = form.incomeMonths.length > 0 ? form.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
          item.businessDayRule = form.businessDayRule
        } else {
          item.accrualMethod = 'compound_continuous'
          item.incomeMonths = [0,1,2,3,4,5,6,7,8,9,10,11]
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
        item.isDebt = true
        if (form.interestRate) item.interestRate = parseFloat(form.interestRate) || 0
        if (form.minimumPayment) item.minimumPayment = parseFloat(form.minimumPayment) || 0
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
          await onAdd({ type: 'Bank', symbol: cashSymbol, name: `${inst} - Cash`, institution: inst, currency: form.currency, quantity: 1, purchasePrice: 0, currentPrice: 0, accountType: form.accountType })
        }
        item.incomeDestination = cashSymbol
      }

      await onAdd(item)

      const totalValue = (item.quantity || 1) * (item.purchasePrice || 0)
      if (isNewMoney && onAddTransaction && totalValue > 0) {
        await onAddTransaction({
          type: 'DEPOSIT', symbol: item.symbol || '',
          description: `${item.name || item.symbol} - ${t('Dinero nuevo', 'New money')}`,
          date: form.acquisitionDate || new Date().toISOString().split('T')[0],
          totalAmount: Math.round(totalValue * 100) / 100, currency: item.currency || 'USD',
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

  const inputCls = 'w-full px-3 py-2 bg-[var(--input-bg,#0f172a)] border border-[var(--card-border,#334155)] rounded-lg text-sm text-[var(--text-primary,white)] placeholder-[var(--text-muted,#475569)] focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block font-medium'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-account-title">
      <div className="bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#334155)] rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#334155)]">
          <div className="flex items-center gap-3">
            {step === 2 && <button onClick={() => setStep(1)} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-sm">←</button>}
            <h2 id="add-account-title" className="text-lg font-bold text-[var(--text-primary,white)]">
              {step === 1 ? t('Agregar Activo', 'Add Asset') : t('Detalles', 'Details')}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <div className={`w-2 h-2 rounded-full ${step >= 1 ? 'bg-blue-400' : 'bg-[var(--card-border,#334155)]'}`} />
              <div className={`w-2 h-2 rounded-full ${step >= 2 ? 'bg-blue-400' : 'bg-[var(--card-border,#334155)]'}`} />
            </div>
            <button onClick={onClose} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-xl leading-none">&times;</button>
          </div>
        </div>

        <form onSubmit={step === 1 ? (e) => { e.preventDefault(); goToStep2() } : handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>}

          {/* === STEP 1 === */}
          {step === 1 && (<>
            <div>
              <label className={labelCls}>{t('Tipo de activo', 'Asset type')}</label>
              <div className="grid grid-cols-4 gap-2">
                {TYPES.map(tp => (
                  <button key={tp.key} type="button" onClick={() => { setType(tp.key); setSubtype(''); setForm(prev => ({ ...prev, symbol: '', name: '', purchasePrice: '', currentPrice: '', sector: '', industry: '', isIlliquid: false, custodyType: '', maturityDate: '' })); setDivInfo(null) }}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-all text-center ${
                      type === tp.key ? 'bg-blue-500/20 border border-blue-500/40 text-blue-400' : 'bg-[var(--input-bg,#0f172a)] border border-[var(--card-border,#334155)] text-[var(--text-secondary,#94a3b8)] hover:border-[var(--text-secondary,#94a3b8)]'
                    }`}>
                    <span className="text-lg">{tp.icon}</span>
                    <span className="text-xs font-medium">{lang === 'es' ? tp.es : tp.en}</span>
                  </button>
                ))}
              </div>
              {currentTypeInfo?.subtypes && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {currentTypeInfo.subtypes.map(st => (
                    <button key={st.key} type="button" onClick={() => setSubtype(st.key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                        subtype === st.key ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)] hover:border-[var(--text-secondary,#94a3b8)]'
                      }`}>
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
                  <label className={labelCls}>
                    {t('Buscar activo', 'Search asset')} *
                    <span className="text-[var(--text-muted,#475569)] ml-1 font-normal">
                      {type === 'Stock' ? '(AAPL, Apple...)' : type === 'Crypto' ? '(BTC, Bitcoin...)' : '(VOO, Vanguard...)'}
                    </span>
                  </label>
                  <div className="relative">
                    <input ref={inputRef} value={form.symbol}
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
                    <div ref={dropdownRef} className="absolute z-50 w-full mt-1 bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#475569)] rounded-lg shadow-xl max-h-56 overflow-y-auto">
                      {searchResults.map((r, i) => (
                        <button key={`${r.symbol}-${i}`} type="button" onClick={() => handleSelectSymbol(r)}
                          className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-[var(--input-bg,#283548)] transition-colors text-left border-b border-[var(--card-border,#334155)]/50 last:border-0">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={`text-xs font-bold shrink-0 px-1.5 py-0.5 rounded ${
                              r.type === 'Crypto' ? 'bg-amber-500/20 text-amber-400' : r.type === 'Fund' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                            }`}>{r.symbol}</span>
                            <span className="text-xs text-[var(--text-secondary,#cbd5e1)] truncate">{r.name}</span>
                          </div>
                          <span className="text-xs text-[var(--text-muted,#475569)] shrink-0 ml-2">{r.exchange}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {form.name && (
                  <div className="flex items-center justify-between bg-[var(--input-bg,#0f172a)] border border-[var(--card-border,#334155)] rounded-lg px-3 py-2">
                    <span className="text-sm text-[var(--text-primary,white)]">{form.name}</span>
                    <div className="flex items-center gap-2">
                      {form.sector && <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded">{form.sector}</span>}
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
                <label className={labelCls}>
                  {isBank ? t('Banco', 'Bank') : t('Nombre / Descripción', 'Name / Description')} *
                </label>
                {isBank ? (
                  <input value={form.institution} onChange={e => { set('institution', e.target.value); const hint = detectCurrency(e.target.value); if (hint) set('currency', hint) }}
                    placeholder={t('BAM, BI, Banrural...', 'Chase, BoA...')} className={inputCls} />
                ) : (
                  <input value={form.name} onChange={e => set('name', e.target.value)}
                    placeholder={isDebt ? t('Hipoteca casa, Tarjeta...', 'Home mortgage, Credit card...') : isBond ? t('Bono Corporativo IDC', 'IDC Corporate Bond') : isAlternative ? t('Club Cash In', 'Club Cash In') : isProperty ? t('Apartamento Centro', 'Downtown Apartment') : t('CDT Banco Industrial', 'Certificate of Deposit')}
                    className={inputCls} />
                )}
              </div>
            )}

            {isBank && (
              <div>
                <label className={labelCls}>{t('Nombre de cuenta', 'Account name')}</label>
                <input value={form.name} onChange={e => set('name', e.target.value)}
                  placeholder={t('Cuenta de ahorro', 'Savings account')} className={inputCls} />
              </div>
            )}

            {/* Institution with autocomplete (for non-bank, since bank already shows it) */}
            {!isBank && (
              <div className="relative">
                <label className={labelCls}>{t('Institución / Broker', 'Institution / Broker')} *</label>
                <input value={form.institution} onChange={e => { set('institution', e.target.value); setShowInstSuggestions(true); const hint = detectCurrency(e.target.value); if (hint && form.currency === 'USD') set('currency', hint) }}
                  onFocus={() => setShowInstSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowInstSuggestions(false), 200)}
                  placeholder={isProperty ? t('Propio, Inmobiliaria...', 'Self, Agency...') : 'IBKR, Fidelity, Binance...'}
                  className={inputCls} />
                {showInstSuggestions && filteredInstitutions.length > 0 && form.institution !== filteredInstitutions[0] && (
                  <div className="absolute z-40 w-full mt-1 bg-[var(--card-bg,#1e293b)] border border-[var(--card-border,#475569)] rounded-lg shadow-xl max-h-32 overflow-y-auto">
                    {filteredInstitutions.map(inst => (
                      <button key={inst} type="button" onClick={() => { set('institution', inst); setShowInstSuggestions(false) }}
                        className="w-full px-3 py-2 text-left text-sm text-[var(--text-secondary,#cbd5e1)] hover:bg-[var(--input-bg,#283548)] transition-colors">
                        {inst}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Duplicate warning */}
            {duplicateWarning && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2">
                <p className="text-xs text-amber-400 font-medium">{t('Este activo ya existe en tu portafolio', 'This asset already exists in your portfolio')}</p>
                <p className="text-xs text-[var(--text-secondary,#94a3b8)]">{duplicateWarning.name} ({duplicateWarning.institution || '—'}) — {duplicateWarning.quantity} @ {duplicateWarning.currency}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setStep(2) }}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30">
                    {t('Agregar a posición', 'Add to position')}
                  </button>
                  <button type="button" onClick={() => { setDuplicateWarning(null); setStep(2) }}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded bg-[var(--input-bg,#0f172a)] text-[var(--text-secondary,#94a3b8)] border border-[var(--card-border,#334155)]">
                    {t('Crear separado', 'Create separate')}
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="flex-1 py-2.5 border border-[var(--card-border,#334155)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-[var(--input-bg,#283548)] transition-colors text-sm">
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
                  <label className={labelCls}>{t('Cantidad', 'Quantity')} *</label>
                  <input value={form.quantity} onChange={e => set('quantity', e.target.value)}
                    placeholder={type === 'Crypto' ? '0.5' : '10'} type="number" step="any" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('Precio de entrada', 'Entry price')} *</label>
                  <input value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                    placeholder="150.00" type="number" step="any" className={inputCls} />
                </div>
              </div>
            )}

            {isProperty && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('Valor de compra', 'Purchase value')} *</label>
                  <input value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                    placeholder="85000" type="number" step="any" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('Valor actual', 'Current value')}</label>
                  <input value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                    placeholder="95000" type="number" step="any" className={inputCls} />
                </div>
              </div>
            )}

            {isBank && (
              <div>
                <label className={labelCls}>{t('Saldo actual', 'Current balance')} *</label>
                <input value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                  placeholder="5000" type="number" step="any" className={inputCls} />
              </div>
            )}

            {(isBond || isAlternative) && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t('Monto invertido', 'Amount invested')} *</label>
                  <input value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                    placeholder="10000" type="number" step="any" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('Valor actual', 'Current value')}</label>
                  <input value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                    placeholder="10800" type="number" step="any" className={inputCls} />
                </div>
              </div>
            )}

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
              <div className="flex items-center gap-3 px-3 py-2 border border-[var(--card-border,#334155)] rounded-lg">
                <button type="button" onClick={() => set('isIlliquid', !form.isIlliquid)}
                  className={`w-8 h-4 rounded-full transition-colors relative ${form.isIlliquid ? 'bg-amber-500' : 'bg-[var(--card-border,#334155)]'}`}>
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

            {/* Debt fields */}
            {isDebt && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t('Saldo actual', 'Current balance')} *</label>
                    <input value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                      placeholder="50000" type="number" step="any" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t('Tasa de interés %', 'Interest rate %')}</label>
                    <input value={form.interestRate} onChange={e => set('interestRate', e.target.value)}
                      placeholder="7.5" type="number" step="any" className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t('Pago mínimo', 'Minimum payment')}</label>
                    <input value={form.minimumPayment} onChange={e => set('minimumPayment', e.target.value)}
                      placeholder="500" type="number" step="any" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t('Fecha vencimiento', 'Maturity date')}</label>
                    <input value={form.maturityDate} onChange={e => set('maturityDate', e.target.value)}
                      type="date" className={inputCls} />
                  </div>
                </div>
              </div>
            )}

            {/* SAFE Note fields */}
            {isAlternative && subtype === 'safe_note' && (
              <div className="border border-pink-500/20 bg-pink-500/5 rounded-lg p-3 space-y-3">
                <p className="text-xs text-pink-400 font-medium">🔮 SAFE Note</p>
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
                <option value="GT">🇬🇹 Guatemala</option>
                <option value="MX">🇲🇽 México</option>
                <option value="US">🇺🇸 USA</option>
                <option value="CO">🇨🇴 Colombia</option>
                <option value="CL">🇨🇱 Chile</option>
                <option value="BR">🇧🇷 Brasil</option>
                <option value="PE">🇵🇪 Perú</option>
                <option value="AR">🇦🇷 Argentina</option>
                <option value="OTHER">{t('Otro', 'Other')}</option>
              </select>
            </div>

            {/* Currency + Account Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('Moneda', 'Currency')}</label>
                <select value={form.currency} onChange={e => set('currency', e.target.value)} className={inputCls}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('Tipo de cuenta', 'Account type')}</label>
                <select value={form.accountType} onChange={e => set('accountType', e.target.value)} className={inputCls}>
                  {ACCOUNT_TYPES.map(at => <option key={at.key} value={at.key}>{lang === 'es' ? at.es : at.en}</option>)}
                </select>
              </div>
            </div>

            {/* Acquisition date */}
            <div>
              <label className={labelCls}>
                {isBank ? t('Fecha de apertura', 'Opening date') : t('Fecha de compra', 'Purchase date')} *
              </label>
              <input value={form.acquisitionDate} onChange={e => set('acquisitionDate', e.target.value)}
                type="date" className={inputCls} />
            </div>

            {/* Dividend info for market assets */}
            {isMarketAsset && divLoading && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted,#475569)] py-1">
                <div className="w-3 h-3 border-2 border-[var(--text-muted,#475569)] border-t-transparent rounded-full animate-spin" />
                {t('Buscando dividendos...', 'Looking up dividends...')}
              </div>
            )}
            {isMarketAsset && divInfo?.hasDividend && (
              <div className="border border-blue-500/20 bg-blue-500/5 rounded-lg p-3 space-y-3">
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
                      className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.dividendAction === 'cash' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                      💵 {t('Efectivo', 'Cash')}
                    </button>
                    <button type="button" onClick={() => set('dividendAction', 'reinvest')}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.dividendAction === 'reinvest' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                      🔄 {t('Reinvertir', 'Reinvest')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Income config toggle for non-market */}
            {!isMarketAsset && (
              <button type="button" onClick={() => setShowIncome(!showIncome)}
                className="w-full text-left px-3 py-2 border border-[var(--card-border,#334155)] rounded-lg text-xs text-[var(--text-secondary,#94a3b8)] hover:border-blue-500/30 transition-colors flex items-center justify-between">
                <span>💰 {isProperty ? t('Configurar renta', 'Configure rental') : isBank ? t('Configurar intereses', 'Configure interest') : t('Configurar rendimiento', 'Configure yield')}</span>
                <span className="text-lg">{showIncome ? '−' : '+'}</span>
              </button>
            )}

            {showIncome && !isMarketAsset && (
              <div className="border border-[var(--card-border,#334155)] rounded-lg p-3 space-y-3">
                {/* Rate type selector */}
                <div>
                  <label className="text-xs text-[var(--text-muted,#475569)] mb-1.5 block">{t('Tipo de tasa', 'Rate type')}</label>
                  <div className="flex gap-1">
                    {[
                      { key: 'fixed', es: 'Fija', en: 'Fixed' },
                      { key: 'variable', es: 'Variable', en: 'Variable' },
                      { key: 'continuous', es: 'Continua', en: 'Continuous' },
                    ].map(rt => (
                      <button key={rt.key} type="button" onClick={() => set('rateType', rt.key)}
                        className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.rateType === rt.key ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                        {lang === 'es' ? rt.es : rt.en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Income mode: fixed amount vs percent */}
                <div className="flex gap-1">
                  <button type="button" onClick={() => set('incomeMode', 'fixed')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.incomeMode === 'fixed' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                    {t('Monto fijo', 'Fixed amount')}
                  </button>
                  <button type="button" onClick={() => set('incomeMode', 'percent')}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all ${form.incomeMode === 'percent' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
                    {t('% del saldo', '% of balance')}
                  </button>
                </div>

                {/* Rate inputs */}
                {form.rateType === 'variable' ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa mín %', 'Min rate %')}</label>
                      <input value={form.rateMin} onChange={e => set('rateMin', e.target.value)}
                        placeholder="4.5" type="number" step="any" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Tasa máx %', 'Max rate %')}</label>
                      <input value={form.rateMax} onChange={e => set('rateMax', e.target.value)}
                        placeholder="5.5" type="number" step="any" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Día de pago', 'Pay day')}</label>
                      <input value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                        placeholder="10" type="number" min="1" max="31" className={inputCls} />
                    </div>
                  </div>
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
                      className="px-2 py-1 bg-[var(--input-bg,#0f172a)] border border-[var(--card-border,#334155)] rounded text-xs text-[var(--text-primary,white)]">
                      <option value="exact">{t('Día exacto', 'Exact day')}</option>
                      <option value="next_business_day">{t('Siguiente día hábil', 'Next business day')}</option>
                    </select>
                  </div>
                )}

                {/* Payment months */}
                {form.rateType !== 'continuous' && (
                  <div>
                    <label className="text-xs text-[var(--text-muted,#475569)] mb-1.5 block">{t('Meses de pago', 'Payment months')}</label>
                    <div className="flex flex-wrap gap-1">
                      {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((label, i) => {
                        const active = form.incomeMonths.includes(i)
                        return (
                          <button key={i} type="button"
                            onClick={() => set('incomeMonths', active ? form.incomeMonths.filter(x => x !== i) : [...form.incomeMonths, i].sort((a, b) => a - b))}
                            className={`px-2 py-1 text-xs font-medium rounded transition-all ${active ? 'bg-blue-500/25 text-blue-400 border border-blue-500/40' : 'bg-[var(--input-bg,#0f172a)] text-[var(--text-muted,#475569)] border border-[var(--card-border,#334155)]'}`}>
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
                {existingItems.length > 0 && (
                  <div>
                    <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Pagos se depositan en:', 'Payments deposit to:')}</label>
                    <select value={form.incomeDestination} onChange={e => set('incomeDestination', e.target.value)} className={inputCls}>
                      <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                      {existingItems.map(it => <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}</option>)}
                    </select>
                  </div>
                )}

                {/* Capital return */}
                <div>
                  <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('Capital devuelto por pago', 'Capital returned per payment')}</label>
                  <input value={form.capitalReturn} onChange={e => set('capitalReturn', e.target.value)}
                    placeholder="0" type="number" step="any" className={inputCls} />
                </div>
              </div>
            )}

            {/* Notes */}
            {(isBond || isAlternative || isProperty) && (
              <div>
                <label className={labelCls}>{t('Notas', 'Notes')}</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                  placeholder={t('Detalles adicionales...', 'Additional details...')}
                  rows={2} className={inputCls + ' resize-none'} />
              </div>
            )}

            {/* New money toggle */}
            <div className="flex items-center gap-3 px-3 py-2 border border-[var(--card-border,#334155)] rounded-lg">
              <button type="button" onClick={() => setIsNewMoney(!isNewMoney)}
                className={`w-8 h-4 rounded-full transition-colors relative ${isNewMoney ? 'bg-blue-500' : 'bg-[var(--card-border,#334155)]'}`}>
                <span className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${isNewMoney ? 'left-4' : 'left-0.5'}`} />
              </button>
              <div>
                <span className="text-xs text-[var(--text-primary,white)] font-medium">{t('Dinero nuevo', 'New money')}</span>
                <p className="text-xs text-[var(--text-muted,#475569)]">
                  {isNewMoney ? t('Entra de afuera, no cuenta como rendimiento', 'From outside, not counted as return') : t('Ya estaba en el portafolio', 'Already in portfolio')}
                </p>
              </div>
            </div>

            {!isNewMoney && existingItems.length > 0 && (
              <div>
                <label className="text-xs text-[var(--text-muted,#475569)] mb-1 block">{t('¿De dónde sale?', 'Source account?')}</label>
                <select value={form.capitalDestination} onChange={e => set('capitalDestination', e.target.value)} className={inputCls}>
                  <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                  {existingItems.map(it => <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''} - {it.currency}</option>)}
                </select>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setStep(1)}
                className="flex-1 py-2.5 border border-[var(--card-border,#334155)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-[var(--input-bg,#283548)] transition-colors text-sm">
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
