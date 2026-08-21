// FASE KK. Lo que un link compartido publica.
//
// Antes esta forma no existía: `app/api/share/route.js` mandaba los documentos
// CRUDOS de Firestore y `app/shared/[token]/page.jsx` los sumaba a mano. Eso la
// convertía en un TERCER generador de las mismas cifras, con los defectos que
// el resto de la app ya había arreglado en otro lado: sin conversión de moneda
// (un saldo en quetzales impreso con `$`), sin precios de mercado en vivo
// (`currentPrice` no se persiste por diseño, FASE EZ4), sin
// `isExcludedFromNetWorth`, con la gráfica dibujando los docs paralelos de NAV
// solo-broker al lado de los de portafolio completo (el diente de sierra), y
// con el retorno como `(último − primero) / primero` crudo, que es el error #3
// de la lógica congelada y el mismo `+1148.8%` que FASE HT sacó del PDF.
//
// Ahora el servidor manda CIFRAS y la página solo las dibuja. El motor es
// `buildReportData`, el mismo que alimenta el reporte PDF, así que el link y el
// PDF no pueden decir cosas distintas del mismo portafolio.
//
// ⚠️ Esto se PUBLICA: cualquiera con el link lo ve. Toda clave que se agregue
// acá sale del dominio del dueño. `lib/__tests__/sharePayload.test.js` fija el
// contrato, en particular que el modo 'percent' no emita un solo monto.

// Un link puede publicar montos, porcentajes, o las dos cosas.
//   'both'    todo (default)
//   'amounts' montos sí, rendimiento no
//   'percent' porcentajes sí, montos NO: no se emite ninguno.
//
// El modo 'percent' antes escalaba `quantity` y seis campos de precio por √k
// para que los ratios sobrevivieran al enmascarado. Con un payload calculado
// eso no hace falta: los montos simplemente no se emiten, que es más simple y
// más difícil de romper que una transformación que tiene que preservar
// exactamente las razones correctas.
export const DISPLAY_MODES = ['both', 'amounts', 'percent']

export function sanitizeDisplay(raw) {
  return DISPLAY_MODES.includes(raw) ? raw : 'both'
}

// FASE KP. El idioma del link lo elige el DUEÑO al crearlo (default español:
// el caso central es un asesor guatemalteco mandándoselo a su cliente) y el
// visitante puede alternarlo en la página. Un valor desconocido cae a 'es',
// nunca a un string arbitrario que la página interpolaría.
export const SHARE_LANGS = ['es', 'en']

export function sanitizeLang(raw) {
  return SHARE_LANGS.includes(raw) ? raw : 'es'
}

// FASE KP. La vigencia del link la elige el dueño al crearlo. Indefinida por
// default (decisión del usuario, y la norma de la industria: DocSend y los
// portales de asesores viven hasta revocarse): el as-of visible en la página y
// la revocación inmediata son lo que la vuelve segura, no un vencimiento.
// AUSENCIA de expiresAt = nunca vence, así los links viejos (que solo llevan
// createdAt) reviven sin migración, que es exactamente lo pedido.
export const SHARE_EXPIRIES = ['never', '30d', '90d', '1y']

export function expiresAtFrom(raw, now = new Date()) {
  const days = raw === '30d' ? 30 : raw === '90d' ? 90 : raw === '1y' ? 365 : null
  return days ? new Date(now.getTime() + days * 86400000).toISOString() : null
}

// ¿Este token ya venció? Sin expiresAt no vence jamás. Un expiresAt ilegible
// NO mata el link: ese campo solo lo escribe expiresAtFrom (ISO válido), así
// que basura ahí es un doc tocado a mano por el propio dueño, y matarle el
// link por un campo corrupto sería más destructivo que ignorarlo.
export function shareTokenExpired(tokenData, nowTs = Date.now()) {
  const raw = tokenData?.expiresAt
  if (!raw) return false
  const exp = Date.parse(raw)
  return isFinite(exp) && nowTs > exp
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null)

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

