import { ACCRUAL_DAILY, accrualAnnualRate, monthlyAccrual } from './dailyAccrual'

// Pure helpers for scheduled-income assets (bonds, CDs, rental, private debt...).
// Shared by two call sites that must agree on the same dates: the automatic
// backfill in useDashboardData (which silently creates the DIVIDEND transactions
// once the account exists) and the "did this already pay?" preview shown in
// AddAccountModal while the user is still filling the form, BEFORE anything is
// saved. Kept framework-free so both can import it without pulling in React.

// FASE HV2. El día de pago configurado, ATERRIZADO en un mes concreto.
//
// El bug que arregla, reportado por el usuario con la captura de un movimiento
// fechado "2026-02-31": la fecha se armaba pegando el día tal cual
// (`${año}-${mes}-${día}`), sin mirar cuántos días tiene ESE mes. Un 31
// configurado produce 2026-02-31, 2026-04-31, 2026-06-31... días que no existen.
//
// Y no falla ruidosamente, que es lo peor: JavaScript los DESBORDA en silencio.
// `new Date('2026-02-31')` devuelve el 3 de MARZO, y `new Date('2026-04-31')` el
// 1 de mayo. Así que la app terminaba con dos lecturas distintas de la misma
// fila: todo lo que mira el texto (`hasDividendInMonth`, que compara
// `YYYY-MM` recortando el string) la ve en febrero, y todo lo que la parsea
// como fecha (`indexBalanceEvents`, `parseUTCDate`, cada motor de
// reconstrucción) la ve en marzo. Con pago mensual, cinco meses del año
// (feb, abr, jun, sep, nov) se corrían al mes siguiente y ahí se apilaban dos
// pagos, mientras el mes nominal figuraba como pagado.
//
// La convención elegida, que además es la que usa un banco: el día se recorta
// al último día real del mes. Configurar 31 significa "el último día del mes",
// y en febrero eso es el 28 (o el 29 en bisiesto).
export function clampPayDay(payDay, year, monthIndex) {
  const day = parseInt(payDay, 10)
  const wanted = Number.isFinite(day) && day > 0 ? Math.min(31, day) : 1
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(wanted, lastDay)
}

// La fecha ISO de pago de un mes concreto, con el día ya recortado.
export function payDateFor(year, monthIndex, payDay) {
  const day = clampPayDay(payDay, year, monthIndex)
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// FASE HV9. ¿El usuario ya dijo que este mes NO pagó?
//
// Se compara por MES, nunca por fecha exacta, y esa es toda la corrección. El
// bug que arregla, reportado tres veces seguidas como "borro el pago y no se
// guarda":
//
// Un pago automático se guarda con un id de documento DETERMINISTA armado de
// fecha+símbolo+tipo+monto, así que si el motor lo vuelve a generar reaparece
// idéntico: es imposible distinguirlo de un borrado que no se guardó. Y lo
// vuelve a generar porque la exclusión se anotaba con la fecha de la fila
// BORRADA mientras el motor decide con la fecha que produce su calendario de
// HOY. Basta con que el día de pago haya cambiado alguna vez (o que la fila
// venga de una versión vieja de la app, o que el día se haya recortado por
// clampPayDay) para que las dos fechas caigan en el mismo mes pero en días
// distintos: la exclusión no matchea y el pago vuelve.
//
// Es exactamente la lección de FASE DH sobre `hasDividendInMonth`: el día que
// dice el calendario y el día en que el dinero de verdad se movió casi nunca
// son el mismo, así que la unidad correcta es el MES. Y es además lo que el
// usuario está afirmando: "en 2024 no recibí ningún pago", no "no recibí un
// pago el 28 de agosto".
//
// Las exclusiones viejas (fechas exactas) siguen valiendo: un mes con una sola
// fecha de pago programada, que es lo único que este motor produce, se comporta
// igual con las dos reglas.
export function isPayDateExcluded(excludedPayDates, dateStr) {
  if (!Array.isArray(excludedPayDates) || excludedPayDates.length === 0) return false
  if (excludedPayDates.includes(dateStr)) return true
  const mk = String(dateStr || '').slice(0, 7)
  if (mk.length !== 7) return false
  return excludedPayDates.some((d) => String(d || '').slice(0, 7) === mk)
}

// Filas que YA quedaron escritas con un día imposible, antes de que clampPayDay
// existiera, con la fecha corregida. Solo toca lo que escribió la app
// (`_source:'auto'`): una fecha tecleada por el usuario pasa por un
// `<input type="date">` y nunca puede ser el 31 de febrero, así que cualquier
// fila manual con esa forma sería un dato que no entendemos y no se toca.
//
// Sin esto, las filas viejas se quedan desbordando al mes siguiente para
// siempre: el motor solo deja de PRODUCIRLAS, no las corrige.
export function impossiblePayDateFixes(transactions) {
  const out = []
  for (const tx of transactions || []) {
    if (!tx?.id || tx._source !== 'auto') continue
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(tx.date || ''))
    if (!m) continue
    const year = Number(m[1])
    const monthIndex = Number(m[2]) - 1
    const day = Number(m[3])
    if (monthIndex < 0 || monthIndex > 11) continue
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
    if (day <= lastDay) continue
    out.push({ id: tx.id, date: payDateFor(year, monthIndex, day) })
  }
  return out
}

