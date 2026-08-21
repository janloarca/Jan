/**
 * @jest-environment node
 */
// FASE KK. Lo que un link compartido PUBLICA, ejercitando el motor real
// (buildReportData) y no una version hecha a mano de sus salidas.
//
// Las capturas del usuario mostraban una pagina que se contradecia a si misma:
// Net Worth $63,375 con la grafica etiquetada $27,320, "+830.2%" all-time,
// "33 positions" al lado de "32 Positions", y bonos que si pagan cupones
// imprimiendo "+0.0%". Cada caso de abajo fija uno de esos defectos.

import { buildReportData } from '../reportData'
import { buildSharePayload, concentrationFrom, sanitizeDisplay } from '../sharePayload'
import { makeConvert, enrichItemsServerSide, netWorthFromItems } from '../serverPortfolio'
import { getItemValue, isExcludedFromNetWorth } from '../../components/dashboard/utils'

const NOW = new Date('2026-08-21T12:00:00Z')
const RATES = { USD: 1, GTQ: 7.7 }

// Un portafolio con las formas que rompian la pagina vieja:
//  - un bono en USD que PAGA cupones (su retorno no puede salir 0.0%)
//  - un saldo en QUETZALES (no puede sumarse como si fueran dolares)
//  - una cuenta por cobrar EXCLUIDA del patrimonio a proposito
const ITEMS = [
  { id: 'bond', name: 'VITALI', type: 'Bond', institution: 'IDC', currency: 'USD', quantity: 1, purchasePrice: 6000, currentPrice: 6000, entryFee: 98, incomeRate: 8 },
  { id: 'q', name: 'FONDO LIQUIDO Q', type: 'Bank', institution: 'IDC', currency: 'GTQ', quantity: 1, purchasePrice: 7700, currentPrice: 7700 },
  { id: 'lent', name: 'Prestamo a un amigo', type: 'Receivable', isReceivable: true, currency: 'USD', quantity: 1, currentPrice: 5000 },
]

const TXS = [
  // El cupon que el bono GENERO: la formula congelada lo suma al numerador.
  { id: 'c1', type: 'DIVIDEND', date: '2026-05-15', totalAmount: 240, currency: 'USD', _linkedItemId: 'bond' },
]

// Una fecha con DOS docs: la observacion de portafolio completo y el doc
// paralelo de NAV solo-broker (FASE FU). Dibujar los dos es el diente de sierra.
const SNAPSHOTS = [
  { id: '2026-01-02', date: '2026-01-02', netWorthUSD: 6800, rates: RATES, _source: 'daily' },
  { id: '2026-06-01', date: '2026-06-01', netWorthUSD: 7000, rates: RATES, _source: 'daily' },
  { id: '2026-06-01~nav~ibkr', date: '2026-06-01', netWorthUSD: 1200, rates: RATES, _source: 'ibkr' },
  { id: '2026-08-20', date: '2026-08-20', netWorthUSD: 7240, rates: RATES, _source: 'daily' },
  // Un ancla de calibracion no es una observacion: no va a la serie.
  { id: '2026-07-01~cal', date: '2026-07-01', netWorthUSD: 99999, rates: RATES, _calibrated: true },
]

function makeReport({ items = ITEMS, snapshots = SNAPSHOTS, baseCurrency = 'USD' } = {}) {
  const convert = makeConvert(RATES, baseCurrency)
  const enriched = enrichItemsServerSide(items, {}, convert, baseCurrency)
  const { netWorth, totalAssets } = netWorthFromItems(enriched, {
    isExcluded: isExcludedFromNetWorth, getValue: getItemValue,
  })
  const report = buildReportData({
    items: enriched, transactions: TXS, snapshots,
    netWorth, totalAssets, baseCurrency, convert,
    profileName: 'Jan Marco', lang: 'en', period: 'ytd', now: NOW,
  })
  return { report, netWorth, totalAssets, convert }
}