// La identidad del asesor que el link imprime ("Preparado por" + contacto).
// Se re-valida ACÁ aunque briefContext ya lo haya hecho: el payload es la
// frontera de lo que se publica, y una frontera no hereda confianza.
// Exportada porque el GET, en el camino de caché KV caliente, relee el perfil
// fresco y tiene que pasar por la MISMA frontera antes de publicarlo.
export function sanitizeAdvisor(raw) {
  if (!raw || typeof raw !== 'object') return null
  const firm = str(raw.firm, 120)
  const phone = str(raw.phone, 40)
  const email = str(raw.email, 120)
  return firm || phone || email ? { firm, phone, email } : null
}

// La serie en porcentaje, rebasada a su primer punto. Es lo que deja dibujar la
// misma forma sin publicar un solo valor: en 'percent' la gráfica sigue
// contando la historia y no dice cuánto dinero hay.
function rebasePct(series) {
  const first = series.find((p) => p.value > 0)
  if (!first) return []
  return series.map((p) => ({ ts: p.ts, date: p.date, pct: ((p.value - first.value) / first.value) * 100 }))
}

/**
 * Proyecta la salida de `buildReportData` a lo que el link publica.
 *
 * @param report  salida de buildReportData
 * @param opts.display        'both' | 'amounts' | 'percent'
 * @param opts.label          etiqueta del link (la escribe el dueño)
 * @param opts.scopeLabel     qué abarca ("Todo", "IDC", el nombre del portafolio)
 * @param opts.hasSeries      false en un link escopado: los snapshots son
 *                            patrimonio GLOBAL y no describen una rebanada
 * @param opts.incomeSources  [{ name, rateLabel, annual }] para la sección de ingresos
 * @param opts.degraded       true si alguna cotización no resolvió
 * @param opts.failedSymbols  cuáles, para poder decirlo en vez de callarlo
 * @param opts.advisor        { firm, phone, email } del dueño (ctx.advisor)
 * @param opts.lang           'es' | 'en', el idioma elegido al crear el link
 */
