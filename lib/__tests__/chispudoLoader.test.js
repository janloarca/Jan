import { ringColor, defaultMessage } from '@/components/ui/ChispudoLoader'

// FASE EU. Pins the loader's two pure contracts: which color each state
// draws the ring in, and the exact accessible text per state/language.
describe('ringColor', () => {
  it('error: text-negative', () => {
    expect(ringColor('error')).toBe('var(--text-negative)')
  })

  it('success: accent-green', () => {
    expect(ringColor('success')).toBe('var(--accent-green)')
  })

  it('every waiting state: brand blue, no separate color per waiting flavor', () => {
    expect(ringColor('initial-loading')).toBe('var(--accent-blue)')
    expect(ringColor('section-loading')).toBe('var(--accent-blue)')
    expect(ringColor('refreshing')).toBe('var(--accent-blue)')
  })
})

describe('defaultMessage', () => {
  it('initial-loading', () => {
    expect(defaultMessage('initial-loading', 'es')).toBe('Cargando Chispudo')
    expect(defaultMessage('initial-loading', 'en')).toBe('Loading Chispudo')
  })

  it('section-loading', () => {
    expect(defaultMessage('section-loading', 'es')).toBe('Cargando datos')
  })

  it('refreshing matches the wording the refresh button itself uses', () => {
    expect(defaultMessage('refreshing', 'es')).toBe('Actualizando datos')
    expect(defaultMessage('refreshing', 'en')).toBe('Updating data')
  })

  it('success', () => {
    expect(defaultMessage('success', 'es')).toBe('Listo')
  })

  it('error', () => {
    expect(defaultMessage('error', 'es')).toBe('No se pudo cargar')
  })
})
