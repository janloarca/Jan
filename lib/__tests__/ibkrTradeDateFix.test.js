import { staleTradeDateFixes } from '../ibkrTradeDateFix'
import { parseTrades } from '../parsers/ibkrFlex'

const trade = (over = {}) => ({
  id: 'doc1', _source: 'ibkr', type: 'BUY', symbol: 'AAPL', date: '20260115',
  quantity: 10, totalAmount: 1500, ...over,
})

describe('staleTradeDateFixes', () => {
  it('re-sella un trade de IBKR con la fecha cruda', () => {
    const [fix] = staleTradeDateFixes([trade()])
    expect(fix.oldId).toBe('doc1')
    expect(fix.tx.date).toBe('2026-01-15')
    // Sin id: bulkImport deriva el nuevo con su propio esquema.
    expect(fix.tx.id).toBeUndefined()
    // Todo lo demás viaja intacto.
    expect(fix.tx).toMatchObject({ symbol: 'AAPL', type: 'BUY', quantity: 10, totalAmount: 1500 })
  })

  it('no toca lo que ya está en ISO', () => {
    expect(staleTradeDateFixes([trade({ date: '2026-01-15' })])).toEqual([])
  })

  it('no toca movimientos manuales aunque tengan fecha rara', () => {
    expect(staleTradeDateFixes([trade({ _source: 'manual_new_account' })])).toEqual([])
    expect(staleTradeDateFixes([trade({ _source: undefined })])).toEqual([])
  })

  it('no toca depósitos ni retiros (esos ya pasaban por formatDate)', () => {
    expect(staleTradeDateFixes([trade({ type: 'DEPOSIT' })])).toEqual([])
    expect(staleTradeDateFixes([trade({ type: 'DIVIDEND' })])).toEqual([])
  })

  it('deja como está una fecha que no entiende, en vez de borrarla', () => {
    expect(staleTradeDateFixes([trade({ date: '15/01/2026' })])).toEqual([])
    expect(staleTradeDateFixes([trade({ date: 'ayer' })])).toEqual([])
  })

  it('ignora una transacción sin id (no se puede borrar la vieja)', () => {
    expect(staleTradeDateFixes([trade({ id: undefined })])).toEqual([])
  })

  it('tolera basura sin explotar', () => {
    expect(staleTradeDateFixes(null)).toEqual([])
    expect(staleTradeDateFixes([null, undefined, {}])).toEqual([])
  })

  it('maneja la forma con hora que IBKR también emite', () => {
    const [fix] = staleTradeDateFixes([trade({ date: '20260115;103000' })])
    expect(fix.tx.date).toBe('2026-01-15')
  })
})

describe('parseTrades ya no produce fechas crudas', () => {
  it('normaliza tradeDate en el parser, que es donde nacía el problema', () => {
    const xml = '<Trade symbol="AAPL" buySell="BUY" quantity="10" tradePrice="150" proceeds="-1500" tradeDate="20260115" accountId="U1" />'
    const [t] = parseTrades(xml)
    expect(t.tradeDate).toBe('2026-01-15')
    // La prueba de que el bug se cerró: la fecha ahora ES parseable.
    expect(Number.isFinite(new Date(t.tradeDate).getTime())).toBe(true)
  })

  it('cae a dateTime cuando no hay tradeDate, y también lo normaliza', () => {
    const xml = '<Trade symbol="MSFT" buySell="SELL" quantity="1" tradePrice="10" dateTime="20260220;153000" />'
    const [t] = parseTrades(xml)
    expect(t.tradeDate).toBe('2026-02-20')
  })

  it('conserva el crudo si el formato es desconocido, para no inventar una fecha', () => {
    const xml = '<Trade symbol="X" buySell="BUY" quantity="1" tradePrice="1" tradeDate="15/01/2026" />'
    const [t] = parseTrades(xml)
    expect(t.tradeDate).toBe('15/01/2026')
  })
})
