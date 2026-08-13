import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { getAdminDb } from '@/lib/firebase-admin'
import { priceItems, fetchYahooChart, fetchCryptoPrices } from '@/lib/marketPrices'
import { buildMarketBrief } from '@/lib/marketBrief'
import { makeConvert, enrichItemsServerSide, weeklyMovers, incomeInWindow, netWorthFromItems } from '@/lib/serverPortfolio'
import { buildWeeklyBriefEmail, weekLabelFor } from '@/lib/weeklyBriefEmail'
import { buildReportData } from '@/lib/reportData'
import { renderReportPdf } from '@/lib/generateReport'
import { getItemValue, isExcludedFromNetWorth, computeModifiedDietz } from '@/components/dashboard/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// FASE HZ. UN despachador diario para TODAS las notificaciones periódicas
// (semanal hoy; mensual y anual entran aquí sin infraestructura nueva).
//
// Por qué un despachador y no un cron por cadencia: el plan Hobby de Vercel
// permite 2 cron jobs y los dispara una vez al día. Con el recordatorio de
// fin de mes ya ocupando uno, tres crons más simplemente no caben. Así que
// esta ruta corre todos los días y decide adentro qué toca: domingo = semanal.
// Y la decisión vive en código testeable en vez de en una expresión cron.
//
// Gating (convención del repo: no-op silencioso sin configurar):
//   CRON_SECRET, SMTP_HOST / SMTP_USER / SMTP_PASS
//
// Suscripciones: users/{uid}/settings/preferences con notifyWeekly = true.
// Cada cadencia es independiente: elegir una no condiciona a las otras.

// Qué cadencias corresponden a una fecha dada. Exportada y pura para poder
// probarla: es la única lógica del cron que decide si alguien recibe correo.
export function dueCadences(date) {
  const out = []
  if (date.getUTCDay() === 0) out.push('weekly')
  return out
}

