'use client'

// Quarterly NAV history, typed in from IBKR's own Portfolio Analyst chart.
//
// A Flex Query reaches back 365 days and no further. That is a hard IBKR limit,
// not something we can work around, so an account opened years ago arrives with
// a history that starts a year ago and a chart that looks like the money
// appeared out of nowhere. Portfolio Analyst DOES show the whole thing, but only
// as a picture: there is no export behind it.
//
// So the user reads the picture and types the quarter-end values. Fourteen
// numbers buy a full multi-year NAV curve, which is a good trade. Each row is
// written as a snapshot with _source:'ibkr_quarterly' — a real broker
// observation (it outranks our reconstructions) but coarser than a synced daily
// NAV (so a later Flex import wins on any day it covers). augmentSnapshots tops
// each one up with the manually-tracked assets that already existed on that
// date, so the curve is portfolio-wide and not just the broker's slice.

import { useState, useMemo, useRef } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { authFetch } from '@/lib/authFetch'
import { quartersBetween, quarterSnapshotDate, formatCurrency } from './utils'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

// Made-up figures. The point is the SHAPE of what to read off the chart, not a
// number anyone should copy.
const EXAMPLE = [
  { label: 'Q1 2024', value: '1,250' },
  { label: 'Q2 2024', value: '1,980' },
  { label: 'Q3 2024', value: '2,400' },
  { label: 'Q4 2024', value: '3,110' },
]

