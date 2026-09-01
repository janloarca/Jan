import { parseEquitySummary, unattributedEquityDates } from '@/lib/parsers/ibkrEquitySummary'
import { parseCashPositions, unattributedCashCurrencies } from '@/lib/parsers/ibkrCashReport'
import { parseXmlToData } from '@/lib/parsers/ibkrFlex'

const nav = (attrs) => `<EquitySummaryByReportDateInBase ${attrs} />`
const cash = (attrs) => `<CashReportCurrency ${attrs} />`

describe('unattributedEquityDates (FASE MP)', () => {
  // EL CASO. Dos cuentas, misma fecha, sin `accountId` porque la query no
  // seleccionó ese campo: comparten la llave vacía del dedupe, la primera gana,
  // y el NAV de la segunda desaparece del historial sin ningún aviso.
  it('marca la fecha cuando dos filas sin cuenta traen totales DISTINTOS', () => {
    const xml = nav('reportDate="20260120" total="10000" totalLong="10000" cash="0"')
      + nav('reportDate="20260120" total="7000" totalLong="7000" cash="0"')
    expect(unattributedEquityDates(xml)).toBe(1)
    // Y se confirma el daño que el aviso describe: el parser se queda con una.
    expect(parseEquitySummary(xml)).toEqual([
      { date: '2026-01-20', netWorthUSD: 10000, totalActivosUSD: 10000, totalDebtUSD: 0, _source: 'ibkr' },
    ])
  })

  // CONTROL NEGATIVO, y es el que impide gritar lobo en el caso COMÚN: un Flex
  // repite la misma fecha entre páginas con la fila IDÉNTICA, y ahí el dedupe
  // de siempre es correcto.
  it('una pagina repetida (fila identica) NO se marca', () => {
    const row = 'reportDate="20260120" total="10000" totalLong="10000" cash="0"'
    expect(unattributedEquityDates(nav(row) + nav(row))).toBe(0)
  })

  // CONTROL NEGATIVO: con el campo presente el dedupe por cuenta ya resuelve el
  // multi-cuenta (FASE KB) y no hay nada que avisar.
  it('con accountId presente no se marca nada, aunque haya dos cuentas', () => {
    const xml = nav('accountId="U111" reportDate="20260120" total="10000" totalLong="10000" cash="0"')
      + nav('accountId="U222" reportDate="20260120" total="7000" totalLong="7000" cash="0"')
    expect(unattributedEquityDates(xml)).toBe(0)
    // Control POSITIVO del arreglo de FASE KB: las dos cuentas SÍ suman.
    expect(parseEquitySummary(xml)[0].netWorthUSD).toBe(17000)
  })

  it('una sola cuenta sin el campo es el caso normal y no se marca', () => {
    const xml = nav('reportDate="20260120" total="10000" totalLong="10000" cash="0"')
      + nav('reportDate="20260121" total="10100" totalLong="10100" cash="0"')
    expect(unattributedEquityDates(xml)).toBe(0)
  })

  it('cuenta las FECHAS afectadas, no las filas', () => {
    const xml = nav('reportDate="20260120" total="10000" totalLong="10000" cash="0"')
      + nav('reportDate="20260120" total="7000" totalLong="7000" cash="0"')
      + nav('reportDate="20260121" total="10100" totalLong="10100" cash="0"')
      + nav('reportDate="20260121" total="7050" totalLong="7050" cash="0"')
    expect(unattributedEquityDates(xml)).toBe(2)
  })

  it('un xml vacio o sin la seccion no marca nada', () => {
    expect(unattributedEquityDates('')).toBe(0)
    expect(unattributedEquityDates(null)).toBe(0)
    expect(unattributedEquityDates('<FlexStatement></FlexStatement>')).toBe(0)
  })
})

