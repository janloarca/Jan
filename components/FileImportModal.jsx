'use client'

import { useState, useCallback, useRef } from 'react'

const FIELD_MAP = {
  symbol: ['symbol', 'ticker', 'simbolo', 'código', 'codigo', 'sym'],
  name: ['name', 'nombre', 'description', 'descripcion', 'instrument', 'instrumento', 'asset'],
  type: ['type', 'tipo', 'category', 'categoria', 'asset_type', 'asset type'],
  quantity: ['quantity', 'cantidad', 'qty', 'shares', 'acciones', 'units', 'unidades', 'amount'],
  purchasePrice: ['price', 'precio', 'purchase_price', 'purchaseprice', 'cost', 'costo', 'unit_price', 'avg_price', 'average price', 'precio promedio'],
  institution: ['institution', 'institucion', 'broker', 'exchange', 'platform', 'plataforma', 'cuenta', 'account'],
  currency: ['currency', 'moneda', 'ccy'],
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
  const name = mapping.name != null ? (row[mapping.name] || '').toString().toLowerCase() : ''
  const symbol = mapping.symbol != null ? (row[mapping.symbol] || '').toString().toLowerCase() : ''
  const combined = `${name} ${symbol}`

  if (/btc|eth|sol|ada|dot|bnb|xrp|doge|avax|matic|crypto|cripto|usdt|usdc|bitcoin|ethereum/i.test(combined)) return 'Crypto'
  if (/etf|fund|fondo|vanguard|ishares|spdr/i.test(combined)) return 'Fund'
  if (/bond|bono|cete|letra|pagare|instrumento|deuda|treasury/i.test(combined)) return 'Bond'
  if (/bank|banco|saving|ahorro|cash|efectivo|checking/i.test(combined)) return 'Bank'
  return 'Stock'
}

