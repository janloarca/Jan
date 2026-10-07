import { PSEUDONYMS, genPseudonym } from '../friendsPseudonyms'

describe('seudónimos de Amigos', () => {
  it('son cien y ninguno se repite', () => {
    expect(PSEUDONYMS).toHaveLength(100)
    expect(new Set(PSEUDONYMS.map((s) => s.toLowerCase())).size).toBe(100)
  })
  it('nunca pasan del tope de 30 caracteres de la ruta, número incluido', () => {
    for (const s of PSEUDONYMS) expect(`${s} 99`.length).toBeLessThanOrEqual(30)
  })
  it('sin guion largo (regla de texto visible)', () => {
    for (const s of PSEUDONYMS) expect(s).not.toMatch(/—/)
  })
  it('genera "nombre número" con el sorteador recibido', () => {
    expect(genPseudonym(() => 0)).toBe(`${PSEUDONYMS[0]} 0`)
    expect(genPseudonym((n) => n - 1)).toBe(`${PSEUDONYMS[99]} 99`)
  })
})
