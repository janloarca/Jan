'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { detectBI, parseBI } from '@/lib/parsers/biParser'
import { detectCardStatement, parseCardStatement } from '@/lib/parsers/guateCardStatements'
import { fingerprintStatement, describeFingerprint } from '@/lib/parsers/statementFingerprint'
import { detectCoinbase, parseCoinbase } from '@/lib/parsers/coinbaseParser'
import { detectKraken, parseKraken } from '@/lib/parsers/krakenParser'
import { isIBKRSectionedFormat, parseIBKRFile, formatIBKRFileResult, detectIBKRFileKind, pickSectionedCsvFromWorkbook } from '@/lib/parsers/ibkrFileParser'
import { parseIBKRXmlFile } from '@/lib/parsers/ibkrXmlFileAdapter'
import { parseAmount, parseImportDate } from '@/lib/numberParse'
import { FIELD_MAP, BROKER_PRESETS, guessMapping } from '@/lib/importMapping'
import { FINANCE_CATEGORIES, CATEGORY_COLORS } from '@/lib/financeCategories'
import { matchStatement } from '@/lib/statementMatcher'
import { reconcileStatement, enrichmentFor } from '@/lib/statementReconcile'
import { flowSign, flowMagnitude } from '@/lib/financeAmount'
import { walletCoverage } from '@/lib/walletCoverage'
import { validateItem, sanitizeImportItem, sanitizeCell } from '@/lib/validation'
import { getBrokerHowTo } from '@/lib/brokerHowTo'
import BrokerSteps from '@/components/ui/BrokerSteps'
import { reconcileBrokerPositions } from '@/lib/brokerReconcile'
import ChispudoLoader from '@/components/ui/ChispudoLoader'

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

