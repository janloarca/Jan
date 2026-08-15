// FASE HZ2. El armado del correo semanal para UN usuario, compartido por el
// cron dominical y el botón de "enviar prueba" de Ajustes.
//
// Existe por la misma razón de siempre: si el botón de prueba armara su propia
// versión, probaría algo distinto de lo que el domingo se manda de verdad, que
// es la peor clase de prueba. Con esto, lo que ves en la prueba ES el correo.

import { weeklyMovers, incomeInWindow } from './serverPortfolio'
import { buildWeeklyBriefEmail, weekLabelFor } from './weeklyBriefEmail'
import { buildReportData } from './reportData'
import { renderReportPdf } from './generateReport'
import { loadUserPortfolioContext } from './briefContext'

/**
 * Devuelve { subject, html, text, attachments } listo para sendMail, o null si
 * el usuario no tiene datos suficientes (portafolio vacío).
 */
export async function buildWeeklyBriefForUser({ db, uid, prefs = {}, market = null, now = new Date() }) {
  // Carga + cotización + enriquecimiento + snapshots AUMENTADOS: el pipeline
  // compartido de lib/briefContext.js (la razón del aumento, el -62.9% de la
  // primera prueba real, está documentada ahí).
  const ctx = await loadUserPortfolioContext({ db, uid, prefs })
  if (!ctx) return null
  const { items: enriched, transactions, augmented, netWorth, totalAssets, baseCurrency, convert } = ctx

  // Retornos: el MISMO motor del reporte (Dietz sobre la serie archivada).
  const common = { items: enriched, transactions, snapshots: augmented, netWorth, totalAssets, baseCurrency, convert, now }
  const weekData = buildReportData({ ...common, period: 'week' })
  const ytdData = buildReportData({ ...common, period: 'ytd' })

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

  // Adjunto: el reporte de la semana. Si falla, el correo SALE igual sin él:
  // perder el resumen entero por un PDF sería peor que no adjuntarlo.
  let attachments = []
  try {
    const { buffer, filename } = await renderReportPdf({
      items: enriched, snapshots: augmented, transactions,
      netWorth, totalAssets, lang: 'en',
      profileName: prefs.profileName || '',
      baseCurrency, convert, period: 'week',
    })
    attachments = [{ filename, content: buffer, contentType: 'application/pdf' }]
  } catch (e) {
    console.error('[weeklyBrief] pdf failed for', uid, e.message)
  }

  const { subject, html, text } = buildWeeklyBriefEmail({
    weekLabel: weekLabelFor(now), portfolio, market, hasAttachment: attachments.length > 0,
  })
  return { subject, html, text, attachments }
}

// Transporte SMTP con la configuración del entorno. Devuelve null (sin
// reventar) cuando falta configuración: la convención de no-op del repo.
export function makeMailer(nodemailer) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null
  const port = Number(process.env.SMTP_PORT) || 465
  return {
    transport: nodemailer.createTransport({
      host: SMTP_HOST, port, secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 15000, socketTimeout: 20000,
    }),
    from: process.env.SMTP_FROM || `Chispudo <${SMTP_USER}>`,
    replyTo: process.env.SMTP_REPLY_TO || null,
  }
}

// Cabeceras de correo AUTOMÁTICO (RFC 3834 + la variante de Outlook): los
// auto-respondedores no deben contestar a un buzón que nadie lee.
export const AUTO_HEADERS = {
  'Auto-Submitted': 'auto-generated',
  'X-Auto-Response-Suppress': 'All',
}
