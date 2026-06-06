'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { detectBI, parseBI } from '@/lib/parsers/biParser'
import { detectCoinbase, parseCoinbase } from '@/lib/parsers/coinbaseParser'
import { detectKraken, parseKraken } from '@/lib/parsers/krakenParser'
import { isIBKRSectionedFormat, parseIBKRFile, formatIBKRFileResult } from '@/lib/parsers/ibkrFileParser'
import { FINANCE_CATEGORIES, CATEGORY_COLORS } from '@/lib/financeCategories'
import { validateItem, sanitizeImportItem } from '@/lib/validation'

const FIELD_MAP = {
  symbol: ['symbol', 'ticker', 'simbolo', 'código', 'codigo', 'sym', 'coin'],
  name: ['name', 'nombre', 'description', 'descripcion', 'instrument', 'instrumento', 'asset', 'financial instrument', 'asset name'],
  type: ['type', 'tipo', 'category', 'categoria', 'asset_type', 'asset type', 'asset class'],
  subtype: ['subtype', 'subtipo', 'sub_type', 'sub type'],
  quantity: ['quantity', 'cantidad', 'qty', 'shares', 'acciones', 'units', 'unidades', 'position', 'total', 'balance', 'amount'],
  purchasePrice: ['precio de compra', 'purchase_price', 'purchaseprice', 'cost', 'costo', 'unit_price', 'avg_price', 'average price', 'precio promedio', 'precio compra', 'cost basis', 'cost price', 'avg cost'],
  currentPrice: ['precio actual', 'current_price', 'currentprice', 'market_price', 'valor actual', 'price', 'precio', 'close price', 'mark price', 'last price', 'market value'],
  institution: ['institution', 'institucion', 'broker', 'exchange', 'platform', 'plataforma', 'cuenta', 'account'],
  currency: ['currency', 'moneda', 'ccy'],
  acquisitionDate: ['fecha', 'fecha de compra', 'date', 'acquisition_date', 'purchase_date', 'fecha compra', 'fecha adquisicion', 'open date'],
  maturityDate: ['maturity', 'vencimiento', 'maturity_date', 'fecha vencimiento', 'expiry', 'expiration'],
  incomeRate: ['rate', 'tasa', 'yield', 'rendimiento', 'income_rate', 'interest_rate', 'tasa anual', 'annual_rate', 'apy', 'apr'],
  taxJurisdiction: ['jurisdiction', 'jurisdiccion', 'tax_jurisdiction', 'pais', 'country'],
  notes: ['notes', 'notas', 'comments', 'comentarios', 'memo'],
}