export function buildSharePayload(report, {
  display = 'both', label = null, scopeLabel = null, hasSeries = true,
  incomeSources = [], degraded = false, failedSymbols = [],
  advisor = null, lang = 'es',
} = {}) {
  const mode = sanitizeDisplay(display)
  const showAmounts = mode !== 'percent'
  const showPerf = mode !== 'amounts'

  const k = report?.kpis || {}
  const meta = report?.meta || {}
  const series = hasSeries ? (report?.series || []) : []

  const kpis = {}
  if (showAmounts) {
    kpis.netWorth = num(k.netWorth) ?? 0
    kpis.totalAssets = num(k.totalAssets) ?? 0
    kpis.debtTotal = num(k.debtTotal) ?? 0
  }
  kpis.holdingsCount = report?.holdings?.length || 0
  if (showPerf && hasSeries) {
    // El retorno del año y el de toda la vida salen del motor del reporte: son
    // Dietz sobre la serie archivada, con los flujos neteados. Nunca el cambio
    // crudo de valor, que lee un depósito como ganancia.
    //
    // FASE KP, el fix del hero: `k.ytd`/`k.sinceStart` son PASSTHROUGHS del
    // hook y en el servidor son null (el dashboard no corre ahí), así que el
    // link real salía sin retorno; mis fixtures de FASE KK los pasaban a mano
    // y por eso el arnés no lo vio (lección GQ3, otra vez). Las filas de
    // `performance` sí se computan en el servidor: cuando el hook no manda,
    // ellas son la fuente. Hay test que fija que el hero y la tabla dicen el
    // mismo número por construcción.
    const perfRows = Array.isArray(report?.performance) ? report.performance : []
    const rowOf = (key) => perfRows.find((r) => r.key === key && num(r.pct) != null) || null
    const ytdSrc = k.ytd && num(k.ytd.pct) != null ? k.ytd : rowOf('ytd')
    if (ytdSrc) kpis.ytd = { pct: num(ytdSrc.pct), ...(showAmounts ? { abs: num(ytdSrc.abs) } : {}) }
    const allSrc = k.sinceStart && num(k.sinceStart.pct) != null ? k.sinceStart : rowOf('all')
    if (allSrc) {
      kpis.sinceStart = {
        pct: num(allSrc.pct),
        date: allSrc.date || (num(allSrc.fromTs) != null ? new Date(allSrc.fromTs).toISOString().slice(0, 10) : null),
      }
    }
    // El retorno del PERÍODO del reporte (el route pide 'ytd'): pct siempre,
    // el monto solo cuando el modo publica montos.
    const pr = k.periodReturn
    if (pr && num(pr.pct) != null) {
      kpis.periodReturn = { pct: num(pr.pct), fromTs: num(pr.fromTs), ...(showAmounts ? { abs: num(pr.abs) } : {}) }
    }
  }
  if (showAmounts && hasSeries && k.valueChange) {
    // Cambio de VALOR del período: informativo, incluye flujos, y la página lo
    // etiqueta así. En 'percent' se omite entero: son montos.
    const vc = k.valueChange
    kpis.valueChange = { first: num(vc.first), firstTs: num(vc.firstTs), last: num(vc.last), lastTs: num(vc.lastTs), abs: num(vc.abs) }
  }

  const holdings = (report?.holdings || []).map((h) => ({
    id: h.id,
    name: h.name,
    symbol: h.symbol || null,
    type: h.type || null,
    weightPct: num(h.weightPct) ?? 0,
    ...(showAmounts ? { value: num(h.value) ?? 0 } : {}),
    // El retorno por posición es el de la fórmula congelada
    // (ganancia contra el principal más el ingreso que el activo GENERÓ,
    // dividido entre el costo total), no `(actual − compra) / compra`, que
    // imprime 0.0% sobre un bono que sí está pagando cupones.
    ...(showPerf ? { retPct: num(h.retPct) } : {}),
  }))

  const allocation = (report?.allocation || []).map((a) => ({
    cat: a.cat,
    count: a.count,
    pct: num(a.pct) ?? 0,
    ...(showAmounts ? { value: num(a.value) ?? 0 } : {}),
  }))

  const maturities = (report?.maturities || []).map((m) => ({
    name: m.name,
    date: m.date,
    days: m.days,
    ...(showAmounts ? { value: num(m.value) ?? 0 } : {}),
  }))

  const income = showAmounts
    ? {
      projectedAnnual: num(report?.income?.projectedAnnual) ?? 0,
      yieldPct: num(report?.income?.yieldPct),
      sources: incomeSources.map((s) => ({ name: s.name, rateLabel: s.rateLabel, annual: num(s.annual) })),
    }
    : {
      yieldPct: num(report?.income?.yieldPct),
      sources: incomeSources.map((s) => ({ name: s.name, rateLabel: s.rateLabel })),
    }

  // ── FASE KP: las secciones del orden institucional ──
  //
  // Todo lo derivado de la SERIE va gateado a `hasSeries` de forma explícita:
  // en un link escopado el contexto ni siquiera computa esas cifras (llegan
  // vacías), pero el gate hace imposible que un cambio futuro del contexto las
  // empiece a filtrar. Y `flows` suma TODAS las transacciones del dueño (el
  // contexto no las filtra por alcance), así que fuera del alcance 'all'
  // publicaría depósitos que el link no cubre: por eso comparte el gate.
  let performance = []
  let calendarYears = []
  let maxDrawdown = null
  let flows = null
  if (hasSeries && showPerf) {
    // Solo filas MEDIDAS: una fila de pct null es un "-" que en un documento
    // para clientes se lee como un dato roto, y el matiz de "sin ancla" ya lo
    // explica la página del dueño, no esta.
    performance = (Array.isArray(report?.performance) ? report.performance : [])
      .filter((r) => num(r.pct) != null)
      .map((r) => ({
        key: r.key, pct: num(r.pct), fromTs: num(r.fromTs),
        ...(r.annualized ? { annualized: true } : {}),
        ...(showAmounts ? { abs: num(r.abs) } : {}),
      }))
    calendarYears = (Array.isArray(report?.calendarYears) ? report.calendarYears : [])
      .filter((c) => num(c.pct) != null)
      .map((c) => ({ year: c.year, pct: num(c.pct), partial: !!c.partial, ...(showAmounts ? { abs: num(c.abs) } : {}) }))
    // La máxima caída es un porcentaje con dos fechas: viaja también en
    // 'percent' (es rendimiento, no un monto). Volatilidad/Sharpe/beta NO se
    // reenvían nunca: son solo-hook y en el servidor están en null.
    const dd = report?.risk?.maxDrawdown
    if (dd && num(dd.pct) != null) maxDrawdown = { pct: num(dd.pct), fromTs: num(dd.fromTs), toTs: num(dd.toTs) }
  }
  if (hasSeries && showAmounts) {
    // La reconciliación (inicio ± depósitos/retiros ± ingresos = final) es la
    // sección que PRUEBA la aritmética del estado. Son montos: en 'percent' se
    // omite entera, nunca se enmascara.
    const f = report?.flows
    if (f) {
      flows = {
        deposits: num(f.deposits) ?? 0,
        withdrawals: num(f.withdrawals) ?? 0,
        net: num(f.net) ?? 0,
        depositCount: f.depositCount || 0,
        withdrawalCount: f.withdrawalCount || 0,
        incomeCollected: num(f.incomeCollected) ?? 0,
        incomeCount: f.incomeCount || 0,
      }
    }
  }

  // Exposición por moneda (denominación ORIGINAL) y geografía: los porcentajes
  // viajan siempre, el monto solo cuando el modo publica montos. Sectores,
  // jurisdicciones, instituciones, deudas y fees NO se reenvían nunca (la
  // promesa del tab Compartir: "Nunca revelan la institución de tus activos").
  const exposureRows = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 8).map((r) => ({
    key: r.key, pct: num(r.pct) ?? 0, ...(showAmounts ? { value: num(r.value) ?? 0 } : {}),
  }))
  const currencies = exposureRows(report?.currencies)
  const geography = exposureRows(report?.geography)

  return {
    lang: sanitizeLang(lang),
    // La ficha del asesor viaja en TODOS los modos: es la identidad de quien
    // prepara el documento, no un dato del portafolio del cliente.
    advisor: sanitizeAdvisor(advisor),
    performance,
    calendarYears,
    maxDrawdown,
    flows,
    currencies,
    geography,
    display: mode,
    owner: meta.owner || '',
    asOf: num(meta.generatedTs),
    baseCurrency: meta.baseCurrency || 'USD',
    label: label || null,
    scopeLabel: scopeLabel || null,
    hasSeries,
    kpis,
    allocation,
    holdings,
    // En 'percent' la serie viaja rebasada: misma forma, cero montos.
    series: showAmounts
      ? series.map((p) => ({ ts: p.ts, date: p.date, value: num(p.value) ?? 0 }))
      : rebasePct(series),
    income,
    maturities,
    degraded: !!degraded,
    failedSymbols: degraded ? failedSymbols.slice(0, 10) : [],
  }
}

// El riesgo que la página muestra (concentración) se deriva ENTERO de los pesos
// que ya vienen en `holdings`, así que el conteo de posiciones de esta tarjeta y
// el del pie de la asignación no pueden volver a discrepar: hoy dicen 33 y 32
// porque cada uno cuenta sobre una lista distinta.
export function concentrationFrom(holdings = [], categoryCount = 0) {
  const weights = holdings.map((h) => h.weightPct || 0).filter((w) => w > 0).sort((a, b) => b - a)
  if (weights.length === 0) return null
  const hhi = weights.reduce((s, w) => s + w * w, 0)
  const largest = weights[0]
  const top3 = weights.slice(0, 3).reduce((s, w) => s + w, 0)

  let score = 100
  if (hhi > 5000) score -= 30
  else if (hhi > 2500) score -= 15
  if (largest > 50) score -= 25
  else if (largest > 30) score -= 10
  if (categoryCount < 3) score -= 20
  else if (categoryCount < 5) score -= 5

  return {
    score: Math.max(0, Math.min(100, score)),
    positions: weights.length,
    categories: categoryCount,
    largestPct: largest,
    top3Pct: top3,
  }
}
