import {
  ringColor, defaultMessage, loadingSteps, stepIndexAt, slowMessage, offlineMessage,
  STEP_FIRST_MS, STEP_EVERY_MS, SLOW_AFTER_MS,
} from '@/components/ui/ChispudoLoader'

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
  it('initial-loading nombra QUE se carga, no el producto', () => {
    expect(defaultMessage('initial-loading', 'es')).toBe('Cargando tu portafolio')
    expect(defaultMessage('initial-loading', 'en')).toBe('Loading your portfolio')
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

// FASE JC. La copia escalonada del splash y su regla de avance.
describe('stepIndexAt', () => {
  const N = loadingSteps('es').length

  it('antes del primer paso no muestra nada, en vez de arrancar hablando', () => {
    expect(stepIndexAt(0, N)).toBe(-1)
    expect(stepIndexAt(STEP_FIRST_MS - 1, N)).toBe(-1)
  })

  it('avanza un paso por intervalo', () => {
    expect(stepIndexAt(STEP_FIRST_MS, N)).toBe(0)
    expect(stepIndexAt(STEP_FIRST_MS + STEP_EVERY_MS, N)).toBe(1)
    expect(stepIndexAt(STEP_FIRST_MS + 2 * STEP_EVERY_MS, N)).toBe(2)
  })

  // Volver de "casi listo" a "trayendo precios" haría retroceder el avance
  // percibido, que es peor que quedarse en la última línea honesta.
  it('se queda en el último paso y NUNCA vuelve a empezar', () => {
    expect(stepIndexAt(STEP_FIRST_MS + 3 * STEP_EVERY_MS, N)).toBe(N - 1)
    expect(stepIndexAt(STEP_FIRST_MS + 50 * STEP_EVERY_MS, N)).toBe(N - 1)
  })

  it('sin pasos no hay índice que mostrar', () => {
    expect(stepIndexAt(999999, 0)).toBe(-1)
  })

  // Los tres pasos y el aviso de lentitud comparten UNA sola línea, así que si
  // el aviso llega antes que el último paso, ese paso queda escrito y nunca
  // visible. Este test es el que fija esa relación entre las tres constantes.
  it('los tres pasos alcanzan a verse antes del aviso de lentitud', () => {
    const lastStepAt = STEP_FIRST_MS + (N - 1) * STEP_EVERY_MS
    expect(lastStepAt).toBeLessThan(SLOW_AFTER_MS)
    expect(SLOW_AFTER_MS - lastStepAt).toBeGreaterThanOrEqual(1000)
  })
})

describe('copia del splash', () => {
  it('los pasos van en el orden real del trabajo, y existen en los dos idiomas', () => {
    expect(loadingSteps('en')).toEqual([
      'Fetching live prices…', 'Loading your assets…', 'Almost ready…',
    ])
    expect(loadingSteps('es')).toHaveLength(3)
    expect(loadingSteps('es')[0]).not.toBe(loadingSteps('en')[0])
  })

  it('lento y sin conexión dicen cosas distintas: uno sigue esperando, el otro no puede', () => {
    expect(slowMessage('en')).toBe('Taking a bit longer than usual.')
    expect(offlineMessage('en').title).toBe('No internet connection')
    expect(offlineMessage('es').title).toBe('Sin conexión a internet')
    expect(offlineMessage('en').hint).toBeTruthy()
  })

  // Regla del repo: prohibido el guión largo en texto visible.
  it('ninguna cadena visible usa guión largo', () => {
    const all = [
      ...loadingSteps('es'), ...loadingSteps('en'),
      slowMessage('es'), slowMessage('en'),
      offlineMessage('es').title, offlineMessage('es').hint,
      offlineMessage('en').title, offlineMessage('en').hint,
      defaultMessage('initial-loading', 'es'), defaultMessage('initial-loading', 'en'),
    ]
    all.forEach((s) => expect(s).not.toContain('—'))
  })
})
