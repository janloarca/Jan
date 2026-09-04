import fs from 'fs'
import path from 'path'

// Guardian de FUENTE: estas tres puertas escriben o usan credenciales de IBKR y
// las tres tienen que consultar la MISMA regla.
//
// Existe porque el defecto no era que la validacion estuviera mal escrita, sino
// que vivia en UNA sola de las tres puertas: conectar por primera vez validaba
// la forma completa, mientras un usuario YA conectado cambiando credenciales y
// el wizard de ConnectionsModal solo miraban que no estuvieran vacias. Y
// equivocarse manda a la red una credencial que no puede funcionar, o sea gasta
// un intento FALLIDO, que es la moneda con la que se compra el bloqueo de IBKR.
//
// Lee los ARCHIVOS y no una copia de las cadenas: con su propia lista se podria
// cambiar el codigo y seguir en verde. Y no strippea comentarios con regex,
// porque en un archivo de miles de lineas un '*/' dentro de una cadena abre un
// comentario falso y el barrido se come codigo real (leccion de FASE NX): las
// aserciones se escriben de forma que la prosa de un comentario no las pueda
// satisfacer ni romper.
const root = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const DOORS = [
  ['components/IBKRSyncModal.jsx', 2],   // handleSync + handleQuickConnect
  ['components/ConnectionsModal.jsx', 1], // handleIbkrSave (el wizard)
]

describe('las tres puertas de credenciales de IBKR comparten una sola regla', () => {
  test('cada puerta llama a normalizeIbkrCredentials', () => {
    for (const [file, calls] of DOORS) {
      const src = read(file)
      expect(src).toContain("from '@/lib/ibkrCredentials'")
      const found = (src.match(/normalizeIbkrCredentials\(\{/g) || []).length
      expect(`${file}: ${found}`).toBe(`${file}: ${calls}`)
    }
  })

  test('ninguna puerta manda al servidor un valor sin normalizar', () => {
    // El vault recibia `token: ibkrToken` crudo mientras settings guardaba el
    // queryId ya recortado: el mismo dato escrito de dos formas en dos lugares.
    const conn = read('components/ConnectionsModal.jsx')
    // Ojo de metodo: la primera version de esta asercion buscaba la cadena
    // "token: ibkrToken" en TODO el archivo y reportaba como ofensora la linea
    // CORRECTA, la que le pasa los valores crudos del formulario AL
    // normalizador. Lo que importa no es que la cadena exista, es que sea lo
    // que sale hacia la RED, asi que se juzga el cuerpo del fetch.
    const body = conn.slice(conn.indexOf("action: 'save-credentials'"))
      .slice(0, 200)
    expect(body).toContain('token: creds.token')
    expect(body).toContain('queryId: creds.queryId')
    // Y lo que se espeja en settings sale del MISMO objeto normalizado, no de
    // un segundo recorte a mano que pueda quedarse atras del que se guardo.
    expect(conn).not.toContain('ibkrQueryId: ibkrQueryId.trim()')

    const modal = read('components/IBKRSyncModal.jsx')
    // Un `.trim()` suelto es la firma de haber vuelto a normalizar a mano.
    expect(modal).not.toContain('queryId.trim()')
  })

  test('la validacion corre ANTES de cualquier llamada a la red', () => {
    // Validar despues de pedirle el reporte a IBKR no ahorra el intento, que es
    // el punto entero: el orden es la garantia, no la existencia del chequeo.
    const modal = read('components/IBKRSyncModal.jsx')
    for (const handler of ['const handleSync = useCallback', 'const handleQuickConnect = useCallback']) {
      const start = modal.indexOf(handler)
      expect(start).toBeGreaterThan(-1)
      const body = modal.slice(start, start + 4000)
      const validateAt = body.indexOf('normalizeIbkrCredentials({')
      expect(validateAt).toBeGreaterThan(-1)
      for (const net of ['syncIBKR(', 'saveIbkrCredentials(']) {
        const netAt = body.indexOf(net)
        if (netAt > -1) expect(validateAt).toBeLessThan(netAt)
      }
    }
  })

  test('el modal respeta el enfriamiento en el punto UNICO por el que pasan sus botones', () => {
    // "Reintentar", "Sincronizar ahora" y "Sincronizar de todos modos" llaman
    // todos a handleSync: el guard va ahi y no en cada boton, para que el
    // proximo boton que alguien agregue lo herede.
    const modal = read('components/IBKRSyncModal.jsx')
    const start = modal.indexOf('const handleSync = useCallback')
    const body = modal.slice(start, start + 4000)
    const guardAt = body.indexOf('ibkrCooldownRemainingMs(cooldownUntil)')
    expect(guardAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(body.indexOf('setSyncing(true)'))
    // Y un fallo del modal reporta hacia arriba, o el enfriamiento nunca se
    // armaria desde esta superficie.
    expect(modal).toContain('onSyncFailure?.(')
  })

  test('el modal NO re-deriva "reintentar no sirve": la pregunta es compartida', () => {
    // Es UNA pregunta que se hacen dos superficies (el pill y este modal). Con
    // dos copias, el modal ofrecia "Reintentar" sobre un token vencido mientras
    // el pill ya mandaba a arreglarlo, o sea la app se contradecia a si misma
    // sobre el mismo error. Y el label tambien: "Pegar un token nuevo" sobre un
    // Query ID inexistente manda a cambiar lo unico que estaba bien.
    const modal = read('components/IBKRSyncModal.jsx')
    expect(modal).toContain('retryCannotFix(errorCode)')
    expect(modal).toContain('ibkrFixActionLabel(errorCode, lang)')
    expect(modal).not.toMatch(/retryFeedsLockout\s*=\s*errorCode\s*===/)
    // Y el label no puede volver a estar escrito a mano en cada boton.
    expect(modal).not.toContain("'Pegar un token nuevo'")
  })

  test('un fallo manual gasta el mismo presupuesto que uno automatico', () => {
    // Un intento fallido cuesta lo mismo en IBKR lo dispare quien lo dispare.
    const hook = read('hooks/useDashboardData.js')
    const start = hook.indexOf('const triggerIBKRSync = useCallback')
    expect(start).toBeGreaterThan(-1)
    const body = hook.slice(start, hook.indexOf('// Derived values', start))
    const catchAt = body.indexOf('} catch (err) {')
    expect(catchAt).toBeGreaterThan(-1)
    const failure = body.slice(catchAt)
    expect(failure).toContain('_ibkrAttemptsToday: bumpAttempts(')
    expect(failure).toContain('_ibkrAutoSyncFailCount: nextFailCount(')
    // Solo al fallar: un manual exitoso ya corta el dia por `synced-today`.
    const success = body.slice(0, catchAt)
    expect(success).not.toContain('bumpAttempts(')
  })
})
