import { shouldAnimate, tweenDuration, tweenValue, easeOut, MIN_MS, MAX_MS } from '../tween'

// ⛔ El invariante de dinero: mientras el tween corre se muestran cifras que no
// son la verdad, así que aterrizar EXACTO no es un detalle, es la condición.
describe('siempre aterriza en el valor exacto', () => {
  for (const [from, to] of [[100, 200], [27291.55, 27300.01], [5350, 5674.68], [1, 0.5], [-100, -50]]) {
    it(`${from} → ${to} termina exacto, no interpolado`, () => {
      const d = tweenDuration(from, to)
      expect(tweenValue(from, to, d, d)).toBe(to)
      expect(tweenValue(from, to, d + 1000, d)).toBe(to)
    })
  }

  it('en el instante cero muestra el valor viejo, no un intermedio', () => {
    expect(tweenValue(100, 200, 0, 300)).toBe(100)
  })

  it('con duración cero no inventa nada: va directo al objetivo', () => {
    expect(tweenValue(100, 200, 0, 0)).toBe(200)
  })
})

describe('qué NO se anima', () => {
  it('el primer render (no hay de dónde venir)', () => {
    expect(shouldAnimate(null, 27000)).toBe(false)
    expect(shouldAnimate(undefined, 27000)).toBe(false)
  })

  // Contar desde cero convierte cada carga en un espectáculo de cajero, y
  // además afirma que el patrimonio "subió" cuando lo que pasó es que el dato
  // llegó.
  it('de cero a algo: eso es el dato llegando, no un cambio', () => {
    expect(shouldAnimate(0, 27000)).toBe(false)
  })

  it('un salto de mas de 4x: no crecio, paso a describir otra cosa', () => {
    expect(shouldAnimate(1000, 5000)).toBe(false)   // cambio de moneda base
    expect(shouldAnimate(5000, 1000)).toBe(false)   // cambio de portafolio
    expect(shouldAnimate(1000, 3900)).toBe(true)    // 3.9x sí es un cambio real
  })

  it('un valor que no cambio', () => {
    expect(shouldAnimate(100, 100)).toBe(false)
  })

  it('nada que no sea un numero finito', () => {
    expect(shouldAnimate(100, NaN)).toBe(false)
    expect(shouldAnimate(Infinity, 100)).toBe(false)
    expect(shouldAnimate(100, null)).toBe(false)
  })

  // Sin esto, quien pidió menos movimiento igual lo recibe en la cifra más
  // grande de la pantalla.
  it('con prefers-reduced-motion, nunca', () => {
    expect(shouldAnimate(100, 110, { reducedMotion: true })).toBe(false)
  })
})

describe('la duración escala con el tamaño del cambio', () => {
  it('un tick de precio dura menos que un movimiento grande', () => {
    const chico = tweenDuration(27000, 27027)      // 0.1%
    const grande = tweenDuration(27000, 35000)     // 30%
    expect(chico).toBeLessThan(grande)
  })

  it('nunca se pasa del techo: nadie espera a que un numero le diga cuanto tiene', () => {
    for (const [a, b] of [[100, 390], [1, 3.9], [27000, 100000]]) {
      const d = tweenDuration(a, b)
      expect(d).toBeGreaterThanOrEqual(MIN_MS)
      expect(d).toBeLessThanOrEqual(MAX_MS)
    }
  })

  it('un cambio infinitesimal cae al piso, no a cero', () => {
    expect(tweenDuration(27000, 27000.01)).toBeGreaterThanOrEqual(MIN_MS)
  })
})

describe('la curva', () => {
  it('empieza en 0 y termina en 1', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
  })

  // Es ease-OUT: la mayor parte del recorrido ocurre al principio. Eso es lo
  // que hace que aterrice suave en vez de frenar de golpe.
  it('a mitad de tiempo ya recorrio mas de la mitad del camino', () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
  })

  it('es monotona: el numero nunca retrocede a mitad de camino', () => {
    let prev = -1
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOut(t)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('fuera de rango se recorta en vez de dispararse', () => {
    expect(easeOut(-1)).toBe(0)
    expect(easeOut(2)).toBe(1)
  })
})

describe('el recorrido completo, como lo ve el usuario', () => {
  it('un movimiento real pasa por valores intermedios y termina en el correcto', () => {
    const from = 12500, to = 10000
    const d = tweenDuration(from, to)
    const frames = [0, d * 0.25, d * 0.5, d * 0.75, d].map((e) => tweenValue(from, to, e, d))
    expect(frames[0]).toBe(from)
    expect(frames[frames.length - 1]).toBe(to)
    // Baja de forma monótona: nunca sube a mitad de una bajada.
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeLessThanOrEqual(frames[i - 1])
    // Y de verdad se mueve: no son cinco veces el mismo número.
    expect(new Set(frames).size).toBeGreaterThan(3)
  })
})
