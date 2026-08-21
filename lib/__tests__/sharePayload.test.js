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
import { buildSharePayload, concentrationFrom, sanitizeDisplay, sanitizeLang, expiresAtFrom, shareTokenExpired } from '../sharePayload'
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
  // FASE KP: un deposito DENTRO de la ventana, para que la reconciliacion
  // (flows) tenga que filtrar algo real en el modo percent.
  { id: 'd1', type: 'DEPOSIT', date: '2026-03-01', totalAmount: 500, currency: 'USD' },
]

// Una fecha con DOS docs: la observacion de portafolio completo y el doc
// paralelo de NAV solo-broker (FASE FU). Dibujar los dos es el diente de sierra.
// El punto de abril es un DIP real: sin el la serie es monotona y maxDrawdown
// (que la matriz de modos tiene que poder gatear) no existiria en el fixture.
const SNAPSHOTS = [
  { id: '2026-01-02', date: '2026-01-02', netWorthUSD: 6800, rates: RATES, _source: 'daily' },
  { id: '2026-04-01', date: '2026-04-01', netWorthUSD: 6600, rates: RATES, _source: 'daily' },
  { id: '2026-06-01', date: '2026-06-01', netWorthUSD: 7000, rates: RATES, _source: 'daily' },
  { id: '2026-06-01~nav~ibkr', date: '2026-06-01', netWorthUSD: 1200, rates: RATES, _source: 'ibkr' },
  { id: '2026-08-20', date: '2026-08-20', netWorthUSD: 7240, rates: RATES, _source: 'daily' },
  // Un ancla de calibracion no es una observacion: no va a la serie.
  { id: '2026-07-01~cal', date: '2026-07-01', netWorthUSD: 99999, rates: RATES, _calibrated: true },
]

