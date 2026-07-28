'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { detectBI, parseBI } from '@/lib/parsers/biParser'
import { detectCoinbase, parseCoinbase } from '@/lib/parsers/coinbaseParser'
import { detectKraken, parseKraken } from '@/lib/parsers/krakenParser'
import { isIBKRSectionedFormat, parseIBKRFile, formatIBKRFileResult, detectIBKRFileKind, pickSectionedCsvFromWorkbook } from '@/lib/parsers/ibkrFileParser'
import { parseAmount, parseImportDate } from '@/lib/numberParse'
import { FIELD_MAP, BROKER_PRESETS, guessMapping } from '@/lib/importMapping'
import { FINANCE_CATEGORIES, CATEGORY_COLORS } from '@/lib/financeCategories'
import { matchStatement } from '@/lib/statementMatcher'
import { validateItem, sanitizeImportItem, sanitizeCell } from '@/lib/validation'
import { getBrokerHowTo } from '@/lib/brokerHowTo'
import BrokerSteps from '@/components/ui/BrokerSteps'
import { reconcileBrokerPositions } from '@/lib/brokerReconcile'

// Default institution stamped on imported items when the import was opened for a
// specific broker (brokerHint) and the file itself has no institution column —
// e.g. a Hapi statement, which has no API and no institution field of its own.
const BROKER_HINT_INSTITUTION = {
  ibkr: 'Interactive Brokers', alpaca: 'Alpaca Markets', schwab: 'Charles Schwab',
  fidelity: 'Fidelity', vanguard: 'Vanguard', degiro: 'DEGIRO', trading212: 'Trading 212',
  traderepublic: 'Trade Republic', etoro: 'eToro', webull: 'Webull', coinbase: 'Coinbase',
  kraken: 'Kraken', binance: 'Binance', bitso: 'Bitso', hapi: 'Hapi',
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

// Number parsing is delegated to the shared LatAm-aware parser (lib/numberParse):
// the old local implementation turned "150,25" into 15025 and "1.234,56" into
// 1.23456, silently corrupting every decimal-comma import.
function parseNumber(val) {
  return parseAmount(val)
}

export default function FileImportModal({ onClose, onImportItems, onImportTransaction, onImportSnapshot, onAddLot, onAddFinanceTransaction, onUpdateItem, onDeleteItem, onBulkImport, existingItems, existingLots = [], existingFinanceTransactions = [], activePortfolio, activeEntity = 'default', lang = 'es', brokerHint = null }) {
  const trapRef = useFocusTrap()
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
  const [aiOpen, setAiOpen] = useState(false)
  const [aiCopied, setAiCopied] = useState(false)
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
  // Statement reconciliation: buckets from lib/statementMatcher + which rows the
  // user checked for import (new rows pre-checked, likely-duplicates unchecked).
  const [biMatch, setBiMatch] = useState(null)
  const [biSelected, setBiSelected] = useState(new Set())
  const [stmtAccount, setStmtAccount] = useState('')

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

    const ibkrEmptyError = () => setError(lang === 'es'
      ? 'No se encontraron posiciones. Exporta el Activity Statement desde IBKR (Performance & Reports → Statements → Activity) en CSV o Excel, con Open Positions, Trades y NAV.'
      : 'No positions found. Export the Activity Statement from IBKR (Performance & Reports → Statements → Activity) as CSV or Excel, with Open Positions, Trades and NAV.')
    const acceptIBKR = (rawTextOrCsv) => {
      const parsed = parseIBKRFile(rawTextOrCsv)
      if (parsed._isPerformanceReport || (parsed.positions.length === 0 && parsed.cashPositions.length === 0)) { ibkrEmptyError(); return true }
      setIbkrData(formatIBKRFileResult(parsed)); setStep('ibkr-preview'); return true
    }

    try {
      const XLSX = await import('xlsx')
      let wb
      let csvText = null

      if (ext === 'csv') {
        // file.text() decodes UTF-8 correctly; letting SheetJS read the raw bytes
        // decoded them as CP1252 and turned "Débito" into "DÃ©bito", which broke
        // Spanish header detection (Banco Industrial statements fell through to the
        // stock mapper).
        csvText = await file.text()
        const kind = detectIBKRFileKind(csvText)
        if (kind === 'pdf') { setError(lang === 'es' ? 'Esto es un PDF, no una hoja de cálculo. Expórtalo de nuevo en CSV o Excel, o usa el asistente de IA de abajo para convertirlo.' : 'This is a PDF, not a spreadsheet. Re-export it as CSV or Excel, or use the AI helper below to convert it.'); return }
        if (kind === 'xml') { setError(lang === 'es' ? 'Esto es un archivo XML. Expórtalo en CSV o Excel.' : 'This is an XML file. Export it as CSV or Excel.'); return }
        if (isIBKRSectionedFormat(csvText)) { acceptIBKR(csvText); return }
        // raw:true stops SheetJS from coercing "150,25" to the number 15025 and
        // "1.234,56" to 1.23456 — the values reach parseAmount as written.
        wb = XLSX.read(csvText, { type: 'string', raw: true })
      } else {
        const data = await file.arrayBuffer()
        // cellDates keeps real date cells as Dates instead of serial numbers like
        // 44576, which used to be read as the year 45000 and rejected every row.
        wb = XLSX.read(data, { type: 'array', cellDates: true })
      }

      // XLSX that carries the IBKR sectioned layout on ANY sheet is an Activity
      // Statement — parse it as IBKR instead of the generic table mapper.
      const sectionedCsv = pickSectionedCsvFromWorkbook(XLSX, wb)
      if (sectionedCsv) { acceptIBKR(sectionedCsv); return }

      const sheetNames = wb.SheetNames.map((n) => n.toLowerCase())
      // Spanish names were missing, so "Portafolio"/"Posiciones"/"Cartera" workbooks
      // silently fell back to sheet 0 (usually a cover page).
      const assetsIdx = sheetNames.findIndex((n) => /activos|assets|portafolio|portfolio|holdings|posiciones|tenencias|cartera|inversiones|saldos/i.test(n))
      const histIdx = sheetNames.findIndex((n) => /historial|history|snapshots/i.test(n))
      const txIdx = sheetNames.findIndex((n) => /transacciones|transactions|movimientos/i.test(n))

      // Pick the named sheet; otherwise the sheet with the most usable rows rather
      // than blindly sheet 0.
      let mainIdx = assetsIdx
      if (mainIdx < 0) {
        let best = 0, bestRows = -1
        wb.SheetNames.forEach((nm, i) => {
          if (i === histIdx || i === txIdx) return
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, defval: '' })
            .filter((r) => r.filter((c) => c !== '').length >= 2).length
          if (rows > bestRows) { bestRows = rows; best = i }
        })
        mainIdx = best
      }
      const mainSheet = wb.Sheets[wb.SheetNames[mainIdx]]
      const json = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' })

      // A PDF saved with an .xls name parses into junk rows instead of throwing.
      const looksPdf = json.length > 0 && /^%PDF/.test((json[0] || []).join(''))
      if (looksPdf) {
        setError(lang === 'es'
          ? 'Esto es un PDF, no una hoja de cálculo. Expórtalo de nuevo en CSV o Excel, o usa el asistente de IA de abajo para convertirlo.'
          : 'This is a PDF, not a spreadsheet. Re-export it as CSV or Excel, or use the AI helper below to convert it.')
        return
      }

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
              symbol: sanitizeCell((r[2] || '').toString()).toUpperCase(),
              description: sanitizeCell((r[3] || '').toString()).slice(0, 500),
              totalAmount: parseNumber(r[4]),
              currency: sanitizeCell((r[5] || 'USD').toString()).toUpperCase(),
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
        // Reconcile against what's already recorded: only truly-new rows get
        // imported; re-uploading the same statement yields zero additions.
        const match = matchStatement(parsed.transactions, existingFinanceTransactions)
        setBiData(parsed)
        setBiMatch(match)
        setBiSelected(new Set(match.newTxs.map((_, i) => `n${i}`)))
        // Preselect the BI account the balance update belongs to — the "create
        // new" default used to mint a duplicate "BI Monetaria" on every re-import.
        const bankAccounts = (existingItems || []).filter((it) => /bank|banco/i.test(it.type || ''))
        const biAccount = bankAccounts.find((a) => (a.symbol || '').toUpperCase() === 'BI-MONETARIA')
          || bankAccounts.find((a) => /banco industrial/i.test(a.institution || ''))
        setSelectedBankAccount(biAccount ? biAccount.id : '')
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
  }, [lang, existingFinanceTransactions, existingItems])

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
        institution: mapping.institution != null ? (row[mapping.institution] || '').toString().trim() : (detectedBroker?.institution || BROKER_HINT_INSTITUTION[brokerHint] || ''),
        currency: mapping.currency != null ? (row[mapping.currency] || 'USD').toString().trim() : 'USD',
      }
      if (mapping.currentPrice != null) {
        const cp = parseNumber(row[mapping.currentPrice])
        if (cp > 0) item.currentPrice = cp
      }
      if (mapping.acquisitionDate != null) {
        // Normalize Excel serials (44576) and dd/mm/yyyy. Passing them through raw
        // produced dates like the year 45000, which validation then rejected — the
        // whole file came back "0 imported" with no reason shown.
        const d = parseImportDate(row[mapping.acquisitionDate])
        if (d) item.acquisitionDate = d
      }
      if (mapping.subtype != null) {
        const st = (row[mapping.subtype] || '').toString().trim()
        if (st) item.subtype = st
      }
      if (mapping.maturityDate != null) {
        const md = parseImportDate(row[mapping.maturityDate])
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
  }, [rawData, mapping, detectedBroker, brokerHint])

  const doImport = useCallback(async () => {
    setImporting(true)
    setError('')
    let success = 0
    let failed = 0
    let snapCount = 0
    let txCount = 0

    // Reasons, not just a count: a rejected file used to report "0 imported /
    // N failed" with nothing explaining why.
    const failReasons = []
    for (const item of preview) {
      try {
        const errors = validateItem(item)
        if (errors.length > 0) {
          failed++
          if (failReasons.length < 5) failReasons.push(`${item.symbol || item.name || '?'}: ${errors[0]}`)
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
          const lotSym = (item.symbol || '').toUpperCase()
          const lotDate = item.acquisitionDate || new Date().toISOString().split('T')[0]
          // Re-importing the same file must not duplicate lots — qtyAtMonth sums them
          const itemInst = item.institution || ''
          const duplicate = existingLots.some(l =>
            (l.symbol || '').toUpperCase() === lotSym &&
            Math.abs((l.quantity || 0) - item.quantity) < 1e-9 &&
            Math.abs((l.costBasis || 0) - item.purchasePrice) < 1e-9 &&
            (l.acquisitionDate || '') === lotDate &&
            (l.institution || '') === itemInst
          )
          if (!duplicate) {
            await onAddLot({
              symbol: lotSym,
              quantity: item.quantity,
              costBasis: item.purchasePrice,
              currency: item.currency || 'USD',
              acquisitionDate: lotDate,
              institution: itemInst,
              ...(activePortfolio && activePortfolio !== '__all__' ? { portfolioId: activePortfolio } : {}),
            })
          }
        }
        success++
      } catch (e) {
        failed++
        if (failReasons.length < 5) failReasons.push(`${item.symbol || item.name || '?'}: ${e?.message || 'error'}`)
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

    setResult({ success, failed, total: preview.length, snapCount, txCount, failReasons })
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
    if (!biData || !biMatch || !onAddFinanceTransaction) return
    setImporting(true)
    setError('')
    let success = 0
    let failed = 0

    // Only the rows the user left checked: new rows (pre-checked) plus any
    // likely-duplicates they explicitly confirmed. Exact matches never import.
    const toImport = [
      ...biMatch.newTxs.filter((_, i) => biSelected.has(`n${i}`)),
      ...biMatch.likely.filter((_, i) => biSelected.has(`l${i}`)).map((x) => x.parsed),
    ]

    for (const tx of toImport) {
      try {
        await onAddFinanceTransaction({
          ...tx,
          description: sanitizeCell(String(tx.description || '')).slice(0, 200),
          ...(tx.reference ? { reference: sanitizeCell(String(tx.reference)).slice(0, 60) } : {}),
          ...(stmtAccount.trim() ? { account: sanitizeCell(stmtAccount.trim()).slice(0, 40) } : {}),
        })
        success++
      } catch {
        failed++
      }
    }

    if (biData.finalBalance > 0 && selectedBankAccount !== 'skip') {
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

    setResult({ success, failed, total: biData.transactions.length, skipped: biMatch.exact.length, isBI: true })
    setStep('done')
    setImporting(false)
  }, [biData, biMatch, biSelected, stmtAccount, onAddFinanceTransaction, onImportItems, onUpdateItem, existingItems, selectedBankAccount])

  const doIBKRImport = useCallback(async () => {
    if (!ibkrData || !ibkrData.items || ibkrData.items.length === 0) return
    setImporting(true)
    setError('')
    setImportProgress({ done: 0, total: 0 })

    const tagged = (obj) => ({
      ...obj,
      ...(activePortfolio && activePortfolio !== '__all__' ? { portfolioId: activePortfolio } : {}),
      ...(activeEntity && activeEntity !== 'default' ? { entityId: activeEntity } : {}),
    })

    const deleteIds = []
    if (ibkrImportMode === 'replace' && existingItems) {
      const ibkrItems = existingItems.filter(it => it.institution === 'Interactive Brokers' || it._source === 'ibkr')
      for (const it of ibkrItems) deleteIds.push(it.id)
    }

    // ENRICH: the statement is history for holdings we ALREADY have, so every
    // position it repeats must be matched, not re-created. Creating them again is
    // what "Agregar" does, and on an account already synced by API that silently
    // doubles the portfolio. Only the gaps (real trade dates, cost basis, conid)
    // get written; quantity/price stay as the live sync left them.
    let enrichUpdates = []
    let incomingItems = ibkrData.items
    if (ibkrImportMode === 'enrich') {
      const rec = reconcileBrokerPositions({
        incoming: ibkrData.items,
        existing: existingItems || [],
        source: 'ibkr',
        mode: 'enrich',
        tag: tagged({}),
      })
      enrichUpdates = rec.updateItems
      incomingItems = rec.newItems
    }

    const validItems = []
    const validLots = []
    for (const item of incomingItems) {
      const clean = tagged(sanitizeImportItem(item))
      validItems.push(clean)
      if (clean.symbol && clean.quantity > 0 && clean.purchasePrice > 0 && !/debt|deuda/i.test(clean.type || '')) {
        validLots.push(tagged({
          symbol: (clean.symbol || '').toUpperCase(),
          quantity: clean.quantity,
          costBasis: clean.purchasePrice,
          currency: clean.currency || 'USD',
          acquisitionDate: clean.acquisitionDate || new Date().toISOString().split('T')[0],
        }))
      }
    }

    let lastDone = 0
    const summary = {
      success: validItems.length,
      failed: 0,
      total: ibkrData.items.length,
      replaced: deleteIds.length,
      enriched: enrichUpdates.length,
      matched: ibkrImportMode === 'enrich' ? ibkrData.items.length - validItems.length : 0,
      history: (ibkrData.transactions || []).length,
      navDays: (ibkrData.equityHistory || []).length,
    }
    try {
      await onBulkImport({
        items: validItems,
        updateItems: enrichUpdates,
        lots: validLots,
        transactions: ibkrData.transactions || [],
        snapshots: ibkrData.equityHistory || [],
        deleteIds,
      }, (done, total) => {
        lastDone = done
        setImportProgress({ done, total })
      })
      setResult(summary)
    } catch (err) {
      console.error('[IBKR Import]', err)
      if (lastDone > 0) {
        setResult(summary)
      } else {
        setResult({ ...summary, success: 0, failed: validItems.length, replaced: 0, errorMsg: err.message })
      }
    } finally {
      setStep('done')
      setImporting(false)
    }
  }, [ibkrData, onBulkImport, existingItems, activePortfolio, activeEntity, ibkrImportMode])

  // Dry run of the enrich match, so the preview can promise a concrete outcome
  // ("21 se enlazan, 0 se duplican") instead of making the user guess which mode
  // is safe. Pure + no writes: same function the import itself runs.
  const ibkrEnrichPreview = useMemo(() => {
    if (!ibkrData?.items?.length) return null
    const rec = reconcileBrokerPositions({
      incoming: ibkrData.items,
      existing: existingItems || [],
      source: 'ibkr',
      mode: 'enrich',
    })
    return { matched: rec.matched, enriched: rec.enriched, created: rec.newItems.length }
  }, [ibkrData, existingItems])

  // A statement uploaded onto an account that already has these holdings is
  // almost always "add the history", never "add them again", so enrich is the
  // default the moment anything matches. With no matches there is nothing to
  // enrich and plain add is correct.
  useEffect(() => {
    if (!ibkrEnrichPreview) return
    setIbkrImportMode(ibkrEnrichPreview.matched > 0 ? 'enrich' : 'merge')
  }, [ibkrEnrichPreview])

  // Positions but no trades and no NAV: the statement was exported without the
  // history sections, which is exactly the case that leaves the chart estimating
  // and the purchase dates unknown. This used to pass silently as a plain
  // "N posiciones" preview, so the user only found out weeks later from a chart
  // that started at the import date.
  const ibkrMissingHistory = !!ibkrData
    && (ibkrData.transactions || []).length === 0
    && (ibkrData.equityHistory || []).length === 0

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const t = (es, en) => lang === 'es' ? es : en

  // How to get the file, shown BEFORE upload (not just after a failed parse).
  // ibkr uses its own text: this modal's IBKR path parses the sectioned "Activity
  // Statement" (Performance & Reports → Statements → Activity), not a Flex Query
  // CSV like BROKER_PRESETS.ibkr.instructions (that one is for the generic
  // column-mapped importer when IBKR is auto-detected without a brokerHint).
  // The researched, multi-step "how do I get this" facts live in
  // lib/brokerHowTo.js (shared with ConnectionsModal's API flow) — this modal
  // only needs the broker's display name/icon plus its csv.steps/csv.note.
  const brokerInfo = brokerHint ? getBrokerHowTo(brokerHint) : null
  const modalTitle = brokerInfo
    ? t(`Importar CSV: ${brokerInfo.name}`, `Import CSV: ${brokerInfo.name}`)
    : t('Importar Portfolio', 'Import Portfolio')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="import-modal-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="import-modal-title" className="text-lg font-bold text-white">{brokerInfo ? `${brokerInfo.icon} ` : ''}{modalTitle}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        {/* Mode tabs */}
        {step === 'upload' && (
          <div className="flex border-b border-glass-border">
            {[
              { key: 'file', label: t('Archivo', 'File'), icon: '📁' },
              { key: 'paste', label: t('Pegar', 'Paste'), icon: '📋' },
              { key: 'manual', label: t('Manual', 'Manual'), icon: '✏️' },
            ].map((tab) => (
              <button key={tab.key} onClick={() => { setMode(tab.key); setError('') }}
                className="flex-1 px-4 py-3 text-sm font-medium transition-colors"
                style={mode === tab.key ? { color: 'var(--accent-green)', borderBottom: '2px solid #34d399', backgroundColor: 'rgba(52,211,153,0.05)' } : { color: '#94a3b8' }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-[#f87171]/10 border border-[#f87171]/20 text-[#f87171] rounded-lg text-sm">{error}</div>
          )}

          {/* Upload step */}
          {step === 'upload' && mode === 'file' && (
            <div>
              {brokerInfo?.csv?.steps && (
                <div className="mb-4">
                  <BrokerSteps steps={brokerInfo.csv.steps} note={brokerInfo.csv.note} variant="csv" lang={lang} />
                </div>
              )}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-glass-border rounded-xl p-6 sm:p-12 text-center cursor-pointer hover:border-[#3b82f6]/50 hover:bg-[#3b82f6]/5 transition-colors"
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
                className="mt-4 w-full py-3 border rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-2"
                style={{ backgroundColor: 'rgba(8,145,178,0.2)', borderColor: 'rgba(6,182,212,0.3)', color: '#22d3ee' }}>
                <span>📥</span> {t('Descargar plantilla de ejemplo', 'Download example template')}
              </button>
              <p className="mt-2 text-xs text-slate-500 text-center">
                {t('Excel con 3 hojas: Activos, Historial anual, Transacciones + instrucciones', 'Excel with 3 sheets: Assets, Annual History, Transactions + instructions')}
              </p>

              {/* AI-assisted file prep: the user pastes their statements into any AI
                  (ChatGPT/Claude/Gemini) with a prompt that specifies our EXACT sheet
                  and column layout, then uploads the file the AI produces. */}
              <div className="mt-4 border rounded-xl overflow-hidden" style={{ borderColor: 'rgba(37,99,235,0.25)', backgroundColor: 'rgba(37,99,235,0.05)' }}>
                <button onClick={() => setAiOpen(!aiOpen)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-left"
                  style={{ color: 'var(--accent-blue)' }}>
                  <span>🤖 {t('¿Tus datos están en PDFs o fotos? Pídele el archivo a una IA', 'Data stuck in PDFs or photos? Ask an AI to build the file')}</span>
                  <span className={`transition-transform text-xs ${aiOpen ? 'rotate-180' : ''}`}>▾</span>
                </button>
                {aiOpen && (
                  <div className="px-4 pb-4 space-y-3">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {t('Copia este prompt, pégalo en ChatGPT, Claude o Gemini junto con tus estados de cuenta (PDF, fotos o texto), y sube aquí el archivo que te genere.',
                         'Copy this prompt, paste it into ChatGPT, Claude or Gemini along with your statements (PDFs, photos or text), and upload the file it produces here.')}
                    </p>
                    <button onClick={() => {
                        const prompt = lang === 'es'
                          ? `Ayúdame a preparar mi portafolio de inversiones para importarlo a una app. Te voy a pasar mis estados de cuenta (PDF, fotos o texto) de brokers, bancos y exchanges. Genera un archivo Excel (.xlsx) con estas hojas y columnas EXACTAS:

Hoja "Activos" (una fila por posición; si compré en varias fechas, una fila por lote):
Simbolo, Nombre, Tipo, Cantidad, Precio de Compra, Precio Actual, Moneda, Institucion, Fecha de Compra, Notas
- Tipo debe ser uno de: Stock, Fund, Crypto, Bond, Bank, RealEstate, Alternative, Debt
- Fechas en formato YYYY-MM-DD, usando la fecha REAL de compra de cada lote
- Precios en la moneda original del activo (indica la moneda: USD, GTQ, MXN, EUR...)
- En Notas incluye lo relevante: comisiones estimadas de compra, si es cuenta de ahorro su tasa, etc.

Hoja "Transacciones" (todos los movimientos que encuentres):
Fecha, Tipo, Simbolo, Descripcion, Monto, Moneda
- Tipo debe ser uno de: BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL
- Incluye compras y ventas con su fecha y monto total (con comisión incluida y anótala en Descripcion), dividendos e intereses cobrados, y mis depósitos y retiros de efectivo (importan para calcular mi retorno real)

Hoja "Historial" (opcional, si mis documentos muestran valores históricos de la cuenta):
Fecha, Total Activos (USD), Total Deudas (USD), Patrimonio Neto (USD), Notas
- Un renglón por fecha (cierres de mes o de año)

Reglas: no inventes ningún dato; si algo no aparece en mis documentos déjalo vacío y dime al final qué me faltó. Cuando termines, dame el archivo .xlsx listo para descargar.`
                          : `Help me prepare my investment portfolio to import into an app. I will give you my statements (PDFs, photos or text) from brokers, banks and exchanges. Generate an Excel file (.xlsx) with these EXACT sheets and columns:

Sheet "Activos" (one row per position; if I bought on several dates, one row per lot):
Simbolo, Nombre, Tipo, Cantidad, Precio de Compra, Precio Actual, Moneda, Institucion, Fecha de Compra, Notas
- Tipo must be one of: Stock, Fund, Crypto, Bond, Bank, RealEstate, Alternative, Debt
- Dates in YYYY-MM-DD format, using each lot's REAL purchase date
- Prices in each asset's original currency (state the currency: USD, GTQ, MXN, EUR...)
- In Notas include anything relevant: estimated purchase commissions, savings account rates, etc.

Sheet "Transacciones" (every movement you find):
Fecha, Tipo, Simbolo, Descripcion, Monto, Moneda
- Tipo must be one of: BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL
- Include buys and sells with date and total amount (commission included, note it in Descripcion), dividends and interest received, and my cash deposits and withdrawals (they matter for computing my real return)

Sheet "Historial" (optional, if my documents show historical account values):
Fecha, Total Activos (USD), Total Deudas (USD), Patrimonio Neto (USD), Notas
- One row per date (month-end or year-end closes)

Rules: do not invent any data; if something is missing from my documents leave it blank and tell me at the end what was missing. When done, give me the .xlsx file ready to download.`
                        navigator.clipboard.writeText(prompt)
                        setAiCopied(true)
                        setTimeout(() => setAiCopied(false), 2500)
                      }}
                      className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
                      style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                      {aiCopied ? t('✓ Prompt copiado, pégalo en tu IA', '✓ Prompt copied, paste it into your AI') : t('Copiar prompt para ChatGPT / Claude / Gemini', 'Copy prompt for ChatGPT / Claude / Gemini')}
                    </button>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {t('El prompt le pide: posiciones con fechas reales de compra por lote, compras y ventas con comisiones, dividendos, depósitos y retiros, y valores históricos. Todo en el formato exacto que Chispudo importa.',
                         'The prompt asks for: positions with real per-lot purchase dates, buys and sells with commissions, dividends, deposits and withdrawals, and historical values. All in the exact format Chispudo imports.')}
                    </p>
                  </div>
                )}
              </div>
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
                className="w-full h-48 px-4 py-3 bg-theme-base border border-glass-border rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-[#3b82f6]/50 resize-none font-mono"
              />
              <button onClick={handlePaste}
                className="mt-3 w-full py-2.5 rounded-lg hover:opacity-90 transition-colors text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
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
                    placeholder="AAPL" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#3b82f6]/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Nombre', 'Name')}</label>
                  <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })}
                    placeholder="Apple Inc" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#3b82f6]/50" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Tipo', 'Type')}</label>
                  <select value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value })}
                    className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-[#3b82f6]/50">
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
                    placeholder="Interactive Brokers" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#3b82f6]/50" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Cantidad', 'Quantity')} *</label>
                  <input value={manual.quantity} onChange={(e) => setManual({ ...manual, quantity: e.target.value })}
                    placeholder="10" type="number" step="any" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#3b82f6]/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Precio', 'Price')} *</label>
                  <input value={manual.purchasePrice} onChange={(e) => setManual({ ...manual, purchasePrice: e.target.value })}
                    placeholder="150.00" type="number" step="any" className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#3b82f6]/50" />
                </div>
              </div>
              <button onClick={doManualImport} disabled={importing}
                className="mt-2 w-full py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors text-sm font-medium"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
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
                <div className="px-3 py-2 mb-3 bg-[#60a5fa]/10 border border-[#60a5fa]/20 rounded-lg">
                  <span className="text-[#60a5fa] text-xs font-medium">
                    {t('Formato detectado', 'Format detected')}: {detectedBroker.institution}
                  </span>
                  {detectedBroker.instructions && (
                    <p className="text-xs text-slate-500 mt-1">
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
                      className="flex-1 px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-[#3b82f6]/50"
                    >
                      <option value="">-- {t('No mapear', 'Skip')} --</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </select>
                    {mapping[field] != null && (
                      <span className="text-[#34d399] text-xs">&#10003;</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 bg-theme-base border border-glass-border rounded-lg">
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
                <div className="mt-4 p-3 bg-[#34d399]/10 border border-[#34d399]/20 rounded-lg">
                  <p className="text-[#34d399] text-xs font-medium mb-1">{t('Hojas detectadas:', 'Sheets detected:')}</p>
                  {extraSheets.snapshots.length > 0 && (
                    <p className="text-slate-400 text-xs">📊 {t('Historial:', 'History:')} {extraSheets.snapshots.length} {t('periodos', 'periods')}</p>
                  )}
                  {extraSheets.transactions.length > 0 && (
                    <p className="text-slate-400 text-xs">💰 {t('Transacciones:', 'Transactions:')} {extraSheets.transactions.length}</p>
                  )}
                </div>
              )}
              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep('upload')} className="flex-1 py-2.5 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-elevated transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={buildPreview}
                  className="flex-1 py-2.5 rounded-lg hover:opacity-90 transition-colors text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
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
                    <tr className="text-slate-500 border-b border-glass-border sticky top-0 bg-theme-card">
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
                      <tr key={i} className="border-b border-glass-border/50 hover:bg-theme-elevated">
                        <td className="py-2 px-2 text-[#34d399] font-medium">{item.symbol}</td>
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
                <button onClick={() => setStep('map')} className="flex-1 py-2.5 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-elevated transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={doImport} disabled={importing}
                  className="flex-1 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors text-sm font-medium"
                  style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
                  {importing ? t('Importando...', 'Importing...') : t(`Importar ${preview.length}`, `Import ${preview.length}`)}
                </button>
              </div>
            </div>
          )}

          {/* BI Preview step */}
          {step === 'bi-preview' && biData && (
            <div>
              <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-[#34d399]/10 border border-[#34d399]/20 rounded-lg">
                <span className="text-[#34d399] text-xs font-medium">
                  {t('Formato detectado: Banco Industrial', 'Format detected: Banco Industrial')}
                </span>
              </div>
              <p className="text-slate-400 text-sm mb-3">
                {t(`${biData.transactions.length} transacciones en el estado`, `${biData.transactions.length} transactions in the statement`)}
                {biMatch && `: ${biMatch.newTxs.length} ${t('nuevas', 'new')} · ${biMatch.exact.length} ${t('ya registradas', 'already recorded')}${biMatch.likely.length > 0 ? ` · ${biMatch.likely.length} ${t('a revisar', 'to review')}` : ''}`}
                {biData.finalBalance > 0 && `: ${t('Saldo final', 'Final balance')}: Q${biData.finalBalance.toLocaleString()}`}
              </p>

              <div className="p-3 bg-theme-base border border-glass-border rounded-lg mb-3">
                <label className="text-xs text-slate-400 mb-1 block">{t('¿De qué cuenta o tarjeta es este estado? (opcional)', 'Which account or card is this statement from? (optional)')}</label>
                <input value={stmtAccount} onChange={(e) => setStmtAccount(e.target.value)} list="stmt-accounts"
                  placeholder={t('Ej: Visa BI, Mastercard G&T…', 'E.g. Visa BI, Mastercard…')}
                  className="w-full px-3 py-2 bg-theme-card border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-[#3b82f6]/50" />
                <datalist id="stmt-accounts">
                  {[...new Set((existingFinanceTransactions || []).map((x) => x.account).filter(Boolean))].map((a) => <option key={a} value={a} />)}
                </datalist>
              </div>

              {biMatch && (
                <div className="space-y-3 mb-4">
                  {/* NEW — pre-checked, will import */}
                  {biMatch.newTxs.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--accent-green)' }}>
                        ✓ {t(`Nuevas (${biMatch.newTxs.length}): se agregarán`, `New (${biMatch.newTxs.length}): will be added`)}
                      </p>
                      <div className="overflow-x-auto max-h-48 overflow-y-auto border border-glass-border/50 rounded-lg">
                        <table className="w-full text-xs">
                          <tbody>
                            {biMatch.newTxs.map((tx, i) => (
                              <tr key={`n${i}`} className="border-b border-glass-border/50 hover:bg-theme-elevated">
                                <td className="py-1.5 px-2">
                                  <input type="checkbox" checked={biSelected.has(`n${i}`)} onChange={(e) => {
                                    const next = new Set(biSelected)
                                    e.target.checked ? next.add(`n${i}`) : next.delete(`n${i}`)
                                    setBiSelected(next)
                                  }} />
                                </td>
                                <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">{tx.date}</td>
                                <td className="py-1.5 px-2 text-white max-w-[160px] truncate">{tx.description}</td>
                                <td className="py-1.5 px-2">
                                  <select value={tx.category}
                                    onChange={(e) => {
                                      const next = { ...biMatch, newTxs: [...biMatch.newTxs] }
                                      next.newTxs[i] = { ...next.newTxs[i], category: e.target.value }
                                      setBiMatch(next)
                                    }}
                                    className="bg-theme-base border border-glass-border rounded text-xs text-slate-300 px-1 py-0.5 focus:outline-none">
                                    {(tx.type === 'INCOME' ? FINANCE_CATEGORIES.INCOME : FINANCE_CATEGORIES.EXPENSE).map(c => (
                                      <option key={c} value={c}>{c}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-1.5 px-2 text-right font-medium whitespace-nowrap" style={{ color: tx.type === 'INCOME' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                  {tx.type === 'INCOME' ? '+' : '-'}Q{tx.amount.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* LIKELY DUPLICATES — default unchecked, user decides */}
                  {biMatch.likely.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--alert-warn-icon)' }}>
                        ⚠ {t(`Posibles duplicados (${biMatch.likely.length}): marca solo las que SÍ falten`, `Possible duplicates (${biMatch.likely.length}): check only the truly missing ones`)}
                      </p>
                      <div className="overflow-x-auto max-h-40 overflow-y-auto border rounded-lg" style={{ borderColor: 'var(--alert-warn-border)' }}>
                        <table className="w-full text-xs">
                          <tbody>
                            {biMatch.likely.map(({ parsed, match }, i) => (
                              <tr key={`l${i}`} className="border-b border-glass-border/50">
                                <td className="py-1.5 px-2">
                                  <input type="checkbox" checked={biSelected.has(`l${i}`)} onChange={(e) => {
                                    const next = new Set(biSelected)
                                    e.target.checked ? next.add(`l${i}`) : next.delete(`l${i}`)
                                    setBiSelected(next)
                                  }} />
                                </td>
                                <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">{parsed.date}</td>
                                <td className="py-1.5 px-2 text-white max-w-[150px] truncate">{parsed.description}</td>
                                <td className="py-1.5 px-2 text-right font-medium whitespace-nowrap" style={{ color: parsed.type === 'INCOME' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                                  {parsed.type === 'INCOME' ? '+' : '-'}Q{parsed.amount.toLocaleString()}
                                </td>
                                <td className="py-1.5 px-2 text-slate-500 max-w-[150px] truncate">
                                  ≈ {match.date} · {match.description}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* EXACT — skipped, collapsed */}
                  {biMatch.exact.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                        ⏭ {t(`Ya registradas (${biMatch.exact.length}): se omiten`, `Already recorded (${biMatch.exact.length}): skipped`)}
                      </summary>
                      <div className="mt-1 max-h-32 overflow-y-auto border border-glass-border/40 rounded-lg p-2 space-y-0.5">
                        {biMatch.exact.map(({ parsed }, i) => (
                          <p key={i} className="text-slate-500 truncate">{parsed.date} · {parsed.description} · Q{parsed.amount.toLocaleString()}</p>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {biData.finalBalance > 0 && (
                <div className="p-3 bg-theme-base border border-glass-border rounded-lg mb-4">
                  <p className="text-xs text-slate-400 mb-2">{t('Actualizar cuenta bancaria:', 'Update bank account:')}</p>
                  <select value={selectedBankAccount} onChange={e => setSelectedBankAccount(e.target.value)}
                    className="w-full px-3 py-2 bg-theme-card border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-[#3b82f6]/50">
                    {(existingItems || []).filter(it => /bank|banco/i.test(it.type || '')).map(item => (
                      <option key={item.id} value={item.id}>{item.name || item.symbol}</option>
                    ))}
                    <option value="">{t('Crear nueva cuenta', 'Create new account')}</option>
                    <option value="skip">{t('No actualizar ninguna cuenta', 'Don\'t update any account')}</option>
                  </select>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setBiData(null); setBiMatch(null); setBiSelected(new Set()); setStep('upload') }}
                  className="flex-1 py-2.5 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-elevated transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={doBIImport} disabled={importing}
                  className="flex-1 py-2.5 rounded-lg disabled:opacity-50 hover:opacity-90 transition-colors text-sm font-medium" style={{ backgroundColor: '#059669', color: '#fff' }}>
                  {importing ? t('Importando...', 'Importing...') : t(`Importar ${biSelected.size} transacciones`, `Import ${biSelected.size} transactions`)}
                </button>
              </div>
            </div>
          )}

          {/* IBKR Preview step */}
          {step === 'ibkr-preview' && ibkrData && (
            <div>
              <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-[#60a5fa]/10 border border-[#60a5fa]/20 rounded-lg">
                <span className="text-[#60a5fa] text-xs font-medium">
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
                    <tr className="text-slate-500 border-b border-glass-border sticky top-0 bg-theme-card">
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
                        <tr key={i} className="border-b border-glass-border/50 hover:bg-theme-elevated">
                          <td className="py-1.5 px-1.5 font-medium" style={{ color: 'var(--accent-blue)' }}>{item.symbol}</td>
                          <td className="py-1.5 px-1.5 text-white max-w-[120px] truncate">{item.name}</td>
                          <td className="py-1.5 px-1.5 text-right text-slate-300">{item.quantity?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                          <td className="py-1.5 px-1.5 text-right text-slate-300">${item.currentPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="py-1.5 px-1.5 text-right text-white font-medium">${val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                          <td className="py-1.5 px-1.5 text-right font-medium" style={{ color: gain > 0 ? '#34d399' : gain < 0 ? '#f87171' : '#64748b' }}>
                            {cost > 0 ? `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* The statement carried no history: say so BEFORE the import, with
                  the exact sections to re-export, since this is the file that was
                  supposed to fix the estimated chart. */}
              {ibkrMissingHistory && (
                <div className="mt-3 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#fcd34d' }}>
                  <p className="font-medium">{t('Este archivo trae posiciones, pero no historial.', 'This file has positions, but no history.')}</p>
                  <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t('Sin la sección Trades no hay fechas de compra ni de venta, así que el gráfico va a seguir estimando el pasado. Vuelve a exportar el Activity Statement marcando Trades y "Net Asset Value (NAV)", con el período completo que quieras cargar.',
                       'Without the Trades section there are no purchase or sale dates, so the chart will keep estimating the past. Re-export the Activity Statement ticking Trades and "Net Asset Value (NAV)", covering the full period you want to load.')}
                  </p>
                </div>
              )}

              {/* Enrich vs Add vs Replace */}
              <div className="mt-4 p-3 bg-theme-base border border-glass-border rounded-lg">
                <p className="text-xs text-slate-400 mb-2">{t('Modo de importación:', 'Import mode:')}</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setIbkrImportMode('enrich')}
                    className="flex-1 min-w-[130px] py-2 px-3 rounded-lg text-xs font-medium transition-colors border"
                    style={ibkrImportMode === 'enrich' ? { backgroundColor: 'rgba(52,211,153,0.18)', borderColor: 'rgba(52,211,153,0.45)', color: 'var(--accent-green)' } : { borderColor: '#38383A', color: '#94a3b8' }}>
                    {t('Enriquecer con historial', 'Enrich with history')}
                  </button>
                  <button onClick={() => setIbkrImportMode('merge')}
                    className="flex-1 min-w-[130px] py-2 px-3 rounded-lg text-xs font-medium transition-colors border"
                    style={ibkrImportMode === 'merge' ? { backgroundColor: 'rgba(37,99,235,0.2)', borderColor: 'rgba(37,99,235,0.4)', color: 'var(--accent-blue)' } : { borderColor: '#38383A', color: '#94a3b8' }}>
                    {t('Agregar junto a existentes', 'Add alongside existing')}
                  </button>
                  <button onClick={() => setIbkrImportMode('replace')}
                    className="flex-1 min-w-[130px] py-2 px-3 rounded-lg text-xs font-medium transition-colors border"
                    style={ibkrImportMode === 'replace' ? { backgroundColor: 'rgba(234,88,12,0.2)', borderColor: 'rgba(249,115,22,0.4)', color: '#fb923c' } : { borderColor: '#38383A', color: '#94a3b8' }}>
                    {t('Reemplazar posiciones IBKR', 'Replace IBKR positions')}
                  </button>
                </div>
                {ibkrImportMode === 'enrich' && ibkrEnrichPreview && (
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    {ibkrEnrichPreview.matched > 0
                      ? t(`${ibkrEnrichPreview.matched} posiciones se enlazan con las que ya tienes (no se duplican): se completan fechas de compra, costo e identificadores faltantes. ${ibkrEnrichPreview.created > 0 ? `${ibkrEnrichPreview.created} nuevas se agregan. ` : ''}Tu cantidad y precio actuales no se tocan, y no se borra nada.`,
                          `${ibkrEnrichPreview.matched} positions link up with the ones you already have (no duplicates): missing purchase dates, cost basis and identifiers get filled in. ${ibkrEnrichPreview.created > 0 ? `${ibkrEnrichPreview.created} new ones are added. ` : ''}Your current quantity and price are left alone, and nothing is deleted.`)
                      : t('Ninguna posición del archivo coincide con las que ya tienes: todas se agregarán como nuevas.',
                          'No position in the file matches what you already have: all of them will be added as new.')}
                  </p>
                )}
                {ibkrImportMode === 'merge' && ibkrEnrichPreview?.matched > 0 && (
                  <p className="text-xs mt-2" style={{ color: 'rgba(251,146,60,0.8)' }}>
                    {t(`Cuidado: ${ibkrEnrichPreview.matched} de estas posiciones ya existen y se van a duplicar. Si lo que quieres es cargar el historial, usa "Enriquecer".`,
                       `Careful: ${ibkrEnrichPreview.matched} of these positions already exist and will be duplicated. If what you want is to load the history, use "Enrich".`)}
                  </p>
                )}
                {ibkrImportMode === 'replace' && existingItems && (
                  <p className="text-xs mt-2" style={{ color: 'rgba(251,146,60,0.7)' }}>
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
                  className="flex-1 py-2.5 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-elevated transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={doIBKRImport} disabled={importing}
                  className="flex-1 py-2.5 text-white rounded-lg disabled:opacity-50 hover:opacity-90 transition-colors text-sm font-medium"
                  style={{ backgroundColor: ibkrImportMode === 'replace' ? '#ea580c' : ibkrImportMode === 'enrich' ? 'var(--accent-green)' : 'var(--accent-blue)' }}>
                  {importing
                    ? importProgress.total > 0
                      ? t(`Importando ${importProgress.done}/${importProgress.total}`, `Importing ${importProgress.done}/${importProgress.total}`)
                      : t('Preparando...', 'Preparing...')
                    : ibkrImportMode === 'replace'
                      ? t(`Reemplazar con ${ibkrData.items.length} posiciones`, `Replace with ${ibkrData.items.length} positions`)
                      : ibkrImportMode === 'enrich'
                        ? t('Enriquecer mi portafolio', 'Enrich my portfolio')
                        : t(`Importar ${ibkrData.items.length} posiciones`, `Import ${ibkrData.items.length} positions`)}
                </button>
                {importing && importProgress.total > 0 && (
                  <div className="mt-2 h-1.5 bg-slate-700/30 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ backgroundColor: 'var(--accent-blue)', width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Done step */}
          {step === 'done' && result && (
            <div className="text-center py-6">
              {/* success === 0 is a FAILURE, not a success: a completely misread file
                  used to show the celebration screen with "0 assets imported".
                  EXCEPT under enrich, where creating zero items is the ideal result:
                  every position matched an existing one and only history was added. */}
              {(() => {
                const enrichWorked = (result.matched || 0) > 0 || (result.enriched || 0) > 0
                  || (result.history || 0) > 0 || (result.navDays || 0) > 0
                const ok = result.failed === 0 && (result.success > 0 || enrichWorked)
                return (
                  <>
                    <div className="text-5xl mb-4">{ok ? '🎉' : '⚠️'}</div>
                    <p className="text-white font-semibold text-lg mb-2">
                      {!ok && result.success === 0
                        ? t('No se importó nada', 'Nothing was imported')
                        : result.failed === 0
                          ? t('Importación exitosa', 'Import successful')
                          : t('Importación parcial', 'Partial import')}
                    </p>
                    <p className="text-slate-400 text-sm">
                      {result.success > 0
                        ? <>{result.success} {result.isBI ? t('transacciones importadas', 'transactions imported') : t('activos importados', 'assets imported')}</>
                        : enrichWorked
                          ? t('No se creó ninguna posición duplicada', 'No duplicate position was created')
                          : <>{result.success} {result.isBI ? t('transacciones importadas', 'transactions imported') : t('activos importados', 'assets imported')}</>}
                      {result.failed > 0 && <>, {result.failed} {t('fallidos', 'failed')}</>}
                    </p>
                  </>
                )
              })()}
              {result.matched > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-green)' }}>
                  🔗 {t(`${result.matched} posiciones enlazadas con las que ya tenías`, `${result.matched} positions linked to the ones you already had`)}
                  {result.enriched > 0 && t(`, ${result.enriched} completadas con datos faltantes`, `, ${result.enriched} filled in with missing data`)}
                </p>
              )}
              {result.replaced > 0 && (
                <p className="text-xs mt-1" style={{ color: '#fb923c' }}>{t(`${result.replaced} posiciones anteriores reemplazadas`, `${result.replaced} previous positions replaced`)}</p>
              )}
              {result.snapCount > 0 && (
                <p className="text-xs mt-1" style={{ color: '#22d3ee' }}>📊 {result.snapCount} {t('periodos de historial', 'history periods')}</p>
              )}
              {result.txCount > 0 && (
                <p className="text-[#34d399] text-xs mt-1">💰 {result.txCount} {t('transacciones', 'transactions')}</p>
              )}
              {result.errorMsg && (
                <p className="text-[#f87171] text-xs mt-2">{result.errorMsg}</p>
              )}
              {result.failReasons?.length > 0 && (
                <div className="mt-3 mx-auto max-w-sm text-left px-3 py-2 rounded-lg"
                  style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)' }}>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--alert-warn-icon)' }}>
                    {t('Por qué fallaron:', 'Why they failed:')}
                  </p>
                  {result.failReasons.map((r, i) => (
                    <p key={i} className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>· {r}</p>
                  ))}
                  {result.failed > result.failReasons.length && (
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      {t(`y ${result.failed - result.failReasons.length} más`, `and ${result.failed - result.failReasons.length} more`)}
                    </p>
                  )}
                </div>
              )}
              <button onClick={onClose}
                className="mt-6 px-8 py-2.5 rounded-lg hover:opacity-90 transition-colors text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
                {t('Cerrar', 'Close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
