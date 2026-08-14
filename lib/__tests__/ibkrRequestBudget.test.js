/**
 * @jest-environment node
 */
// El presupuesto de la petición de generación de IBKR, del lado del SERVIDOR,
// tiene que caber dentro del que espera el CLIENTE. Si no, el servidor sigue
// reintentando para nadie y el usuario ve "signal timed out" (el mensaje crudo
// de AbortSignal.timeout, que no es de IBKR y no le dice nada).
//
// Un usuario real quedó atrapado exactamente ahí: credenciales guardadas,
// nunca un solo sync exitoso. La aritmética estaba mal y nada la revisaba.
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const readNum = (file, name) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`))
  if (!m) throw new Error(`no se encontró ${name} en ${file}`)
  return Number(m[1])
}
const readArr = (file, name) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`))
  if (!m) throw new Error(`no se encontró ${name} en ${file}`)
  return m[1].split(',').map((s) => Number(s.trim())).filter((n) => isFinite(n))
}

const ROUTE = 'app/api/brokers/ibkr/route.js'
const SYNC = 'lib/ibkrSync.js'

describe('presupuesto de la petición de generación de IBKR', () => {
  test('el techo del servidor cabe dentro de lo que el cliente espera', () => {
    const serverBudget = readNum(ROUTE, 'REQUEST_BUDGET_MS')
    const clientBudget = readNum(SYNC, 'REQUEST_TIMEOUT_MS')
    // Estrictamente menor: iguales sería una carrera, y el margen tiene que
    // alcanzar para la ida y vuelta de la red y el trabajo del propio route.
    expect(serverBudget).toBeLessThan(clientBudget)
    expect(clientBudget - serverBudget).toBeGreaterThanOrEqual(10000)
  })

  test('el deadline es lo que de verdad acota, no la lista de reintentos', () => {
    // Sin deadline, las esperas SOLAS ya se pasan del presupuesto: por eso el
    // techo no puede depender de "cuántos reintentos hay".
    const delays = readArr(ROUTE, 'REQUEST_DELAYS')
    const fetchTimeout = readNum(ROUTE, 'FETCH_TIMEOUT_MS')
    const attempts = readNum(ROUTE, 'REQUEST_ATTEMPTS')
    const budget = readNum(ROUTE, 'REQUEST_BUDGET_MS')
    const worstCase = delays.reduce((a, b) => a + b, 0) + attempts * fetchTimeout
    expect(worstCase).toBeGreaterThan(budget)

    const src = fs.readFileSync(path.join(ROOT, ROUTE), 'utf8')
    expect(src).toContain('REQUEST_BUDGET_MS')
    expect(src).toMatch(/deadline/)
  })

  test('la petición de generación NO se queda con el default de authFetch', () => {
    // authFetch aborta a los 30s cuando no le pasan señal, y generar un reporte
    // de IBKR tarda legítimamente más que eso: ese default es el que dejó a un
    // usuario sin poder conectar nunca.
    const auth = fs.readFileSync(path.join(ROOT, 'lib/authFetch.js'), 'utf8')
    const m = auth.match(/AbortSignal\.timeout\((\d+)\)/)
    expect(m).toBeTruthy()
    const authDefault = Number(m[1])

    expect(readNum(SYNC, 'REQUEST_TIMEOUT_MS')).toBeGreaterThan(authDefault)
    // Y tiene que USARSE: pasar la señal propia es lo que evita que authFetch
    // aplique el suyo, porque solo pone el default cuando no viene ninguna.
    const sync = fs.readFileSync(path.join(ROOT, SYNC), 'utf8')
    expect(sync).toMatch(/signal:\s*budget\.signal/)
  })

  test('un aborto se archiva como TIMEOUT o CANCELLED, nunca como UNKNOWN', () => {
    // Sin esto el fallo quedaba guardado como UNKNOWN con el mensaje crudo del
    // navegador ("signal timed out"), que no distingue "IBKR tardó" de
    // "el usuario canceló" ni le dice nada al usuario.
    const sync = fs.readFileSync(path.join(ROOT, SYNC), 'utf8')
    expect(sync).toMatch(/budget\.timedOut\s*\?\s*'TIMEOUT'\s*:\s*'CANCELLED'/)
  })
})