function makeReport({ items = ITEMS, snapshots = SNAPSHOTS, baseCurrency = 'USD', reportExtra = {} } = {}) {
  const convert = makeConvert(RATES, baseCurrency)
  const enriched = enrichItemsServerSide(items, {}, convert, baseCurrency)
  const { netWorth, totalAssets } = netWorthFromItems(enriched, {
    isExcluded: isExcludedFromNetWorth, getValue: getItemValue,
  })
  const report = buildReportData({
    items: enriched, transactions: TXS, snapshots,
    netWorth, totalAssets, baseCurrency, convert,
    profileName: 'Jan Marco', lang: 'en', period: 'ytd', now: NOW,
    ...reportExtra,
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
    const amounts = [netWorth, totalAssets, 6000, 7700, 1000, 240, 500]
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

  test('y NINGUNA seccion derivada de la serie viaja: flows sumaria depositos fuera del alcance', () => {
    // El contexto no filtra las transacciones por alcance, asi que `flows`
    // fuera del alcance 'all' publicaria depositos que el link no cubre. El
    // gate explicito hace imposible que un cambio del contexto lo filtre.
    const payload = buildSharePayload(makeReport().report, { hasSeries: false })
    expect(payload.performance).toEqual([])
    expect(payload.calendarYears).toEqual([])
    expect(payload.flows).toBeNull()
    expect(payload.maxDrawdown).toBeNull()
    expect(payload.kpis.valueChange).toBeUndefined()
    expect(payload.kpis.ytd).toBeUndefined()
    expect(payload.kpis.periodReturn).toBeUndefined()
    // La exposicion SI viaja: se deriva de los items en alcance, no de la serie.
    expect(payload.currencies.length).toBeGreaterThan(0)
  })
})

describe('FASE KP: el hero gana retorno desde el camino del SERVIDOR', () => {
  test('sin cifras del hook, kpis.ytd y sinceStart salen de las filas de performance (misma cifra)', () => {
    // makeReport NO pasa returnYTD/returnSinceStart: este ES el camino del
    // servidor. Antes el hero del link real salia sin retorno porque
    // k.ytd/k.sinceStart son passthroughs del hook (null aca); los fixtures de
    // FASE KK los pasaban a mano y el arnes no lo vio (leccion GQ3).
    const payload = buildSharePayload(makeReport().report, {})
    const ytdRow = payload.performance.find((r) => r.key === 'ytd')
    expect(ytdRow).toBeTruthy()
    expect(payload.kpis.ytd?.pct).toBe(ytdRow.pct)
    expect(typeof payload.kpis.ytd.pct).toBe('number')
    const allRow = payload.performance.find((r) => r.key === 'all')
    expect(payload.kpis.sinceStart?.pct).toBe(allRow.pct)
    // La fecha de "desde el inicio" se deriva del ancla real de la serie.
    expect(payload.kpis.sinceStart.date).toBe('2026-01-02')
  })

  test('cuando el hook SI manda, su cifra gana (el contrato de siempre)', () => {
    const { report } = makeReport({ reportExtra: { returnYTD: 1.23, ytdChange: 86 } })
    const payload = buildSharePayload(report, {})
    expect(payload.kpis.ytd.pct).toBe(1.23)
    expect(payload.kpis.ytd.abs).toBe(86)
  })
})

describe('FASE KP: la matriz de modos sobre las secciones nuevas', () => {
  test("'both': performance y reconciliacion completas, con montos", () => {
    const payload = buildSharePayload(makeReport().report, {})
    expect(payload.performance.length).toBeGreaterThan(0)
    expect(payload.performance.every((r) => typeof r.pct === 'number')).toBe(true)
    // La reconciliacion: el deposito de 500 y el cupon de 240 del fixture.
    expect(payload.flows.deposits).toBeCloseTo(500, 6)
    expect(payload.flows.withdrawals).toBe(0)
    expect(payload.flows.net).toBeCloseTo(500, 6)
    expect(payload.flows.incomeCollected).toBeCloseTo(240, 6)
    expect(payload.flows.depositCount).toBe(1)
    expect(payload.kpis.valueChange).toBeTruthy()
    expect(typeof payload.kpis.periodReturn?.pct).toBe('number')
    expect(payload.maxDrawdown.pct).toBeLessThan(0)
    // Exposicion por MONEDA ORIGINAL: el fondo en quetzales aparece como GTQ.
    expect(payload.currencies.map((c) => c.key)).toEqual(expect.arrayContaining(['USD', 'GTQ']))
    expect(payload.currencies.every((c) => typeof c.value === 'number' && typeof c.pct === 'number')).toBe(true)
    expect(payload.geography.length).toBeGreaterThan(0)
  })

  test("'amounts': el rendimiento se omite ENTERO, el dinero se queda", () => {
    const payload = buildSharePayload(makeReport().report, { display: 'amounts' })
    expect(payload.performance).toEqual([])
    expect(payload.calendarYears).toEqual([])
    expect(payload.maxDrawdown).toBeNull()
    expect(payload.kpis.periodReturn).toBeUndefined()
    expect(payload.flows.deposits).toBeCloseTo(500, 6)
    expect(payload.kpis.valueChange).toBeTruthy()
  })

  test("'percent': el rendimiento viaja SIN un solo monto; flows y valueChange se omiten enteros", () => {
    const payload = buildSharePayload(makeReport().report, { display: 'percent' })
    expect(payload.flows).toBeNull()
    expect(payload.kpis.valueChange).toBeUndefined()
    expect(payload.performance.length).toBeGreaterThan(0)
    expect(payload.performance.every((r) => r.abs === undefined && typeof r.pct === 'number')).toBe(true)
    expect(payload.calendarYears.every((c) => c.abs === undefined)).toBe(true)
    expect(payload.kpis.periodReturn.abs).toBeUndefined()
    // La maxima caida es rendimiento (pct + fechas), no un monto: sobrevive.
    expect(payload.maxDrawdown.pct).toBeLessThan(0)
    expect(payload.currencies.every((c) => c.value === undefined && typeof c.pct === 'number')).toBe(true)
    expect(payload.geography.every((g) => g.value === undefined)).toBe(true)
  })
})

describe('FASE KP: asesor e idioma', () => {
  test('advisor viaja en los TRES modos: es identidad del emisor, no del portafolio', () => {
    const advisor = { firm: 'IDC Valores', phone: '+502 5555 5555', email: 'a@idc.gt' }
    for (const display of ['both', 'amounts', 'percent']) {
      const payload = buildSharePayload(makeReport().report, { display, advisor })
      expect(payload.advisor).toEqual(advisor)
    }
  })

  test('advisor basura se sanea POR CAMPO; vacio del todo viaja null; claves extra no sobreviven', () => {
    const payload = buildSharePayload(makeReport().report, {
      advisor: { firm: 123, phone: '   ', email: 'a@b.c', extra: 'nope' },
    })
    expect(payload.advisor).toEqual({ firm: null, phone: null, email: 'a@b.c' })
    expect(payload.advisor.extra).toBeUndefined()
    expect(buildSharePayload(makeReport().report, { advisor: { firm: 42 } }).advisor).toBeNull()
    expect(buildSharePayload(makeReport().report, {}).advisor).toBeNull()
  })

  test('sanitizeLang: solo es/en, y un valor desconocido cae a es', () => {
    expect(sanitizeLang('en')).toBe('en')
    expect(sanitizeLang('es')).toBe('es')
    expect(sanitizeLang('xx')).toBe('es')
    expect(sanitizeLang(undefined)).toBe('es')
    expect(buildSharePayload(makeReport().report, {}).lang).toBe('es')
    expect(buildSharePayload(makeReport().report, { lang: 'en' }).lang).toBe('en')
  })
})

describe('FASE KP: ciclo de vida del token', () => {
  test('expiresAtFrom: indefinido por default; solo las tres vigencias reales producen fecha', () => {
    const now = new Date('2026-08-21T00:00:00Z')
    expect(expiresAtFrom('never', now)).toBeNull()
    expect(expiresAtFrom(undefined, now)).toBeNull()
    expect(expiresAtFrom('basura', now)).toBeNull()
    expect(expiresAtFrom('30d', now)).toBe(new Date(now.getTime() + 30 * 86400000).toISOString())
    expect(expiresAtFrom('90d', now)).toBe(new Date(now.getTime() + 90 * 86400000).toISOString())
    expect(expiresAtFrom('1y', now)).toBe(new Date(now.getTime() + 365 * 86400000).toISOString())
  })

  test('shareTokenExpired: ausencia = nunca vence, asi los links viejos REVIVEN sin migracion', () => {
    const nowTs = Date.parse('2026-08-21T00:00:00Z')
    // Un token de la era del tope fijo solo lleva createdAt, aunque tenga mas
    // de 90 dias: con la regla nueva vive, que es la decision del usuario.
    expect(shareTokenExpired({ createdAt: '2024-01-01T00:00:00Z' }, nowTs)).toBe(false)
    expect(shareTokenExpired({}, nowTs)).toBe(false)
    expect(shareTokenExpired(null, nowTs)).toBe(false)
    expect(shareTokenExpired({ expiresAt: '2026-08-20T00:00:00Z' }, nowTs)).toBe(true)
    expect(shareTokenExpired({ expiresAt: '2026-08-22T00:00:00Z' }, nowTs)).toBe(false)
    // Un expiresAt ilegible NO mata el link: ese campo solo lo escribe
    // expiresAtFrom (ISO valido), y matar el link por un campo corrupto seria
    // mas destructivo que ignorarlo.
    expect(shareTokenExpired({ expiresAt: 'basura' }, nowTs)).toBe(false)
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
