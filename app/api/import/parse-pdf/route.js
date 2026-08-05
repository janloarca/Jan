import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
// Reading a multi-page statement with Claude can take 20-40s.
export const maxDuration = 60

// Native PDF import. Brokers like Hapi (Apex Clearing statements) and Trade
// Republic only export PDF, and the old flow sent the user OFF the platform
// (copy a prompt, open ChatGPT, come back with an xlsx). Nobody understood
// that. Here the statement goes straight to Claude, which extracts positions,
// movements and value history into the EXACT structure of our import
// template. The client then drops the result into the normal mapping/preview
// step, so a human always validates before anything is written to Firestore.
//
// Keys: server ANTHROPIC_API_KEY when configured; otherwise BYOK, the same
// user-provided key /api/chat already uses (the client sends it from the
// browser). NO_AI_KEY tells the client to fall back to the manual prompt.
//
// Size: Vercel caps serverless request bodies around 4.5MB and base64
// inflates ~33%, so the client caps PDFs for this route at 3MB.

const EXTRACTION_PROMPT_ES = `Extrae las posiciones y movimientos de este estado de cuenta de inversiones y devuélvelos como JSON.

Responde SOLO con un objeto JSON (sin markdown, sin explicaciones) con esta estructura exacta:
{
  "activos": [{ "simbolo": "AAPL", "nombre": "Apple Inc", "tipo": "Stock", "cantidad": 10, "precioCompra": 150.25, "precioActual": 190.10, "moneda": "USD", "institucion": "Hapi", "fechaCompra": "2024-03-15", "notas": "comision $0.10" }],
  "transacciones": [{ "fecha": "2024-03-15", "tipo": "BUY", "simbolo": "AAPL", "descripcion": "Compra 10 AAPL, comision incluida $0.10", "monto": 1502.60, "moneda": "USD" }],
  "historial": [{ "fecha": "2024-12-31", "totalActivos": 10000, "totalDeudas": 0, "patrimonioNeto": 10000 }],
  "missing": "descripcion breve de lo que no encontraste"
}

Reglas:
- "tipo" en activos debe ser uno de: Stock, Fund, Crypto, Bond, Bank, RealEstate, Alternative, Debt
- "tipo" en transacciones debe ser uno de: BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL
- Fechas YYYY-MM-DD, usando la fecha REAL de cada compra; si el documento muestra lotes con fechas distintas, una fila por lote
- Numeros sin simbolo de moneda ni separadores de miles
- Precios y montos en la moneda original del activo; indica la moneda en "moneda"
- Compras y ventas con monto total incluyendo comision, anotandola en "descripcion"
- Incluye dividendos e intereses cobrados, y depositos y retiros de efectivo (importan para el retorno real)
- "historial" solo si el documento muestra valores historicos de la cuenta (cierres de mes o ano); si no, dejalo como []
- NO INVENTES ningun dato: si algo no aparece en el documento, omítelo y explicalo en "missing"
- Si el documento no es un estado de cuenta de inversiones, devuelve {"activos": [], "transacciones": [], "historial": [], "missing": "no es un estado de cuenta"}`

const EXTRACTION_PROMPT_EN = `Extract the positions and movements from this investment account statement and return them as JSON.

Reply with ONLY a JSON object (no markdown, no explanations) with this exact structure:
{
  "activos": [{ "simbolo": "AAPL", "nombre": "Apple Inc", "tipo": "Stock", "cantidad": 10, "precioCompra": 150.25, "precioActual": 190.10, "moneda": "USD", "institucion": "Hapi", "fechaCompra": "2024-03-15", "notas": "fee $0.10" }],
  "transacciones": [{ "fecha": "2024-03-15", "tipo": "BUY", "simbolo": "AAPL", "descripcion": "Buy 10 AAPL, fee included $0.10", "monto": 1502.60, "moneda": "USD" }],
  "historial": [{ "fecha": "2024-12-31", "totalActivos": 10000, "totalDeudas": 0, "patrimonioNeto": 10000 }],
  "missing": "brief description of what you could not find"
}

Rules:
- "tipo" in activos must be one of: Stock, Fund, Crypto, Bond, Bank, RealEstate, Alternative, Debt
- "tipo" in transacciones must be one of: BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL
- Dates YYYY-MM-DD, using each purchase's REAL date; if the document shows lots with different dates, one row per lot
- Plain numbers, no currency symbols and no thousands separators
- Prices and amounts in each asset's original currency; state the currency in "moneda"
- Buys and sells with total amount including fees, noting the fee in "descripcion"
- Include dividends and interest received, and cash deposits and withdrawals (they matter for real returns)
- "historial" only if the document shows historical account values (month-end or year-end closes); otherwise leave it as []
- DO NOT INVENT any data: if something is not in the document, omit it and explain in "missing"
- If the document is not an investment account statement, return {"activos": [], "transacciones": [], "historial": [], "missing": "not an investment statement"}`

function extractJson(text) {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

// Light shape validation only: the heavy per-row validation (validateItem,
// parseAmount, date normalization) already lives in the client's existing
// import pipeline, which this output feeds into unchanged.
function normalize(p) {
  const arr = (v) => (Array.isArray(v) ? v : [])
  return {
    activos: arr(p.activos).slice(0, 500),
    transacciones: arr(p.transacciones).slice(0, 2000),
    historial: arr(p.historial).slice(0, 500),
    missing: typeof p.missing === 'string' ? p.missing.slice(0, 1000) : '',
  }
}

export async function POST(request) {
  const { error: authError } = await verifyAuth(request)
  if (authError) return authError

  const { limited } = await rateLimit(request, { maxRequests: 10 })
  if (limited) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const { pdf, lang, apiKey: clientKey } = body || {}
  if (!pdf || typeof pdf !== 'string') {
    return NextResponse.json({ error: 'Missing pdf' }, { status: 400 })
  }
  // 3MB of PDF becomes ~4MB of base64; anything past that risks the Vercel
  // request-body cap and a very slow read anyway.
  if (pdf.length > 4200000) {
    return NextResponse.json({ error: 'PDF too large', errorCode: 'PDF_TOO_LARGE' }, { status: 413 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || clientKey
  if (!apiKey) {
    // The client opens the manual AI-prompt section on this code.
    return NextResponse.json({ error: 'No AI key configured', errorCode: 'NO_AI_KEY' }, { status: 400 })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
            { type: 'text', text: lang === 'en' ? EXTRACTION_PROMPT_EN : EXTRACTION_PROMPT_ES },
          ],
        }],
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      console.error('[import/parse-pdf] Claude error:', response.status, err.error?.message)
      return NextResponse.json({ error: 'AI conversion failed', errorCode: 'AI_ERROR' }, { status: 502 })
    }

    const data = await response.json()
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
    const parsed = extractJson(text)
    if (!parsed) {
      console.error('[import/parse-pdf] unparseable AI output, length:', text.length)
      return NextResponse.json({ error: 'Could not parse AI output', errorCode: 'AI_PARSE' }, { status: 502 })
    }
    return NextResponse.json(normalize(parsed))
  } catch (err) {
    console.error('[import/parse-pdf]', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
