// FASE IE. El armado del correo mensual para UN usuario, compartido por el
// cron del día 1 y el botón de "enviar prueba" de Ajustes (misma razón que el
// semanal: lo que ves en la prueba ES el correo real).
//
// Contenido, decidido por el usuario: el mes + el reporte YTD adjunto (PDF) +
// el spreadsheet de enero al mes cubierto (Excel) + el brief de mercado en
// ventana mensual.
//
// La ventana: el correo sale el día 1 y cubre el mes que acaba de CERRAR. El
// mes de referencia es el mes de AYER (now - 1 día): en el envío real eso es
// el mes anterior completo; en una prueba a mitad de mes es el mes en curso,
// etiquetado "(to date)" para no mentir sobre una ventana parcial.

import { incomeInWindow } from './serverPortfolio'
import { buildMonthlyBriefEmail, monthLabelFor } from './monthlyBriefEmail'
import { buildReportData } from './reportData'
import { renderReportPdf } from './generateReport'
import { loadUserPortfolioContext, loadItemSnapshotDocs } from './briefContext'
import { monthKeysFor, buildSpreadsheetRows, renderSpreadsheetXlsx } from './monthlySpreadsheet'
import { SNAPSHOT_VERSION } from './snapshotVersion'

// El día de referencia del mes cubierto: ayer.
export function monthRefFor(now) {
  return new Date(now.getTime() - 86400000)
}

/**
 * Devuelve { subject, html, text, attachments } listo para sendMail, o null si
 * el usuario no tiene datos suficientes (portafolio vacío).
 */
export async function buildMonthlyBriefForUser({ db, uid, prefs = {}, market = null, now = new Date() }) {
  const ctx = await loadUserPortfolioContext({ db, uid, prefs })
  if (!ctx) return null
  const { items: enriched, transactions, augmented, netWorth, totalAssets, baseCurrency, convert } = ctx

  const ref = monthRefFor(now)
  const monthStartTs = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)
  const monthLabel = monthLabelFor(ref, now)

  // Retornos: el MISMO motor del reporte. El del mes usa el arranque explícito
  // (periodStartTs) porque periodRange('month') ancla en el mes EN CURSO, que
  // el día 1 sería una ventana de cero horas.
  const common = { items: enriched, transactions, snapshots: augmented, netWorth, totalAssets, baseCurrency, convert, now }
  const monthData = buildReportData({ ...common, period: 'month', periodStartTs: monthStartTs })
  const ytdData = buildReportData({ ...common, period: 'ytd' })

  const income = incomeInWindow(transactions, {
    fromTs: monthStartTs, toTs: now.getTime(), convert, baseCurrency, items: enriched,
  })

  const portfolio = {
    netWorth,
    monthAbs: monthData.kpis.periodReturn?.abs ?? null,
    monthPct: monthData.kpis.periodReturn?.pct ?? null,
    ytdAbs: ytdData.kpis.periodReturn?.abs ?? null,
    ytdPct: ytdData.kpis.periodReturn?.pct ?? null,
    incomeAbs: income.total,
    incomeCount: income.count,
    currency: baseCurrency,
    asOf: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
  }

  // Adjuntos, cada uno best-effort: perder el resumen entero por un adjunto
  // sería peor que mandarlo sin él, y el correo DICE qué logró adjuntar.
  const attachments = []
  const attachmentsInfo = { report: false, spreadsheet: false, missingMonths: [] }

  try {
    const { buffer, filename } = await renderReportPdf({
      items: enriched, snapshots: augmented, transactions,
      netWorth, totalAssets, lang: 'en',
      profileName: prefs.profileName || '',
      baseCurrency, convert, period: 'ytd',
    })
    attachments.push({ filename, content: buffer, contentType: 'application/pdf' })
    attachmentsInfo.report = true
  } catch (e) {
    console.error('[monthlyBrief] pdf failed for', uid, e.message)
  }

  try {
    const { year, monthKeys, refMonthKey } = monthKeysFor(ref)
    const monthDocs = await loadItemSnapshotDocs({ db, uid, monthKeys, minVersion: SNAPSHOT_VERSION })
    // El mes cubierto sin doc todavía (recién cerrado: el cliente solo lo
    // cachea cuando deja de ser "mes actual") sale de los valores EN VIVO,
    // la misma regla del cliente para la columna del mes en curso.
    const { rows, missingMonths } = buildSpreadsheetRows({
      items: enriched, monthDocs, monthKeys, liveMonthKey: refMonthKey, baseCurrency, convert,
    })
    const { buffer, filename } = await renderSpreadsheetXlsx({ rows, year })
    attachments.push({ filename, content: buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    attachmentsInfo.spreadsheet = true
    attachmentsInfo.missingMonths = missingMonths
  } catch (e) {
    console.error('[monthlyBrief] spreadsheet failed for', uid, e.message)
  }

  const { subject, html, text } = buildMonthlyBriefEmail({ monthLabel, portfolio, market, attachmentsInfo })
  return { subject, html, text, attachments }
}