// FASE KS. El día de compra como texto ISO 'YYYY-MM-DD', o null.
//
// Existe para que la comparación "¿esta fecha de pago es anterior a la
// compra?" se haga entre DOS CADENAS ISO y nunca entre objetos Date. Dos
// razones, las dos pagadas antes en este repo:
//
//  - El orden lexicográfico de 'YYYY-MM-DD' ES el cronológico, así que la
//    comparación no puede corromperse por zona horaria. Los dos consumidores
//    de esta regla leían la fecha de formas distintas (`getUTCFullYear` acá,
//    `getFullYear` LOCAL en el motor de useDashboardData), o sea que al oeste
//    de UTC podían discrepar sobre en qué mes cae una compra.
//  - Es UNA sola definición para las DOS superficies (la vista previa del
//    formulario y el motor que escribe de verdad). Con una copia en cada lado,
//    una se queda atrás.
export function acquisitionDayISO(acquisitionDate) {
  if (!acquisitionDate) return null
  const s = String(acquisitionDate)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = new Date(s).getTime()
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 10)
}

// Which configured pay-dates already fell due, counting back from `today`.
// Mirrors the lookback window used by the automatic engine (capped at 24
// months) so the preview and the real backfill never disagree on what counts
// as "already happened".
export function getScheduledPayDates({ acquisitionDate, incomeMonths, incomePayDay, rateType }, today = new Date()) {
  if (rateType === 'continuous') return [] // compounding has no discrete pay dates
  const payMonths = Array.isArray(incomeMonths) && incomeMonths.length > 0 ? incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
  const payDay = parseInt(incomePayDay, 10) || 1
  const acq = acquisitionDate ? new Date(`${acquisitionDate}T00:00:00Z`) : null
  if (acq && isNaN(acq.getTime())) return []

  const todayDay = today.getUTCDate()
  const curMonth = today.getUTCMonth()
  const curYear = today.getUTCFullYear()
  const lookback = acq
    ? Math.min(24, Math.ceil((today.getTime() - acq.getTime()) / (30 * 86400000)))
    : 3
  if (lookback < 0) return [] // acquisition date is in the future

  const acqDay = acquisitionDayISO(acquisitionDate)
  const dates = []
  for (let offset = lookback; offset >= 0; offset--) {
    const checkDate = new Date(Date.UTC(curYear, curMonth - offset, 1))
    const checkMonth = checkDate.getUTCMonth()
    const checkYear = checkDate.getUTCFullYear()
    if (!payMonths.includes(checkMonth)) continue
    // Contra el día YA recortado: con 31 configurado en un mes de 30, el
    // `todayDay < 31` de antes era siempre cierto y el mes en curso nunca pagaba.
    if (offset === 0 && todayDay < clampPayDay(payDay, checkYear, checkMonth)) continue
    const dateStr = payDateFor(checkYear, checkMonth, payDay)
    // FASE KS. Un pago NUNCA puede ser anterior al día de la compra.
    //
    // El guard viejo comparaba contra el PRIMERO DEL MES de la compra, así que
    // cualquier día de pago anterior dentro de ese mismo mes pasaba: comprando
    // el 20 de agosto con día de pago 1, la app ofrecía un pago del 1 de
    // agosto, o sea un mes entero de interés fechado ONCE DÍAS ANTES de tener
    // el activo (reportado con captura: $5,000 al 4% ofreciendo "~USD 16.67 el
    // 1 ago" sobre una compra del 20 ago). Comparar la fecha de pago YA armada
    // contra el día de compra es la regla que se quería desde el principio.
    if (acqDay && dateStr < acqDay) continue
    dates.push(dateStr)
  }
  return dates
}

