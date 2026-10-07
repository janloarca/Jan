import { deltaE } from '../colorMath'
import { ARCHETYPE_ACCENT, accentOf } from '../worldPalette'
import { ARCHETYPES } from '../worldModel'

test('todo arquetipo tiene acento propio', () => {
  for (const a of ARCHETYPES) expect(ARCHETYPE_ACCENT[a]).toMatch(/^#[0-9A-F]{6}$/i)
  expect(accentOf('NO_EXISTE')).toBe(ARCHETYPE_ACCENT.GENERIC_CORPORATE)
})

test('los tres acentos nuevos no se confunden con ninguno existente', () => {
  const existing = Object.entries(ARCHETYPE_ACCENT).filter(([k]) => !['FUND_HALL', 'SOVEREIGN', 'DIGITAL_VAULT'].includes(k))
  for (const k of ['FUND_HALL', 'SOVEREIGN', 'DIGITAL_VAULT']) {
    const nearest = Math.min(...existing.map(([, h]) => deltaE(ARCHETYPE_ACCENT[k], h)))
    expect(nearest).toBeGreaterThanOrEqual(9)
  }
})

test('agregar acentos no empeora el par mas cercano que ya existia', () => {
  const entries = Object.entries(ARCHETYPE_ACCENT)
  let min = Infinity
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) min = Math.min(min, deltaE(entries[i][1], entries[j][1]))
  // ENERGY/REAL_ESTATE ya estaban a 5.4 antes de FASE PR; ese es el piso.
  expect(min).toBeGreaterThanOrEqual(5.4)
})
