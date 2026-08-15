import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Reads a screenshot of a broker's own NAV-by-period chart (IBKR's Portfolio
// Analyst "Holdings" view, Since Inception + Quarterly) and returns one value
// per bar. This is the AI half of QuarterlyHistoryModal: a Flex Query only
// reaches 365 days back, but Portfolio Analyst shows the whole account history
// as a PICTURE with no export behind it — so instead of the user typing ~4
// numbers a year by eye, they screenshot the chart and Claude reads the bars.
// The result is always a STARTING POINT: every value lands back in the same
// editable grid the manual flow uses, so a misread bar is a one-field fix, not
// a re-upload.

const EXTRACTION_PROMPT_ES = `Esta es una captura de un gráfico de barras del valor de una cuenta de inversión (Net Asset Value) por período: cada barra es un trimestre o un año, etiquetado en el eje X (ej. "Q1 2024", "2024 Q1", "Mar-24") con un valor en dólares. A veces (ej. reportes de IBKR "Portfolio Analyst") la imagen también trae, arriba de la gráfica, una tabla resumen con "Net Asset Value" (Beginning/Ending/Change), "Return" (Best/Worst con su fecha, y Period), y "Deposits & Withdrawals" (Net); y sobre algunas barras, marcadores "D" (depósito) y/o "W" (retiro) señalando en qué trimestre entró o salió dinero.

Lee todo lo que aparezca y responde SOLO con un objeto JSON (sin markdown, sin explicación):
{
  "quarters": [{ "label": "Q1 2024", "value": 1250.00, "deposit": false, "withdrawal": false, "flowAmount": null }],
  "currency": "USD",
  "confidence": "high" | "low",
  "notes": "lo que no pudiste leer bien, si algo",
  "summary": {
    "beginning": 0, "ending": 9919.38, "change": 9919.38,
    "returnBestPct": 13.54, "returnBestDate": "2026-06-30",
    "returnWorstPct": -9.30, "returnWorstDate": "2026-03-31",
    "returnPeriodPct": 68.23,
    "netFlows": 7909.99
  }
}

Reglas:
- "label" en formato "Q<1-4> <año de 4 dígitos>" (ej. "Q3 2025"), en el orden en que aparecen las barras
- "value" es el número que representa esa barra: si hay etiquetas de valor sobre las barras, úsalas; si no, estima por la altura relativa contra el eje Y
- "deposit"/"withdrawal": true SOLO si esa barra específica tiene un marcador "D" o "W" visible sobre o cerca de ella; si no ves marcadores en la imagen, deja ambos en false para todas las barras
- "flowAmount": el reporte puede traer una SEGUNDA serie de barras más claras ("Cash Flows") junto a las de NAV; si esa barra existe y es legible para ese trimestre, pon su magnitud (número positivo, sin signo); si no existe, no se distingue o no es legible, deja null. NUNCA la estimes desde el salto del NAV: solo desde la barra de Cash Flows misma
- Una fila por barra visible, sin inventar barras que no estén en la imagen
- "confidence": "low" si tuviste que estimar por altura en vez de leer un número explícito
- "summary": solo inclúyelo si la imagen realmente trae esa tabla de resumen arriba de la gráfica; si no la trae, responde "summary": null. Fechas en formato "AAAA-MM-DD" (si el reporte da fecha corta tipo "2026-06-30" úsala tal cual; si no puedes inferir el año con certeza, deja esa fecha en null)
- Si la imagen no es un gráfico de valor de cuenta por período, responde {"quarters": [], "currency": "USD", "confidence": "low", "notes": "no parece ser ese tipo de gráfico", "summary": null}`

const EXTRACTION_PROMPT_EN = `This is a screenshot of a bar chart showing an investment account's Net Asset Value by period: each bar is a quarter or year, labeled on the X axis (e.g. "Q1 2024", "2024 Q1", "Mar-24") with a dollar value. Sometimes (e.g. IBKR "Portfolio Analyst" reports) the image also carries, above the chart, a summary table with "Net Asset Value" (Beginning/Ending/Change), "Return" (Best/Worst with its date, and Period), and "Deposits & Withdrawals" (Net); and above some bars, "D" (deposit) and/or "W" (withdrawal) markers flagging which quarter money moved in or out.

Read everything present and reply with ONLY a JSON object (no markdown, no explanation):
{
  "quarters": [{ "label": "Q1 2024", "value": 1250.00, "deposit": false, "withdrawal": false, "flowAmount": null }],
  "currency": "USD",
  "confidence": "high" | "low",
  "notes": "anything you could not read well",
  "summary": {
    "beginning": 0, "ending": 9919.38, "change": 9919.38,
    "returnBestPct": 13.54, "returnBestDate": "2026-06-30",
    "returnWorstPct": -9.30, "returnWorstDate": "2026-03-31",
    "returnPeriodPct": 68.23,
    "netFlows": 7909.99
  }
}

Rules:
- "label" formatted as "Q<1-4> <4-digit year>" (e.g. "Q3 2025"), in the order the bars appear
- "value" is the number that bar represents: use value labels above the bars if present; otherwise estimate from relative height against the Y axis
- "deposit"/"withdrawal": true ONLY if that specific bar has a visible "D" or "W" marker above or near it; if the image has no markers at all, leave both false for every bar
- "flowAmount": the report may carry a SECOND, lighter bar series ("Cash Flows") next to the NAV bars; if that bar exists and is legible for that quarter, give its magnitude (positive number, unsigned); if it does not exist, cannot be told apart or is not legible, leave null. NEVER estimate it from the NAV jump: only from the Cash Flows bar itself
- One row per bar visible, do not invent bars that are not in the image
- "confidence": "low" if you had to estimate from height instead of reading an explicit number
- "summary": only include it if the image actually has that summary table above the chart; otherwise reply "summary": null. Dates formatted "YYYY-MM-DD" (if the report gives a short date like "2026-06-30" use it as-is; if you cannot infer the year with confidence, leave that date null)
- If the image is not a per-period account value chart, reply {"quarters": [], "currency": "USD", "confidence": "low", "notes": "does not look like that kind of chart", "summary": null}`

