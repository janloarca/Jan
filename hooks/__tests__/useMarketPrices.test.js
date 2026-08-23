// Segundo hook con arnés. Lo que se fija acá no es "el hook trae precios":
// son los cuatro invariantes que ya costaron un bug de producción cada uno.
//
// Las trampas del arnés están documentadas en test-utils/hookHarness.js.

const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')

let useMarketPrices, authFetch

// `/api/prices` y `/api/prices/dividends` se piden en paralelo; el mock
// responde según la URL para no depender del orden de las llamadas.
function mockApi({ prices = {}, dividends = {} } = {}) {
  authFetch.mockImplementation((url) => {
    if (String(url).includes('/dividends')) return Promise.resolve(jsonResponse({ dividends }))
    return Promise.resolve(jsonResponse({ prices }))
  })
}

const stock = (o) => ({ id: 'i1', symbol: 'AAPL', type: 'Stock', quantity: 1, ...o })

// El array de items va por `initialProps` y NO inline dentro del callback de
// render: `fetchPrices` depende de la IDENTIDAD de `items` y el efecto depende
// de `fetchPrices`, asi que un array nuevo en cada render dispara un fetch en
// cada render (bucle). En produccion `items` llega de un memo estable, asi que
// pasarlo por props es lo que refleja el uso real.

beforeEach(() => {
  jest.resetModules()
  pinReact()
  jest.doMock('../../lib/authFetch', () => ({ authFetch: jest.fn() }))
  ;({ authFetch } = require('../../lib/authFetch'))
  ;({ useMarketPrices } = require('../useMarketPrices'))
})

// ⛔ FASE FE. La bandera que de verdad protege las escrituras.
//
// `loading` se arma SOLO en el primerísimo fetch de la sesión, a propósito:
// armarla en cada refresco haría destellar una pantalla de carga cada 5
// minutos. Pero eso la vuelve INÚTIL como semáforo de escritura, y cuatro
// efectos de useDashboardData (snapshot diario, backfill, dividendos, limpieza
// de corruptos) la usaban justo para eso: durante un refresco de fondo el
// semáforo no protegía nada y un precio momentáneamente malo podía grabarse a
// Firestore. Con broker conectado el snapshot del día no se corrige el resto
// del día, así que el precio malo quedaba pegado: los "bumps" que reportó el
// usuario. `isFetching` es la señal correcta y no alimenta ninguna UI, así que
// no puede reintroducir el destello.
describe('loading vs isFetching: el semaforo de escritura', () => {
  it('el primer fetch arma las DOS', async () => {
    mockApi({ prices: { AAPL: { price: 100 } } })
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock()] } })

    // Sin esperar: el fetch acaba de arrancar.
    expect(result.current.loading).toBe(true)
    expect(result.current.isFetching).toBe(true)

    await act(async () => {})
    expect(result.current.loading).toBe(false)
    expect(result.current.isFetching).toBe(false)
    unmount()
  })

  it('un refresco de FONDO arma isFetching y deja loading en false', async () => {
    mockApi({ prices: { AAPL: { price: 100 } } })
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock()] } })
    await act(async () => {})

    // Segundo fetch: es lo que hace el poll de 5 minutos. Se deja PENDIENTE
    // solo la llamada de precios; la de dividendos resuelve al toque, porque
    // las dos van dentro del mismo `Promise.all` y dejar las dos colgadas con
    // un unico resolver no cierra nunca.
    let settlePrices
    authFetch.mockImplementation((url) => {
      if (String(url).includes('/dividends')) return Promise.resolve(jsonResponse({ dividends: {} }))
      return new Promise((r) => { settlePrices = r })
    })
    act(() => { result.current.refresh() })

    // ESTA es la distinción entera. Si alguien "simplifica" borrando
    // isFetching y dejando solo loading, los cuatro escritores vuelven a
    // quedar sin semáforo durante los refrescos de fondo.
    expect(result.current.isFetching).toBe(true)
    expect(result.current.loading).toBe(false)

    await act(async () => { settlePrices(jsonResponse({ prices: { AAPL: { price: 101 } } })) })
    expect(result.current.isFetching).toBe(false)
    unmount()
  })
})