// Recorre el payload entero y devuelve toda clave numerica, con su ruta.
function numericKeys(obj, path = '', out = []) {
  if (obj == null) return out
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => numericKeys(v, `${path}[${i}]`, out))
    return out
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) numericKeys(v, path ? `${path}.${k}` : k, out)
    return out
  }
  if (typeof obj === 'number') out.push({ path, value: obj })
  return out
}

describe('el patrimonio que publica el link', () => {
  test('un saldo en quetzales se convierte, no se suma como si fueran dolares', () => {
    const { netWorth } = makeReport()
    // 6,000 del bono + 7,700 GTQ (= 1,000 USD) = 7,000. Sin conversion serian
    // 13,700, que es la forma del salto a $63K de la captura.
    expect(netWorth).toBeCloseTo(7000, 2)
  })

  test('una cuenta por cobrar EXCLUIDA no entra al patrimonio', () => {
    const { report } = makeReport()
    // El prestamo de 5,000 esta marcado isReceivable sin countInNetWorth.
    expect(report.kpis.netWorth).toBeCloseTo(7000, 2)
    expect(report.holdings.some((h) => h.id === 'lent')).toBe(false)
  })

  test('las partes suman el todo: allocation, holdings y el conteo publicado', () => {
    const payload = buildSharePayload(makeReport().report, {})
    const allocSum = payload.allocation.reduce((s, a) => s + a.value, 0)
    const holdSum = payload.holdings.reduce((s, h) => s + h.value, 0)
    expect(allocSum).toBeCloseTo(holdSum, 2)
    // El conteo del pie de la asignacion sale de la MISMA lista que el de la
    // tarjeta de concentracion: en la captura decian 33 y 32.
    const conc = concentrationFrom(payload.holdings, payload.allocation.length)
    expect(payload.kpis.holdingsCount).toBe(conc.positions)
  })
})

describe('el retorno por posicion usa la formula congelada', () => {
  test('un bono que paga cupones NO sale en 0.0%', () => {
    const { report } = makeReport()
    const bond = report.holdings.find((h) => h.id === 'bond')
    // (valor - principal) + ingreso = (6000 - 6000) + 240 = 240
    // 240 / 6098 = 3.94%, el numero que fija la logica congelada. La formula
    // vieja de la pagina, (actual - compra) / compra, da exactamente 0.
    expect(bond.retPct).toBeCloseTo(3.94, 2)
    // La fila publicada NO lleva precios crudos (ver "no se cuela ninguna clave
    // de item crudo"), asi que la formula vieja se reproduce sobre el ITEM de
    // origen: da exactamente 0 sobre un bono que rindio 3.94%.
    const src = ITEMS.find((it) => it.id === 'bond')
    expect((src.currentPrice - src.purchasePrice) / src.purchasePrice).toBe(0)
  })
})

describe('la serie que alimenta la grafica', () => {
  test('un dia con doc paralelo de NAV aporta UN punto, no dos', () => {
    const { report } = makeReport()
    const jun = report.series.filter((p) => p.date === '2026-06-01')
    expect(jun).toHaveLength(1)
    // Y es la observacion de portafolio COMPLETO, no el NAV de una sola cuenta.
    expect(jun[0].value).toBeGreaterThan(1200)
  })

  test('un ancla de calibracion no es una observacion y no entra', () => {
    const { report } = makeReport()
    expect(report.series.some((p) => p.value === 99999)).toBe(false)
  })

  test('la serie sale ordenada por fecha', () => {
    const { report } = makeReport()
    const ts = report.series.map((p) => p.ts)
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
  })
})

