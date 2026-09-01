import { normalizeFlexDate } from '@/lib/parsers/flexDate'
import { formatDate, parseCashTransactions, parseTrades } from '@/lib/parsers/ibkrFlex'
import { normalizeFlexDate as fromEquity, parseEquitySummary } from '@/lib/parsers/ibkrEquitySummary'

// ⛔ FASE MH. Una fecha que no se entiende NO deja un hueco visible: deja un
// movimiento AUSENTE, porque todo caller descarta la fila. Estos tests fijan las
// dos formas que fallaban y, sobre todo, que las dos superficies comparten UNA
// definición: eran dos copias y cada una fallaba con un separador distinto.
describe('normalizeFlexDate: partir por el separador, nunca quitarlo', () => {
  it('las formas que YA funcionaban quedan idénticas', () => {
    expect(normalizeFlexDate('20260120')).toBe('2026-01-20')
    expect(normalizeFlexDate('2026-01-15')).toBe('2026-01-15')
    expect(normalizeFlexDate('2026-01-15 10:30:00')).toBe('2026-01-15')
    expect(normalizeFlexDate('2026-01-20, 12:00:00')).toBe('2026-01-20')
  })

  // El caso que rompía `formatDate`: sin espacio, la coma se QUITABA y la hora
  // quedaba pegada ('20260120120000', 14 dígitos), que no matchea ninguna forma.
  it('compacta con COMA: la que perdía los cash transactions', () => {
    expect(normalizeFlexDate('20260120,120000')).toBe('2026-01-20')
  })

  // El caso que rompía `normalizeFlexDate`: quitaba también el punto y coma, o
  // sea el NAV diario del broker desaparecía entero.
  it('compacta con PUNTO Y COMA: la que perdía el historial de valor', () => {
    expect(normalizeFlexDate('20260120;120000')).toBe('2026-01-20')
  })

  // Adivinar una fecha archiva dinero real contra el día equivocado: preferimos
  // el hueco, que además se ve.
  it('lo que no se entiende NO se adivina', () => {
    expect(normalizeFlexDate('basura')).toBeUndefined()
    expect(normalizeFlexDate('')).toBeUndefined()
    expect(normalizeFlexDate(null)).toBeUndefined()
    expect(normalizeFlexDate(undefined)).toBeUndefined()
    expect(normalizeFlexDate('01/20/2026')).toBeUndefined()
  })

  // La razón de ser del módulo: si vuelven a ser dos implementaciones, esto falla.
  it('las dos superficies comparten la MISMA definición', () => {
    expect(formatDate).toBe(normalizeFlexDate)
    expect(fromEquity).toBe(normalizeFlexDate)
  })
})

// El daño no es que la fecha salga mal: es que la FILA no existe. Estos tests
// corren los parsers REALES, que es donde el defecto se paga.
describe('el movimiento sobrevive de punta a punta', () => {
  it('un depósito con separador de coma se importa, no se descarta', () => {
    const xml = '<CashTransactions><CashTransaction accountId="U1" currency="USD" amount="5000" '
      + 'type="Deposits/Withdrawals" dateTime="20260120,120000" transactionID="T1" description="WIRE" /></CashTransactions>'
    const out = parseCashTransactions(xml)
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(5000)
    expect(out[0].date).toBe('2026-01-20')
    expect(out[0].kind).toBe('flow')
  })

  it('un día de NAV con separador de punto y coma se importa', () => {
    const xml = '<EquitySummaryByReportDateInBase reportDate="20260120;120000" total="10000" '
      + 'totalLong="10000" totalShort="0" accountId="U1" />'
    const out = parseEquitySummary(xml)
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-20')
    expect(out[0].netWorthUSD).toBe(10000)
  })

  it('un trade con separador de coma conserva su fecha', () => {
    const xml = '<Trade accountId="U1" symbol="AAPL" quantity="10" tradePrice="100" '
      + 'buySell="BUY" tradeDate="20260120,120000" tradeID="X1" assetCategory="STK" currency="USD" />'
    const out = parseTrades(xml)
    expect(out).toHaveLength(1)
    expect(out[0].tradeDate).toBe('2026-01-20')
  })

  // Control POSITIVO: sin él, los tres de arriba podrían pasar porque el parser
  // no encuentra NADA y devuelve [] por otra razón.
  it('control: la forma que siempre funcionó sigue funcionando', () => {
    const xml = '<CashTransactions><CashTransaction accountId="U1" currency="USD" amount="5000" '
      + 'type="Deposits/Withdrawals" dateTime="20260120" transactionID="T2" description="WIRE" /></CashTransactions>'
    const out = parseCashTransactions(xml)
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe('2026-01-20')
  })
})