describe('unattributedCashCurrencies (FASE MP)', () => {
  it('marca la moneda cuando dos filas sin cuenta traen saldos DISTINTOS', () => {
    const xml = cash('currency="USD" endingCash="5000"') + cash('currency="USD" endingCash="3000"')
    expect(unattributedCashCurrencies(xml)).toBe(1)
    // El daño: solo entra el primer saldo, el otro efectivo nunca aparece.
    expect(parseCashPositions(xml)).toHaveLength(1)
  })

  it('una pagina repetida (saldo identico) NO se marca', () => {
    const row = 'currency="USD" endingCash="5000"'
    expect(unattributedCashCurrencies(cash(row) + cash(row))).toBe(0)
  })

  it('con accountId presente no se marca nada', () => {
    const xml = cash('accountId="U111" currency="USD" endingCash="5000"')
      + cash('accountId="U222" currency="USD" endingCash="3000"')
    expect(unattributedCashCurrencies(xml)).toBe(0)
    // Control POSITIVO: con el campo, las dos cuentas SÍ entran por separado.
    expect(parseCashPositions(xml)).toHaveLength(2)
  })

  it('dos monedas distintas son el caso normal y no se marcan', () => {
    const xml = cash('currency="USD" endingCash="5000"') + cash('currency="EUR" endingCash="3000"')
    expect(unattributedCashCurrencies(xml)).toBe(0)
    expect(parseCashPositions(xml)).toHaveLength(2)
  })

  it('BASE_SUMMARY y saldo cero se ignoran, igual que en el parser', () => {
    const xml = cash('currency="BASE_SUMMARY" endingCash="5000"')
      + cash('currency="BASE_SUMMARY" endingCash="3000"')
      + cash('currency="USD" endingCash="0"')
    expect(unattributedCashCurrencies(xml)).toBe(0)
  })
})

describe('la forense del reporte lo publica (FASE MP)', () => {
  it('parseXmlToData expone los dos conteos en sections', () => {
    const xml = '<FlexStatement>'
      + '<OpenPosition symbol="AAPL" position="10" markPrice="100" costBasisPrice="90" currency="USD" />'
      + nav('reportDate="20260120" total="10000" totalLong="10000" cash="0"')
      + nav('reportDate="20260120" total="7000" totalLong="7000" cash="0"')
      + cash('currency="USD" endingCash="5000"')
      + cash('currency="USD" endingCash="3000"')
      + '</FlexStatement>'
    const out = parseXmlToData(xml)
    expect(out.sections.unattributedEquityDates).toBe(1)
    expect(out.sections.unattributedCashCurrencies).toBe(1)
  })

  it('un reporte sano publica cero en los dos', () => {
    const xml = '<FlexStatement>'
      + '<OpenPosition symbol="AAPL" position="10" markPrice="100" costBasisPrice="90" currency="USD" />'
      + nav('accountId="U111" reportDate="20260120" total="10000" totalLong="10000" cash="0"')
      + cash('accountId="U111" currency="USD" endingCash="5000"')
      + '</FlexStatement>'
    const out = parseXmlToData(xml)
    expect(out.sections.unattributedEquityDates).toBe(0)
    expect(out.sections.unattributedCashCurrencies).toBe(0)
  })
})

// El aviso vive en JSX que jest no puede montar sin el modal entero con un
// archivo real, así que se fija LEYENDO LA FUENTE (precedente
// `ibkrImportGate.test.js`). No es cosmética: sin el aviso, el detector se
// computa, se publica en `sections` y no lo lee nadie, que es el patrón de
// "se escribe y nadie lo lee" que este repo ya pagó cuatro veces.
describe('el aviso del multi-cuenta llega a la pantalla (FASE MP)', () => {
  const fs = require('fs')
  const path = require('path')
  const modalSrc = fs.readFileSync(path.join(__dirname, '../../components/IBKRSyncModal.jsx'), 'utf8')

  it('el modal lee los DOS conteos', () => {
    expect(modalSrc).toContain('unattributedEquityDates')
    expect(modalSrc).toContain('unattributedCashCurrencies')
  })

  it('los usa como condición de render, no solo los menciona', () => {
    expect(modalSrc).toMatch(/unattributedEquityDates\s*\?\?\s*0\)\s*>\s*0/)
    expect(modalSrc).toMatch(/unattributedCashCurrencies\s*\?\?\s*0\)\s*>\s*0/)
  })

  it('el aviso nombra el arreglo real, que vive del lado del usuario', () => {
    const at = modalSrc.indexOf('unattributedEquityDates')
    const block = modalSrc.slice(at, at + 1400)
    expect(block).toMatch(/Select All/)
    expect(block).toMatch(/Flex Query/)
  })
})