function parseNumber(val) {
  if (val == null) return 0
  if (typeof val === 'number') return val
  const str = val.toString().replace(/[$,\s]/g, '').replace(/\((.+)\)/, '-$1')
  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

export default function FileImportModal({ onClose, onImportItems, onImportTransaction, lang = 'es' }) {
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

  // Manual form
  const [manual, setManual] = useState({
    symbol: '', name: '', type: 'Stock', quantity: '', purchasePrice: '', institution: '',
  })

  const handleFile = useCallback(async (file) => {
    setError('')
    try {
      const XLSX = await import('xlsx')
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      if (json.length < 2) {
        setError(lang === 'es' ? 'El archivo no tiene datos suficientes.' : 'File has insufficient data.')
        return
      }

      const hdrs = json[0].map((h) => (h || '').toString().trim())
      const rows = json.slice(1).filter((r) => r.some((cell) => cell !== ''))

      setHeaders(hdrs)
      setRawData(rows)
      setMapping(guessMapping(hdrs))
      setStep('map')
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
    const hdrs = lines[0].split(sep).map((h) => h.trim())
    const rows = lines.slice(1).map((l) => l.split(sep).map((c) => c.trim())).filter((r) => r.some((c) => c !== ''))

    setHeaders(hdrs)
    setRawData(rows)
    setMapping(guessMapping(hdrs))
    setStep('map')
  }, [pasteText, lang])

  const buildPreview = useCallback(() => {
    const items = rawData.map((row) => ({
      symbol: mapping.symbol != null ? (row[mapping.symbol] || '').toString().trim() : '',
      name: mapping.name != null ? (row[mapping.name] || '').toString().trim() : '',
      type: mapping.type != null ? (row[mapping.type] || '').toString().trim() : inferType(row, mapping),
      quantity: parseNumber(mapping.quantity != null ? row[mapping.quantity] : 0),
      purchasePrice: parseNumber(mapping.purchasePrice != null ? row[mapping.purchasePrice] : 0),
      institution: mapping.institution != null ? (row[mapping.institution] || '').toString().trim() : '',
      currency: mapping.currency != null ? (row[mapping.currency] || 'USD').toString().trim() : 'USD',
    })).filter((item) => item.symbol || item.name)

    setPreview(items)
    setStep('preview')
  }, [rawData, mapping])

  const doImport = useCallback(async () => {
    setImporting(true)
    setError('')
    let success = 0
    let failed = 0

    for (const item of preview) {
      try {
        await onImportItems(item)
        success++
      } catch {
        failed++
      }
    }

    setResult({ success, failed, total: preview.length })
    setStep('done')
    setImporting(false)
  }, [preview, onImportItems])

  const doManualImport = useCallback(async () => {
    if (!manual.symbol && !manual.name) {
      setError(lang === 'es' ? 'Ingresa al menos el símbolo o nombre.' : 'Enter at least symbol or name.')
      return
    }
    setImporting(true)
    setError('')
    try {
      await onImportItems({
        ...manual,
        quantity: parseNumber(manual.quantity),
        purchasePrice: parseNumber(manual.purchasePrice),
      })
      setResult({ success: 1, failed: 0, total: 1 })
      setStep('done')
    } catch (err) {
      setError(err.message)
    }
    setImporting(false)
  }, [manual, onImportItems, lang])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const t = (es, en) => lang === 'es' ? es : en

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#131c2e] border border-[#1e2d45] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2d45]">
          <h2 className="text-lg font-bold text-white">{t('Importar Portfolio', 'Import Portfolio')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Mode tabs */}
        {step === 'upload' && (
          <div className="flex border-b border-[#1e2d45]">
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
                className="border-2 border-dashed border-[#1e2d45] rounded-xl p-12 text-center cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors"
              >
                <div className="text-4xl mb-3">📊</div>
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
              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-blue-400 text-xs font-medium mb-1">{t('Formato esperado:', 'Expected format:')}</p>
                <p className="text-slate-400 text-xs">{t(
                  'Columnas: Symbol, Name, Type, Quantity, Price, Institution',
                  'Columns: Symbol, Name, Type, Quantity, Price, Institution'
                )}</p>
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
                className="w-full h-48 px-4 py-3 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500/50 resize-none font-mono"
              />
              <button onClick={handlePaste}
                className="mt-3 w-full py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
                {t('Procesar datos', 'Process data')}
              </button>
            </div>
          )}

          {step === 'upload' && mode === 'manual' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Símbolo', 'Symbol')} *</label>
                  <input value={manual.symbol} onChange={(e) => setManual({ ...manual, symbol: e.target.value })}
                    placeholder="AAPL" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Nombre', 'Name')}</label>
                  <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })}
                    placeholder="Apple Inc" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Tipo', 'Type')}</label>
                  <select value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value })}
                    className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50">
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
                    placeholder="Interactive Brokers" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Cantidad', 'Quantity')} *</label>
                  <input value={manual.quantity} onChange={(e) => setManual({ ...manual, quantity: e.target.value })}
                    placeholder="10" type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">{t('Precio', 'Price')} *</label>
                  <input value={manual.purchasePrice} onChange={(e) => setManual({ ...manual, purchasePrice: e.target.value })}
                    placeholder="150.00" type="number" step="any" className="w-full px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/50" />
                </div>
              </div>
              <button onClick={doManualImport} disabled={importing}
                className="mt-2 w-full py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors text-sm font-medium">
                {importing ? t('Importando...', 'Importing...') : t('Agregar', 'Add')}
              </button>
            </div>
          )}

          {/* Column mapping step */}
          {step === 'map' && (
            <div>
              <p className="text-slate-400 text-sm mb-4">
                {t(`${rawData.length} filas encontradas. Mapea las columnas:`, `${rawData.length} rows found. Map the columns:`)}
              </p>
              <div className="space-y-3">
                {Object.entries(FIELD_MAP).map(([field]) => (
                  <div key={field} className="flex items-center gap-3">
                    <label className="text-sm text-slate-300 w-28 capitalize">{field === 'purchasePrice' ? t('Precio', 'Price') : field}</label>
                    <select
                      value={mapping[field] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [field]: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                      className="flex-1 px-3 py-2 bg-[#0b1120] border border-[#1e2d45] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
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
              <div className="mt-4 p-3 bg-[#0b1120] border border-[#1e2d45] rounded-lg">
                <p className="text-xs text-slate-500 mb-2">{t('Vista previa primera fila:', 'First row preview:')}</p>
                <div className="text-xs text-slate-400 font-mono">
                  {headers.map((h, i) => (
                    <span key={i} className="inline-block mr-3 mb-1">
                      <span className="text-slate-600">{h}:</span> {(rawData[0]?.[i] || '').toString().slice(0, 20)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => setStep('upload')} className="flex-1 py-2.5 border border-[#1e2d45] text-slate-300 rounded-lg hover:bg-[#1a2540] transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={buildPreview}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
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
                    <tr className="text-slate-500 border-b border-[#1e2d45] sticky top-0 bg-[#131c2e]">
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
                      <tr key={i} className="border-b border-[#1e2d45]/50 hover:bg-[#1a2540]">
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
                <button onClick={() => setStep('map')} className="flex-1 py-2.5 border border-[#1e2d45] text-slate-300 rounded-lg hover:bg-[#1a2540] transition-colors text-sm">
                  {t('Atrás', 'Back')}
                </button>
                <button onClick={doImport} disabled={importing}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors text-sm font-medium">
                  {importing ? t('Importando...', 'Importing...') : t(`Importar ${preview.length}`, `Import ${preview.length}`)}
                </button>
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
                {result.success} {t('importados', 'imported')}
                {result.failed > 0 && <>, {result.failed} {t('fallidos', 'failed')}</>}
              </p>
              <button onClick={onClose}
                className="mt-6 px-8 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
                {t('Cerrar', 'Close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
