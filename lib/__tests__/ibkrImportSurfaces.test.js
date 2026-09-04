import fs from 'fs'
import path from 'path'

// ⛔ Dos superficies de import que tenían que decir lo mismo y no lo decían.
//
// Los dos defectos salieron de la auditoría de 8 usuarios sobre el registro de
// IBKR, y los dos son SILENCIOSOS: nada falla, el usuario simplemente no ve lo
// que debería ver.
//
// NOTA DE MÉTODO: aquí NO se strippean comentarios con regex. En un archivo de
// 3000 líneas como page.jsx, un `*/` dentro de una cadena abre un comentario
// falso y el barrido se come código real (medido: la declaración de
// handleOpenImport desaparecía). Estas aserciones buscan CÓDIGO que debe
// existir, así que el archivo crudo es la fuente correcta; las negativas están
// escritas para no poder confundirse con la prosa de un comentario.
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('los avisos post-import llegan por las DOS puertas', () => {
  const SRC = read('components/IBKRSyncModal.jsx')

  it('el desglose se calcula en un solo lugar', () => {
    // Con una copia por rama, la del camino de ARCHIVO se quedó sin `sections`
    // y con ella se cayeron TODOS los avisos (multi-cuenta, cero depósitos,
    // historial corto y la caja forense), además de dejar `hasWarnings` en
    // falso: el modal se autocerraba a los 5s anunciando "Sincronización
    // exitosa" sobre un import al que le faltaban secciones enteras.
    expect(SRC).toMatch(/function importBreakdown\(/)
  })

  it('las dos ramas que escriben result lo usan', () => {
    const uses = SRC.match(/\.\.\.importBreakdown\(/g) || []
    expect(uses.length).toBeGreaterThanOrEqual(2)
  })

  it('el desglose no se vuelve a armar a mano fuera del helper', () => {
    // La firma de la copia vieja: contar tipos de transacción inline con `_c`.
    expect(SRC).not.toMatch(/impFlows:\s*_c\(/)
    expect(SRC).not.toMatch(/const _c = \(types\)/)
  })
})

describe('el hint de broker no puede ser un evento', () => {
  const PAGE = read('app/dashboard/page.jsx')

  it('handleOpenImport exige un string', () => {
    // `onClick: onImport` (QuickActionsCard, Header) entrega el MouseEvent como
    // primer argumento, y con `bh || null` ese evento quedaba guardado COMO
    // hint: `brokerHint === 'ibkr'` fallaba, el `accept` del input perdía .xml
    // (el Flex Query que las propias instrucciones mandan a bajar aparecía GRIS
    // en el diálogo del sistema) y getBrokerHowTo(evento) devolvía undefined,
    // así que la pantalla perdía las instrucciones. Misma trampa que FASE GQ4.
    const i = PAGE.indexOf('const handleOpenImport')
    expect(i).toBeGreaterThan(-1)
    const body = PAGE.slice(i, i + 260)
    expect(body).toMatch(/typeof bh === 'string'/)
    expect(body).not.toMatch(/setImportBrokerHint\(bh \|\| null\)/)
  })
})