// Un día ISO como número de día UTC. Por RECORTE DE TEXTO y nunca `new Date(s)`
// a secas: es la misma razón por la que existe `acquisitionDayISO` (el orden
// lexicográfico no se corrompe por zona horaria) y la regla que la cabecera de
// lib/financeMonth.js ya fija para todo este repo.
function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000
}

// La fecha de pago ANTERIOR del mismo calendario. Camina hacia atrás mes a mes
// hasta encontrar uno que esté en `payMonths`, así que funciona igual con un
// calendario mensual, trimestral, semestral o irregular ([0,1,5]) sin ninguna
// rama por caso.
export function previousPayDate(payDate, incomeMonths, incomePayDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(payDate || ''))
  if (!m) return null
  const year = Number(m[1])
  const monthIndex = Number(m[2]) - 1
  const payMonths = Array.isArray(incomeMonths) && incomeMonths.length > 0
    ? incomeMonths
    : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  // Hasta 12 pasos: un pagador ANUAL tiene su anterior exactamente un año atrás.
  for (let back = 1; back <= 12; back++) {
    const d = new Date(Date.UTC(year, monthIndex - back, 1))
    if (!payMonths.includes(d.getUTCMonth())) continue
    return payDateFor(d.getUTCFullYear(), d.getUTCMonth(), incomePayDay)
  }
  return null
}

// FASE KY. Qué fracción del PERÍODO estuvo el activo en manos del usuario.
//
// EL BUG: comprar el 20 de agosto con día de pago 1 acreditaba un mes COMPLETO
// el 1 de septiembre por once días de tenencia. FASE KS dejó el caso anotado y
// FASE KT lo cerró SOLO para devengo diario; las demás ramas de TASA seguían
// escribiendo el período entero. El día de compra ya llegaba al motor, pero
// solo como FILTRO de qué fechas existen: una vez que una fecha pasaba, el
// monto era el completo.
//
// La fracción es del PERÍODO y no del MES porque el período puede ser
// trimestral o semestral (las ramas dividen entre `payMonths.length`).
//
// Solo el PRIMER pago después de la compra puede quedar partido: en los
// siguientes la compra es anterior al inicio del período y la fracción da 1,
// así que la fórmula se limita sola y no hay que preguntarle a nadie "¿es este
// el primero?".
export function periodFraction({ payDate, acquisitionDay, incomeMonths, incomePayDay }) {
  if (!acquisitionDay || !payDate) return 1
  const end = dayNumber(payDate)
  const acq = dayNumber(acquisitionDay)
  if (end == null || acq == null) return 1
  if (acq <= 0 || acq >= end) return acq >= end ? 0 : 1

  const prev = previousPayDate(payDate, incomeMonths, incomePayDay)
  const start = dayNumber(prev)
  if (start == null || !(end > start)) return 1
  if (acq <= start) return 1
  return (end - acq) / (end - start)
}

