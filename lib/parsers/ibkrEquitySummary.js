// Parser for the IBKR Flex Query "Equity Summary" section — the daily portfolio NAV
// history (<EquitySummaryByReportDateInBase> rows). This is the ONLY source of real
// historical portfolio value; without this section a Flex Query imports positions but
// no value history, so YTD/ALL returns and the value chart start from today.
//
// Extracted from the route handler so it can be unit-tested (Next.js route files only
// allow HTTP-method / segment-config exports). Kept self-contained (own date helper).

import { decodeXmlEntities } from './xmlEntities'
import { normalizeFlexDate } from './flexDate'

// ⛔ La definición vive en `./flexDate`, compartida con `ibkrFlex`. Esta copia
// QUITABA el separador en vez de partir por él, así que un `reportDate` con hora
// (`20260120;120000`) daba `undefined` y la fila se descartaba: el historial de
// valor COMPLETO desaparecía, que es justo lo que la cabecera de este archivo
// dice que esta sección existe para traer. Se re-exporta con el mismo nombre
// porque los tests de este módulo ya lo importan de acá.
export { normalizeFlexDate }

// ⛔ FASE KB. El NAV diario, sumado a través de las CUENTAS que cubre el
// reporte.
//
// El defecto que reemplaza: un Flex multi-cuenta emite una fila por cuenta y
// por fecha, y el dedupe era POR FECHA a secas, así que se quedaba con la
// primera y tiraba el resto. Con dos cuentas de $10,000 y $7,000 el historial
// de valor decía $10,000: una cuenta entera desaparecía de la gráfica y de todo
// lo que se ancla en ese NAV (YTD, TWR, la composición diaria de FASE HN), sin
// ningún aviso y sin forma de notarlo salvo comparando contra el broker a mano.
//
// El dedupe sigue existiendo porque hace falta (un Flex repite la misma fecha
// entre páginas), solo que ahora la llave es cuenta+fecha, la misma forma que
// `parseCashPositions` ya usaba para el efectivo. Una cuenta repetida entre
// páginas sigue contando UNA vez; cuentas distintas suman.
//
// Supuesto anotado, no verificable desde acá (el proxy de salida bloquea
// interactivebrokers.com, ver FASE FX): un Flex trae las filas por cuenta O una
// consolidada, nunca las dos juntas. Si algún día trajera ambas, esto sumaría
// de más; el guardián contra eso sería que la consolidada llegara con un
// accountId propio, y ahí el número saltaría al doble, o sea sería visible de
// inmediato en vez de silencioso como el defecto que se arregla acá.
// Match the opening tag whether it is self-closing (<... />) or paired
// (<...>...</...>) — IBKR emits either shape depending on the report version, and
// every attribute we read lives on the opening tag. A `/>`-only regex silently
// dropped the entire NAV history for accounts whose Flex used the paired form.
//
// UNA sola definición para el parser y para el detector de FASE MP: con una
// copia por función, la que se quede atrás vigilaría una forma que ya nadie lee.
const EQUITY_TAG = /<EquitySummaryByReportDateInBase\b[^>]*>/g

function attrOf(tag) {
  return (name) => {
    const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'))
    // FASE KD: el valor viene con las entidades XML sin decodificar
    // (`AT&amp;T INC`). Se hace acá, una sola vez para todo atributo.
    return m ? decodeXmlEntities(m[1]) : ''
  }
}

export function parseEquitySummary(xml) {
  if (!xml) return []
  // date -> Map(accountId -> fila)
  const byDate = new Map()
  const regex = new RegExp(EQUITY_TAG.source, 'g')
  let match
  while ((match = regex.exec(xml)) !== null) {
    const attr = attrOf(match[0])
    const reportDate = attr('reportDate')
    const total = parseFloat(attr('total')) || 0
    const totalLong = parseFloat(attr('totalLong')) || 0
    const totalShort = parseFloat(attr('totalShort')) || 0
    const cash = parseFloat(attr('cash')) || 0
    if (!reportDate || total === 0) continue
    const date = normalizeFlexDate(reportDate)
    if (!date) continue
    let perAccount = byDate.get(date)
    if (!perAccount) { perAccount = new Map(); byDate.set(date, perAccount) }
    // Misma cuenta repetida entre páginas: la primera gana, igual que antes.
    const accountId = attr('accountId') || ''
    if (perAccount.has(accountId)) continue
    perAccount.set(accountId, {
      netWorthUSD: total,
      totalActivosUSD: totalLong + cash,
      totalDebtUSD: Math.abs(totalShort),
    })
  }
  const out = []
  for (const [date, perAccount] of byDate) {
    let netWorthUSD = 0
    let totalActivosUSD = 0
    let totalDebtUSD = 0
    for (const r of perAccount.values()) {
      netWorthUSD += r.netWorthUSD
      totalActivosUSD += r.totalActivosUSD
      totalDebtUSD += r.totalDebtUSD
    }
    out.push({ date, netWorthUSD, totalActivosUSD, totalDebtUSD, _source: 'ibkr' })
  }
  return out
}

// ⛔ FASE MP. La mitad que le faltaba al arreglo de FASE KB.
//
// Aquel dedupe por cuenta+fecha resuelve el multi-cuenta SOLO cuando el reporte
// trae el campo `accountId`, y ese campo es OPCIONAL: un Flex Query cuyos
// campos se eligieron a mano (en vez del "Select All" que las instrucciones
// piden desde FASE KE) emite las filas SIN él. Ahí las dos cuentas comparten la
// llave vacía, la primera gana, y el NAV de la otra desaparece: exactamente el
// defecto que KB vino a cerrar, entrando por la puerta de al lado.
//
// Por qué esto AVISA en vez de sumar. Sin `accountId` no se puede distinguir
// "dos cuentas" de "una cuenta más su fila consolidada", y esa segunda forma no
// es hipotética: el comentario de `parseCashPositions` ya la documenta como
// observada ("per-account plus summary detail rows"). Sumar ahí contaría el
// mismo dinero dos veces, que es peor que el defecto actual. Un lector que se
// equivoca sobre dinero es peor que uno que no existe: se DICE y se nombra el
// arreglo real, que está del lado del usuario (marcar el campo en la query).
//
// La firma exige valores DISTINTOS a propósito: un Flex repite la misma fecha
// entre páginas con la fila IDÉNTICA, y ahí el dedupe de arriba es correcto y
// avisar sería gritar lobo en el caso común. El residuo aceptado y dicho: dos
// cuentas con el MISMO NAV exacto ese día se leen como un repetido de página y
// no se avisan, porque con los datos presentes no hay forma de separarlas.
export function unattributedEquityDates(xml) {
  if (!xml) return 0
  const byDate = new Map()
  const regex = new RegExp(EQUITY_TAG.source, 'g')
  let match
  while ((match = regex.exec(xml)) !== null) {
    const attr = attrOf(match[0])
    if (attr('accountId')) continue
    const total = parseFloat(attr('total')) || 0
    const reportDate = attr('reportDate')
    if (!reportDate || total === 0) continue
    const date = normalizeFlexDate(reportDate)
    if (!date) continue
    if (!byDate.has(date)) byDate.set(date, new Set())
    byDate.get(date).add(total)
  }
  let dates = 0
  for (const totals of byDate.values()) if (totals.size > 1) dates++
  return dates
}