export default function QuarterlyHistoryModal({
  onClose, onSaved, saveSnapshot, saveSettings, convert, baseCurrency = 'USD',
  snapshots = [], lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  const now = new Date()

  const [fromYear, setFromYear] = useState(String(now.getFullYear() - 2))
  const [fromQuarter, setFromQuarter] = useState('1')
  const [currency, setCurrency] = useState('USD')
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [doneMsg, setDoneMsg] = useState('')
  const [showSteps, setShowSteps] = useState(true)
  // Labels whose value came from the screenshot read, not typed by hand — a
  // quick visual "double-check this one" cue. Clears the moment the user
  // touches that field, since an edited value is no longer the AI's claim.
  const [aiFilled, setAiFilled] = useState(() => new Set())
  const [aiReading, setAiReading] = useState(false)
  const [aiNotice, setAiNotice] = useState(null) // { count, confidence, notes }
  // label -> 'deposit' | 'withdrawal', read off a "D"/"W" marker on that bar.
  // Persisted onto the saved snapshot as `_flowMarker` so lib/inferredFlows.js
  // can trust a real read instead of guessing purely from the value jump.
  const [aiMarkers, setAiMarkers] = useState(() => new Map())
  // label -> magnitude of that quarter's Cash Flows bar (FASE GJ), persisted
  // as `_flowAmount`: the marker gives the direction, this gives the amount,
  // so the inferred-flow candidate stops estimating it from the NAV jump.
  const [aiFlowAmounts, setAiFlowAmounts] = useState(() => new Map())
  // Cross-check panel from the screenshot's own summary table (Beginning/
  // Ending/Change, Return Best/Worst/Period, Deposits & Withdrawals). Shown so
  // the user can compare it against what landed in the grid below, and since
  // FASE GI also persisted to settings.ibkrPaSummary when the transcription is
  // saved: lifetime Net D&W + inception are the global constraints the
  // pre-window flow inference reconciles against.
  const [aiSummary, setAiSummary] = useState(null)
  const fileInputRef = useRef(null)

  const rows = useMemo(
    () => quartersBetween(fromYear, fromQuarter, now),
    [fromYear, fromQuarter] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Quarters we already have a transcribed figure for, so re-opening this shows
  // what is on file instead of an empty grid.
  const existing = useMemo(() => {
    const m = new Map()
    ;(snapshots || []).forEach((s) => {
      if (s && s._source === 'ibkr_quarterly' && s.date) m.set(s.date, s)
    })
    return m
  }, [snapshots])

  const filledCount = rows.filter((r) => {
    const v = values[r.label]
    return v != null && v !== '' && isFinite(parseFloat(v))
  }).length

  // Read the chart screenshot with AI, same BYOK pattern as the PDF statement
  // reader (parse-pdf): server key first, else the user's own key from the
  // chat widget. The result only ever PREFILLS the grid below — nothing is
  // saved until the user reviews it and presses "Guardar" themselves.
  const handleImageFile = async (file) => {
    if (!file) return
    setAiNotice(null)
    setError('')
    const ALLOWED = { 'image/png': true, 'image/jpeg': true, 'image/webp': true }
    if (!ALLOWED[file.type]) {
      setError(t('Sube una imagen PNG, JPEG o WebP.', 'Upload a PNG, JPEG or WebP image.'))
      return
    }
    const MAX = 5 * 1024 * 1024
    if (file.size > MAX) {
      setError(t('Captura demasiado grande (máx 5MB). Recórtala solo a la gráfica.', 'Screenshot too large (max 5MB). Crop it to just the chart.'))
      return
    }
    setAiReading(true)
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(file)
      })
      const base64 = String(dataUrl).split(',')[1] || ''
      let clientKey
      try { clientKey = localStorage.getItem('chispudo-anthropic-key') || undefined } catch { clientKey = undefined }
      const res = await authFetch('/api/import/parse-chart-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType: file.type, lang, apiKey: clientKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.errorCode === 'NO_AI_KEY'
          ? t('La lectura automática necesita una API key de IA. Configúrala en el chat de Chispu, o transcribe a mano abajo.', 'Automatic reading needs an AI API key. Set it up in the Chispu chat, or transcribe by hand below.')
          : t('No pudimos leer la captura. Intenta con otra imagen o transcribe a mano abajo.', 'We could not read the screenshot. Try another image or transcribe by hand below.'))
        return
      }
      const quarters = data.quarters || []
      if (quarters.length === 0) {
        setError(t('No encontramos barras en esa imagen. Asegúrate de que se vean las etiquetas de cada trimestre.', 'We could not find bars in that image. Make sure each quarter\'s label is visible.'))
        return
      }
      // Widen the visible range to the earliest quarter the AI actually found —
      // otherwise a read that reaches further back than the current "Desde
      // año" selection would fill values into rows nobody can see.
      let minYear = Infinity, minQ = 5
      for (const q of quarters) {
        const m = q.label.match(/^Q([1-4]) (\d{4})$/)
        if (!m) continue
        const y = Number(m[2]), qq = Number(m[1])
        if (y < minYear || (y === minYear && qq < minQ)) { minYear = y; minQ = qq }
      }
      if (isFinite(minYear)) {
        const needsWiden = minYear < Number(fromYear) || (minYear === Number(fromYear) && minQ < Number(fromQuarter))
        if (needsWiden) { setFromYear(String(minYear)); setFromQuarter(String(minQ)) }
      }
      // Only currency-switch on a clean grid: flipping it under numbers the
      // user already typed by hand would silently reinterpret their entries.
      const noManualValuesYet = Object.values(values).every((v) => v == null || String(v).trim() === '')
      if (noManualValuesYet && data.currency && CURRENCIES.includes(data.currency)) setCurrency(data.currency)
      setValues((prev) => {
        const next = { ...prev }
        for (const q of quarters) next[q.label] = String(q.value)
        return next
      })
      setAiFilled(new Set(quarters.map((q) => q.label)))
      const markers = new Map()
      const flowAmts = new Map()
      for (const q of quarters) {
        if (q.deposit) markers.set(q.label, 'deposit')
        else if (q.withdrawal) markers.set(q.label, 'withdrawal')
        // Magnitude of that quarter's Cash Flows bar (FASE GJ). Only useful
        // WITH a D/W marker: the bar gives the amount, the marker the
        // direction. Kept separate from the NAV value the user types.
        if ((q.deposit || q.withdrawal) && isFinite(Number(q.flowAmount)) && Number(q.flowAmount) > 0) {
          flowAmts.set(q.label, Number(q.flowAmount))
        }
      }
      setAiMarkers(markers)
      setAiFlowAmounts(flowAmts)
      setAiSummary(data.summary || null)
      setAiNotice({ count: quarters.length, confidence: data.confidence, notes: data.notes })
    } catch (err) {
      setError(t(`Error leyendo la imagen: ${err.message}`, `Error reading the image: ${err.message}`))
    } finally {
      setAiReading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const save = async () => {
    setError('')
    setDoneMsg('')
    const jobs = []
    for (const r of rows) {
      const raw = values[r.label]
      if (raw == null || String(raw).trim() === '') continue
      // Tolerate what people actually paste: "9,919.38", "$9 919", "9919,38".
      const cleaned = String(raw).replace(/[^0-9.,-]/g, '').replace(/\s/g, '')
      const normalized = cleaned.includes(',') && !cleaned.includes('.')
        ? cleaned.replace(',', '.')
        : cleaned.replace(/,/g, '')
      const num = parseFloat(normalized)
      if (!isFinite(num) || num < 0) {
        setError(t(`Revisa el valor de ${r.label}: debe ser un número.`, `Check the ${r.label} value: it must be a number.`))
        return
      }
      const usd = currency === 'USD' || !convert ? num : convert(num, currency, 'USD')
      if (!isFinite(usd)) {
        setError(t('No se pudo convertir a USD. Intenta con USD.', 'Could not convert to USD. Try USD.'))
        return
      }
      const marker = aiMarkers.get(r.label) || null
      // The flow amount is read in the screenshot's currency; convert like the
      // NAV value so both live in USD on the snapshot.
      const rawFlow = marker ? aiFlowAmounts.get(r.label) : null
      const flowUSD = rawFlow != null ? (currency === 'USD' || !convert ? rawFlow : convert(rawFlow, currency, 'USD')) : null
      jobs.push({
        date: quarterSnapshotDate(r.year, r.quarter, now), netWorthUSD: usd, label: r.label, marker,
        flowAmount: isFinite(flowUSD) && flowUSD > 0 ? flowUSD : null,
      })
    }
    if (jobs.length === 0) {
      setError(t('Escribe al menos un valor.', 'Fill in at least one value.'))
      return
    }
    setSaving(true)
    try {
      for (const j of jobs) {
        await saveSnapshot({
          date: j.date,
          netWorthUSD: j.netWorthUSD,
          totalActivosUSD: j.netWorthUSD,
          _source: 'ibkr_quarterly',
          ...(j.marker ? { _flowMarker: j.marker } : {}),
          ...(j.flowAmount ? { _flowAmount: j.flowAmount } : {}),
        })
      }
      // FASE GI (Fase 2a del plan): the screenshot's own summary table is
      // EVIDENCE, not just a cross-check to throw away. Beginning 0.00 dates
      // the account's inception; lifetime Net Deposits & Withdrawals is the
      // global constraint the pre-window flow inference (Fase 3) reconciles
      // against: sum(inferred flows) must equal lifetime net minus the exact
      // flows already on file from the Flex window. Stored on settings, never
      // as a snapshot: it is account metadata, not a NAV point. Persisting is
      // best-effort on purpose: the quarters above are already saved, and a
      // summary write failure must not make the user believe they were not.
      if (aiSummary && saveSettings) {
        try {
          await saveSettings({
            ibkrPaSummary: {
              ...aiSummary,
              currency,
              savedAt: new Date().toISOString(),
            },
          })
        } catch { /* quarters saved; summary is supplementary evidence */ }
      }
      setDoneMsg(t(
        `Listo: ${jobs.length} ${jobs.length === 1 ? 'trimestre guardado' : 'trimestres guardados'}. Tu gráfica ya arranca desde ahí.`,
        `Done: ${jobs.length} ${jobs.length === 1 ? 'quarter saved' : 'quarters saved'}. Your chart now starts from there.`
      ))
      if (onSaved) onSaved(jobs.length)
    } catch {
      setError(t('No se pudo guardar. Intenta de nuevo.', 'Could not save. Try again.'))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm focus:outline-none'
  const inputStyle = {
    backgroundColor: 'var(--input-bg, #000)', border: '1px solid var(--card-border, #38383A)',
    color: 'var(--text-primary, white)',
  }

  const STEPS = [
    { es: 'En IBKR entra a "Performance & Reports" → "Portfolio Analyst"', en: 'In IBKR go to "Performance & Reports" → "Portfolio Analyst"' },
    { es: 'Abre el reporte "Holdings"', en: 'Open the "Holdings" report' },
    { es: 'En el período pon "Since Inception" y la frecuencia en "Quarterly"', en: 'Set the period to "Since Inception" and the frequency to "Quarterly"' },
    { es: 'Quita los benchmarks: solo debe quedar tu cuenta', en: 'Remove the benchmarks: only your account should remain' },
    { es: 'Toma captura de la gráfica de Net Asset Value y transcribe abajo el valor de cada barra', en: 'Screenshot the Net Asset Value chart and transcribe each bar\'s value below' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={trapRef} className="rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}>

        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('Historial anterior a 12 meses', 'History older than 12 months')}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {t('IBKR solo deja exportar los últimos 365 días. Lo de antes se transcribe una vez.',
                 'IBKR only lets you export the last 365 days. Anything older gets typed in once.')}
            </p>
          </div>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
            className="text-xl leading-none shrink-0" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto space-y-4">
          {/* Where the numbers come from */}
          <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            <button type="button" onClick={() => setShowSteps((v) => !v)}
              className="w-full flex items-center justify-between gap-2 text-left">
              <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
                {t('De dónde salen estos números', 'Where these numbers come from')}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{showSteps ? '▴' : '▾'}</span>
            </button>
            {showSteps && (
              <ol className="mt-2.5 space-y-1.5">
                {STEPS.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-body" style={{ color: 'var(--text-secondary)' }}>
                    <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono"
                      style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>{i + 1}</span>
                    <span className="min-w-0">{lang === 'es' ? s.es : s.en}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Generic example, so it is obvious what a row means */}
          <div className="rounded-xl p-3" style={{ border: '1px dashed var(--card-border)' }}>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
              {t('Ejemplo (números inventados): cada barra de la gráfica es una fila.',
                 'Example (made-up numbers): each bar of the chart is one row.')}
            </p>
            <div className="flex items-end gap-1.5 h-16 mb-2">
              {EXAMPLE.map((e, i) => (
                <div key={e.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t"
                    style={{ height: `${28 + i * 16}%`, minHeight: 8, backgroundColor: 'var(--accent-blue)', opacity: 0.55 }} />
                  <span className="text-[9px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{e.label}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {EXAMPLE.map((e) => (
                <div key={e.label} className="flex justify-between text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  <span>{e.label}</span>
                  <span className="font-mono">{e.value}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
              {t('Solo el valor total de la cuenta. No hace falta desglosar por acción.',
                 'Just the account total. No need to break it down by position.')}
            </p>
          </div>

          {/* Screenshot reader: an accelerator, never a requirement. Every value
              it produces lands in the SAME editable grid below, so a misread
              bar costs one field, not a redo. */}
          <div className="rounded-xl p-3 space-y-2" style={{ border: '1px dashed var(--card-border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t('O sube la captura y que Chispu la lea', 'Or upload the screenshot and let Chispu read it')}
            </p>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleImageFile(e.target.files?.[0])} className="hidden" id="quarterly-chart-image" />
            <button type="button" disabled={aiReading}
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2 text-body rounded-lg border disabled:opacity-50 transition-colors hover:bg-theme-elevated"
              style={{ borderColor: 'var(--card-border)', color: 'var(--accent-blue)' }}>
              {aiReading ? t('Leyendo...', 'Reading...') : t('📷 Subir captura del gráfico', '📷 Upload chart screenshot')}
            </button>
            {aiNotice && (
              <p className="text-xs" style={{ color: aiNotice.confidence === 'low' ? 'var(--accent-orange)' : 'var(--accent-green)' }}>
                {aiNotice.confidence === 'low'
                  ? t(`Leyó ${aiNotice.count} barras estimando por altura: revisa cada número antes de guardar.`, `Read ${aiNotice.count} bars estimating by height: check every number before saving.`)
                  : t(`Leyó ${aiNotice.count} barras. Revísalas abajo antes de guardar.`, `Read ${aiNotice.count} bars. Review them below before saving.`)}
                {aiNotice.notes ? ` ${aiNotice.notes}` : ''}
              </p>
            )}
            {/* The screenshot's own summary table (when present), shown so the
                user can cross-check it against what the grid below ends up
                with — never itself saved anywhere, it's just a second source
                of truth for the same numbers. */}
            {aiSummary && (
              <div className="rounded-lg p-2.5 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[11px]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                {aiSummary.ending != null && (
                  <div>
                    <p style={{ color: 'var(--text-muted)' }}>{t('Ending', 'Ending')}</p>
                    <p className="font-mono font-medium" style={{ color: 'var(--text-primary)' }}>{formatCurrency(aiSummary.ending, currency)}</p>
                  </div>
                )}
                {aiSummary.change != null && (
                  <div>
                    <p style={{ color: 'var(--text-muted)' }}>{t('Cambio', 'Change')}</p>
                    <p className="font-mono font-medium" style={{ color: aiSummary.change >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                      {aiSummary.change >= 0 ? '+' : ''}{formatCurrency(aiSummary.change, currency)}
                    </p>
                  </div>
                )}
                {aiSummary.returnPeriodPct != null && (
                  <div>
                    <p style={{ color: 'var(--text-muted)' }}>{t('Retorno del período', 'Period return')}</p>
                    <p className="font-mono font-medium" style={{ color: aiSummary.returnPeriodPct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                      {aiSummary.returnPeriodPct >= 0 ? '+' : ''}{aiSummary.returnPeriodPct.toFixed(2)}%
                    </p>
                  </div>
                )}
                {aiSummary.netFlows != null && (
                  <div className="col-span-3 pt-1" style={{ borderTop: '1px solid var(--card-border)' }}>
                    <p style={{ color: 'var(--text-muted)' }}>{t('Depósitos y retiros netos (todo el período)', 'Net deposits & withdrawals (whole period)')}</p>
                    <p className="font-mono font-medium" style={{ color: 'var(--text-primary)' }}>{formatCurrency(aiSummary.netFlows, currency)}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Range + currency */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>{t('Desde año', 'From year')}</label>
              <input value={fromYear} onChange={(e) => setFromYear(e.target.value)}
                type="number" min="2000" max={now.getFullYear()} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>{t('Trimestre', 'Quarter')}</label>
              <select value={fromQuarter} onChange={(e) => setFromQuarter(e.target.value)} className={inputCls} style={inputStyle}>
                {['1', '2', '3', '4'].map((q) => <option key={q} value={q}>Q{q}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>{t('Moneda', 'Currency')}</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls} style={inputStyle}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* The grid */}
          {rows.length === 0 ? (
            <p className="text-body" style={{ color: 'var(--text-muted)' }}>
              {t('Elige un año y trimestre de inicio válidos.', 'Pick a valid start year and quarter.')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r) => {
                const already = existing.get(quarterSnapshotDate(r.year, r.quarter, now))
                const fromAi = aiFilled.has(r.label)
                const marker = aiMarkers.get(r.label)
                return (
                  <div key={r.label} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-body font-mono flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                      {r.label}
                      {marker && (
                        <span
                          className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={marker === 'deposit'
                            ? { color: 'var(--accent-green)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 18%, transparent)' }
                            : { color: 'var(--accent-orange)', backgroundColor: 'color-mix(in srgb, var(--accent-orange) 18%, transparent)' }}
                          title={marker === 'deposit'
                            ? t('Tu captura marca un depósito en este trimestre', 'Your screenshot flags a deposit this quarter')
                            : t('Tu captura marca un retiro en este trimestre', 'Your screenshot flags a withdrawal this quarter')}>
                          {marker === 'deposit' ? 'D' : 'W'}
                        </span>
                      )}
                    </span>
                    <input
                      value={values[r.label] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value
                        setValues((v) => ({ ...v, [r.label]: val }))
                        // An edited value is the user's claim now, not the AI's.
                        if (fromAi) setAiFilled((s) => { const n = new Set(s); n.delete(r.label); return n })
                      }}
                      inputMode="decimal"
                      placeholder={already ? formatCurrency(already.netWorthUSD, 'USD') : t('valor', 'value')}
                      className={`${inputCls} flex-1`}
                      style={fromAi ? { ...inputStyle, borderColor: 'var(--accent-blue)' } : inputStyle} />
                    {fromAi && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                        style={{ color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' }}
                        title={t('Leído de tu captura: verifica el número.', 'Read from your screenshot: double-check the number.')}>
                        {t('IA', 'AI')}
                      </span>
                    )}
                    {already && !fromAi && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
                        style={{ color: 'var(--accent-green)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 15%, transparent)' }}
                        title={t('Ya guardado. Escribe encima para corregirlo.', 'Already saved. Type over it to correct it.')}>
                        ✓
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {error && <p className="text-body" style={{ color: 'var(--text-negative)' }}>{error}</p>}
          {doneMsg && <p className="text-body" style={{ color: 'var(--accent-green)' }}>{doneMsg}</p>}

          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('Los trimestres en blanco se dejan como están. Si después importas el historial real del broker para esas fechas, ese dato manda.',
               'Blank quarters are left alone. If you later import the broker\'s real history for those dates, that data wins.')}
          </p>
        </div>

        <div className="px-5 py-3 flex gap-2 shrink-0" style={{ borderTop: '1px solid var(--card-border)' }}>
          <button type="button" onClick={onClose}
            className="flex-1 py-2 text-body rounded-lg border" style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
            {t('Cerrar', 'Close')}
          </button>
          <button type="button" onClick={save} disabled={saving || filledCount === 0}
            className="flex-1 py-2 text-body font-medium rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-blue-strong, #2563eb)' }}>
            {saving ? '...' : t(`Guardar ${filledCount || ''}`.trim(), `Save ${filledCount || ''}`.trim())}
          </button>
        </div>
      </div>
    </div>
  )
}
