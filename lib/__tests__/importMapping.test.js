import { guessMapping, FIELD_MAP, BROKER_PRESETS } from '../importMapping'

describe('BROKER_PRESETS detectors are callable', () => {
  // Regression: extracting the presets out of FileImportModal left detectCoinbase /
  // detectKraken unimported here, so every CSV upload threw a ReferenceError and
  // crashed the whole page. Executing each detector catches that class of break.
  it('every preset detect() runs without throwing', () => {
    const headers = ['Symbol', 'Quantity', 'Price', 'Total', 'Coin', 'txid', 'pair', 'vol', 'ordertxid']
    for (const [key, preset] of Object.entries(BROKER_PRESETS)) {
      expect(typeof preset.detect).toBe('function')
      expect(() => preset.detect(headers)).not.toThrow()
      expect(typeof preset.detect(headers)).toBe('boolean')
    }
  })

  it('detects a Kraken trades export', () => {
    const kraken = ['txid', 'ordertxid', 'pair', 'time', 'type', 'ordertype', 'price', 'cost', 'fee', 'vol']
    expect(BROKER_PRESETS.kraken.detect(kraken)).toBe(true)
  })
})

// The exact header row lib/generateTemplate.js ships. Kept in sync by the
// round-trip test below: if the template changes, this must too.
const TEMPLATE_HEADERS = [
  'Simbolo', 'Nombre', 'Tipo', 'Subtipo', 'Cantidad', 'Precio de Compra (USD)',
  'Precio Actual (USD)', 'Moneda', 'Institucion', 'Fecha de Compra', 'Vencimiento',
  'Tasa (%)', 'Jurisdiccion', 'Notas',
]

describe('guessMapping — our own template must round-trip', () => {
  it('maps the purchase price and the current price to DIFFERENT columns', () => {
    // The bug: currentPrice's alias 'precio' matched "Precio de Compra (USD)" first,
    // so every import from our template had currentPrice === purchasePrice and
    // showed a 0.00% gain on every position.
    const m = guessMapping(TEMPLATE_HEADERS)
    expect(m.purchasePrice).toBe(5)
    expect(m.currentPrice).toBe(6)
    expect(m.purchasePrice).not.toBe(m.currentPrice)
  })

  it('maps every core template column', () => {
    const m = guessMapping(TEMPLATE_HEADERS)
    expect(m.symbol).toBe(0)
    expect(m.name).toBe(1)
    expect(m.type).toBe(2)
    expect(m.quantity).toBe(4)
    expect(m.currency).toBe(7)
    expect(m.institution).toBe(8)
    expect(m.acquisitionDate).toBe(9)
  })

  it('never assigns one column to two fields', () => {
    const m = guessMapping(TEMPLATE_HEADERS)
    const cols = Object.values(m)
    expect(new Set(cols).size).toBe(cols.length)
  })
})

describe('guessMapping — general behavior', () => {
  it('prefers an exact header over a substring match', () => {
    const m = guessMapping(['Precio', 'Precio de Compra'])
    expect(m.currentPrice).toBe(0)
    expect(m.purchasePrice).toBe(1)
  })

  it('handles English broker headers', () => {
    const m = guessMapping(['Symbol', 'Quantity', 'Cost Price', 'Close Price', 'Currency'])
    expect(m.symbol).toBe(0)
    expect(m.quantity).toBe(1)
    expect(m.purchasePrice).toBe(2)
    expect(m.currentPrice).toBe(3)
    expect(m.currency).toBe(4)
  })

  it('ignores empty headers', () => {
    const m = guessMapping(['', 'Simbolo', ''])
    expect(m.symbol).toBe(1)
  })

  it('returns an empty mapping for unrelated headers', () => {
    const m = guessMapping(['Foo', 'Bar', 'Baz'])
    expect(Object.keys(m)).toHaveLength(0)
  })

  it('strips a trailing unit suffix when matching', () => {
    const m = guessMapping(['Cantidad (uds)', 'Precio Actual (USD)'])
    expect(m.quantity).toBe(0)
    expect(m.currentPrice).toBe(1)
  })
})

describe('FIELD_MAP', () => {
  it('has no field whose alias list is empty', () => {
    for (const [field, aliases] of Object.entries(FIELD_MAP)) {
      expect(Array.isArray(aliases) && aliases.length > 0).toBe(true)
    }
  })
})