// onImportComplete (FASE GM): fired once when an import lands on its done
// screen, with a summary of what was written. The IBKR journey orchestrator
// listens to it to ADVANCE to the next step instead of dropping the user back
// on the dashboard wondering whether more steps exist (the reported bug).
export default function FileImportModal({ onClose, onImportItems, onImportTransaction, onImportSnapshot, onAddLot, onAddFinanceTransaction, onUpdateFinanceTransaction, onUpdateItem, onDeleteItem, onBulkImport, existingItems, existingLots = [], existingFinanceTransactions = [], ingestRules = [], activePortfolio, activeEntity = 'default', lang = 'es', brokerHint = null, onImportComplete = null, journeyActive = false }) {
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
  const [histCopied, setHistCopied] = useState(false)
  const [pdfReading, setPdfReading] = useState(false)
  // Qué era el PDF que no reconocimos. Null cuando sí lo reconocimos o cuando ni
  // siquiera parecía un estado de cuenta.
  const [stmtFingerprint, setStmtFingerprint] = useState(null)
  const [fpCopied, setFpCopied] = useState(false)
  const [pdfNotice, setPdfNotice] = useState('')
  const fileRef = useRef(null)
  const [ibkrData, setIbkrData] = useState(null)
  const [ibkrImportMode, setIbkrImportMode] = useState('merge')
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })

  const [extraSheets, setExtraSheets] = useState({ snapshots: [], transactions: [] })
  const [biData, setBiData] = useState(null)
  const [selectedBankAccount, setSelectedBankAccount] = useState('')
  // Statement reconciliation: buckets from lib/statementMatcher + which rows the
  // user checked for import (new rows pre-checked, likely-duplicates unchecked).
  const [biMatch, setBiMatch] = useState(null)
  const [walletStats, setWalletStats] = useState(null)
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

  // The AI returns the template structure as JSON; we hydrate the SAME state
  // the xlsx path fills (headers/rows/mapping/extraSheets), so mapping,
  // preview, per-row validation and the import itself are literally the
  // existing pipeline. Nothing the AI says reaches Firestore unreviewed.
  const hydrateFromPdf = useCallback((data) => {
    const HDRS = ['Simbolo', 'Nombre', 'Tipo', 'Cantidad', 'Precio de Compra', 'Precio Actual', 'Moneda', 'Institucion', 'Fecha de Compra', 'Notas']
    const rows = (data.activos || []).map((a) => [
      a.simbolo ?? '', a.nombre ?? '', a.tipo ?? '', a.cantidad ?? '', a.precioCompra ?? '',
      a.precioActual ?? '', a.moneda ?? 'USD', a.institucion ?? '', a.fechaCompra ?? '', a.notas ?? '',
    ])
    if (rows.length === 0 && (data.transacciones || []).length === 0) {
      setError(lang === 'es'
        ? `La IA no encontró posiciones en el PDF.${data.missing ? ` Nota: ${data.missing}` : ''}`
        : `The AI found no positions in the PDF.${data.missing ? ` Note: ${data.missing}` : ''}`)
      return
    }
    const transactions = (data.transacciones || [])
      .filter((t) => t.fecha && t.tipo)
      .map((t) => ({
        date: String(t.fecha),
        type: String(t.tipo).toUpperCase(),
        symbol: sanitizeCell(String(t.simbolo || '')).toUpperCase(),
        description: sanitizeCell(String(t.descripcion || '')).slice(0, 500),
        totalAmount: parseNumber(t.monto),
        currency: sanitizeCell(String(t.moneda || 'USD')).toUpperCase(),
      }))
    const snapshots = (data.historial || [])
      .filter((h) => h.fecha)
      .map((h) => ({
        date: String(h.fecha),
        totalActivosUSD: parseNumber(h.totalActivos),
        netWorthUSD: parseNumber(h.patrimonioNeto) || (parseNumber(h.totalActivos) - parseNumber(h.totalDeudas)),
      }))
    setExtraSheets({ snapshots, transactions })
    setHeaders(HDRS)
    setRawData(rows)
    setMapping(guessMapping(HDRS))
    setPdfNotice(lang === 'es'
      ? `Chispu leyó tu PDF con IA. Revisa que cada dato esté correcto antes de importar.${data.missing ? ` La IA no encontró: ${data.missing}` : ''}`
      : `Chispu read your PDF with AI. Review every value before importing.${data.missing ? ` The AI could not find: ${data.missing}` : ''}`)
    setStep('map')
  }, [lang])

  const handlePdf = useCallback(async (file) => {
    // FIRST: the deterministic path. A Guatemalan credit-card statement
    // (Contecnica/BI, G&T Continental, BAC Credomatic) is parsed locally with
    // pdf.js + format-specific parsers that reconcile against the statement's
    // own totals: exact, free, and offline, so the AI never sees it. Anything
    // unrecognized (or an image-only scan) falls through to the AI path that
    // handled every PDF before this existed.
    setPdfReading(true)
    setError('')
    try {
      const { extractPdfLayoutText } = await import('@/lib/pdfExtract')
      const text = await extractPdfLayoutText(file)
      // Si NO lo reconocemos, dejar constancia de qué era antes de caer a la
      // IA. Un estado de un banco que todavía no soportamos se veía igual que un
      // archivo malo: el usuario no sabía cuál de las dos cosas pasó, y sin
      // saber cómo imprime ese banco no hay forma de escribirle un parser. Es
      // observación pura, jamás montos.
      if (text && !detectCardStatement(text)) {
        const fp = fingerprintStatement(text)
        setStmtFingerprint(fp.looksLikeStatement ? fp : null)
      } else {
        setStmtFingerprint(null)
      }
      if (text && detectCardStatement(text)) {
        // Las reglas que el usuario ya enseñó corrigiendo categorías. Sin
        // ellas, el mismo comercio volvía a "Otros Gastos" en cada import por
        // más veces que se lo hubiera corregido.
        const parsed = parseCardStatement(text, { rules: ingestRules })
        if (parsed && parsed.transactions.length > 0) {
          // Card statements go through reconcileStatement, NOT matchStatement:
          // the statement arrives a month after the Shortcut and the email
          // already captured these same purchases, and that cross-method case
          // needs multiplicity, currency and settled-vs-authorized amounts
          // handled. See lib/statementReconcile.js for why each one matters.
          const match = reconcileStatement(parsed.transactions, existingFinanceTransactions)
          // La moneda sale de las filas, no de una constante: un estado que
          // no sea guatemalteco se etiquetaba GTQ pase lo que pase. Gana la más
          // frecuente, que es la del cuerpo del estado (BAC imprime dos).
          const freq = {}
          for (const tx of parsed.transactions) freq[tx.currency || 'GTQ'] = (freq[tx.currency || 'GTQ'] || 0) + 1
          const mainCurrency = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 'GTQ'
          setBiData({ transactions: parsed.transactions, finalBalance: 0, currency: mainCurrency, card: parsed })
          setBiMatch(match)
          // Cuánto de este estado ya lo había capturado sola la app. Se calcula
          // acá, con el emparejamiento recién hecho, en vez de re-emparejar.
          setWalletStats(walletCoverage(match))
          // New rows import by default. A review row is checked only when the
          // evidence says it is a SEPARATE charge; left unchecked it means
          // "same charge" and the statement's amount is applied to the row
          // already recorded.
          setBiSelected(new Set([
            ...match.newTxs.map((_, i) => `n${i}`),
            ...match.review.map((x, i) => (x.defaultSame ? null : `r${i}`)).filter(Boolean),
          ]))
          if (parsed.cardLast4) setStmtAccount(`${parsed.bankLabel} •${parsed.cardLast4}`)
          setStep('bi-preview')
          setPdfReading(false)
          return
        }
      }
    } catch (err) {
      // The deterministic path must never block the AI path that always existed.
      console.warn('[import] deterministic card path failed:', err?.message)
    }

    // Vercel caps serverless request bodies around 4.5MB and base64 inflates
    // ~33%, so AI reading caps at 3MB. Bigger statements fall back to the
    // manual prompt flow.
    const MAX_PDF = 3 * 1024 * 1024
    if (file.size > MAX_PDF) {
      setError(lang === 'es'
        ? 'PDF demasiado grande para la lectura con IA (máx 3MB). Usa el prompt manual de abajo con tu propia IA.'
        : 'PDF too large for AI reading (max 3MB). Use the manual prompt below with your own AI.')
      setAiOpen(true)
      setPdfReading(false)
      return
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(file)
      })
      const base64 = String(dataUrl).split(',')[1] || ''
      const { authFetch } = await import('@/lib/authFetch')
      // BYOK: the same Anthropic key the chat widget keeps in the browser. The
      // server uses its own ANTHROPIC_API_KEY when one is configured.
      let clientKey
      try { clientKey = localStorage.getItem('chispudo-anthropic-key') || undefined } catch { clientKey = undefined }
      const res = await authFetch('/api/import/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf: base64, lang, apiKey: clientKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(lang === 'es'
          ? data.errorCode === 'NO_AI_KEY'
            ? 'La lectura automática de PDF necesita una API key de IA. Configúrala en el chat de Chispu o usa el prompt manual de abajo.'
            : 'No pudimos leer el PDF con IA. Intenta de nuevo o usa el prompt manual de abajo.'
          : data.errorCode === 'NO_AI_KEY'
            ? 'Automatic PDF reading needs an AI API key. Set it up in the Chispu chat or use the manual prompt below.'
            : 'We could not read the PDF with AI. Try again or use the manual prompt below.')
        setAiOpen(true)
        return
      }
      hydrateFromPdf(data)
    } catch (err) {
      setError(lang === 'es' ? `Error leyendo el PDF: ${err.message}` : `Error reading PDF: ${err.message}`)
    } finally {
      setPdfReading(false)
    }
  }, [lang, hydrateFromPdf, existingFinanceTransactions])

  const handleFile = useCallback(async (file) => {
    setError('')
    setPdfNotice('')

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
      'application/pdf',
      'text/xml',
      'application/xml',
    ]
    const ext = (file.name || '').split('.').pop()?.toLowerCase()
    if (!validTypes.includes(file.type) && !['xlsx', 'xls', 'csv', 'pdf', 'xml'].includes(ext)) {
      setError(lang === 'es' ? 'Tipo de archivo no válido. Usa .xlsx, .csv, .pdf o .xml (IBKR).' : 'Invalid file type. Use .xlsx, .csv, .pdf or .xml (IBKR).')
      return
    }

    // Native PDF path: Chispu reads the statement with AI and pre-fills the
    // same mapping/preview step a spreadsheet reaches.
    if (ext === 'pdf' || file.type === 'application/pdf') {
      await handlePdf(file)
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
    // A Flex Query downloaded by hand arrives as XML: the file the app's own
    // instructions tell IBKR users to get. It enters the SAME preview/import
    // flow as the CSV (the adapter returns the formatIBKRFileResult shape).
    const acceptIBKRXml = (xmlText) => {
      if (!/<FlexQueryResponse|<FlexStatements?\b/i.test(xmlText.slice(0, 2000))) {
        setError(lang === 'es'
          ? 'Este XML no es un Flex Query de IBKR. Descarga el Activity Flex Query (Performance & Reports → Flex Queries) y súbelo tal cual.'
          : 'This XML is not an IBKR Flex Query. Download the Activity Flex Query (Performance & Reports → Flex Queries) and upload it as is.')
        return true
      }
      const data = parseIBKRXmlFile(xmlText)
      if (data.empty) { ibkrEmptyError(); return true }
      setIbkrData(data); setStep('ibkr-preview'); return true
    }

    try {
      const XLSX = await import('xlsx')
      let wb
      let csvText = null

      if (ext === 'xml') {
        acceptIBKRXml(await file.text())
        return
      }

      if (ext === 'csv') {
        // file.text() decodes UTF-8 correctly; letting SheetJS read the raw bytes
        // decoded them as CP1252 and turned "Débito" into "DÃ©bito", which broke
        // Spanish header detection (Banco Industrial statements fell through to the
        // stock mapper).
        csvText = await file.text()
        const kind = detectIBKRFileKind(csvText)
        if (kind === 'pdf') { await handlePdf(file); return }
        // A Flex XML saved with a .csv name is still the file we asked for.
        if (kind === 'xml') { acceptIBKRXml(csvText); return }
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
      if (looksPdf) { await handlePdf(file); return }

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
  }, [lang, existingFinanceTransactions, existingItems, handlePdf])

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
    if (onImportComplete) onImportComplete({ kind: 'generic', summary: { success, failed } })
  }, [preview, onImportItems, onImportSnapshot, onImportTransaction, onAddLot, activePortfolio, extraSheets, onImportComplete])

  const doBIImport = useCallback(async () => {
    if (!biData || !biMatch || !onAddFinanceTransaction) return
    setImporting(true)
    setError('')
    let success = 0
    let failed = 0
    let updated = 0

    // Two shapes reach this handler. A card statement is reconciled with
    // reconcileStatement (confirmed / review / orphans), because the Shortcut
    // and the email have usually captured the same purchases already; a bank
    // CSV still uses matchStatement (exact / likely).
    const isCard = Array.isArray(biMatch.confirmed)

    // Only the rows the user left checked. For a card statement a checked
    // REVIEW row means "this is a separate charge, import it"; leaving it
    // unchecked means "same charge", and the statement's settled amount is
    // applied to the row already recorded instead.
    const toImport = isCard
      ? [
        ...biMatch.newTxs.filter((_, i) => biSelected.has(`n${i}`)),
        ...biMatch.review.filter((_, i) => biSelected.has(`r${i}`)).map((x) => x.row),
      ]
      : [
        ...biMatch.newTxs.filter((_, i) => biSelected.has(`n${i}`)),
        ...biMatch.likely.filter((_, i) => biSelected.has(`l${i}`)).map((x) => x.parsed),
      ]

    // The statement is the bank's own record, so a row it confirms gets
    // enriched (settled amount, posting date, card, installment) rather than
    // skipped. Anything only the earlier capture has (GPS from the Shortcut,
    // a category the user fixed) is preserved by enrichmentFor.
    if (isCard && onUpdateFinanceTransaction) {
      const toUpdate = [
        ...biMatch.confirmed,
        ...biMatch.review
          .filter((_, i) => !biSelected.has(`r${i}`))
          .map((x) => ({ match: x.match, updates: enrichmentFor(x.row, x.match).updates })),
      ]
      for (const u of toUpdate) {
        if (!u.match?.id || !u.updates || Object.keys(u.updates).length === 0) continue
        try {
          await onUpdateFinanceTransaction(u.match.id, u.updates)
          updated++
        } catch {
          failed++
        }
      }
    }

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

    setResult({
      success, failed, updated,
      total: biData.transactions.length,
      skipped: isCard ? biMatch.confirmed.length : biMatch.exact.length,
      isBI: true,
    })
    setStep('done')
    setImporting(false)
  }, [biData, biMatch, biSelected, stmtAccount, onAddFinanceTransaction, onUpdateFinanceTransaction, onImportItems, onUpdateItem, existingItems, selectedBankAccount])

  const doIBKRImport = useCallback(async () => {
    // History-only files are valid: a Flex XML for a closed year can carry just
    // NAV days and trades, no current positions.
    if (!ibkrData || !ibkrData.items
      || (ibkrData.items.length === 0 && (ibkrData.transactions || []).length === 0 && (ibkrData.equityHistory || []).length === 0)) return
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
      isIBKR: true,
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
      if (onImportComplete) onImportComplete({ kind: 'ibkr', summary })
    }
  }, [ibkrData, onBulkImport, existingItems, activePortfolio, activeEntity, ibkrImportMode, onImportComplete])

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

  // Holdings the statement can't date because they were bought before its start.
  // Worth its own notice: the file looks complete (it HAS trades), so nothing
  // else would hint that some positions are still missing their real start date.
  const ibkrOlderThanFile = (ibkrData?.items || []).filter(i => i._historyIncomplete).length

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
  // "Importar CSV" era literalmente falso para IBKR, cuyo archivo es XML (y
  // esta pantalla también acepta xlsx y pdf para cualquier broker): decía el
  // formato equivocado justo arriba de una zona que pide .xml.
  const modalTitle = brokerInfo
    ? t(`Importar archivo: ${brokerInfo.name}`, `Import file: ${brokerInfo.name}`)
    : t('Importar Portfolio', 'Import Portfolio')
  // Dentro del viaje, las instrucciones que YA son pasos propios del viaje se
  // omiten (ver journeyStep en lib/brokerHowTo.js).
  const brokerSteps = (brokerInfo?.csv?.steps || []).filter((s) => !(journeyActive && s.journeyStep))

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
            ].map((tab) => (
              <button key={tab.key} onClick={() => { setMode(tab.key); setError('') }}
                className="flex-1 px-4 py-3 text-sm font-medium transition-colors"
                style={mode === tab.key ? { color: 'var(--accent-green)', borderBottom: '2px solid #34d399', backgroundColor: 'rgba(52,211,153,0.05)' } : { color: 'var(--text-muted)' }}>
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

          {/* Un estado de cuenta de un banco que todavía no leemos de forma
              exacta. Se muestra en TODOS los pasos a propósito: lo que sigue es
              la lectura con IA, y quien la está mirando merece saber por qué no
              fue la exacta. La huella describe la FORMA del documento (páginas,
              filas, convención de números, moneda), nunca un monto ni un
              comercio: eso es de quien recibió el estado. */}
          {stmtFingerprint && (
            <div className="mb-4 p-3 rounded-lg text-xs"
              style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)', color: 'var(--text-secondary)' }}>
              <p className="font-medium mb-1" style={{ color: 'var(--alert-warn-icon)' }}>
                {stmtFingerprint.issuers.length
                  ? t(`Todavía no leemos ${stmtFingerprint.issuers[0]} de forma exacta`, `We don't read ${stmtFingerprint.issuers[0]} exactly yet`)
                  : t('Todavía no reconocemos este banco', "We don't recognize this bank yet")}
              </p>
              <p className="mb-2">{t(
                'Lo vamos a leer con IA, que funciona pero no reconcilia contra los totales que el estado imprime. Si querés lectura exacta, mandá esta línea (no lleva montos ni comercios):',
                'We will read it with AI, which works but does not reconcile against the totals the statement prints. For exact reading, send this line (it carries no amounts or merchants):'
              )}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 font-mono break-words px-2 py-1 rounded bg-theme-base" style={{ color: 'var(--text-muted)' }}>
                  {describeFingerprint(stmtFingerprint, lang)}
                </code>
                <button onClick={() => { navigator.clipboard.writeText(describeFingerprint(stmtFingerprint, lang)); setFpCopied(true); setTimeout(() => setFpCopied(false), 2000) }}
                  className="shrink-0 px-2 py-1 rounded-md font-medium"
                  style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                  {fpCopied ? t('¡Copiado!', 'Copied!') : t('Copiar', 'Copy')}
                </button>
              </div>
            </div>
          )}

          {/* Upload step */}
          {step === 'upload' && mode === 'file' && (
            <div>
              {/* FASE IH2: plegadas por defecto, misma razón que el paso 1:
                  con la lista abierta, la zona de "arrastra tu archivo" (la
                  única acción de esta pantalla) quedaba fuera de la vista. */}
              {brokerInfo?.csv?.steps && (
                <div className="mb-4">
                  <BrokerSteps steps={brokerSteps} note={brokerInfo.csv.note} variant="csv" lang={lang} collapsible />
                </div>
              )}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => !pdfReading && fileRef.current?.click()}
                className="border-2 border-dashed border-glass-border rounded-xl p-6 sm:p-12 text-center cursor-pointer hover:border-[#3b82f6]/50 hover:bg-[#3b82f6]/5 transition-colors"
              >
                {pdfReading ? (
                  <div className="py-4">
                    <div className="flex justify-center mb-3"><ChispudoLoader mode="inline" size={24} state="section-loading" lang={lang} /></div>
                    <p className="text-white font-medium mb-1">{t('Chispu está leyendo tu PDF con IA...', 'Chispu is reading your PDF with AI...')}</p>
                    <p className="text-slate-500 text-sm">{t('Un estado grande puede tardar hasta medio minuto', 'A large statement can take up to half a minute')}</p>
                  </div>
                ) : (
                  <>
                    <div className="text-4xl mb-3">{brokerInfo ? brokerInfo.icon : '📊'}</div>
                    <p className="text-white font-medium mb-1">{t('Arrastra tu archivo aquí', 'Drag your file here')}</p>
                    <p className="text-slate-500 text-sm">{t('o haz clic para seleccionar', 'or click to browse')}</p>
                    <p className="text-slate-600 text-xs mt-3">{brokerHint === 'ibkr' ? '.xml, .xlsx, .xls, .csv, .pdf' : '.xlsx, .xls, .csv, .pdf'}</p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={brokerHint === 'ibkr' ? '.xml,.xlsx,.xls,.csv,.pdf' : '.xlsx,.xls,.csv,.pdf'}
                  className="hidden"
                  onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
                />
              </div>
              <button onClick={async () => {
                  const { generateTemplate } = await import('@/lib/generateTemplate')
                  await generateTemplate()
                }}
                className="mt-4 w-full py-3 border rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-2"
                style={{ backgroundColor: 'rgba(8,145,178,0.2)', borderColor: 'rgba(6,182,212,0.3)', color: 'var(--accent-cyan)' }}>
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
                  <span>🤖 {t('¿PDF de más de 3MB, fotos, o prefieres tu propia IA? Prompt manual aquí', 'PDF over 3MB, photos, or prefer your own AI? Manual prompt here')}</span>
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

                    {/* Second, narrower prompt. The big one above is shaped around
                        POSITIONS, so someone whose only artifact is a screenshot of
                        a performance chart (PortfolioAnalyst is the sole IBKR view
                        that reaches account inception, and its dashboard has no
                        export) gets an AI answer full of empty position columns.
                        This one asks for the value history ALONE, which is exactly
                        what the chart needs to stop estimating the past. */}
                    <div className="pt-3 mt-1 border-t" style={{ borderColor: 'rgba(37,99,235,0.2)' }}>
                      <p className="text-xs font-medium mb-1" style={{ color: 'var(--accent-blue)' }}>
                        {t('¿Solo tienes una captura del valor de tu cuenta en el tiempo?', 'Only have a screenshot of your account value over time?')}
                      </p>
                      <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                        {t('Por ejemplo la gráfica de PortfolioAnalyst en IBKR (Holdings, período INCEPTION). Este prompt le pide a la IA solo el historial de valor, que es lo que hace que tu gráfico deje de estimar el pasado.',
                           'For example the PortfolioAnalyst chart in IBKR (Holdings, INCEPTION period). This prompt asks the AI for the value history alone, which is what makes your chart stop estimating the past.')}
                      </p>
                      <button onClick={() => {
                          const prompt = lang === 'es'
                            ? `Te voy a pasar una o varias capturas de pantalla (o PDFs) del historial de valor de mi cuenta de inversión. Puede ser una gráfica de barras por trimestre o por mes, una tabla, o ambas.

Genera un archivo Excel (.xlsx) con UNA sola hoja llamada exactamente "Historial", con estas columnas EXACTAS en este orden:
Fecha, Total Activos (USD), Total Deudas (USD), Patrimonio Neto (USD), Notas

Reglas:
- Una fila por cada punto de tiempo que se vea en la imagen (cada barra, cada punto, cada fila de la tabla)
- Fecha en formato YYYY-MM-DD. Si el punto es un trimestre, usa el ÚLTIMO día de ese trimestre (Q1 2025 = 2025-03-31, Q2 = 2025-06-30, Q3 = 2025-09-30, Q4 = 2025-12-31). Si es un mes, usa el último día del mes
- "Total Activos (USD)" y "Patrimonio Neto (USD)" son el valor de la cuenta (NAV) en esa fecha. Si no tengo deudas, pon 0 en "Total Deudas (USD)" y repite el mismo número en las otras dos
- Solo números, sin símbolo de moneda ni separadores de miles
- Ordena de la fecha más antigua a la más reciente

MUY IMPORTANTE: no inventes ni interpoles valores. Si una barra no tiene su número escrito y no puedes leerlo con certeza, omite esa fila y dime al final cuáles omitiste. Es preferible tener menos puntos correctos que muchos inventados.

Cuando termines, dame el archivo .xlsx listo para descargar.`
                            : `I will give you one or more screenshots (or PDFs) of my investment account's value history. It may be a bar chart by quarter or month, a table, or both.

Generate an Excel file (.xlsx) with ONE sheet named exactly "Historial", with these EXACT columns in this order:
Fecha, Total Activos (USD), Total Deudas (USD), Patrimonio Neto (USD), Notas

Rules:
- One row per time point visible in the image (each bar, each point, each table row)
- Date in YYYY-MM-DD format. If the point is a quarter, use the LAST day of that quarter (Q1 2025 = 2025-03-31, Q2 = 2025-06-30, Q3 = 2025-09-30, Q4 = 2025-12-31). If it's a month, use the last day of the month
- "Total Activos (USD)" and "Patrimonio Neto (USD)" are the account value (NAV) on that date. If I have no debt, put 0 in "Total Deudas (USD)" and repeat the same number in the other two
- Numbers only, no currency symbol and no thousands separators
- Sort from oldest date to newest

VERY IMPORTANT: do not invent or interpolate values. If a bar has no number written on it and you cannot read it with certainty, skip that row and tell me at the end which ones you skipped. Fewer correct points beat many invented ones.

When done, give me the .xlsx file ready to download.`
                          navigator.clipboard.writeText(prompt)
                          setHistCopied(true)
                          setTimeout(() => setHistCopied(false), 2500)
                        }}
                        className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors border"
                        style={{ color: 'var(--accent-blue)', borderColor: 'rgba(37,99,235,0.4)' }}>
                        {histCopied ? t('✓ Copiado, pégalo con tu captura', '✓ Copied, paste it with your screenshot') : t('Copiar prompt para historial de valor', 'Copy prompt for value history')}
                      </button>
                    </div>
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

          {/* Column mapping step */}
          {step === 'map' && (
            <div>
              {pdfNotice && (
                <div className="mb-3 p-3 rounded-lg text-xs leading-relaxed" style={{ backgroundColor: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.25)', color: 'var(--accent-blue)' }}>
                  {pdfNotice}
                </div>
              )}
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
                  {biData.card
                    ? `${t('Formato detectado', 'Format detected')}: ${biData.card.bankLabel}${biData.card.cardLast4 ? ` •${biData.card.cardLast4}` : ''}${biData.card.cutDate ? ` · ${t('corte', 'cut')} ${biData.card.cutDate}` : ''}`
                    : t('Formato detectado: Banco Industrial', 'Format detected: Banco Industrial')}
                </span>
              </div>
              {/* The parse re-adds every row and compares against the statement's
                  own printed totals, per currency and per side. Saying so (or
                  saying it does NOT add up) is the whole point: a statement
                  imported wrong silently is how a month's numbers stop being
                  trustworthy. */}
              {biData.card && (
                <div className="px-3 py-2 mb-3 rounded-lg border text-xs"
                  style={biData.card.reconciled
                    ? { borderColor: 'var(--alert-success-border)', backgroundColor: 'var(--alert-success-bg)', color: 'var(--accent-green)' }
                    : { borderColor: 'var(--alert-warn-border)', backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                  {biData.card.reconciled
                    ? t('✓ Cuadra al centavo contra los totales impresos del estado de cuenta.', '✓ Adds up to the cent against the statement\'s own printed totals.')
                    : t('⚠ La lectura NO cuadra contra los totales del estado. Revisa las filas antes de importar.', '⚠ The parse does NOT add up against the statement totals. Review the rows before importing.')}
                  {!biData.card.reconciled && biData.card.reconciliation.filter((x) => !x.ok).map((x) => (
                    <span key={`${x.currency}${x.side}`} className="block mt-0.5">
                      {x.currency} {x.side === 'debit' ? t('cargos', 'debits') : t('créditos', 'credits')}: {t('esperado', 'expected')} {x.expected.toLocaleString()} · {t('leído', 'parsed')} {x.computed.toLocaleString()}
                    </span>
                  ))}
                </div>
              )}
              {/* Cobertura de la captura automática, medida contra los
                  marcadores APPLEPAY que el propio estado imprime. Es la única
                  forma de saber si la automatización del teléfono está
                  disparando sin tener que deducirlo de los síntomas: el
                  resultado final se ve igual capturara quien capturara. */}
              {walletStats && walletStats.total > 0 && (
                <div className="px-3 py-2 mb-3 rounded-lg border text-xs"
                  style={walletStats.missing === 0
                    ? { borderColor: 'var(--alert-success-border)', backgroundColor: 'var(--alert-success-bg)', color: 'var(--alert-success-icon)' }
                    : { borderColor: 'var(--alert-warn-border)', backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                  <span className="block font-medium">
                    {t(`Captura automática: ${walletStats.captured} de ${walletStats.total} compras con billetera (${Math.round(walletStats.pct)}%)`,
                       `Automatic capture: ${walletStats.captured} of ${walletStats.total} wallet purchases (${Math.round(walletStats.pct)}%)`)}
                  </span>
                  {Object.keys(walletStats.byTransport).length > 0 && (
                    <span className="block mt-0.5 opacity-80">
                      {Object.entries(walletStats.byTransport)
                        .map(([via, n]) => `${via === 'shortcut' ? t('atajo', 'shortcut') : via === 'email' ? t('correo', 'email') : via} ${n}`)
                        .join(' · ')}
                      {walletStats.byHand > 0 && ` · ${t('a mano', 'by hand')} ${walletStats.byHand}`}
                    </span>
                  )}
                  {walletStats.missing > 0 && (
                    <span className="block mt-0.5 opacity-80">
                      {t(`${walletStats.missing} no las capturó nada: la automatización no disparó en esas.`,
                         `${walletStats.missing} were captured by nothing: the automation did not fire on those.`)}
                    </span>
                  )}
                </div>
              )}
              <p className="text-slate-400 text-sm mb-3">
                {t(`${biData.transactions.length} transacciones en el estado`, `${biData.transactions.length} transactions in the statement`)}
                {biMatch && (Array.isArray(biMatch.confirmed)
                  ? `: ${biMatch.newTxs.length} ${t('nuevas', 'new')} · ${biMatch.confirmed.length} ${t('ya capturadas', 'already captured')}${biMatch.review.length > 0 ? ` · ${biMatch.review.length} ${t('a revisar', 'to review')}` : ''}`
                  : `: ${biMatch.newTxs.length} ${t('nuevas', 'new')} · ${biMatch.exact.length} ${t('ya registradas', 'already recorded')}${biMatch.likely.length > 0 ? ` · ${biMatch.likely.length} ${t('a revisar', 'to review')}` : ''}`)}
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
                  {/* REVIEW — the cross-method judgement call: the statement's
                      settled amount differs from what was captured live (a tip,
                      a fuel pre-authorization), or the merchant text is too
                      weak to decide. Checked = separate charge, import it.
                      Unchecked = same charge, correct the recorded one. */}
                  {biMatch.review?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'var(--alert-warn-icon)' }}>
                        ⚠ {t(`¿El mismo cobro? (${biMatch.review.length}): marca solo los que sean cobros APARTE`,
                             `Same charge? (${biMatch.review.length}): check only the ones that are SEPARATE charges`)}
                      </p>
                      <div className="overflow-x-auto max-h-44 overflow-y-auto border rounded-lg" style={{ borderColor: 'var(--alert-warn-border)' }}>
                        <table className="w-full text-xs">
                          <tbody>
                            {biMatch.review.map(({ row, match, relation }, i) => (
                              <tr key={`r${i}`} className="border-b border-glass-border/50">
                                <td className="py-1.5 px-2">
                                  <input type="checkbox" checked={biSelected.has(`r${i}`)} onChange={(e) => {
                                    const next = new Set(biSelected)
                                    e.target.checked ? next.add(`r${i}`) : next.delete(`r${i}`)
                                    setBiSelected(next)
                                  }} />
                                </td>
                                <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">{row.date}</td>
                                <td className="py-1.5 px-2 text-white max-w-[150px] truncate">{row.description}</td>
                                <td className="py-1.5 px-2 text-right whitespace-nowrap" style={{ color: 'var(--text-negative)' }}>
                                  {row.currency === 'USD' ? '$' : 'Q'}{row.amount.toLocaleString()}
                                </td>
                                <td className="py-1.5 px-2 text-slate-500 max-w-[170px] truncate">
                                  {relation === 'adjusted'
                                    ? t(`ya tienes ${match.currency === 'USD' ? '$' : 'Q'}${match.amount.toLocaleString()} el ${match.date}`,
                                        `you have ${match.currency === 'USD' ? '$' : 'Q'}${match.amount.toLocaleString()} on ${match.date}`)
                                    : `≈ ${match.date} · ${match.description}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        {t('Sin marcar, se corrige el movimiento que ya tenías con el monto final del banco.',
                           'Left unchecked, the movement you already had is corrected with the bank\'s final amount.')}
                      </p>
                    </div>
                  )}

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
                                  {flowSign(tx)}{tx.currency === 'USD' ? '$' : 'Q'}{flowMagnitude(tx).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* LIKELY DUPLICATES — default unchecked, user decides */}
                  {biMatch.likely?.length > 0 && (
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
                                  {flowSign(parsed)}{parsed.currency === 'USD' ? '$' : 'Q'}{flowMagnitude(parsed).toLocaleString()}
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

                  {/* CONFIRMED — captured live by the Shortcut/email (or typed
                      by hand) and now confirmed by the bank. Not re-imported;
                      enriched with what only the statement knows. */}
                  {biMatch.confirmed?.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer" style={{ color: 'var(--accent-green)' }}>
                        ✓ {t(`Ya capturadas (${biMatch.confirmed.length}): el banco las confirma, no se duplican`,
                             `Already captured (${biMatch.confirmed.length}): the bank confirms them, no duplicates`)}
                      </summary>
                      <div className="mt-1 max-h-40 overflow-y-auto border border-glass-border/40 rounded-lg p-2 space-y-0.5">
                        {biMatch.confirmed.map(({ row, changes }, i) => (
                          <p key={i} className="text-slate-500 truncate">
                            {row.date} · {row.description} · {row.currency === 'USD' ? '$' : 'Q'}{row.amount.toLocaleString()}
                            {changes.length > 0 && (
                              <span style={{ color: 'var(--alert-warn-icon)' }}>
                                {' → '}{changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(', ')}
                              </span>
                            )}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* ORPHANS — recorded inside the statement's own window but
                      absent from it. Informational: the usual cause is another
                      card, but it is also how a double-capture shows up. */}
                  {biMatch.orphans?.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                        ? {t(`Tienes ${biMatch.orphans.length} movimiento(s) de estas fechas que el estado no trae`,
                             `You have ${biMatch.orphans.length} movement(s) from these dates the statement does not include`)}
                      </summary>
                      <div className="mt-1 max-h-32 overflow-y-auto border border-glass-border/40 rounded-lg p-2 space-y-0.5">
                        <p className="text-slate-600 mb-1">
                          {t('Normal si son de otra tarjeta. Si no, revisa que no sea el mismo cobro capturado dos veces.',
                             'Normal if they are from another card. If not, check they are not the same charge captured twice.')}
                        </p>
                        {biMatch.orphans.map((o, i) => (
                          <p key={i} className="text-slate-500 truncate">
                            {o.date} · {o.description} · {o.currency === 'USD' ? '$' : 'Q'}{(o.amount || 0).toLocaleString()}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* EXACT — skipped, collapsed */}
                  {biMatch.exact?.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                        ⏭ {t(`Ya registradas (${biMatch.exact.length}): se omiten`, `Already recorded (${biMatch.exact.length}): skipped`)}
                      </summary>
                      <div className="mt-1 max-h-32 overflow-y-auto border border-glass-border/40 rounded-lg p-2 space-y-0.5">
                        {biMatch.exact.map(({ parsed }, i) => (
                          <p key={i} className="text-slate-500 truncate">{parsed.date} · {parsed.description} · {parsed.currency === 'USD' ? '$' : 'Q'}{parsed.amount.toLocaleString()}</p>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Payments TO the card are transfers between the user's own
                      accounts: importing them as income or expense would
                      distort the month, so they never import, but hiding them
                      entirely would make the statement look misread. */}
                  {biData.card?.excluded?.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                        ⏭ {t(`Pagos a la tarjeta (${biData.card.excluded.length}): no se importan, son transferencias`, `Card payments (${biData.card.excluded.length}): not imported, they are transfers`)}
                      </summary>
                      <div className="mt-1 max-h-32 overflow-y-auto border border-glass-border/40 rounded-lg p-2 space-y-0.5">
                        {biData.card.excluded.map((e, i) => (
                          <p key={i} className="text-slate-500 truncate">{e.date} · {e.description} · {e.currency === 'USD' ? '$' : 'Q'}{e.amount.toLocaleString()}</p>
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
                          <td className="py-1.5 px-1.5 text-right font-medium" style={{ color: gain > 0 ? 'var(--accent-green)' : gain < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                            {cost > 0 ? `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* The statement carried no history: say so BEFORE the import, in
                  terms of what the user LOSES, not which report section is absent.
                  Naming the two checkboxes is enough to act on; the jargon
                  ("Activity Statement", "Trades section") stays out of the way. */}
              {ibkrMissingHistory && (
                <div className="mt-3 px-3 py-2.5 rounded-lg text-xs" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <p className="font-medium" style={{ color: 'var(--alert-warn-icon)' }}>
                    {ibkrData._period?.singleDay
                      ? t(`Este archivo cubre un solo día: ${ibkrData._period.raw}.`, `This file covers a single day: ${ibkrData._period.raw}.`)
                      : t('Este archivo tiene lo que tienes hoy, pero no cómo llegaste ahí.', 'This file has what you hold today, but not how you got there.')}
                  </p>
                  <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                    {/* When the file names its own one-day period, THAT is the whole
                        explanation and the whole fix. Telling this user to tick more
                        sections would be wrong: a one-day statement has no trades to
                        list because no trades happened that day. */}
                    {ibkrData._period?.singleDay
                      ? t('Por eso no trae tus compras ni tu historial: ese día no pasó nada. Vuelve a generarlo en IBKR y en "Period" elige un rango largo (por ejemplo el año completo, o desde que abriste la cuenta). Puedes importar este igual, pero tu gráfico seguirá estimando el pasado.',
                          'That is why it has no purchases or history: nothing happened that day. Generate it again at IBKR and under "Period" pick a long range (the full year, or since you opened the account). You can still import this one, but your chart will keep estimating the past.')
                      : t('No trae las fechas en que compraste ni vendiste, así que tu gráfico va a seguir mostrando el pasado como estimado. Puedes importarlo igual. Para incluir tu historia real, vuelve a descargar el archivo en IBKR eligiendo un rango de fechas largo.',
                          'It has no purchase or sale dates, so your chart will keep showing the past as an estimate. You can still import it. To include your real history, download the file again at IBKR choosing a long date range.')}
                  </p>
                </div>
              )}

              {/* Some holdings are older than the statement window. Say it plainly
                  and point at the ONE setting that solves it regardless of period
                  (lot open dates), because widening the statement only helps as
                  far back as IBKR keeps statements. */}
              {!ibkrMissingHistory && ibkrOlderThanFile > 0 && (
                <div className="mt-3 px-3 py-2.5 rounded-lg text-xs" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <p className="font-medium" style={{ color: 'var(--alert-warn-icon)' }}>
                    {t(`${ibkrOlderThanFile} de estas posiciones ya las tenías antes de que empiece este archivo.`,
                       `${ibkrOlderThanFile} of these positions were already yours before this file starts.`)}
                  </p>
                  <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t('Para esas no ponemos fecha de compra, porque la primera que aparece aquí no es la real. Si quieres sus fechas verdaderas: en IBKR crea un Flex Query, y en "Open Positions" pon "Level of Detail: Lots" y marca "Open Date Time". Eso trae la fecha de cada compra por vieja que sea. La otra opción es bajar un statement por cada año anterior.',
                       'We leave those without a purchase date, because the first one showing up here is not the real one. To get their true dates: in IBKR create a Flex Query, and under "Open Positions" set "Level of Detail: Lots" and tick "Open Date Time". That brings each purchase date no matter how old. The other option is downloading one statement per earlier year.')}
                  </p>
                </div>
              )}

              {/* One decision, three plain-language outcomes. The old row of three
                  jargon buttons ("Enriquecer", "Agregar junto a existentes",
                  "Reemplazar posiciones IBKR") asked the user to understand our
                  data model before they could pick safely, and cramped onto two
                  lines on a phone. Now each option says what happens to THEIR data,
                  the safe one carries the recommendation, and the risky one spells
                  out the loss. */}
              <div className="mt-4">
                <p className="text-xs text-slate-400 mb-2">{t('¿Qué hacemos con este archivo?', 'What should we do with this file?')}</p>
                <div className="space-y-2">
                  {(() => {
                    const matched = ibkrEnrichPreview?.matched || 0
                    const created = ibkrEnrichPreview?.created || 0
                    const ibkrCount = (existingItems || []).filter(it => it.institution === 'Interactive Brokers' || it._source === 'ibkr').length
                    const options = [
                      {
                        key: 'enrich',
                        accent: 'var(--accent-green)',
                        title: matched > 0
                          ? t('Completar lo que ya tengo', 'Fill in what I already have')
                          : t('Completar mi portafolio', 'Fill in my portfolio'),
                        desc: matched > 0
                          ? t(`Encontramos ${matched} de estas posiciones en tu portafolio. Les agregamos las fechas y movimientos que falten${created > 0 ? `, y sumamos las ${created} que no tenías` : ''}. No se duplica ni se borra nada, y tu saldo de hoy queda igual.`,
                              `We found ${matched} of these positions in your portfolio. We add the missing dates and movements${created > 0 ? `, and add the ${created} you didn't have` : ''}. Nothing is duplicated or deleted, and today's balance stays the same.`)
                          : t('Ninguna de estas posiciones está todavía en tu portafolio, así que se agregarán todas.',
                              'None of these positions are in your portfolio yet, so all of them will be added.'),
                      },
                      {
                        key: 'merge',
                        accent: 'var(--accent-blue)',
                        title: t('Agregar todo como nuevo', 'Add everything as new'),
                        desc: matched > 0
                          ? t(`Ojo: ${matched} posiciones que ya tienes aparecerían dos veces y tu patrimonio se vería inflado.`,
                              `Careful: ${matched} positions you already have would show up twice and your net worth would look inflated.`)
                          : t('Úsalo si este archivo es de una cuenta que todavía no está aquí.',
                              'Use this if the file is from an account that isn\'t here yet.'),
                        warn: matched > 0,
                      },
                      {
                        key: 'replace',
                        accent: 'var(--accent-orange)',
                        title: t('Borrar y empezar de nuevo', 'Delete and start over'),
                        desc: ibkrCount > 0
                          ? t(`Elimina tus ${ibkrCount} posiciones de IBKR y las vuelve a crear desde este archivo.`,
                              `Deletes your ${ibkrCount} IBKR positions and recreates them from this file.`)
                          : t('No tienes posiciones de IBKR que borrar.', 'You have no IBKR positions to delete.'),
                        warn: ibkrCount > 0,
                      },
                    ]
                    return options.map((opt) => {
                      const active = ibkrImportMode === opt.key
                      const recommended = opt.key === (matched > 0 ? 'enrich' : 'merge')
                      return (
                        <button key={opt.key} onClick={() => setIbkrImportMode(opt.key)}
                          className="w-full text-left p-3 rounded-lg border transition-colors flex items-start gap-2.5"
                          style={active
                            ? { borderColor: opt.accent, backgroundColor: `${opt.accent}14` }
                            : { borderColor: 'var(--card-border)', backgroundColor: 'var(--bg-card)' }}>
                          <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center"
                            style={{ borderColor: active ? opt.accent : 'var(--card-border)' }}>
                            {active && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.accent }} />}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium" style={{ color: active ? opt.accent : 'var(--text-primary)' }}>{opt.title}</span>
                              {recommended && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                  style={{ color: 'var(--accent-green)', backgroundColor: 'rgba(52,211,153,0.15)' }}>
                                  {t('Recomendado', 'Recommended')}
                                </span>
                              )}
                            </span>
                            <span className="block text-xs mt-0.5 leading-relaxed"
                              style={{ color: opt.warn ? 'rgba(251,146,60,0.9)' : 'var(--text-muted)' }}>
                              {opt.desc}
                            </span>
                          </span>
                        </button>
                      )
                    })
                  })()}
                </div>
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
                      ? t(`Borrar y usar estas ${ibkrData.items.length}`, `Delete and use these ${ibkrData.items.length}`)
                      : ibkrImportMode === 'enrich'
                        ? t('Completar mi portafolio', 'Fill in my portfolio')
                        : t(`Agregar ${ibkrData.items.length} posiciones`, `Add ${ibkrData.items.length} positions`)}
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
                          ? t('Tu portafolio quedó igual de tamaño: no se duplicó nada.', 'Your portfolio is the same size: nothing was duplicated.')
                          : <>{result.success} {result.isBI ? t('transacciones importadas', 'transactions imported') : t('activos importados', 'assets imported')}</>}
                      {result.failed > 0 && <>, {result.failed} {t('fallidos', 'failed')}</>}
                    </p>
                    {/* The cross-method outcome: what the statement confirmed
                        instead of duplicating, and what it corrected. */}
                    {result.skipped > 0 && (
                      <p className="text-xs mt-1" style={{ color: 'var(--accent-green)' }}>
                        {t(`${result.skipped} ya las tenías capturadas: el banco las confirmó, no se duplicaron.`,
                           `${result.skipped} were already captured: the bank confirmed them, nothing was duplicated.`)}
                      </p>
                    )}
                    {result.updated > 0 && (
                      <p className="text-xs mt-1" style={{ color: 'var(--accent-blue)' }}>
                        {t(`${result.updated} se corrigieron con el monto y los datos finales del banco.`,
                           `${result.updated} were corrected with the bank's final amount and data.`)}
                      </p>
                    )}
                  </>
                )
              })()}
              {result.matched > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-green)' }}>
                  {result.enriched > 0
                    ? t(`Se completaron ${result.enriched} posiciones que ya tenías con sus fechas y datos faltantes.`, `${result.enriched} positions you already had were filled in with their missing dates and data.`)
                    : t(`Reconocimos tus ${result.matched} posiciones: ya estaban completas.`, `We recognized your ${result.matched} positions: they were already complete.`)}
                </p>
              )}
              {result.replaced > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-orange)' }}>{t(`${result.replaced} posiciones anteriores reemplazadas`, `${result.replaced} previous positions replaced`)}</p>
              )}
              {result.snapCount > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-cyan)' }}>📊 {result.snapCount} {t('periodos de historial', 'history periods')}</p>
              )}
              {result.isIBKR && result.navDays > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--accent-cyan)' }}>📊 {result.navDays} {t('días de historial de valor importados', 'days of value history imported')}</p>
              )}
              {/* IBKR import with ZERO NAV days: the file lacked the daily-value
                  section, so history and returns stay empty even though the
                  import "succeeded". Say so here, where it is still actionable. */}
              {result.isIBKR && result.navDays === 0 && (
                <div className="mt-3 mx-auto max-w-sm px-3 py-2.5 rounded-lg text-left text-xs" style={{ backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <p className="font-medium" style={{ color: 'var(--alert-warn-icon)' }}>
                    {t('El archivo no trae el valor diario de tu cuenta (sección "Net Asset Value (NAV) in Base").',
                       'The file has no daily account value (the "Net Asset Value (NAV) in Base" section).')}
                  </p>
                  <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t('Por eso tu historial y tus retornos siguen vacíos. Vuelve a generar el Flex Query marcando esa sección y sube el archivo otra vez: se suma a lo que ya importaste.',
                       'That is why your history and returns stay empty. Generate the Flex Query again ticking that section and upload the file again: it adds to what you already imported.')}
                  </p>
                </div>
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