const BROKER_PRESETS = {
  ibkr: {
    detect: (h) => h.some((c) => /financial instrument/i.test(c)) || h.some((c) => /mark.?to.?market/i.test(c)),
    institution: 'Interactive Brokers',
    instructions: { es: 'IBKR → Performance & Reports → Flex Queries → Exportar CSV', en: 'IBKR → Performance & Reports → Flex Queries → Export CSV' },
  },
  degiro: {
    detect: (h) => h.some((c) => /product/i.test(c)) && h.some((c) => /isin/i.test(c)) && h.some((c) => /local value/i.test(c)),
    institution: 'DEGIRO',
    instructions: { es: 'DEGIRO → Actividad → Portafolio → Exportar', en: 'DEGIRO → Activity → Portfolio → Export' },
  },
  trading212: {
    detect: (h) => h.some((c) => /ticker.*isin/i.test(c)) || (h.some((c) => /^action$/i.test(c)) && h.some((c) => /price.*share/i.test(c))),
    institution: 'Trading 212',
    instructions: { es: 'Trading 212 → Menú → Historial → Exportar CSV', en: 'Trading 212 → Menu → History → Export CSV' },
  },
  tradeRepublic: {
    detect: (h) => h.some((c) => /isin/i.test(c)) && h.some((c) => /^shares$/i.test(c)) && h.length <= 10,
    institution: 'Trade Republic',
    instructions: { es: 'Trade Republic → Perfil → Actividad → Exportar', en: 'Trade Republic → Profile → Activity → Export' },
  },
  lightyear: {
    detect: (h) => h.some((c) => /ticker/i.test(c)) && h.some((c) => /average.*price/i.test(c)),
    institution: 'Lightyear',
    instructions: { es: 'Lightyear → Portfolio → Exportar posiciones', en: 'Lightyear → Portfolio → Export positions' },
  },
  saxoBank: {
    detect: (h) => h.some((c) => /instrument/i.test(c)) && h.some((c) => /exposure/i.test(c)),
    institution: 'Saxo Bank',
    instructions: { es: 'Saxo → Account → Reports → Portfolio → Export', en: 'Saxo → Account → Reports → Portfolio → Export' },
  },
  schwab: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /market value/i.test(c)) && h.some((c) => /security type/i.test(c)),
    institution: 'Charles Schwab',
    instructions: { es: 'Schwab → Positions → Export', en: 'Schwab → Positions → Export' },
  },
  fidelity: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /last price/i.test(c)) && h.some((c) => /current value/i.test(c)),
    institution: 'Fidelity',
    instructions: { es: 'Fidelity → Positions → Download', en: 'Fidelity → Positions → Download' },
  },
  vanguard: {
    detect: (h) => h.some((c) => /investment.*name/i.test(c)) && h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /^shares$/i.test(c)),
    institution: 'Vanguard',
    instructions: { es: 'Vanguard → My Accounts → Download holdings', en: 'Vanguard → My Accounts → Download holdings' },
  },
  etoro: {
    detect: (h) => h.some((c) => /position.*id/i.test(c)) || (h.some((c) => /open.*rate/i.test(c)) && h.some((c) => /close.*rate/i.test(c))),
    institution: 'eToro',
    instructions: { es: 'eToro → Portfolio → Configuración → Descargar datos', en: 'eToro → Portfolio → Settings → Download data' },
  },
  webull: {
    detect: (h) => h.some((c) => /ticker/i.test(c)) && h.some((c) => /avg.*cost/i.test(c)) && h.some((c) => /market.*value/i.test(c)),
    institution: 'Webull',
    instructions: { es: 'Webull → Positions → Export CSV', en: 'Webull → Positions → Export CSV' },
  },
  tradeStation: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /^last$/i.test(c)) && h.some((c) => /^qty$/i.test(c)),
    institution: 'TradeStation',
    instructions: { es: 'TradeStation → Portfolio → Exportar posiciones', en: 'TradeStation → Portfolio → Export positions' },
  },
  tastytrade: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /instrument.*type/i.test(c)) && h.some((c) => /trade.*price/i.test(c)),
    institution: 'Tastytrade',
    instructions: { es: 'Tastytrade → Positions → Export', en: 'Tastytrade → Positions → Export' },
  },
  ig: {
    detect: (h) => h.some((c) => /^market$/i.test(c)) && h.some((c) => /^direction$/i.test(c)) && h.some((c) => /^size$/i.test(c)),
    institution: 'IG',
    instructions: { es: 'IG → My IG → Reports → Download', en: 'IG → My IG → Reports → Download' },
  },
  dukascopy: {
    detect: (h) => h.some((c) => /dukascopy/i.test(c)) || (h.some((c) => /^instrument$/i.test(c)) && h.some((c) => /^p.?l$/i.test(c))),
    institution: 'Dukascopy',
    instructions: { es: 'Dukascopy → Reports → Statement → Export', en: 'Dukascopy → Reports → Statement → Export' },
  },
  alpaca: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /avg.*entry.*price/i.test(c)),
    institution: 'Alpaca Markets',
    instructions: { es: 'Alpaca → Dashboard → Portfolio → Export', en: 'Alpaca → Dashboard → Portfolio → Export' },
  },
  ppiGlobal: {
    detect: (h) => h.some((c) => /especie/i.test(c)) || h.some((c) => /^ppi$/i.test(c)),
    institution: 'PPI Global',
    instructions: { es: 'PPI → Mi Portafolio → Exportar', en: 'PPI → My Portfolio → Export' },
  },
  tdAmeritrade: {
    detect: (h) => h.some((c) => /account.*number/i.test(c)) && h.some((c) => /^security$/i.test(c)) && h.some((c) => /^description$/i.test(c)),
    institution: 'TD Ameritrade',
    instructions: { es: 'thinkorswim → Monitor → Activity → Export', en: 'thinkorswim → Monitor → Activity → Export' },
  },
  m1Finance: {
    detect: (h) => h.some((c) => /^m1$/i.test(c)) || (h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /target.*allocation/i.test(c))),
    institution: 'M1 Finance',
    instructions: { es: 'M1 → Research → Holdings → Export', en: 'M1 → Research → Holdings → Export' },
  },
  revolut: {
    detect: (h) => h.some((c) => /^symbol$/i.test(c)) && h.some((c) => /^quantity$/i.test(c)) && h.some((c) => /price.*per.*share/i.test(c)),
    institution: 'Revolut Investments',
    instructions: { es: 'Revolut → Inversiones → Exportar estado de cuenta', en: 'Revolut → Investments → Export statement' },
  },
  myInvestor: {
    detect: (h) => h.some((c) => /isin/i.test(c)) && h.some((c) => /participaciones/i.test(c)),
    institution: 'MyInvestor',
    instructions: { es: 'MyInvestor → Mi Cartera → Descargar posiciones', en: 'MyInvestor → My Portfolio → Download positions' },
  },
  coinbase: {
    detect: (h) => detectCoinbase(h.map(c => (c || '').toString().trim())),
    institution: 'Coinbase',
    typeOverride: 'Crypto',
    instructions: { es: 'Coinbase → Configuración → Reportes → Generar reporte', en: 'Coinbase → Settings → Reports → Generate report' },
  },
  kraken: {
    detect: (h) => detectKraken(h.map(c => (c || '').toString().trim())),
    institution: 'Kraken',
    typeOverride: 'Crypto',
    instructions: { es: 'Kraken → History → Export', en: 'Kraken → History → Export' },
  },
  binance: {
    detect: (h) => h.some((c) => /^coin$/i.test(c)) && h.some((c) => /^total$/i.test(c)),
    institution: 'Binance',
    typeOverride: 'Crypto',
    instructions: { es: 'Binance → Wallet → Spot → Export', en: 'Binance → Wallet → Spot → Export' },
  },
}

function guessMapping(headers) {
  const mapping = {}
  const lowerHeaders = headers.map((h) => (h || '').toString().toLowerCase().trim())

  for (const [field, aliases] of Object.entries(FIELD_MAP)) {
    const idx = lowerHeaders.findIndex((h) => aliases.some((a) => h === a || h.includes(a)))
    if (idx !== -1) mapping[field] = idx
  }
  return mapping
}

function inferType(row, mapping) {
  const name = mapping.name != null ? (row[mapping.name] || '').toString() : ''
  const symbol = mapping.symbol != null ? (row[mapping.symbol] || '').toString() : ''
  const typeHint = mapping.type != null ? (row[mapping.type] || '').toString() : ''
  const combined = `${name} ${symbol} ${typeHint}`

  if (/btc|eth|sol|ada|dot|bnb|xrp|doge|avax|matic|crypto|cripto|usdt|usdc|bitcoin|ethereum|staking|defi/i.test(combined)) return 'Crypto'
  if (/\bdebt\b|deuda|hipoteca|mortgage|\bloan\b|prestamo|credit.?card|tarjeta|liability|pasivo/i.test(combined)) return 'Debt'
  if (/safe.?note|vc.?fund|private.?equity|club.?deal|\balternative?\b|collectible/i.test(combined)) return 'Alternative'
  if (/real.?estate|inmueble|property|propiedad|\breit\b|crowdfund/i.test(combined)) return 'RealEstate'
  if (/\betf\b|\bfund\b|fondo|vanguard|ishares|spdr|mutual/i.test(combined)) return 'Fund'
  if (/\bbond\b|bono|cete|letra|pagare|instrumento|treasury|cdt|deposito|certificado/i.test(combined)) return 'Bond'
  if (/\bbank\b|banco|saving|ahorro|\bcash\b|efectivo|checking|cuenta/i.test(combined)) return 'Bank'
  return 'Stock'
}

function parseCSVLine(line, sep) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; continue }
      if (ch === '"') { inQuotes = false; continue }
      current += ch
    } else {
      if (ch === '"') { inQuotes = true; continue }
      if (ch === sep) { fields.push(current.trim()); current = ''; continue }
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function parseEuropeanOrUS(str) {
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
    return parseFloat(str.replace(/\./g, '').replace(',', '.'))
  }
  if (/^-?\d+,\d{1,2}$/.test(str)) {
    return parseFloat(str.replace(',', '.'))
  }
  return parseFloat(str.replace(/,/g, ''))
}

