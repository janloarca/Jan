// FASE IE. El armado del correo MENSUAL y, desde FASE IE6, del ANUAL para UN
// usuario, compartido por el cron y el botón de "enviar prueba" de Ajustes
// (misma razón que el semanal: lo que ves en la prueba ES el correo real).
//
// Contenido, decidido por el usuario:
//   mensual → el mes + el reporte YTD (PDF) + el spreadsheet de enero al mes
//             cubierto (Excel) + el brief de mercado en ventana mensual.
//   anual   → el año + el reporte del año (PDF) + el spreadsheet del año
//             completo (Excel) + el brief de mercado en ventana anual.
//
// La ventana, y es la MISMA regla para los dos: el día de referencia es AYER.
// El mensual sale el día 1 y "el mes de ayer" es el mes que acaba de cerrar;
// el anual sale el 1 de enero y "el año de ayer" es el año que acaba de
// cerrar. En una prueba a mitad de período, ayer cae dentro del período en
// curso y la etiqueta lleva "(to date)": nunca una ventana parcial vestida de
// período completo.

import { incomeInWindow } from './serverPortfolio'
import { buildMonthlyBriefEmail, buildAnnualBriefEmail, monthLabelFor, yearLabelFor } from './periodBriefEmail'
import { buildReportData } from './reportData'
import { renderReportPdf } from './generateReport'
import { loadUserPortfolioContext, loadItemSnapshotDocs } from './briefContext'
import { monthKeysFor, buildSpreadsheetModel, renderSpreadsheetXlsx } from './monthlySpreadsheet'
import { SNAPSHOT_VERSION } from './snapshotVersion'

// El día de referencia del período cubierto: ayer.
export function monthRefFor(now) {
  return new Date(now.getTime() - 86400000)
}
export const yearRefFor = monthRefFor

/**
 * Devuelve { subject, html, text, attachments } listo para sendMail, o null si
 * el usuario no tiene datos suficientes (portafolio vacío).
 *
 * @param {'monthly'|'annual'} kind
 */
export async function buildPeriodBriefForUser({ kind = 'monthly', db, uid, prefs = {}, market = null, now = new Date() }) {
  const ctx = await loadUserPortfolioContext({ db, uid, prefs })
  if (!ctx) return null
  const { items: enriched, transactions, augmented, netWorth, totalAssets, baseCurrency, convert } = ctx

  const isAnnual = kind === 'annual'
  const ref = monthRefFor(now)
  const periodStartTs = isAnnual
    ? Date.UTC(ref.getUTCFullYear(), 0, 1)
    : Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)
  const periodLabel = isAnnual ? yearLabelFor(ref, now) : monthLabelFor(ref, now)

  // Retornos: el MISMO motor del reporte, con el arranque explícito
  // (periodStartTs) porque periodRange ancla en el período EN CURSO, que el
  // primer día del siguiente sería una ventana de cero horas.
  const common = { items: enriched, transactions, snapshots: augmented, netWorth, totalAssets, baseCurrency, convert, now }
  const periodData = buildReportData({
    ...common, period: isAnnual ? 'ytd' : 'month', periodStartTs,
  })
  // El anual mide el año cubierto y esa YA es su cifra de año: pedir un YTD
  // aparte sería la misma ventana calculada dos veces.
  const ytdData = isAnnual ? null : buildReportData({ ...common, period: 'ytd' })

  const income = incomeInWindow(transactions, {
    fromTs: periodStartTs, toTs: now.getTime(), convert, baseCurrency, items: enriched,
  })

  const portfolio = {
    netWorth,
    monthAbs: periodData.kpis.periodReturn?.abs ?? null,
    monthPct: periodData.kpis.periodReturn?.pct ?? null,
    yearAbs: periodData.kpis.periodReturn?.abs ?? null,
    yearPct: periodData.kpis.periodReturn?.pct ?? null,
    ytdAbs: ytdData?.kpis.periodReturn?.abs ?? null,
    ytdPct: ytdData?.kpis.periodReturn?.pct ?? null,
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
      baseCurrency, convert,
      period: 'ytd',
      // El anual mide el año CUBIERTO; el mensual, el año en curso.
      ...(isAnnual ? { periodStartTs } : {}),
    })
    attachments.push({ filename, content: buffer, contentType: 'application/pdf' })
    attachmentsInfo.report = true
  } catch (e) {
    console.error(`[${kind}Brief] pdf failed for`, uid, e.message)
  }

  try {
    // monthKeysFor(ref) da enero..mes de ref, así que para el anual (ref = 31
    // de diciembre) son los 12 meses del año cubierto sin caso especial.
    const { year, monthKeys, refMonthKey } = monthKeysFor(ref)
    const monthDocs = await loadItemSnapshotDocs({ db, uid, monthKeys, minVersion: SNAPSHOT_VERSION })
    // El mes cubierto sin doc todavía (recién cerrado: el cliente solo lo
    // cachea cuando deja de ser "mes actual") sale de los valores EN VIVO,
    // la misma regla del cliente para la columna del mes en curso.
    const model = buildSpreadsheetModel({
      items: enriched, monthDocs, monthKeys, liveMonthKey: refMonthKey, baseCurrency, convert,
    })
    attachmentsInfo.missingMonths = model.missingMonths
    const { buffer, filename } = await renderSpreadsheetXlsx({ model, year })
    attachments.push({ filename, content: buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    attachmentsInfo.spreadsheet = true
  } catch (e) {
    console.error(`[${kind}Brief] spreadsheet failed for`, uid, e.message)
  }

  const { subject, html, text } = isAnnual
    ? buildAnnualBriefEmail({ yearLabel: periodLabel, portfolio, market, attachmentsInfo })
    : buildMonthlyBriefEmail({ monthLabel: periodLabel, portfolio, market, attachmentsInfo })
  return { subject, html, text, attachments }
}

// Envolturas por cadencia: el nombre dice cuál es, el motor es uno solo.
export function buildMonthlyBriefForUser(args) {
  return buildPeriodBriefForUser({ ...args, kind: 'monthly' })
}

export function buildAnnualBriefForUser(args) {
  return buildPeriodBriefForUser({ ...args, kind: 'annual' })
}
