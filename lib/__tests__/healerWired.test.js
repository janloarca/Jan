import fs from 'fs'
import path from 'path'

// Un detector escrito y nunca cableado es la peor forma de fallar de este
// modulo: pasa sus propios tests en verde, se lee como si el defecto estuviera
// cerrado, y no borra una sola fila mala. Es el mismo patron de "se escribe y
// nadie lo lee" que este repo ya pago con `prefs.profileName`, `lastUsedAt`, el
// parametro `touched` y `_confirmedBy`.
//
// Y aca es peor todavia porque el detector si CORRE: se computa, se descarta, y
// el usuario sigue con los documentos duplicados. Nada falla ruidosamente.
//
// Estos guardianes leen la FUENTE, precedente `ibkrImportGate.test.js`: el
// efecto sanador vive en JSX que jest no puede montar sin el dashboard entero.

const root = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const cleanupSrc = read('lib/badDataCleanup.js')
const pageSrc = read('app/dashboard/page.jsx')
const itemsSrc = read('hooks/useFirestoreItems.js')

const detectors = [...cleanupSrc.matchAll(/^export function (detect\w+)/gm)].map((m) => m[1])

describe('los detectores de badDataCleanup estan cableados (FASE MO)', () => {
  it('el barrido encuentra detectores (si no, el guardian no vigila nada)', () => {
    expect(detectors.length).toBeGreaterThanOrEqual(8)
  })

  it.each(detectors)('%s se LLAMA en algun consumidor real', (name) => {
    const called = [pageSrc, itemsSrc].some((src) => new RegExp(`\\b${name}\\s*\\(`).test(src))
    expect(called).toBe(true)
  })
})

describe('lo que el sanador computa, el sanador lo APLICA (FASE MO)', () => {
  // La region del efecto: desde donde se declara el primer detector hasta el
  // cierre del array de borrados. Acotarla es lo que impide que una mencion en
  // un comentario o en el toast cuente como "aplicado".
  const start = pageSrc.indexOf('const fakeTrades = detect')
  const end = pageSrc.indexOf('healedRef.current = true')

  it('la region del efecto sanador se encuentra', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
  })

  const region = pageSrc.slice(start, end)
  const bindings = [...region.matchAll(/const (\w+) = (detect\w+)\(/g)].map((m) => ({
    name: m[1], detector: m[2],
  }))

  it('el barrido encuentra los bindings del efecto', () => {
    expect(bindings.length).toBeGreaterThanOrEqual(6)
  })

  // Los tres unicos destinos que de verdad escriben: el array de borrados de
  // transacciones, y los dos bucles que tocan items.
  const txList = (region.match(/const txToDelete = \[[^\]]*\]/) || [''])[0]
  const applyLoops = [...pageSrc.matchAll(/for \(const \w+ of (\w+)\)/g)].map((m) => m[1])

  it('el array de borrados se encuentra', () => {
    expect(txList).toContain('txToDelete')
  })

  it.each(bindings.map((b) => [b.name, b.detector]))(
    '%s (de %s) termina en txToDelete o en un bucle que escribe',
    (name) => {
      const applied = txList.includes(`...${name}`) || applyLoops.includes(name)
      expect(applied).toBe(true)
    }
  )
})
