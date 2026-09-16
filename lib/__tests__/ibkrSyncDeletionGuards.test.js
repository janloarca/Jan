import fs from 'fs'
import path from 'path'

// ⛔ Un sync de broker no puede borrar datos que el usuario escribió a mano.
//
// El sync de IBKR tiene tres rutas de borrado y dos de ellas alcanzaban items
// que nadie importó:
//
//   · La limpieza por cantidad cero identificaba "esto es de IBKR" con la
//     heurística `institution.includes('interactive brokers')`, así que una
//     cuenta que el usuario tecleó a mano con ese nombre entraba. Y
//     `quantity: 0` no es basura: es como lib/transferFields.js escribe una
//     cuenta VACIADA a propósito (con dos sanadores construidos sobre esa
//     firma). O sea la regla no distinguía un residuo de una decisión.
//   · Una regla por COLISIÓN DE SÍMBOLO borraba todo item con cantidad cero
//     que compartiera símbolo con uno de IBKR, y arrancaba con
//     `if (it._source === 'ibkr') return` — o sea su alcance real era
//     EXCLUSIVAMENTE lo no importado. Se quitó entera.
//
// Las dos podían dispararse en un auto-sync que el usuario no pidió, sin
// preview y sin aviso. El comentario de GUARDA 2 en lib/ibkrVanishedPositions.js
// ya nombraba esta rama como "imperdonable" antes de que se arreglara.
//
// El modo 'replace' queda FUERA a propósito: ahí el usuario lee una
// advertencia con el conteo exacto y confirma, así que la heurística por
// nombre es parte de la promesa ("borra todo lo de IBKR") y no una sorpresa.
const SRC = fs.readFileSync(path.join(process.cwd(), 'hooks/useDashboardData.js'), 'utf8')

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const CODE = stripComments(SRC)

describe('el sync de IBKR no borra lo que el usuario tecleó', () => {
  it('ninguna ruta de BORRADO usa la heurística por nombre, salvo replace', () => {
    // La heurística sigue siendo legítima en dos sitios que NO borran:
    //   · el modo 'replace', donde el usuario lee el conteo y confirma;
    //   · el match del merge, que ADOPTA un item manual llamado "Interactive
    //     Brokers" para actualizarlo en vez de duplicarlo (fusión, no pérdida).
    // Lo que no puede volver es que decida un borrado por su cuenta.
    const lines = CODE.split('\n')
    const offenders = []
    lines.forEach((line, i) => {
      if (!/includes\('interactive brokers'\)/.test(line)) return
      // La ventana en la que un borrado se decide a partir de esta línea.
      const window = lines.slice(i, i + 6).join('\n')
      const isReplace = lines.slice(Math.max(0, i - 4), i + 1).join('\n').includes("mode === 'replace'")
      if (/deleteIds\.push/.test(window) && !isReplace) offenders.push(i + 1)
    })
    expect(offenders).toEqual([])
  })

  it('no vuelve el borrado por colisión de símbolo', () => {
    // La firma de aquella regla: buscar OTRO item de IBKR con el mismo símbolo
    // para decidir borrar el actual.
    expect(CODE).not.toMatch(/other\._source === 'ibkr'/)
  })

  it('la limpieza por cantidad cero exige _source ibkr', () => {
    // El bloque que empareja contra los símbolos entrantes tiene que rechazar
    // todo lo que el sync no creó antes de mirar la cantidad.
    const block = CODE.slice(CODE.indexOf('incomingSymbols'))
    const guard = block.indexOf("it._source !== 'ibkr'")
    const push = block.indexOf('deleteIds.push')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(push)
  })
})