async function loadCollection(db, uid, name) {
  const snap = await db.collection(`users/${uid}/${name}`).get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// Serie de cierres diarios para el brief. Las acciones/índices van a Yahoo y
// las cripto a CoinGecko, que no da serie: para esas se reconstruye una serie
// mínima con el precio de hoy y el cambio de 7 días, suficiente para la fila
// (el % de la semana) y honesta con el resto (no alcanza para "el mayor
// movimiento en N semanas", que por eso solo se afirma del S&P y el VIX).
function makeBriefFetcher() {
  let cryptoCache = null
  return async (symbol, kind) => {
    if (kind === 'crypto') {
      if (!cryptoCache) cryptoCache = (await fetchCryptoPrices(['BTC', 'ETH'])).results
      const q = cryptoCache[symbol]
      if (!q || !(q.price > 0)) return null
      const prior = q.change7d != null ? q.price / (1 + q.change7d / 100) : q.price
      return { closes: [prior, prior, prior, prior, prior, q.price] }
    }
    const { data } = await fetchYahooChart(symbol, { range: '6mo', interval: '1d' })
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    return closes ? { closes } : null
  }
}

export async function GET(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized', errorCode: 'BAD_REQUEST' }, { status: 401 })
  }

  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return NextResponse.json({ ok: true, skipped: 'SMTP not configured' })
  }
  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Admin not configured', errorCode: 'INTERNAL' }, { status: 503 })

  const now = new Date()
  const cadences = dueCadences(now)
  if (cadences.length === 0) {
    return NextResponse.json({ ok: true, skipped: `nothing due on ${now.toISOString().slice(0, 10)}` })
  }

  const snap = await db.collectionGroup('settings').where('notifyWeekly', '==', true).get()
  if (snap.empty) return NextResponse.json({ ok: true, cadences, optedIn: 0, sent: 0 })

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: (Number(process.env.SMTP_PORT) || 465) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 15000,
    socketTimeout: 20000,
  })
  const from = process.env.SMTP_FROM || `Chispudo <${SMTP_USER}>`
  const replyTo = process.env.SMTP_REPLY_TO || null

  // El brief de mercado es el MISMO para todos: se arma una sola vez por
  // corrida en vez de una por usuario (mismos datos, N veces el costo).
  let market = null
  try {
    market = await buildMarketBrief({ fetchSeries: makeBriefFetcher() })
  } catch (e) {
    console.error('[cron/notifications] market brief failed:', e.message)
  }

  const weekKey = now.toISOString().slice(0, 10)
  let sent = 0, skipped = 0, failed = 0

  for (const doc of snap.docs) {
    try {
      if (doc.id !== 'preferences') { skipped++; continue }
      const prefs = doc.data()
      const uid = doc.ref.parent.parent?.id
      const email = (prefs.notifyEmail || prefs.financeReminderEmail || '').trim()
      if (!uid || !email.includes('@')) { skipped++; continue }
      // Un solo correo por semana aunque el cron corra dos veces.
      if (prefs._lastWeeklyBrief === weekKey) { skipped++; continue }

      const [items, transactions, snapshots] = await Promise.all([
        loadCollection(db, uid, 'items'),
        loadCollection(db, uid, 'transactions'),
        loadCollection(db, uid, 'snapshots'),
      ])
      if (items.length === 0) { skipped++; continue }

      // Las tasas salen del último snapshot, que las archiva: son las mismas
      // con las que la app calculó, sin una llamada extra de FX.
      const sorted = [...snapshots].sort((a, b) => String(a.date).localeCompare(String(b.date)))
      const latest = sorted[sorted.length - 1] || {}
      const baseCurrency = prefs.baseCurrency || latest.baseCurrency || 'USD'
      const convert = makeConvert(latest.rates || { USD: 1 }, baseCurrency)

      const { prices } = await priceItems(items)
      const enriched = enrichItemsServerSide(items, prices, convert, baseCurrency)
      const { netWorth, totalAssets } = netWorthFromItems(enriched, {
        isExcluded: isExcludedFromNetWorth, getValue: getItemValue,
      })

      // Retornos: el MISMO motor del reporte (Dietz sobre la serie archivada).
      const weekData = buildReportData({
        items: enriched, transactions, snapshots,
        netWorth, totalAssets, baseCurrency, convert, period: 'week', now,
      })
      const ytdData = buildReportData({
        items: enriched, transactions, snapshots,
        netWorth, totalAssets, baseCurrency, convert, period: 'ytd', now,
      })

      const income = incomeInWindow(transactions, {
        fromTs: now.getTime() - 7 * 86400000, toTs: now.getTime(),
        convert, baseCurrency, items: enriched,
      })

      const portfolio = {
        netWorth,
        weekAbs: weekData.kpis.periodReturn?.abs ?? null,
        weekPct: weekData.kpis.periodReturn?.pct ?? null,
        ytdAbs: ytdData.kpis.periodReturn?.abs ?? null,
        ytdPct: ytdData.kpis.periodReturn?.pct ?? null,
        incomeAbs: income.total,
        incomeCount: income.count,
        movers: weeklyMovers(enriched),
        currency: baseCurrency,
        asOf: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
      }

      // Adjunto: el reporte de la semana. Si falla, el correo SALE igual sin
      // él: perder el resumen entero por un PDF sería peor que no adjuntarlo.
      let attachments = []
      try {
        const { buffer, filename } = await renderReportPdf({
          items: enriched, snapshots, transactions,
          netWorth, totalAssets, lang: 'en',
          profileName: prefs.profileName || '',
          baseCurrency, convert, period: 'week',
        })
        attachments = [{ filename, content: buffer, contentType: 'application/pdf' }]
      } catch (e) {
        console.error('[cron/notifications] pdf failed for', uid, e.message)
      }

      const { subject, html, text } = buildWeeklyBriefEmail({
        weekLabel: weekLabelFor(now),
        portfolio, market, hasAttachment: attachments.length > 0,
      })

      await transport.sendMail({
        from, to: email, subject, html, text, attachments,
        ...(replyTo ? { replyTo } : {}),
        headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
      })
      await doc.ref.set({ _lastWeeklyBrief: weekKey }, { merge: true })
      sent++
    } catch (e) {
      console.error('[cron/notifications] user failed:', e.message)
      failed++
    }
  }

  transport.close()
  return NextResponse.json({ ok: true, cadences, optedIn: snap.size, sent, skipped, failed, marketComplete: !!market?.complete })
}
