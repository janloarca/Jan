// FASE LH — los guards del lado del IMPORT en la carrera import ↔ auto-sync.
//
// La otra mitad del cierre (el funnel de handleIBKRSync: esperar la escritura
// masiva + reconciliar contra la foto fresca) se prueba de verdad en
// hooks/__tests__/useDashboardData.test.js. Estos tres guards viven dentro de
// FileImportModal, cuyo confirm es inalcanzable en jest sin montar el modal
// completo con un archivo real, así que se fijan LEYENDO LA FUENTE (el
// precedente es moneyInputs.test.js). Son load-bearing, no cosmética:
//
//  - `ibkrSyncBusy`: sin él, confirmar un preview durante la ESCRITURA de un
//    auto-sync reconcilia contra el `existingItems` de un render viejo y
//    re-crea las posiciones que el sync acaba de escribir (duplicados sin
//    heal: dataCompleteness excluye items de broker a propósito).
//  - `!onBulkImport`: el mount de Flujo no pasa esa prop, y confirmar un Flex
//    XML ahí reventaba con TypeError mudo.
//  - `ibkrModeTouchedRef`: el auto-select re-decide el modo con cada eco del
//    listener y pisaba la elección manual del usuario a mitad del preview.
const fs = require('fs')
const path = require('path')

const modalSrc = fs.readFileSync(path.join(__dirname, '../../components/FileImportModal.jsx'), 'utf8')
const pageSrc = fs.readFileSync(path.join(__dirname, '../../app/dashboard/page.jsx'), 'utf8')

// El cuerpo de doIBKRImport: desde su declaración hasta la llamada que escribe.
const importFnStart = modalSrc.indexOf('const doIBKRImport')
const writeCall = modalSrc.indexOf('await onBulkImport(', importFnStart)
const importFnBody = modalSrc.slice(importFnStart, writeCall)

describe('FASE LH: guards del confirm de import de IBKR', () => {
  it('doIBKRImport existe y llega a escribir', () => {
    expect(importFnStart).toBeGreaterThan(-1)
    expect(writeCall).toBeGreaterThan(importFnStart)
  })

  it('rehúsa confirmar con una sincronización de IBKR en vuelo, ANTES de escribir', () => {
    expect(importFnBody).toMatch(/if\s*\(\s*ibkrSyncBusy\s*\)/)
    // y el guard corta la función, no solo avisa
    const guardAt = importFnBody.search(/if\s*\(\s*ibkrSyncBusy\s*\)/)
    expect(importFnBody.slice(guardAt, guardAt + 600)).toMatch(/return/)
  })

  it('sin onBulkImport rehúsa con mensaje en vez de reventar', () => {
    expect(importFnBody).toMatch(/if\s*\(\s*!onBulkImport\s*\)/)
  })

  it('el auto-select del modo respeta la elección manual del usuario', () => {
    // El efecto que decide enrich/merge tiene que mirar la ref ANTES de
    // escribir el modo; y los botones tienen que marcarla.
    expect(modalSrc).toMatch(/ibkrModeTouchedRef\.current\s*\)\s*return/)
    expect(modalSrc).toMatch(/ibkrModeTouchedRef\.current\s*=\s*true/)
    // Un archivo nuevo resetea la elección: dos accepts, dos resets.
    const resets = modalSrc.match(/ibkrModeTouchedRef\.current\s*=\s*false/g) || []
    expect(resets.length).toBeGreaterThanOrEqual(2)
  })

  it('el tablero cablea la señal con las DOS mitades: sync en vuelo O escritura masiva', () => {
    // ibkrAutoSyncing cubre descarga+escritura del sync; bulkWriting cubre
    // además el colchón de 1500ms del eco del listener. Solo una de las dos
    // deja una ventana real (ver el bullet de FASE LH en CLAUDE.md).
    expect(pageSrc).toMatch(/ibkrSyncBusy=\{ibkrAutoSyncing\s*\|\|\s*bulkWriting\}/)
  })
})