function parseNumber(val) {
  if (val == null) return 0
  if (typeof val === 'number') return isFinite(val) ? val : 0
  let str = val.toString().trim()
  str = str.replace(/[$€£¥₡₿Q₱₨]/g, '')
  const neg = str.match(/^\((.+)\)$/)
  if (neg) str = '-' + neg[1]
  str = str.replace(/[\s ]/g, '')
  str = str.replace(/%$/, '')
  const shorthand = str.match(/^(-?[\d.,]+)([KkMmBb])$/)
  if (shorthand) {
    const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 }
    const base = parseEuropeanOrUS(shorthand[1])
    const result = base * (mult[shorthand[2]] || 1)
    return isFinite(result) ? result : 0
  }
  const num = parseEuropeanOrUS(str)
  return isFinite(num) ? num : 0
}

export default function FileImportModal({ onClose, onImportItems, onImportTransaction, onImportSnapshot, onAddLot, onAddFinanceTransaction, onUpdateItem, onDeleteItem, onBulkImport, existingItems, activePortfolio, activeEntity = 'default', lang = 'es', brokerHint = null }) {
  const [mode, setMode] = useState('file')
  const [step, setStep] = useState('upload')
  const [rawData, setRawData] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [pasteText, setPasteText] = useState('')
  const fileRef = useRef(null)
  const [ibkrData, setIbkrData] = useState(null)
  const [ibkrImportMode, setIbkrImportMode] = useState('merge')
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })

  // Manual form
  const [manual, setManual] = useState({
    symbol: '', name: '', type: 'Stock', quantity: '', purchasePrice: '', institution: '',
  })

  const [extraSheets, setExtraSheets] = useState({ snapshots: [], transactions: [] })
  const [biData, setBiData] = useState(null)
  const [selectedBankAccount, setSelectedBankAccount] = useState('')

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    if (brokerHint && step === 'upload' && mode === 'file') {
      setTimeout(() => fileRef.current?.click(), 150)
    }
  }, [brokerHint])

  const handleFile = useCallback(async (file) => {
    setError('')

    const MAX_SIZE = 5 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      setError(lang === 'es' ? 'Archivo demasiado grande (máx 5MB).' : 'File too large (max 5MB).')
      return
    }

    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ]
    const ext = (file.name || '').split('.').pop()?.toLowerCase()
    if (!validTypes.includes(file.type) && !['xlsx', 'xls', 'csv'].includes(ext)) {
      setError(lang === 'es' ? 'Tipo de archivo no válido. Usa .xlsx o .csv.' : 'Invalid file type. Use .xlsx or .csv.')
      return
    }

    try {
      if (ext === 'csv') {
        const rawText = await file.text()
        if (isIBKRSectionedFormat(rawText)) {
          const parsed = parseIBKRFile(rawText)
          if (parsed._isPerformanceReport || (parsed.positions.length === 0 && parsed.cashPositions.length === 0)) {
            setError(lang === 'es'
              ? 'No se encontraron posiciones en este archivo. Exporta un Activity Statement desde IBKR → Reports → Statements → Activity.'
              : 'No positions found in this file. Export an Activity Statement from IBKR → Reports → Statements → Activity.')
            return
          }
          const formatted = formatIBKRFileResult(parsed)
          setIbkrData(formatted)
          setStep('ibkr-preview')
          return
        }
      }

      const XLSX = await import('xlsx')
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data, { type: 'array' })

      const sheetNames = wb.SheetNames.map((n) => n.toLowerCase())
      const assetsIdx = sheetNames.findIndex((n) => /activos|assets|portfolio|holdings/i.test(n))
      const histIdx = sheetNames.findIndex((n) => /historial|history|snapshots/i.test(n))
      const txIdx = sheetNames.findIndex((n) => /transacciones|transactions/i.test(n))

      const mainSheet = wb.Sheets[wb.SheetNames[assetsIdx >= 0 ? assetsIdx : 0]]
      const json = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' })

      if (json.length < 2) {
        setError(lang === 'es' ? 'El archivo no tiene datos suficientes.' : 'File has insufficient data.')
        return
      }
      if (json.length > 10000) {
        setError(lang === 'es' ? 'Archivo demasiado grande (máx 10,000 filas).' : 'File too large (max 10,000 rows).')
        return
      }

      const parsed = { snapshots: [], transactions: [] }

      if (histIdx >= 0) {
        const histRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[histIdx]], { header: 1, defval: '' })
        for (let i = 1; i < histRows.length; i++) {
          const r = histRows[i]
          const date = r[0] ? r[0].toString().trim() : ''
          const totalAssets = parseNumber(r[1])
          const totalDebt = parseNumber(r[2])
          const netWorth = parseNumber(r[3]) || (totalAssets - totalDebt)
          if (date && (totalAssets > 0 || netWorth > 0)) {
            parsed.snapshots.push({ date, totalActivosUSD: totalAssets, netWorthUSD: netWorth })
          }
        }
      }

      if (txIdx >= 0) {
        const txRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[txIdx]], { header: 1, defval: '' })
        for (let i = 1; i < txRows.length; i++) {
          const r = txRows[i]
          const date = r[0] ? r[0].toString().trim() : ''
          const type = (r[1] || '').toString().trim().toUpperCase()
          if (date && type) {
            parsed.transactions.push({
              date, type,
              symbol: (r[2] || '').toString().trim().toUpperCase(),
              description: (r[3] || '').toString().trim(),
              totalAmount: parseNumber(r[4]),
              currency: (r[5] || 'USD').toString().trim(),
            })
          }
        }
      }

      setExtraSheets(parsed)

      const hdrs = json[0].map((h) => (h || '').toString().trim())
      const rows = json.slice(1).filter((r) => r.some((cell) => cell !== ''))

      if (detectCoinbase(hdrs)) {
        const items = parseCoinbase(rows, hdrs)
        const mapped = items.map(it => sanitizeImportItem(it))
        setHeaders(['symbol', 'name', 'type', 'quantity', 'purchasePrice', 'currentPrice', 'institution', 'currency'])
        setRawData(mapped.map(it => [it.symbol, it.name, it.type, it.quantity, it.purchasePrice, it.currentPrice, it.institution, it.currency]))
        setMapping({ symbol: 0, name: 1, type: 2, quantity: 3, purchasePrice: 4, currentPrice: 5, institution: 6, currency: 7 })
        setStep('map')
      } else if (detectKraken(hdrs)) {
        const items = parseKraken(rows, hdrs)
        const mapped = items.map(it => sanitizeImportItem(it))
        setHeaders(['symbol', 'name', 'type', 'quantity', 'purchasePrice', 'currentPrice', 'institution', 'currency'])
        setRawData(mapped.map(it => [it.symbol, it.name, it.type, it.quantity, it.purchasePrice, it.currentPrice, it.institution, it.currency]))
        setMapping({ symbol: 0, name: 1, type: 2, quantity: 3, purchasePrice: 4, currentPrice: 5, institution: 6, currency: 7 })
        setStep('map')
      } else if (detectBI(hdrs)) {
        const parsed = parseBI(rows, hdrs)
        setBiData(parsed)
        setStep('bi-preview')
      } else {
        setHeaders(hdrs)
        setRawData(rows)
        setMapping(guessMapping(hdrs))
        setStep('map')
      }
    } catch (err) {
      setError(lang === 'es' ? `Error leyendo archivo: ${err.message}` : `Error reading file: ${err.message}`)
    }
  }, [lang])

  const handlePaste = useCallback(() => {
    if (!pasteText.trim()) return
    const lines = pasteText.trim().split('\n')
    if (lines.length < 2) {
      setError(lang === 'es' ? 'Necesitas al menos una fila de encabezados y una de datos.' : 'Need at least a header row and a data row.')
      return
    }

    const sep = lines[0].includes('\t') ? '\t' : ','
    const hdrs = parseCSVLine(lines[0], sep)
    const rows = lines.slice(1).map((l) => parseCSVLine(l, sep)).filter((r) => r.some((c) => c !== ''))

    setHeaders(hdrs)
    setRawData(rows)
    setMapping(guessMapping(hdrs))
    setStep('map')
  }, [pasteText, lang])

  const detectedBroker = useMemo(() => {
    const lh = headers.map((h) => (h || '').toString().trim())
    for (const [key, preset] of Object.entries(BROKER_PRESETS)) {
      if (preset.detect(lh)) return { key, ...preset }
    }
    return null
  }, [headers])

  const buildPreview = useCallback(() => {
    const items = rawData.map((row) => {
      const item = {
        symbol: mapping.symbol != null ? (row[mapping.symbol] || '').toString().trim() : '',
        name: mapping.name != null ? (row[mapping.name] || '').toString().trim() : '',
        type: detectedBroker?.typeOverride || (mapping.type != null ? (row[mapping.type] || '').toString().trim() : inferType(row, mapping)),
        quantity: parseNumber(mapping.quantity != null ? row[mapping.quantity] : 0),
        purchasePrice: parseNumber(mapping.purchasePrice != null ? row[mapping.purchasePrice] : 0),
        institution: mapping.institution != null ? (row[mapping.institution] || '').toString().trim() : (detectedBroker?.institution || ''),
        currency: mapping.currency != null ? (row[mapping.currency] || 'USD').toString().trim() : 'USD',
      }
      if (mapping.currentPrice != null) {
        const cp = parseNumber(row[mapping.currentPrice])
        if (cp > 0) item.currentPrice = cp
      }
      if (mapping.acquisitionDate != null) {
        const d = (row[mapping.acquisitionDate] || '').toString().trim()
        if (d) item.acquisitionDate = d
      }
      if (mapping.subtype != null) {
        const st = (row[mapping.subtype] || '').toString().trim()
        if (st) item.subtype = st
      }
      if (mapping.maturityDate != null) {
        const md = (row[mapping.maturityDate] || '').toString().trim()
        if (md) item.maturityDate = md
      }
      if (mapping.incomeRate != null) {
        const ir = parseNumber(row[mapping.incomeRate])
        if (ir > 0) item.incomeRate = ir
      }
      if (mapping.taxJurisdiction != null) {
        const tj = (row[mapping.taxJurisdiction] || '').toString().trim()
        if (tj) item.taxJurisdiction = tj
      }
      if (mapping.notes != null) {
        const n = (row[mapping.notes] || '').toString().trim()
        if (n) item.notes = n
      }
      if (/^debt$/i.test(item.type)) {
        item.isDebt = true
      }
      return item
    }).filter((item) => item.symbol || item.name).map(sanitizeImportItem)

    setPreview(items)
    setStep('preview')
  }, [rawData, mapping, detectedBroker])

  const doImport = useCallback(async () => {
    setImporting(true)
    setError('')
    let success = 0
    let failed = 0
    let snapCount = 0
    let txCount = 0

    for (const item of preview) {
      try {
        const errors = validateItem(item)
        if (errors.length > 0) {
          console.warn(`[Import] Skipping ${item.symbol || item.name}:`, errors)
          failed++
          continue
        }
        if (activePortfolio && activePortfolio !== '__all__') {
          item.portfolioId = activePortfolio
        }
        if (activeEntity && activeEntity !== 'default') {
          item.entityId = activeEntity
        }
        await onImportItems(item)
        if (onAddLot && item.symbol && item.quantity > 0 && item.purchasePrice > 0 && !/debt|deuda/i.test(item.type || '')) {
          await onAddLot({
            symbol: (item.symbol || '').toUpperCase(),
            quantity: item.quantity,
            costBasis: item.purchasePrice,
            currency: item.currency || 'USD',
            acquisitionDate: item.acquisitionDate || new Date().toISOString().split('T')[0],
            ...(activePortfolio && activePortfolio !== '__all__' ? { portfolioId: activePortfolio } : {}),
          })
        }
        success++
      } catch {
        failed++
      }
    }

    if (onImportSnapshot && extraSheets.snapshots.length > 0) {
      for (const snap of extraSheets.snapshots) {
        try {
          await onImportSnapshot(snap)
          snapCount++
        } catch {}
      }
    }

    if (onImportTransaction && extraSheets.transactions.length > 0) {
      for (const tx of extraSheets.transactions) {
        try {
          await onImportTransaction(tx)
          txCount++
        } catch {}
      }
    }

    setResult({ success, failed, total: preview.length, snapCount, txCount })
    setStep('done')
    setImporting(false)
  }, [preview, onImportItems, onImportSnapshot, onImportTransaction, onAddLot, activePortfolio, extraSheets])

  const doManualImport = useCallback(async () => {
    if (!manual.symbol && !manual.name) {
      setError(lang === 'es' ? 'Ingresa al menos el símbolo o nombre.' : 'Enter at least symbol or name.')
      return
    }
    const candidate = sanitizeImportItem({
      ...manual,
      quantity: parseNumber(manual.quantity),
      purchasePrice: parseNumber(manual.purchasePrice),
    })
    const errors = validateItem(candidate)
    if (errors.length > 0) {
      setError(errors.join(', '))
      return
    }
    setImporting(true)
    setError('')
    try {
      await onImportItems(candidate)
      setResult({ success: 1, failed: 0, total: 1 })
      setStep('done')
    } catch (err) {
      setError(err.message)
    }
    setImporting(false)
  }, [manual, onImportItems, lang])

  const doBIImport = useCallback(async () => {
    if (!biData || !onAddFinanceTransaction) return
    setImporting(true)
    setError('')
    let success = 0
    let failed = 0

    for (const tx of biData.transactions) {
      try {
        await onAddFinanceTransaction(tx)
        success++
      } catch {
        failed++
      }
    }

    if (biData.finalBalance > 0) {
      const bankAccounts = (existingItems || []).filter(it => /bank|banco/i.test(it.type || ''))
      const target = selectedBankAccount ? bankAccounts.find(a => a.id === selectedBankAccount) : null

      if (target && onUpdateItem) {
        await onUpdateItem(target.id, { currentPrice: biData.finalBalance, purchasePrice: biData.finalBalance })
      } else if (onImportItems) {
        await onImportItems({
          type: 'Bank',
          name: 'BI Monetaria',
          symbol: 'BI-MONETARIA',
          institution: 'Banco Industrial',
          currency: biData.currency || 'GTQ',
          quantity: 1,
          currentPrice: biData.finalBalance,
          purchasePrice: biData.finalBalance,
        })
      }
    }

    setResult({ success, failed, total: biData.transactions.length, isBI: true })
    setStep('done')
    setImporting(false)
  }, [biData, onAddFinanceTransaction, onImportItems, onUpdateItem, existingItems, selectedBankAccount])

  const doIBKRImport = useCallback(async () => {
    if (!ibkrData || !ibkrData.items || ibkrData.items.length === 0) return
    setImporting(true)
    setError('')
    setImportProgress({ done: 0, total: 0 })

    const deleteIds = []
    if (ibkrImportMode === 'replace' && existingItems) {
      const ibkrItems = existingItems.filter(it => it.institution === 'Interactive Brokers' || it._source === 'ibkr')
      for (const it of ibkrItems) deleteIds.push(it.id)
    }

    const validItems = []
    const validLots = []
    for (const item of ibkrData.items) {
      const clean = sanitizeImportItem(item)
      if (activePortfolio && activePortfolio !== '__all__') clean.portfolioId = activePortfolio
      if (activeEntity && activeEntity !== 'default') clean.entityId = activeEntity
      validItems.push(clean)
      if (clean.symbol && clean.quantity > 0 && clean.purchasePrice > 0 && !/debt|deuda/i.test(clean.type || '')) {
        validLots.push({
          symbol: (clean.symbol || '').toUpperCase(),
          quantity: clean.quantity,
          costBasis: clean.purchasePrice,
          currency: clean.currency || 'USD',
          acquisitionDate: clean.acquisitionDate || new Date().toISOString().split('T')[0],
          ...(activePortfolio && activePortfolio !== '__all__' ? { portfolioId: activePortfolio } : {}),
          ...(activeEntity && activeEntity !== 'default' ? { entityId: activeEntity } : {}),
        })
      }
    }

    let lastDone = 0
    try {
      await onBulkImport({
        items: validItems,
        lots: validLots,
        transactions: ibkrData.transactions || [],
        snapshots: ibkrData.equityHistory || [],
        deleteIds,
      }, (done, total) => {
        lastDone = done
        setImportProgress({ done, total })
      })
      setResult({ success: validItems.length, failed: 0, total: ibkrData.items.length, replaced: deleteIds.length })
    } catch (err) {
      console.error('[IBKR Import]', err)
      if (lastDone > 0) {
        setResult({ success: validItems.length, failed: 0, total: ibkrData.items.length, replaced: deleteIds.length })
      } else {
        setResult({ success: 0, failed: validItems.length, total: ibkrData.items.length, replaced: 0, errorMsg: err.message })
      }
    } finally {
      setStep('done')
      setImporting(false)
    }
  }, [ibkrData, onBulkImport, existingItems, activePortfolio, activeEntity, ibkrImportMode])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const t = (es, en) => lang === 'es' ? es : en

  const BROKER_INSTRUCTIONS = {
    ibkr: { name: 'Interactive Brokers', icon: '🏦' },
    alpaca: { name: 'Alpaca Markets', icon: '🦙' },
    schwab: { name: 'Charles Schwab', icon: '🇺🇸' },
    fidelity: { name: 'Fidelity', icon: '🇺🇸' },
    vanguard: { name: 'Vanguard', icon: '🇺🇸' },
    degiro: { name: 'DEGIRO', icon: '🇪🇺' },
    trading212: { name: 'Trading 212', icon: '📊' },
    traderepublic: { name: 'Trade Republic', icon: '🇩🇪' },
    etoro: { name: 'eToro', icon: '📈' },
    webull: { name: 'Webull', icon: '📱' },
    coinbase: { name: 'Coinbase', icon: '🟠' },
    kraken: { name: 'Kraken', icon: '🦑' },
    binance: { name: 'Binance', icon: '🟡' },
    bitso: { name: 'Bitso', icon: '🟢' },
  }

  const brokerInfo = brokerHint ? BROKER_INSTRUCTIONS[brokerHint] : null
  const modalTitle = brokerInfo
    ? t(`Importar CSV — ${brokerInfo.name}`, `Import CSV — ${brokerInfo.name}`)
    : t('Importar Portfolio', 'Import Portfolio')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#38383A]">
          <h2 id="import-modal-title" className="text-lg font-bold text-white">{brokerInfo ? `${brokerInfo.icon} ` : ''}{modalTitle}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Mode tabs */}
        {step === 'upload' && (
          <div className="flex border-b border-[#38383A]">
            {[
              { key: 'file', label: t('Archivo', 'File'), icon: '📁' },
              { key: 'paste', label: t('Pegar', 'Paste'), icon: '📋' },
              { key: 'manual', label: t('Manual', 'Manual'), icon: '✏️' },
            ].map((tab) => (
              <button key={tab.key} onClick={() => { setMode(tab.key); setError('') }}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  mode === tab.key
                    ? 'text-emerald-400 border-b-2 border-emerald-400 bg-emerald-400/5'
                    : 'text-slate-400 hover:text-slate-300'
                }`}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">{error}</div>
          )}

          {/* Upload step */}
          {step === 'upload' && mode === 'file' && (
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-[#38383A] rounded-xl p-6 sm:p-12 text-center cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors"
              >
                <div className="text-4xl mb-3">{brokerInfo ? brokerInfo.icon : '📊'}</div>
                <p className="text-white font-medium mb-1">{t('Arrastra tu archivo aquí', 'Drag your file here')}</p>
                <p className="text-slate-500 text-sm">{t('o haz clic para seleccionar', 'or click to browse')}</p>
                <p className="text-slate-600 text-xs mt-3">.xlsx, .xls, .csv</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
                />
              </div>
              <button onClick={async () => {
                  const { generateTemplate } = await import('@/lib/generateTemplate')
                  await generateTemplate()
                }}
                className="mt-4 w-full py-3 bg-cyan-600/20 border border-cyan-500/30 text-cyan-400 rounded-lg hover:bg-cyan-600/30 transition-colors text-sm font-medium flex items-center justify-center gap-2">
                <span>📥</span> {t('Descargar plantilla de ejemplo', 'Download example template')}
              </button>
              <p className="mt-2 text-xs text-slate-500 text-center">
                {t('Excel con 3 hojas: Activos, Historial anual, Transacciones + instrucciones', 'Excel with 3 sheets: Assets, Annual History, Transactions + instructions')}
              </p>
            </div>
          )}

          {step === 'upload' && mode === 'paste' && (
            <div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={t(
                  'Pega tus datos aquí (separados por tabs o comas)...\n\nEjemplo:\nSymbol\tName\tType\tQuantity\tPrice\nAAPL\tApple Inc\tStock\t10\t150.00',
                  'Paste your data here (tab or comma separated)...\n\nExample:\nSymbol\tName\tType\tQuantity\tPrice\nAAPL\tApple Inc\tStock\t10\t150.00'
                )}
                className="w-full h-48 px-4 py-3 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 resize-none font-mono"
              />
              <button onClick={handlePaste}
                className="mt-3 w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium">
                {t('Procesar datos', 'Process data')}
              </button>
            </div>
          )}

          {step === 'upload' && mode === 'manual' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Símbolo', 'Symbol')} *</label>
                  <input value={manual.symbol} onChange={(e) => setManual({ ...manual, symbol: e.target.value })}
                    placeholder="AAPL" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Nombre', 'Name')}</label>
                  <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })}
                    placeholder="Apple Inc" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Tipo', 'Type')}</label>
                  <select value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value })}
                    className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                    <option value="Stock">Stock</option>
                    <option value="Crypto">Crypto</option>
                    <option value="Bond">{t('Bono/Instrumento', 'Bond')}</option>
                    <option value="Fund">{t('Fondo/ETF', 'Fund/ETF')}</option>
                    <option value="Bank">{t('Banco/Cash', 'Bank/Cash')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Institución', 'Institution')}</label>
                  <input value={manual.institution} onChange={(e) => setManual({ ...manual, institution: e.target.value })}
                    placeholder="Interactive Brokers" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Cantidad', 'Quantity')} *</label>
                  <input value={manual.quantity} onChange={(e) => setManual({ ...manual, quantity: e.target.value })}
                    placeholder="10" type="number" step="any" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Precio', 'Price')} *</label>
                  <input value={manual.purchasePrice} onChange={(e) => setManual({ ...manual, purchasePrice: e.target.value })}
                    placeholder="150.00" type="number" step="any" className="w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                </div>
              </div>
              <button onClick={doManualImport} disabled={importing}
                className="mt-2 w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
                {importing ? t('Importando...', 'Importing...') : t('Agregar', 'Add')}
              </button>
            </div>
          )}

          {/* Column mapping step */}
          {step === 'map' && (
            <div>
              <p className="text-slate-400 text-sm mb-3">
                {t(`${rawData.length} filas encontradas. Mapea las columnas:`, `${rawData.length} rows found. Map the columns:`)}
              </p>
              {detectedBroker && (
                <div className="px-3 py-2 mb-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <span className="text-blue-400 text-xs font-medium">
                    {t('Formato detectado', 'Format detected')}: {detectedBroker.institution}
                  </span>
                  {detectedBroker.instructions && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      {detectedBroker.instructions[lang] || detectedBroker.instructions.en}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-3">
                {Object.entries(FIELD_MAP).map(([field]) => (
                  <div key={field} className="flex items-center gap-3">
                    <label className="text-sm text-slate-300 w-28 capitalize">{field === 'purchasePrice' ? t('Precio', 'Price') : field}</label>
                    <select
                      value={mapping[field] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [field]: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                      className="flex-1 px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="">-- {t('No mapear', 'Skip')} --</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </select>
                    {mapping[field] != null && (
                      <span className="text-emerald-400 text-xs">&#10003;</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 bg-[#000000] border border-[#38383A] rounded-lg">
                <p className="text-xs text-slate-500 mb-2">{t('Vista previa primera fila:', 'First row preview:')}</p>
                <div className="text-xs text-slate-400 font-mono">
                  {headers.map((h, i) => (
                    <span key={i} className="inline-block mr-3 mb-1">
                      <span className="text-slate-600">{h}:</span> {(rawData[0]?.[i] || '').toString().slice(0, 20)}
                    </span>
                  ))}
                </div>
              </div>
              {(extraSheets.snapshots.length > 0 || extraSheets.transactions.length > 0) && (
                <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <p className="text-emerald-400 text-xs font-medium mb-1">{t('Hojas detectadas:', 'Sheets detected:')}</p>
                  {extraSheets.snapshots.length > 0 && (
                    <p className="text-slate-400 text-xs">📊 {t('Historial:', 'History:')} {extraSheets.snapshots.length} {t('periodos', 'periods')}</p>
                  )}
                  {extraSheets.transactions.length > 0 && (
                    <p className="text-slate-400 text-xs">💰 {t('Transacciones:', 'Transactions:')} {extraSheets.transactions.length}</p>
                  )}
                </div>
              )}
              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep('upload')} className="flex-1 py-2.5 border border-[#38383A] text-slate-300 rounded-lg hover:bg-[#2C2C2E] transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={buildPreview}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium">
                  {t('Vista previa', 'Preview')}
                </button>
              </div>
            </div>
          )}

          {/* Preview step */}
          {step === 'preview' && (
            <div>
              <p className="text-slate-400 text-sm mb-3">
                {t(`${preview.length} instrumentos listos para importar:`, `${preview.length} instruments ready to import:`)}
              </p>
              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-[#38383A] sticky top-0 bg-[#1C1C1E]">
                      <th className="text-left py-2 px-2">Symbol</th>
                      <th className="text-left py-2 px-2">Name</th>
                      <th className="text-left py-2 px-2">Type</th>
                      <th className="text-right py-2 px-2">Qty</th>
                      <th className="text-right py-2 px-2">Price</th>
                      <th className="text-left py-2 px-2">Inst.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((item, i) => (
                      <tr key={i} className="border-b border-[#38383A]/50 hover:bg-[#2C2C2E]">
                        <td className="py-2 px-2 text-emerald-400 font-medium">{item.symbol}</td>
                        <td className="py-2 px-2 text-white">{item.name}</td>
                        <td className="py-2 px-2 text-slate-400">{item.type}</td>
                        <td className="py-2 px-2 text-right text-slate-300">{item.quantity.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right text-slate-300">${item.purchasePrice.toLocaleString()}</td>
                        <td className="py-2 px-2 text-slate-500">{item.institution}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep('map')} className="flex-1 py-2.5 border border-[#38383A] text-slate-300 rounded-lg hover:bg-[#2C2C2E] transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={doImport} disabled={importing}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium">
                  {importing ? t('Importando...', 'Importing...') : t(`Importar ${preview.length}`, `Import ${preview.length}`)}
                </button>
              </div>
            </div>
          )}

          {/* BI Preview step */}
          {step === 'bi-preview' && biData && (
            <div>
              <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <span className="text-emerald-400 text-xs font-medium">
                  {t('Formato detectado: Banco Industrial', 'Format detected: Banco Industrial')}
                </span>
              </div>
              <p className="text-slate-400 text-sm mb-3">
                {t(`${biData.transactions.length} transacciones encontradas`, `${biData.transactions.length} transactions found`)}
                {biData.finalBalance > 0 && ` — ${t('Saldo final', 'Final balance')}: Q${biData.finalBalance.toLocaleString()}`}
              </p>

              <div className="overflow-x-auto max-h-60 overflow-y-auto mb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-[#38383A] sticky top-0 bg-[#1C1C1E]">
                      <th className="text-left py-2 px-2">{t('Fecha', 'Date')}</th>
                      <th className="text-left py-2 px-2">{t('Descripción', 'Description')}</th>
                      <th className="text-left py-2 px-2">{t('Categoría', 'Category')}</th>
                      <th className="text-right py-2 px-2">{t('Monto', 'Amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {biData.transactions.map((tx, i) => (
                      <tr key={i} className="border-b border-[#38383A]/50 hover:bg-[#2C2C2E]">
                        <td className="py-2 px-2 text-slate-400 whitespace-nowrap">{tx.date}</td>
                        <td className="py-2 px-2 text-white max-w-[180px] truncate">{tx.description}</td>
                        <td className="py-2 px-2">
                          <select
                            value={tx.category}
                            onChange={(e) => {
                              const updated = { ...biData }
                              updated.transactions = [...updated.transactions]
                              updated.transactions[i] = { ...updated.transactions[i], category: e.target.value }
                              setBiData(updated)
                            }}
                            className="bg-[#000000] border border-[#38383A] rounded text-xs text-slate-300 px-1 py-0.5 focus:outline-none"
                          >
                            {(tx.type === 'INCOME' ? FINANCE_CATEGORIES.INCOME : FINANCE_CATEGORIES.EXPENSE).map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                        <td className={`py-2 px-2 text-right font-medium whitespace-nowrap ${tx.type === 'INCOME' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {tx.type === 'INCOME' ? '+' : '-'}Q{tx.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {biData.finalBalance > 0 && (
                <div className="p-3 bg-[#000000] border border-[#38383A] rounded-lg mb-4">
                  <p className="text-xs text-slate-400 mb-2">{t('Actualizar cuenta bancaria:', 'Update bank account:')}</p>
                  <select value={selectedBankAccount} onChange={e => setSelectedBankAccount(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1C1C1E] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                    <option value="">{t('Crear nueva cuenta', 'Create new account')}</option>
                    {(existingItems || []).filter(it => /bank|banco/i.test(it.type || '')).map(item => (
                      <option key={item.id} value={item.id}>{item.name || item.symbol}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setBiData(null); setStep('upload') }}
                  className="flex-1 py-2.5 border border-[#38383A] text-slate-300 rounded-lg hover:bg-[#2C2C2E] transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={doBIImport} disabled={importing}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors text-sm font-medium">
                  {importing ? t('Importando...', 'Importing...') : t(`Importar ${biData.transactions.length} transacciones`, `Import ${biData.transactions.length} transactions`)}
                </button>
              </div>
            </div>
          )}

          {/* IBKR Preview step */}
          {step === 'ibkr-preview' && ibkrData && (
            <div>
              <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <span className="text-blue-400 text-xs font-medium">
                  {t('Formato detectado: Interactive Brokers', 'Format detected: Interactive Brokers')}
                </span>
              </div>
              <p className="text-slate-400 text-sm mb-3">
                {t(`${ibkrData.items.length} posiciones`, `${ibkrData.items.length} positions`)}
                {ibkrData.transactions?.length > 0 && (() => {
                  const deps = ibkrData.transactions.filter(t => t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL').length
                  const trades = ibkrData.transactions.length - deps
                  return (trades > 0 ? ` · ${trades} trades` : '') + (deps > 0 ? ` · ${deps} ${t('depósitos/retiros', 'deposits/withdrawals')}` : '')
                })()}
                {ibkrData.equityHistory?.length > 0 && ` · ${ibkrData.equityHistory.length} NAV`}
              </p>

              <div className="overflow-x-auto max-h-52 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-[#38383A] sticky top-0 bg-[#1C1C1E]">
                      <th className="text-left py-2 px-1.5">Symbol</th>
                      <th className="text-left py-2 px-1.5">Name</th>
                      <th className="text-right py-2 px-1.5">Qty</th>
                      <th className="text-right py-2 px-1.5">{t('Precio', 'Price')}</th>
                      <th className="text-right py-2 px-1.5">{t('Valor', 'Value')}</th>
                      <th className="text-right py-2 px-1.5">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ibkrData.items.map((item, i) => {
                      const val = (item.currentPrice || 0) * (item.quantity || 0)
                      const cost = (item.purchasePrice || 0) * (item.quantity || 0)
                      const gain = cost > 0 ? ((val - cost) / cost * 100) : 0
                      return (
                        <tr key={i} className="border-b border-[#38383A]/50 hover:bg-[#2C2C2E]">
                          <td className="py-1.5 px-1.5 text-blue-400 font-medium">{item.symbol}</td>
                          <td className="py-1.5 px-1.5 text-white max-w-[120px] truncate">{item.name}</td>
                          <td className="py-1.5 px-1.5 text-right text-slate-300">{item.quantity?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                          <td className="py-1.5 px-1.5 text-right text-slate-300">${item.currentPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="py-1.5 px-1.5 text-right text-white font-medium">${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                          <td className={`py-1.5 px-1.5 text-right font-medium ${gain > 0 ? 'text-emerald-400' : gain < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                            {cost > 0 ? `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Merge vs Replace */}
              <div className="mt-4 p-3 bg-[#000000] border border-[#38383A] rounded-lg">
                <p className="text-xs text-slate-400 mb-2">{t('Modo de importación:', 'Import mode:')}</p>
                <div className="flex gap-2">
                  <button onClick={() => setIbkrImportMode('merge')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                      ibkrImportMode === 'merge'
                        ? 'bg-blue-600/20 border border-blue-500/40 text-blue-400'
                        : 'border border-[#38383A] text-slate-400 hover:text-slate-300'
                    }`}>
                    {t('Agregar junto a existentes', 'Add alongside existing')}
                  </button>
                  <button onClick={() => setIbkrImportMode('replace')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                      ibkrImportMode === 'replace'
                        ? 'bg-orange-600/20 border border-orange-500/40 text-orange-400'
                        : 'border border-[#38383A] text-slate-400 hover:text-slate-300'
                    }`}>
                    {t('Reemplazar posiciones IBKR', 'Replace IBKR positions')}
                  </button>
                </div>
                {ibkrImportMode === 'replace' && existingItems && (
                  <p className="text-[11px] text-orange-400/70 mt-2">
                    {(() => {
                      const ibkrCount = existingItems.filter(it => it.institution === 'Interactive Brokers' || it._source === 'ibkr').length
                      return ibkrCount > 0
                        ? t(`Se eliminarán ${ibkrCount} posiciones IBKR existentes antes de importar`, `${ibkrCount} existing IBKR positions will be deleted before import`)
                        : t('No hay posiciones IBKR existentes', 'No existing IBKR positions')
                    })()}
                  </p>
                )}
              </div>

              <div className="flex gap-3 mt-4">
                <button onClick={() => { setIbkrData(null); setStep('upload') }}
                  className="flex-1 py-2.5 border border-[#38383A] text-slate-300 rounded-lg hover:bg-[#2C2C2E] transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={doIBKRImport} disabled={importing}
                  className={`flex-1 py-2.5 text-white rounded-lg disabled:opacity-50 transition-colors text-sm font-medium ${
                    ibkrImportMode === 'replace' ? 'bg-orange-600 hover:bg-orange-500' : 'bg-blue-600 hover:bg-blue-500'
                  }`}>
                  {importing
                    ? importProgress.total > 0
                      ? t(`Importando ${importProgress.done}/${importProgress.total}`, `Importing ${importProgress.done}/${importProgress.total}`)
                      : t('Preparando...', 'Preparing...')
                    : ibkrImportMode === 'replace'
                      ? t(`Reemplazar con ${ibkrData.items.length} posiciones`, `Replace with ${ibkrData.items.length} positions`)
                      : t(`Importar ${ibkrData.items.length} posiciones`, `Import ${ibkrData.items.length} positions`)}
                </button>
                {importing && importProgress.total > 0 && (
                  <div className="mt-2 h-1.5 bg-slate-700/30 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Done step */}
          {step === 'done' && result && (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">{result.failed === 0 ? '🎉' : '⚠️'}</div>
              <p className="text-white font-semibold text-lg mb-2">
                {result.failed === 0
                  ? t('Importación exitosa', 'Import successful')
                  : t('Importación parcial', 'Partial import')}
              </p>
              <p className="text-slate-400 text-sm">
                {result.success} {result.isBI ? t('transacciones importadas', 'transactions imported') : t('activos importados', 'assets imported')}
                {result.failed > 0 && <>, {result.failed} {t('fallidos', 'failed')}</>}
              </p>
              {result.replaced > 0 && (
                <p className="text-orange-400 text-xs mt-1">{t(`${result.replaced} posiciones anteriores reemplazadas`, `${result.replaced} previous positions replaced`)}</p>
              )}
              {result.snapCount > 0 && (
                <p className="text-cyan-400 text-xs mt-1">📊 {result.snapCount} {t('periodos de historial', 'history periods')}</p>
              )}
              {result.txCount > 0 && (
                <p className="text-emerald-400 text-xs mt-1">💰 {result.txCount} {t('transacciones', 'transactions')}</p>
              )}
              {result.errorMsg && (
                <p className="text-red-400 text-xs mt-2">{result.errorMsg}</p>
              )}
              <button onClick={onClose}
                className="mt-6 px-8 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium">
                {t('Cerrar', 'Close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
