import {
  resist, pullProgress, isReady, shouldClaim,
  PULL_THRESHOLD_PX, MAX_PULL_PX, DIRECTION_LOCK_PX,
} from '@/lib/pullToRefresh'

// FASE JE. El gesto de jalar para refrescar.

describe('resist', () => {
  it('no hay tirón hacia arriba: solo cuenta lo que baja', () => {
    expect(resist(0)).toBe(0)
    expect(resist(-50)).toBe(0)
    expect(resist(-1)).toBe(0)
  })

  it('crece con el dedo pero SATURA: nunca pasa el techo', () => {
    expect(resist(10_000)).toBeLessThan(MAX_PULL_PX)
    expect(resist(1e9)).toBeLessThan(MAX_PULL_PX)
    // Y es monótona: más dedo nunca da menos indicador.
    let prev = 0
    for (let dy = 1; dy < 2000; dy += 17) {
      const cur = resist(dy)
      expect(cur).toBeGreaterThanOrEqual(prev)
      prev = cur
    }
  })

  it('cerca del origen el indicador avanza MENOS que el dedo (se siente elástico)', () => {
    expect(resist(50)).toBeLessThan(50)
    expect(resist(100)).toBeLessThan(100)
  })

  // Este es EL test de la curva. La primera version saturaba desde cero y
  // pedia ~429px de recorrido para armarse: monotona, acotada y correcta en
  // todo lo demas, pero inusable con el pulgar. Lo destapo el navegador, no
  // este archivo, porque la cota de antes ("< 600px") era demasiado floja.
  it('armar el gesto cuesta un tirón de pulgar, no media pantalla', () => {
    let dy = 0
    while (dy < 2000 && resist(dy) < PULL_THRESHOLD_PX) dy += 1
    expect(dy).toBeGreaterThan(80)   // no se dispara solo al empezar a scrollear
    expect(dy).toBeLessThan(200)     // y se alcanza sin recolocar la mano
  })

  it('hasta el umbral sigue al dedo de forma LINEAL (predecible mientras se puede cancelar)', () => {
    // Dos tramos iguales antes del umbral avanzan lo mismo.
    const a = resist(40) - resist(20)
    const b = resist(60) - resist(40)
    expect(a).toBeCloseTo(b, 6)
  })

  it('y pasado el umbral se amortigua (deja de seguir al dedo 1 a 1)', () => {
    const beforeStep = resist(100) - resist(80)
    const afterStep = resist(400) - resist(380)
    expect(afterStep).toBeLessThan(beforeStep)
  })
})

describe('pullProgress / isReady', () => {
  it('llega a 1 EXACTAMENTE en el umbral y no lo pasa', () => {
    expect(pullProgress(PULL_THRESHOLD_PX)).toBe(1)
    expect(pullProgress(PULL_THRESHOLD_PX * 5)).toBe(1)
    expect(pullProgress(MAX_PULL_PX)).toBe(1)
  })

  it('cero o negativo no dibuja nada', () => {
    expect(pullProgress(0)).toBe(0)
    expect(pullProgress(-20)).toBe(0)
  })

  it('a mitad de camino va por la mitad', () => {
    expect(pullProgress(PULL_THRESHOLD_PX / 2)).toBeCloseTo(0.5, 10)
  })

  it('isReady coincide con el borde del umbral', () => {
    expect(isReady(PULL_THRESHOLD_PX - 0.01)).toBe(false)
    expect(isReady(PULL_THRESHOLD_PX)).toBe(true)
  })

  // El techo tiene que dejar recorrido VISIBLE despues de armar el gesto: si
  // MAX fuera igual al umbral, el indicador se congelaria justo cuando el
  // usuario necesita sentir que ya puede soltar.
  it('el techo deja recorrido más allá del umbral', () => {
    expect(MAX_PULL_PX).toBeGreaterThan(PULL_THRESHOLD_PX)
  })
})

// Los tres rechazos de esta funcion son los que impiden que un listener a nivel
// de window rompa el scroll y los gestos que ya existen.
describe('shouldClaim', () => {
  const V = { dx: 0, dy: 30, atTop: true, insideMain: true }

  it('un tirón vertical desde arriba SÍ es nuestro', () => {
    expect(shouldClaim(V)).toBe(true)
  })

  it('un swipe HORIZONTAL no es nuestro (esto es lo que salva el swipe de movimientos)', () => {
    expect(shouldClaim({ ...V, dx: 40, dy: 5 })).toBe(false)
    // Incluso con deriva vertical notable, mientras mande el eje horizontal.
    expect(shouldClaim({ ...V, dx: 40, dy: 39 })).toBe(false)
  })

  it('empate no se reclama: ante la duda, gana el scroll', () => {
    expect(shouldClaim({ ...V, dx: 30, dy: 30 })).toBe(false)
  })

  it('hacia arriba no es nuestro: eso es scroll normal', () => {
    expect(shouldClaim({ ...V, dy: -40 })).toBe(false)
  })

  it('scrolleado hacia abajo no es nuestro', () => {
    expect(shouldClaim({ ...V, atTop: false })).toBe(false)
  })

  it('fuera de <main> no es nuestro: cubre modales, header y nav de una vez', () => {
    expect(shouldClaim({ ...V, insideMain: false })).toBe(false)
  })

  // Una lista con scroll propio a media altura: ese tirón es de ella. Sin esto,
  // subir la lista de transacciones de Finanzas dispararia un refresco.
  it('dentro de un scroller interno que todavía puede subir, NO es nuestro', () => {
    expect(shouldClaim({ ...V, blockedByScroller: true })).toBe(false)
  })

  it('pero si ese scroller ya está en su tope, el gesto pasa de largo hacia acá', () => {
    expect(shouldClaim({ ...V, blockedByScroller: false })).toBe(true)
  })

  it('sin argumentos no reclama nada', () => {
    expect(shouldClaim()).toBe(false)
    expect(shouldClaim({})).toBe(false)
  })

  it('el bloqueo de dirección espera unos píxeles antes de decidir', () => {
    // A 1-2px la comparación |dy| > |dx| es una moneda al aire, así que el
    // caller no debe preguntar hasta pasar este mínimo.
    expect(DIRECTION_LOCK_PX).toBeGreaterThanOrEqual(4)
    expect(DIRECTION_LOCK_PX).toBeLessThan(PULL_THRESHOLD_PX)
  })
})
