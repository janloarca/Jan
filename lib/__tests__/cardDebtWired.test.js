const fs = require('fs')
const path = require('path')

// Guardián de FUENTE, mismo precedente que `ibkrImportGate` y `moneyInputs`: el
// interruptor y su escritura viven en JSX que jest no puede montar sin subir un
// PDF real por un input de archivo. Lo que se vigila no es la aritmética (esa la
// cubre `cardDebt.test.js` sobre el módulo puro) sino el CABLEADO, que es
// exactamente lo que se rompe en silencio: un planificador escrito y nunca
// llamado pasa sus propios tests en verde, se lee como si la función existiera,
// y no escribe una sola deuda. Es el patrón que este repo ya pagó con
// `prefs.profileName`, `lastUsedAt`, el parámetro `touched` y `_confirmedBy`.

const SRC = fs.readFileSync(path.join(__dirname, '../../components/FileImportModal.jsx'), 'utf8')

// Los comentarios se strippean antes de juzgar: los de este cambio NOMBRAN las
// mismas funciones que el guardián busca, así que sin esto pasaría por leer una
// explicación en vez del código (la lección de FASE LE).
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n')

describe('el interruptor de deuda de tarjeta está cableado', () => {
  it('el planificador se importa y se LLAMA, no solo se define', () => {
    expect(CODE).toContain("from '@/lib/cardDebt'")
    // Dos llamadas: una para la vista previa y otra al confirmar. La del
    // confirm NO puede tomar el plan del render (entre dibujar la vista previa
    // y apretar Importar, el listener de Firestore puede haber cambiado los
    // items, y escribir contra una foto vieja crea una segunda deuda que el
    // plan decía que iba a actualizar).
    const calls = CODE.match(/planCardDebtSync\(/g) || []
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('lo que el plan computa, el import lo APLICA', () => {
    // Sin esto el plan se calcularía, se mostraría y no escribiría nada.
    //
    // La condición se exige LITERAL (`if (onImportItems)`) y no solo que la
    // llamada aparezca cerca: la primera versión de este test buscaba el texto
    // de la llamada, y neutralizarla con `if (false)` lo dejaba pasando en
    // verde. Un guardián con hueco deja la sensación de haber barrido, que es
    // peor que no tenerlo.
    expect(CODE).toMatch(/for \(const c of plan\.creates\)[\s\S]{0,160}if \(onImportItems\) \{ await onImportItems\(c\.item\); debtsWritten\+\+ \}/)
    expect(CODE).toMatch(/for \(const u of plan\.updates\)[\s\S]{0,160}if \(onUpdateItem\) \{ await onUpdateItem\(u\.id, u\.patch\); debtsWritten\+\+ \}/)
    // Y que el contador que se reporta sea el que estos bucles incrementan: sin
    // esto, "N deudas guardadas" podría salir de una variable que nadie mueve.
    expect((CODE.match(/debtsWritten\+\+/g) || []).length).toBe(2)
  })

  it('la escritura está detrás del interruptor, no corre sola', () => {
    // Una escritura al patrimonio no puede ocurrir porque sí: el usuario la
    // pide. El estado arranca apagado.
    expect(CODE).toMatch(/useState\(false\)/)
    expect(CODE).toMatch(/if \(debtToSheet && biData\.card\)/)
  })

  it('el resultado se REPORTA en la pantalla final', () => {
    // Una escritura silenciosa no se distingue de una que falló, y esta mueve
    // el patrimonio neto.
    expect(CODE).toContain('debtsWritten')
    expect(CODE).toContain('debtsFailed')
    expect(CODE).toMatch(/result\.debtsWritten > 0/)
    expect(CODE).toMatch(/result\.debtsFailed > 0/)
  })

  it('un fallo de la deuda no tumba el import de movimientos', () => {
    // Best-effort: los movimientos ya se escribieron cuando esto corre.
    expect(CODE).toMatch(/catch \{ debtsFailed\+\+ \}/)
  })
})

describe('el módulo no puede volverse huérfano', () => {
  it('cardBalance también tiene consumidor', () => {
    // `closingBalance` estuvo escrito y sin leer desde que existe; el punto de
    // FASE NI fue cerrarlo, y este test impide que se reabra.
    expect(CODE).toContain("from '@/lib/cardBalance'")
    expect(CODE).toMatch(/cardBalanceSummary\(/)
  })
})
