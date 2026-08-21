import { decodeXmlEntities } from '../parsers/xmlEntities'
import { parseFlexPositions, parseTrades, parseCashTransactions } from '../parsers/ibkrFlex'

describe('decodeXmlEntities (FASE KD)', () => {
  it('decodifica las cinco entidades nombradas', () => {
    expect(decodeXmlEntities('AT&amp;T INC')).toBe('AT&T INC')
    expect(decodeXmlEntities('&lt;a&gt;')).toBe('<a>')
    expect(decodeXmlEntities('&quot;x&quot;')).toBe('"x"')
    expect(decodeXmlEntities('O&apos;NEIL')).toBe("O'NEIL")
  })

  it('&amp; se decodifica AL FINAL: `&amp;lt;` es el texto literal `&lt;`', () => {
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;')
  })

  it('referencias numericas, decimales y hexadecimales', () => {
    expect(decodeXmlEntities('J&#38;J')).toBe('J&J')
    expect(decodeXmlEntities('J&#x26;J')).toBe('J&J')
  })

  it('deja intacto lo que no puede representar en vez de producir basura', () => {
    expect(decodeXmlEntities('&#0;')).toBe('&#0;')
    expect(decodeXmlEntities('&#99999999;')).toBe('&#99999999;')
    expect(decodeXmlEntities('&noesunaentidad;')).toBe('&noesunaentidad;')
  })

  it('sin & no toca nada, y tolera valores que no son texto', () => {
    expect(decodeXmlEntities('AT T INC')).toBe('AT T INC')
    expect(decodeXmlEntities('')).toBe('')
    expect(decodeXmlEntities(undefined)).toBeUndefined()
    expect(decodeXmlEntities(null)).toBeNull()
  })
})

describe('los parsers Flex ya no dejan pasar el texto crudo', () => {
  const xml = `
    <OpenPosition accountId="U1" conid="1234" symbol="T" description="AT&amp;T INC" position="10" markPrice="20" costBasisPrice="18" currency="USD" assetCategory="STK" />
    <Trade accountId="U1" symbol="BRK.B" description="BERKSHIRE HATHAWAY &amp; CO" tradeDate="20260115" buySell="BUY" quantity="1" tradePrice="100" currency="USD" assetCategory="STK" />
    <CashTransaction accountId="U1" type="Deposits/Withdrawals" description="WIRE FROM J&amp;J TRUST" amount="100" currency="USD" dateTime="20260115" />
  `

  it('el nombre de una posicion (lo que el usuario ve en su portafolio)', () => {
    expect(parseFlexPositions(xml)[0].name).toBe('AT&T INC')
  })

  it('la descripcion de un trade', () => {
    expect(parseTrades(xml)[0].description).toBe('BERKSHIRE HATHAWAY & CO')
  })

  it('la descripcion de un movimiento de efectivo', () => {
    expect(parseCashTransactions(xml)[0].description).toBe('WIRE FROM J&J TRUST')
  })

  it('los numeros y las fechas no cambian', () => {
    const p = parseFlexPositions(xml)[0]
    expect(p.quantity).toBe(10)
    expect(p.currentPrice).toBe(20)
    expect(parseTrades(xml)[0].tradeDate).toBe('2026-01-15')
  })
})
