// ⛔ FASE LF. El guardian de COMPORTAMIENTO de la frontera del año calendario.
//
// Va en pareja con `lib/__tests__/yearBoundaryUtc.test.js`, que es el guardian
// de FUENTE, y no se solapan: aquel caza el PATRON (`new Date(y,0,1)`) en una
// lista fija de modulos, incluso en uno que no tenga tests de valores; este
// caza la CONSECUENCIA, que es lo unico que atrapa un desajuste en un archivo
// que esa lista no contemple. Borrar uno no deja cubierto lo del otro.
//
// El defecto que ambos persiguen: los bordes del año se calculaban con
// `new Date(year, 0, 1)` (hora LOCAL) mientras todo lo que se compara contra
// ellos es UTC (el `ts` de un snapshot, la fecha de una transaccion, los
// limites de `computeYtdInvested`). En UTC las dos formas dan el MISMO
// instante, asi que coincidian por casualidad y en cualquier otra zona no.
//
// La zona la fija `jest.config.js` (America/Guatemala), NO este archivo:
// dentro de jsdom, asignar `process.env.TZ` en caliente no surte efecto porque
// el contexto ya tiene su Date con la zona cacheada. Verificado: un archivo que
// lo asignaba en su primera linea seguia corriendo en UTC, o sea sus tests
// pasaban sin probar nada. El primer test de abajo es el que cierra ese hueco.

import { calendarYearGain, computeInvestedByYear } from '../investedByYear'
import { computeYtdInvested } from '../ytdInvested'

const convert = (a) => a

// Anclas en los bordes EXACTOS. Un snapshot se fecha a medianoche UTC, asi que
// el punto del 1 de enero cae justo sobre el borde: el caso limite.
const series = [
  { ts: Date.parse('2025-01-01'), value: 10000 },
  { ts: Date.parse('2025-12-31'), value: 11500 },
  { ts: Date.parse('2026-01-01'), value: 12000 },
  { ts: Date.parse('2026-12-31'), value: 13000 },
]

// El caso frontera: un deposito fechado EXACTO el 1 de enero.
const eneroUno = [{ type: 'DEPOSIT', date: '2026-01-01', totalAmount: 1000, currency: 'USD' }]

// META-TEST, y es el que sostiene a todos los demas de este archivo.
//
// Si la suite corriera en UTC, `new Date(y,0,1)` y `Date.UTC(y,0,1)` serian el
// MISMO instante y los tests de abajo pasarian con el bug adentro: no probarian
// nada. Este test falla si alguien devuelve la suite a UTC, y entonces el
// mensaje dice por que importa.
test('la suite NO corre en UTC, o los tests de abajo no prueban nada', () => {
  const local = new Date(2026, 0, 1).getTime()
  if (local === Date.UTC(2026, 0, 1)) {
    throw new Error(
      'La suite esta corriendo en UTC, y en UTC este archivo no prueba NADA: ' +
      '`new Date(y,0,1)` y `Date.UTC(y,0,1)` son el mismo instante, asi que los ' +
      'tests de abajo pasan con el bug adentro. Revisa que jest.config.js siga ' +
      'fijando una zona distinta de UTC, y que el entorno (CI) no la este ' +
      'pisando con TZ=UTC. Para revisar el otro lado del meridiano usa una zona ' +
      'real: TZ=Asia/Tokyo npx jest.'
    )
  }
  expect(local).not.toBe(Date.UTC(2026, 0, 1))
})

describe('los bordes del anio no dependen de la zona del usuario', () => {
  // El cierre de 2025 tiene que ser el 31 de DICIEMBRE (11500), nunca el
  // snapshot del 1 de enero de 2026 (12000), que es la apertura del anio que
  // entra. Con hora local ese punto se colaba y la ganancia salia mal.
  test('el cierre de un anio es el 31 de diciembre, no el 1 de enero siguiente', () => {
    const g = calendarYearGain({ series, year: 2025, transactions: [], convert, baseCurrency: 'USD' })
    expect(g.endValue).toBe(11500)
    expect(g.startValue).toBe(10000)
    expect(g.abs).toBeCloseTo(1500, 6)
  })

  // Y el corolario: un deposito del 1 de enero de 2026 NO puede tocar la
  // ganancia de 2025. Antes se le restaba entera.
  test('un deposito del 1 de enero no se descuenta del anio anterior', () => {
    const g = calendarYearGain({ series, year: 2025, transactions: eneroUno, convert, baseCurrency: 'USD' })
    expect(g.abs).toBeCloseTo(1500, 6)
  })

  // Las dos columnas de la tabla tienen que estar de acuerdo sobre a que anio
  // pertenece ese dinero: invertido en 2026, y dentro del valor de apertura de
  // 2026 (o sea sin descontarse de su ganancia tampoco).
  test('invertido y ganancia coinciden sobre a que anio pertenece', () => {
    expect(computeYtdInvested({ transactions: eneroUno, items: [], year: 2025, convert, baseCurrency: 'USD' }).invested).toBe(0)
    expect(computeYtdInvested({ transactions: eneroUno, items: [], year: 2026, convert, baseCurrency: 'USD' }).invested).toBeCloseTo(1000, 6)
    const g26 = calendarYearGain({ series, year: 2026, transactions: eneroUno, convert, baseCurrency: 'USD' })
    // El deposito vive DENTRO del ancla del 1 de enero (regla de FASE DV), asi
    // que no se netea otra vez: 13000 - 12000.
    expect(g26.startValue).toBe(12000)
    expect(g26.abs).toBeCloseTo(1000, 6)
  })

  // La tabla completa: las mismas filas que se verian desde UTC.
  test('la tabla completa no cambia de forma segun la zona', () => {
    const r = computeInvestedByYear({
      transactions: eneroUno, items: [], series, convert, baseCurrency: 'USD',
      nowTs: Date.parse('2027-06-01'),
    })
    const y2025 = r.rows.find((x) => x.year === 2025)
    const y2026 = r.rows.find((x) => x.year === 2026)
    expect(y2025.gainAbs).toBeCloseTo(1500, 6)
    expect(y2025.invested).toBe(0)
    expect(y2026.gainAbs).toBeCloseTo(1000, 6)
    expect(y2026.invested).toBeCloseTo(1000, 6)
  })
})