function extractJson(text) {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

const LABEL_RE = /^Q[1-4]\s\d{4}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function normNum(v) {
  const n = Number(v)
  return isFinite(n) ? n : null
}
function normPct(v) {
  const n = normNum(v)
  // A return read off a chart legend is never outside this band; anything
  // wilder is a misread digit, not a real number to carry into the app.
  return n != null && Math.abs(n) <= 10000 ? n : null
}
function normDate(v) {
  return typeof v === 'string' && DATE_RE.test(v) ? v : null
}

// Only worth keeping if it actually says something — an all-null summary
// (the model returned the shape but every field empty) is the same as no
// summary at all for the UI, so collapse it to null rather than render a
// blank card.
function normalizeSummary(s) {
  if (!s || typeof s !== 'object') return null
  const out = {
    beginning: normNum(s.beginning), ending: normNum(s.ending), change: normNum(s.change),
    returnBestPct: normPct(s.returnBestPct), returnBestDate: normDate(s.returnBestDate),
    returnWorstPct: normPct(s.returnWorstPct), returnWorstDate: normDate(s.returnWorstDate),
    returnPeriodPct: normPct(s.returnPeriodPct),
    netFlows: normNum(s.netFlows),
  }
  return Object.values(out).some((v) => v != null) ? out : null
}

function normalize(p) {
  const quarters = Array.isArray(p.quarters) ? p.quarters : []
  return {
    quarters: quarters
      .filter((q) => q && typeof q.label === 'string' && LABEL_RE.test(q.label.trim()) && isFinite(Number(q.value)))
      .slice(0, 80)
      .map((q) => ({
        label: q.label.trim(),
        value: Number(q.value),
        deposit: q.deposit === true,
        withdrawal: q.withdrawal === true,
        // Magnitude of that quarter's Cash Flows bar, when the screenshot has
        // the series and the model could read it. Direction still comes from
        // the D/W marker; this only refines the AMOUNT of the inferred flow.
        flowAmount: isFinite(Number(q.flowAmount)) && Number(q.flowAmount) > 0 ? Number(q.flowAmount) : null,
      })),
    currency: typeof p.currency === 'string' ? p.currency.slice(0, 8) : 'USD',
    confidence: p.confidence === 'low' ? 'low' : 'high',
    notes: typeof p.notes === 'string' ? p.notes.slice(0, 500) : '',
    summary: normalizeSummary(p.summary),
  }
}

const ALLOWED_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true }

export async function POST(request) {
  const { error: authError } = await verifyAuth(request)
  if (authError) return authError

  const { limited } = await rateLimit(request, { maxRequests: 10 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const { image, mediaType, lang, apiKey: clientKey } = body || {}
  if (!image || typeof image !== 'string') {
    return NextResponse.json({ error: 'Missing image' }, { status: 400 })
  }
  if (!ALLOWED_TYPES[mediaType]) {
    return NextResponse.json({ error: 'Unsupported image type', errorCode: 'BAD_TYPE' }, { status: 400 })
  }
  // ~5MB of image becomes ~6.7MB base64; keep well under Vercel's body cap.
  if (image.length > 7000000) {
    return NextResponse.json({ error: 'Image too large', errorCode: 'IMAGE_TOO_LARGE' }, { status: 413 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || clientKey
  if (!apiKey) {
    return NextResponse.json({ error: 'No AI key configured', errorCode: 'NO_AI_KEY' }, { status: 400 })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: lang === 'en' ? EXTRACTION_PROMPT_EN : EXTRACTION_PROMPT_ES },
          ],
        }],
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      console.error('[import/parse-chart-image] Claude error:', response.status, err.error?.message)
      return NextResponse.json({ error: 'AI reading failed', errorCode: 'AI_ERROR' }, { status: 502 })
    }

    const data = await response.json()
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    const parsed = extractJson(text)
    if (!parsed) {
      console.error('[import/parse-chart-image] unparseable AI output, length:', text.length)
      return NextResponse.json({ error: 'Could not parse AI output', errorCode: 'AI_PARSE' }, { status: 502 })
    }
    return NextResponse.json(normalize(parsed))
  } catch (err) {
    console.error('[import/parse-chart-image]', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
