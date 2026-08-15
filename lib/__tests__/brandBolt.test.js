import { BOLT_PATH, BOLT_VIEWBOX, boltStrokeWidth } from '../brandBolt'

describe('brandBolt', () => {
  it('exposes a non-empty path and a square viewBox', () => {
    expect(typeof BOLT_PATH).toBe('string')
    expect(BOLT_PATH.length).toBeGreaterThan(0)
    expect(BOLT_VIEWBOX).toBe('0 0 24 24')
  })

  describe('boltStrokeWidth', () => {
    it('uses a thicker relative stroke at small (favicon/button) sizes, so rounding stays visible', () => {
      expect(boltStrokeWidth(16)).toBeGreaterThan(boltStrokeWidth(40))
    })

    it('is stable at the exact 24px boundary', () => {
      expect(boltStrokeWidth(24)).toBe(boltStrokeWidth(20))
      expect(boltStrokeWidth(25)).toBe(boltStrokeWidth(40))
    })
  })
})
