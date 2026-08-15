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

  const dates = []
  for (let offset = lookback; offset >= 0; offset--) {
    const checkDate = new Date(Date.UTC(curYear, curMonth - offset, 1))
    const checkMonth = checkDate.getUTCMonth()
    const checkYear = checkDate.getUTCFullYear()
    if (acq && checkDate < new Date(Date.UTC(acq.getUTCFullYear(), acq.getUTCMonth(), 1))) continue
    if (!payMonths.includes(checkMonth)) continue
    // Contra el día YA recortado: con 31 configurado en un mes de 30, el
    // `todayDay < 31` de antes era siempre cierto y el mes en curso nunca pagaba.
    if (offset === 0 && todayDay < clampPayDay(payDay, checkYear, checkMonth)) continue
    dates.push(payDateFor(checkYear, checkMonth, payDay))
  }
  return dates
}

// Same per-payment estimate the automatic engine computes (management fees
// aside — those aren't collected until the account already exists, in
// EditAccountModal). Used only to preview an approximate figure to the user;
// the real transaction amount is computed by processDividends at write time.
export function estimateIncomeAmount({ balance, incomeMode, incomeRate, incomeAmount, rateType, rateMin, rateMax, isPerShare, qty }, payMonthsCount = 12) {
  const divisor = payMonthsCount || 12
  if (rateType === 'variable' && rateMin > 0 && rateMax > 0) {
    return (balance * (((rateMin + rateMax) / 2) / 100)) / divisor
  }
  if (incomeMode === 'percent' && incomeRate > 0) {
    return (balance * (incomeRate / 100)) / divisor
  }
  if (incomeAmount > 0) {
    return isPerShare ? incomeAmount * (qty || 1) : incomeAmount
  }
  return 0
}
