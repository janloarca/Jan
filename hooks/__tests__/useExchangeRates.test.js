// El primer hook con arnés, y a propósito el que tuvo el bug más caro de los
// seis de cableado: `convert` con identidad congelada (FASE JA3).
//
// El defecto: `convert` era `useCallback(..., [])`. Lee las tasas de un ref,
// así que SIEMPRE devolvía respuestas frescas, pero React no tiene forma de
// saber eso y le entregaba el valor cacheado a todo memo que dependiera de él.
// En el tablero se autocuraba por accidente (sus memos también dependen de los
// precios, que sí cambian); en Flujo NO hay precios de mercado, así que un
// ingreso de USD 1,000 se mostraba como "Q1,000" el resto de la sesión y el
// botón de refresco del header no podía mover un solo número.
//
// Ni `npx jest` ni `npm run build` podían ver eso: un `useCallback` con deps
// vacías es JavaScript perfectamente válido. Hacía falta RENDERIZAR el hook y
// comparar identidades entre renders, que es exactamente lo que este arnés
// habilita.
//
// Los dos lados se fijan acá, y el segundo importa tanto como el primero:
// arreglar solo el primero (meter `rates` en las deps) causaba churn, porque
// el poll de cada 15 minutos publicaba identidad nueva aunque el FX no se
// hubiera movido, y hay dos efectos que releen Firestore con `convert` en sus
// deps. Por eso `setRates` compara por CONTENIDO.

// ⚠️ DOS TRAMPAS DEL ARNES, las dos pagadas al escribir este archivo:
//
// 1. La ruta del mock es RELATIVA, no el alias `@/`: no resuelve dentro de
//    jest.mock()/doMock() en este repo (ya documentado al testear
//    app/api/prices/portfolio-history/route.js). El mock igual intercepta el
//    import aliasado del hook: Jest mockea por modulo RESUELTO y los dos
//    caminos llegan al mismo archivo.
//
// 2. El hook guarda las tasas en un cache a NIVEL DE MODULO, asi que sin
//    resetearlo el primer test contamina a los siguientes y ninguno vuelve a
//    poder observar la transicion "sin tasas -> con tasas", que ES el bug.
//    Limpiarlo tiene DOS trampas encadenadas, las dos pagadas aca:
//
//    · `jest.isolateModules(...)` aisla TAMBIEN a React, asi que el hook queda
//      con una instancia distinta de la del arnes y revienta con "Cannot read
//      properties of null (reading 'useState')": se queda sin dispatcher.
//    · Y re-pedir `@testing-library/react` dentro del beforeEach tampoco
//      sirve: al importarse registra su propio `afterAll`, y Jest prohibe
//      definir un hook de test dentro de otro ("Hooks cannot be defined
//      inside tests").
//
//    La salida es resetear el registro pero FIJAR React a la instancia que el
//    arnes ya tiene, para que los dos compartan dispatcher.

const React = require('react')
const { renderHook, act } = require('@testing-library/react')

let useExchangeRates, authFetch

beforeEach(() => {
  jest.resetModules()
  jest.doMock('react', () => React)
  jest.doMock('../../lib/authFetch', () => ({ authFetch: jest.fn() }))
  ;({ authFetch } = require('../../lib/authFetch'))
  ;({ useExchangeRates } = require('../useExchangeRates'))
  try { localStorage.clear() } catch { /* jsdom sin storage */ }
})

const okRates = (rates, timestamp = 't1') => ({
  ok: true,
  status: 200,
  json: async () => ({ rates, timestamp }),
})

describe('useExchangeRates: la identidad de convert', () => {
  it('convert cambia de identidad cuando las tasas ATERRIZAN', async () => {
    let resolve
    authFetch.mockReturnValue(new Promise((r) => { resolve = r }))

    const { result, unmount } = renderHook(() => useExchangeRates('USD'))
    const before = result.current.convert

    // Antes de que lleguen las tasas no hay número correcto que inventar.
    expect(before(1000, 'GTQ', 'USD')).toBe(1000)

    await act(async () => { resolve(okRates({ USD: 1, GTQ: 7.7 })) })

    // ESTA es la aserción que el bug rompía: sin `rates` en las deps la
    // identidad no cambiaba nunca, así que ningún memo de Flujo recomputaba.
    expect(result.current.convert).not.toBe(before)
    expect(result.current.convert(1000, 'GTQ', 'USD')).toBeCloseTo(1000 / 7.7, 6)
    unmount()
  })

  it('convert CONSERVA su identidad si el poll trae las mismas tasas', async () => {
    authFetch.mockResolvedValue(okRates({ USD: 1, GTQ: 7.7 }))

    const { result, unmount } = renderHook(() => useExchangeRates('USD'))
    await act(async () => {})
    const settled = result.current.convert

    // Segundo fetch con EXACTAMENTE las mismas tasas: es lo que hace el poll
    // de cada 15 minutos cuando el FX no se movió. Publicar identidad nueva
    // acá re-dispararía los memos y los dos efectos que releen Firestore.
    await act(async () => { await result.current.refresh() })
    expect(result.current.convert).toBe(settled)
    unmount()
  })

  it('una tasa que SI cambio publica identidad nueva', async () => {
    authFetch.mockResolvedValueOnce(okRates({ USD: 1, GTQ: 7.7 }))

    const { result, unmount } = renderHook(() => useExchangeRates('USD'))
    await act(async () => {})
    const first = result.current.convert

    authFetch.mockResolvedValueOnce(okRates({ USD: 1, GTQ: 7.9 }, 't2'))
    await act(async () => { await result.current.refresh() })

    expect(result.current.convert).not.toBe(first)
    expect(result.current.convert(1000, 'GTQ', 'USD')).toBeCloseTo(1000 / 7.9, 6)
    unmount()
  })
})

describe('useExchangeRates: nunca inventa un numero', () => {
  it('sin tasas devuelve el monto CRUDO, no un cero ni una conversion falsa', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 503 })

    const { result, unmount } = renderHook(() => useExchangeRates('USD'))
    await act(async () => {})

    expect(result.current.convert(1000, 'GTQ', 'USD')).toBe(1000)
    unmount()
  })

  it('una moneda sin tasa devuelve el monto crudo en vez de convertir con otra', async () => {
    authFetch.mockResolvedValue(okRates({ USD: 1, GTQ: 7.7 }))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const { result, unmount } = renderHook(() => useExchangeRates('USD'))
    await act(async () => {})

    expect(result.current.convert(1000, 'XYZ', 'USD')).toBe(1000)
    warn.mockRestore()
    unmount()
  })

  it('descarta tasas invalidas en vez de dejarlas entrar', async () => {
    authFetch.mockResolvedValue(okRates({ USD: 1, GTQ: 7.7, BAD: 0, WORSE: -1, NOPE: 'x' }))

    const { result, unmount } = renderHook(() => useExchangeRates('USD'))
    await act(async () => {})

    // Una tasa de 0 dividiría por cero; una negativa voltearía el signo del
    // dinero. Las tres se descartan y esas monedas caen al monto crudo.
    expect(result.current.convert(1000, 'BAD', 'USD')).toBe(1000)
    expect(result.current.convert(1000, 'WORSE', 'USD')).toBe(1000)
    expect(result.current.convert(1000, 'GTQ', 'USD')).toBeCloseTo(1000 / 7.7, 6)
    unmount()
  })
})