describe('el modo percent no publica un solo monto', () => {
  test('ninguna clave numerica del payload puede ser un monto', () => {
    const { report, netWorth, totalAssets } = makeReport()
    const payload = buildSharePayload(report, { display: 'percent' })

    // Ninguna de las claves de dinero existe.
    expect(payload.kpis.netWorth).toBeUndefined()
    expect(payload.kpis.totalAssets).toBeUndefined()
    expect(payload.kpis.debtTotal).toBeUndefined()
    expect(payload.holdings.every((h) => h.value === undefined)).toBe(true)
    expect(payload.allocation.every((a) => a.value === undefined)).toBe(true)
    expect(payload.maturities.every((m) => m.value === undefined)).toBe(true)
    expect(payload.income.projectedAnnual).toBeUndefined()
    expect(payload.income.sources.every((s) => s.annual === undefined)).toBe(true)
    // La serie viaja rebasada a porcentaje: misma forma, cero valores.
    expect(payload.series.every((p) => p.value === undefined && typeof p.pct === 'number')).toBe(true)

    // Y el barrido completo: ningun numero del payload puede coincidir con una
    // cifra de dinero real del portafolio. Esto es lo que atrapa una clave
    // nueva que alguien agregue despues sin acordarse de este modo.
    const amounts = [netWorth, totalAssets, 6000, 7700, 1000, 240]
    for (const { path, value } of numericKeys(payload)) {
      if (path.startsWith('asOf')) continue // un timestamp no es un monto
      for (const amt of amounts) {
        expect(Math.abs(value - amt) > 0.005 || amt === 0).toBe(true)
      }
    }
  })

  test('el porcentaje SI sobrevive: es lo que ese modo existe para mostrar', () => {
    const payload = buildSharePayload(makeReport().report, { display: 'percent' })
    expect(payload.holdings.some((h) => typeof h.retPct === 'number')).toBe(true)
    expect(payload.allocation.every((a) => typeof a.pct === 'number')).toBe(true)
  })

  test("el modo 'amounts' esconde el rendimiento y conserva el dinero", () => {
    const payload = buildSharePayload(makeReport().report, { display: 'amounts' })
    expect(payload.holdings.every((h) => h.retPct === undefined)).toBe(true)
    expect(payload.kpis.ytd).toBeUndefined()
    expect(payload.kpis.sinceStart).toBeUndefined()
    expect(payload.kpis.netWorth).toBeGreaterThan(0)
  })

  test('un display desconocido cae a both, nunca a algo mas permisivo', () => {
    expect(sanitizeDisplay('percent')).toBe('percent')
    expect(sanitizeDisplay('nope')).toBe('both')
    expect(sanitizeDisplay(undefined)).toBe('both')
  })
})

describe('un link escopado no publica la historia global', () => {
  test('sin serie, el payload la trae vacia y lo dice', () => {
    const payload = buildSharePayload(makeReport().report, { hasSeries: false })
    expect(payload.hasSeries).toBe(false)
    expect(payload.series).toEqual([])
  })
})

describe('lo que el payload identifica', () => {
  test('lleva dueno, fecha de corte y moneda: quien abre el link puede situarlo', () => {
    const payload = buildSharePayload(makeReport().report, { scopeLabel: 'IDC' })
    expect(payload.owner).toBe('Jan Marco')
    expect(typeof payload.asOf).toBe('number')
    expect(payload.baseCurrency).toBe('USD')
    expect(payload.scopeLabel).toBe('IDC')
  })

  test('no se cuela ninguna clave de item crudo', () => {
    const payload = buildSharePayload(makeReport().report, {})
    const leaky = ['quantity', 'qty', 'purchasePrice', 'currentPrice', 'cost', 'averagePrice', 'costBasis', 'institution']
    for (const h of payload.holdings) {
      for (const k of leaky) expect(h[k]).toBeUndefined()
    }
  })
})

describe('concentrationFrom', () => {
  test('cuenta solo posiciones con peso, y el top 3 nunca excede el total', () => {
    const c = concentrationFrom([{ weightPct: 50 }, { weightPct: 30 }, { weightPct: 20 }, { weightPct: 0 }], 3)
    expect(c.positions).toBe(3)
    expect(c.largestPct).toBe(50)
    expect(c.top3Pct).toBe(100)
  })

  test('sin posiciones devuelve null en vez de un puntaje inventado', () => {
    expect(concentrationFrom([], 0)).toBeNull()
  })
})
