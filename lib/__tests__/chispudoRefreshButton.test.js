import { progressColor, statusText } from '@/components/ui/ChispudoRefreshButton'

// FASE ET. Pins the two behavioral contracts the spec calls out by number:
// the percentage → color bands, and the four accessible status strings.
describe('progressColor', () => {
  it('0-24%: soft coral (text-negative at reduced opacity)', () => {
    expect(progressColor(0, false)).toEqual({ color: 'var(--text-negative)', opacity: 0.62 })
    expect(progressColor(24, false)).toEqual({ color: 'var(--text-negative)', opacity: 0.62 })
  })

  it('25-74%: amber, full intensity', () => {
    expect(progressColor(25, false)).toEqual({ color: 'var(--accent-orange)', opacity: 1 })
    expect(progressColor(74, false)).toEqual({ color: 'var(--accent-orange)', opacity: 1 })
  })

  it('75-99%: light/medium green (accent-green at reduced opacity)', () => {
    expect(progressColor(75, false)).toEqual({ color: 'var(--accent-green)', opacity: 0.72 })
    expect(progressColor(99, false)).toEqual({ color: 'var(--accent-green)', opacity: 0.72 })
  })

  it('100%: intense green, full opacity', () => {
    expect(progressColor(100, false)).toEqual({ color: 'var(--accent-green)', opacity: 1 })
  })

  it('null progress (indeterminate): brand blue, never a color-band guess', () => {
    expect(progressColor(null, false)).toEqual({ color: 'var(--accent-blue)', opacity: 1 })
  })

  it('error always wins, regardless of whatever percentage came with it', () => {
    expect(progressColor(80, true)).toEqual({ color: 'var(--text-negative)', opacity: 1 })
    expect(progressColor(null, true)).toEqual({ color: 'var(--text-negative)', opacity: 1 })
  })

  // The spec's own distinguishing signal between "just started" (soft) and
  // "error" (intense) is INTENSITY on the same hue — lock that relationship,
  // not just the two endpoint values, so a future edit can't quietly make
  // them the same color again.
  it('early-progress red is strictly softer than error red', () => {
    const early = progressColor(10, false)
    const error = progressColor(10, true)
    expect(early.color).toBe(error.color)
    expect(early.opacity).toBeLessThan(error.opacity)
  })
})

describe('statusText', () => {
  it('idle', () => {
    expect(statusText('idle', null, 'es')).toBe('Actualizar datos')
    expect(statusText('idle', null, 'en')).toBe('Refresh data')
  })

  it('loading with a known percentage', () => {
    expect(statusText('loading', 25, 'es')).toBe('Actualizando datos, 25%')
    expect(statusText('loading', 25, 'en')).toBe('Updating data, 25%')
  })

  it('loading indeterminate (no invented percentage in the announced text)', () => {
    expect(statusText('loading', null, 'es')).toBe('Actualizando datos')
    expect(statusText('loading', null, 'es')).not.toMatch(/%/)
  })

  it('success', () => {
    expect(statusText('success', 100, 'es')).toBe('Actualización completada')
  })

  it('error', () => {
    expect(statusText('error', null, 'es')).toBe('Error al actualizar')
    expect(statusText('error', null, 'en')).toBe('Update failed')
  })
})
