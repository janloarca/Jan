// FASE II. La matemática del "Dividendo detectado", extraída del route para
// poder fijarla con tests. Dos bugs reales salieron de verificar 6 acciones de
// 5 mercados contra fuentes públicas (14 ago 2026):
//
//  1) RENDIMIENTO: "último pago × frecuencia" acierta solo en pagadores
//     PAREJOS (Shell, Microsoft, Meta: exactos al segundo decimal) y se rompe
//     en los DESIGUALES: Novo Nordisk paga un interino chico (DKK 3.75) y un
//     final grande (DKK 7.95), así que duplicar el último dio 2.53% en
//     Copenhague y 5.55% en Nueva York PARA LA MISMA EMPRESA, cuando la
//     verdad es 3.95% en ambas. La convención correcta (y la estándar de los
//     sitios financieros) es sumar lo REALMENTE pagado en los últimos 12
//     meses (TTM), que ya viene en el historial de 3 años que el route trae.
//
//  2) FECHA: la proyección sumaba meses con setMonth(), que DESBORDA: un
//     ex-date el 30 de noviembre + 3 meses caía en "2 de septiembre" (30 feb
//     no existe y JS lo corre), y el corrimiento quedaba para siempre.
//     La suma correcta es por componentes, con el día recortado al último día
//     real del mes destino (la convención de clampPayDay en incomeSchedule).

const DAY_MS = 86400000

const tsOf = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime())

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

// Suma de dividendos por acción realmente pagados en los últimos ~12 meses.
// Devuelve null cuando el historial no alcanza para responder con hechos:
//  - sin ningún pago dentro de la ventana (pagador que dejó de pagar: mejor
//    que el caller decida con su extrapolación de siempre), o
//  - el historial COMPLETO es más joven que ~11 meses (una empresa que empezó
//    a pagar hace poco: la suma TTM subestimaría el año a rate actual, y ahí
//    la extrapolación por frecuencia es el mejor estimado disponible).
export function ttmAnnualDividend(divList, nowMs = Date.now()) {
  if (!Array.isArray(divList) || divList.length === 0) return null
  const yearAgo = nowMs - 365.25 * DAY_MS
  const ttm = divList.filter((d) => {
    const t = tsOf(d.date)
    return isFinite(t) && t > yearAgo && t <= nowMs
  })
  if (ttm.length === 0) return null
  const oldest = tsOf(divList[0].date)
  // ~11 meses: un pagador anual con historial de justo un año no debe caer al
  // fallback por unos días de margen entre ex-dates.
  if (!isFinite(oldest) || oldest > nowMs - 330 * DAY_MS) return null
  const sum = ttm.reduce((s, d) => s + (Number(d.amount) || 0), 0)
  return sum > 0 ? sum : null
}

// Próxima fecha proyectada sumando meses por COMPONENTES (año/mes/día), con el
// día recortado al último día real del mes destino: día 30 o 31 significa "el
// fin del mes", nunca un desborde al mes siguiente.
export function projectNextDate(lastDateMs, monthsApart, nowMs = Date.now()) {
  const last = new Date(lastDateMs)
  if (isNaN(last.getTime())) return null
  const step = Math.max(1, Number(monthsApart) || 3)
  let y = last.getUTCFullYear()
  let m = last.getUTCMonth()
  const day = last.getUTCDate()
  let cur = Date.UTC(y, m, Math.min(day, daysInMonth(y, m)))
  // Techo holgado: un pagador mensual con historial desde 1900 son ~1,520
  // pasos legítimos; el guard existe para basura (NaN ya filtrado arriba, o
  // un step que no avanza), no para fechas viejas reales.
  let guard = 0
  while (cur <= nowMs && guard < 5000) {
    m += step
    y += Math.floor(m / 12)
    m = ((m % 12) + 12) % 12
    cur = Date.UTC(y, m, Math.min(day, daysInMonth(y, m)))
    guard++
  }
  if (guard >= 5000) return null
  return new Date(cur).toISOString().split('T')[0]
}