// El monto de UN pago, en UN solo lugar.
//
// ⛔ POR QUÉ VIVE ACÁ Y NO EN CADA PANTALLA. La misma cascada de ramas estaba
// escrita en cuatro lugares y ya habían divergido: el motor de
// `useDashboardData` (5 ramas), esta estimación (4, sin `continuous`),
// `projectItemAnnualIncome` (6, con `incomeAmount` antes que `percent`) y
// `UpcomingDividends` (3, sin rama de devengo). Arreglar solo el motor dejaría
// la vista previa del alta y la tarjeta de próximos pagos contradiciendo al
// motor sobre el mismo activo.
//
// ⛔ QUÉ PRORRATEA Y QUÉ NO, y la razón está en las etiquetas de los dos
// modales. Las tres ramas del medio son una TASA SOBRE UN SALDO ("% anual del
// saldo", "Tasa mín/máx %", "Capitalización") y una tasa se gana por tiempo.
// La última es un MONTO FIJO CONTRACTUAL ("Monto fijo mensual", "Monto por
// pago"; el InfoTip dice "Fixed amount you receive each payment"): un cupón de
// bono se paga entero sin importar cuándo compraste, así que NO se prorratea.
// El usuario tecleó "esto es lo que recibo por pago" y reemplazarlo por una
// fracción calculada contradice lo que declaró. Lo confirma que
// `accrualAnnualRate` devuelve 0 en modo fijo y que el selector de devengo
// diario se esconde ahí a propósito.
export function monthlyIncomeAmount({
  balance, incomeMode, incomeRate, incomeAmount, rateType, rateMin, rateMax,
  isPerShare, qty, accrual, acquisitionDay, payDate, incomeMonths, incomePayDay,
}, payMonthsCount = 12) {
  const divisor = payMonthsCount || 12

  // FASE KT. Devengo diario: el monto de un mes depende de sus DIAS reales, no
  // de un doceavo parejo, asi que se calcula por fecha de pago. Ya prorratea el
  // mes de la compra por dentro (`acquisitionDay`), así que no lleva la
  // fracción de período de abajo. Sin `payDate` (callers viejos) se cae al
  // reparto de siempre.
  if (accrual === ACCRUAL_DAILY && payDate) {
    const y = Number(payDate.slice(0, 4))
    const m = Number(payDate.slice(5, 7)) - 1
    const rate = accrualAnnualRate({ rateType, rateMin, rateMax, incomeRate })
    if (rate > 0 && Number.isFinite(y) && Number.isFinite(m)) {
      return monthlyAccrual({ balance, annualRatePct: rate, year: y, monthIndex: m, acquisitionDay })
    }
  }

  const held = periodFraction({ payDate, acquisitionDay, incomeMonths, incomePayDay })

  if (rateType === 'variable' && rateMin > 0 && rateMax > 0) {
    return ((balance * (((rateMin + rateMax) / 2) / 100)) / divisor) * held
  }
  // Divide entre 12 fijo y no entre `divisor`: la capitalización continua
  // siempre escribe los doce meses (`incomeMonthsExplicit`), así que coinciden,
  // y cambiarlo movería el monto de un ítem mal configurado sin que nadie lo
  // pidiera.
  if (rateType === 'continuous' && incomeRate > 0) {
    return ((balance * (Math.exp(incomeRate / 100) - 1)) / 12) * held
  }
  if (incomeMode === 'percent' && incomeRate > 0) {
    return ((balance * (incomeRate / 100)) / divisor) * held
  }
  // Monto FIJO: sin fracción, a propósito (ver arriba).
  if (incomeAmount > 0) {
    return isPerShare ? incomeAmount * (qty || 1) : incomeAmount
  }
  return 0
}

// Same per-payment estimate the automatic engine computes (management fees
// aside — those aren't collected until the account already exists, in
// EditAccountModal). Used only to preview an approximate figure to the user;
// the real transaction amount is computed by processDividends at write time.
//
// Envoltura delgada sobre `monthlyIncomeAmount` para que la vista previa y el
// motor no puedan decir números distintos del mismo activo.
export function estimateIncomeAmount(fields, payMonthsCount = 12) {
  return monthlyIncomeAmount(fields, payMonthsCount)
}