// ⛔ Defensa en profundidad: la lista es BLANCA, no negra.
describe('un item que no cotiza nunca recibe una cotizacion', () => {
  it('una cuenta de efectivo llamada USD no se cotiza como el ETF USD', async () => {
    // La cartera es MIXTA a propósito, y esto no es un detalle del fixture: con
    // SOLO la cuenta de efectivo el hook ni siquiera sale a la red (la lista de
    // símbolos queda vacía y retorna antes), así que el mapa de precios llega
    // vacío y el test pasaría sin ejercitar nada. Con una acción de verdad al
    // lado, el fetch SÍ ocurre, el mapa SÍ trae 'USD', y recién ahí se prueba
    // lo que importa: el guard del enriquecimiento, que es la segunda capa.
    mockApi({ prices: { AAPL: { price: 100 }, USD: { price: 25.5 } } })
    const cash = { id: 'c1', symbol: 'USD', type: 'Cuenta Monetaria', quantity: 1, purchasePrice: 5000 }
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock(), cash] } })
    await act(async () => {})

    const [aapl, usd] = result.current.enrichedItems
    expect(aapl.currentPrice).toBe(100)
    // El saldo guardado manda: sobreescribirlo con una cotización convertiría
    // una cuenta de $5,000 en una de $25.50.
    expect(usd.currentPrice).toBeUndefined()
    expect(usd.purchasePrice).toBe(5000)
    unmount()
  })

  it('una accion de verdad SI recibe su cotizacion', async () => {
    mockApi({ prices: { AAPL: { price: 100, change1d: 1.5, currency: 'USD' } } })
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock()] } })
    await act(async () => {})

    expect(result.current.enrichedItems[0].currentPrice).toBe(100)
    expect(result.current.enrichedItems[0].change1d).toBe(1.5)
    unmount()
  })
})

// ⛔ FASE KN. La frescura viaja con el precio, o el precio miente en silencio.
describe('la frescura de la cotizacion no se tira', () => {
  it('una cotizacion RANCIA llega marcada, con su fecha', async () => {
    // `priceItems` cae a un respaldo last-known-good con expiración de SIETE
    // días y lo devuelve marcado. Esos dos campos existían y este
    // enriquecimiento los tiraba: una cotización de la semana pasada se
    // dibujaba en "movimientos de HOY" idéntica a una viva.
    mockApi({ prices: { AAPL: { price: 100, stale: true, asOf: '2026-08-14' } } })
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock()] } })
    await act(async () => {})

    expect(result.current.enrichedItems[0]._priceStale).toBe(true)
    expect(result.current.enrichedItems[0]._priceAsOf).toBe('2026-08-14')
    unmount()
  })

  it('una cotizacion VIVA no queda marcada como rancia', async () => {
    mockApi({ prices: { AAPL: { price: 100 } } })
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock()] } })
    await act(async () => {})
    expect(result.current.enrichedItems[0]._priceStale).toBe(false)
    unmount()
  })

  it('la VENTANA del cambio diario viaja: una sesion cerrada no es "hoy"', async () => {
    // Para una acción, change1d es la última sesión regular COMPLETADA, así que
    // un sábado sigue siendo el viernes; para cripto es una ventana rodante.
    // Sin estos campos, la tarjeta de movimientos titulaba "hoy" un dato del
    // viernes, y Amigos comparaba gente con frescuras distintas.
    mockApi({ prices: { AAPL: { price: 100, change1dWindow: 'session', change1dAsOf: '2026-08-21' } } })
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock()] } })
    await act(async () => {})

    expect(result.current.enrichedItems[0]._change1dWindow).toBe('session')
    expect(result.current.enrichedItems[0]._change1dAsOf).toBe('2026-08-21')
    unmount()
  })
})

// Lo que el usuario tecleó gana sobre lo que el proveedor detecta.
describe('el dividendo detectado no pisa lo que configuro el usuario', () => {
  it('no toca un incomeAmount ya configurado', async () => {
    mockApi({
      prices: { AAPL: { price: 100 } },
      dividends: { AAPL: { hasDividend: true, dividendYield: 5, lastAmount: 99 } },
    })
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock({ incomeAmount: 42 })] } })
    await act(async () => {})

    expect(result.current.enrichedItems[0].incomeAmount).toBe(42)
    expect(result.current.enrichedItems[0].dividendYield).toBeUndefined()
    unmount()
  })

  it('sin nada configurado si aplica lo detectado', async () => {
    mockApi({
      prices: { AAPL: { price: 100 } },
      dividends: { AAPL: { hasDividend: true, dividendYield: 5, lastAmount: 1.2, paymentMonths: [2, 5, 8, 11] } },
    })
    const { result, unmount } = renderHook(({ items }) => useMarketPrices(items), { initialProps: { items: [stock()] } })
    await act(async () => {})

    expect(result.current.enrichedItems[0].dividendYield).toBe(5)
    expect(result.current.enrichedItems[0].incomeMonths).toEqual([2, 5, 8, 11])
    unmount()
  })
})
