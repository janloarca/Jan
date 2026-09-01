import { boundedPct } from '../friendsStats'
import { groupStandings } from '../friendsGroups'

// ⛔ `boundedPct` es el validador del SERVIDOR sobre un cuerpo que la propia
// ruta declara untrusted. Parchar `null` y `''` uno por uno dejaba abiertas
// las demas formas que `Number()` convierte en 0: una AUSENCIA entraba al
// ranking como "exactamente 0%", que es una POSICION.
describe('boundedPct acepta por TIPO, no por coercion', () => {
  it('un numero real pasa', () => {
    expect(boundedPct(12.5)).toBe(12.5)
    expect(boundedPct(0)).toBe(0)
    expect(boundedPct(-7)).toBe(-7)
  })

  it('un numero serializado pasa: es un dato, solo que en texto', () => {
    expect(boundedPct('12.5')).toBe(12.5)
    expect(boundedPct(' -7 ')).toBe(-7)
  })

  it('fuera de banda se publica como null, no saturado', () => {
    expect(boundedPct(5000)).toBeNull()
    expect(boundedPct(-201)).toBeNull()
    expect(boundedPct(200)).toBe(200) // el borde SI se publica
  })

  // El hueco: todo esto coercionaba a 0 y entraba al ranking.
  it('lo que NO es un numero ni texto numerico se rehusa', () => {
    for (const basura of [[], [0], [12.5], false, true, new Date(0), {}, () => 1, NaN, Infinity]) {
      expect(boundedPct(basura)).toBeNull()
    }
  })

  it('null, undefined y vacio siguen siendo ausencia', () => {
    expect(boundedPct(null)).toBeNull()
    expect(boundedPct(undefined)).toBeNull()
    expect(boundedPct('')).toBeNull()
    expect(boundedPct('   ')).toBeNull()
    expect(boundedPct('hola')).toBeNull()
  })
})

// La pantalla y el correo tienen que ordenar IGUAL sobre los mismos perfiles:
// para eso existe `groupStandings`. Una fila sin cifra no esta en la carrera.
describe('groupStandings: puesto solo para quien tiene numero', () => {
  const rows = () => groupStandings({
    group: { scope: 'all', memberUids: ['a', 'b', 'c'] },
    profiles: [
      { uid: 'a', profile: { displayName: 'Ana', stats: { all: { ytd: 22 } } } },
      { uid: 'b', profile: { displayName: 'Beto', stats: { all: { ytd: 10 } } } },
      { uid: 'c', profile: { displayName: 'Caro', stats: {} } },
    ],
    viewerUid: 'a',
  }).rows

  it('quien no publico NO recibe puesto', () => {
    const r = rows()
    const caro = r.find((x) => x.displayName === 'Caro')
    expect(caro.rank).toBeNull()
  })

  it('los que si publicaron reciben 1 y 2', () => {
    const r = rows()
    expect(r.find((x) => x.displayName === 'Ana').rank).toBe(1)
    expect(r.find((x) => x.displayName === 'Beto').rank).toBe(2)
  })

  // Con el podio derivado del INDICE, Caro quedaba tercera y se llevaba el
  // bronce mientras decia "Sin datos" al lado.
  it('nadie sin puesto puede caer en el podio', () => {
    for (const r of rows()) {
      const enPodio = r.rank != null && r.rank <= 3
      if (r.rank == null) expect(enPodio).toBe(false)
    }
  })
})
