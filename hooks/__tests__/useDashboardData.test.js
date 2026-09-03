// El hook grande, y el punto NO es probar sus fórmulas: esas ya viven en
// módulos puros de `lib/` con sus propios tests. Lo que no tenía forma de
// probarse es la CAPA DE COMPOSICIÓN, que es donde estuvieron los bugs.
//
// Por eso se falsean los cinco hooks hermanos en vez de mockear Firestore
// entero: el límite del mock es exactamente el límite donde viven los defectos
// (un campo que no se re-exporta, un semáforo que no protege lo que debería,
// un ref que no se re-arma).
//
// Las trampas del arnés están en test-utils/hookHarness.js.

const { renderHook, act, pinReact, jsonResponse } = require('../../test-utils/hookHarness')

let useDashboardData
let fakeFirestore, fakePrices, fakeRates, authFetch

// --- el doble de useFirestoreItems ------------------------------------------
// Se declaran TODAS las llaves que el hook desestructura. Una que falte llega
// como `undefined` sin ruido, que es precisamente la clase de bug que este
// archivo existe para atrapar.
function makeFirestore(over = {}) {
  const noop = jest.fn(async () => {})
  return {
    items: [], snapshots: [], transactions: [], goals: {}, settings: {}, profile: null,
    loading: false, loadError: null,
    addItem: jest.fn(async () => 'new-id'), updateItem: noop, deleteItem: noop,
    deleteAllItems: noop, deleteItemGroup: noop,
    saveSnapshot: jest.fn(async () => {}), deleteSnapshot: noop, deleteAllSnapshots: noop,
    deleteDemoData: noop,
    addTransaction: noop, updateTransaction: noop, deleteTransaction: noop, deleteAllTransactions: noop,
    alerts: [], addAlert: noop, deleteAlert: noop, updateAlert: noop,
    lots: [], addLot: noop, closeLotsFIFO: noop, transferFunds: noop,
    executeSaleAtomic: noop, executeContribution: noop, bulkImport: noop,
    bulkWriting: false, bulkWritingRef: { current: false }, deletionEpoch: 0,
    portfolios: [], addPortfolio: noop, deletePortfolio: noop,
    financeTransactions: [], addFinanceTransaction: noop, updateFinanceTransaction: noop,
    deleteFinanceTransaction: noop, deleteAllFinanceTransactions: noop,
    deleteFinanceTransactionsByIds: noop,
    saveGoals: noop, saveSettings: jest.fn(async () => {}), saveProfile: noop,
    incomePlan: null, saveIncomePlan: noop,
    saveItemSnapshots: noop, loadItemSnapshots: jest.fn(async () => ({})),
    ...over,
  }
}

const item = (o) => ({
  id: 'i1', name: 'Acme', symbol: 'ACME', type: 'Stock',
  quantity: 10, currentPrice: 100, purchasePrice: 80,
  currency: 'USD', acquisitionDate: '2026-01-05', createdAt: '2026-01-05',
  ...o,
})

function setup(over = {}) {
  fakeFirestore = makeFirestore(over.firestore)
  fakePrices = {
    enrichedItems: fakeFirestore.items,
    prices: {}, loading: false, isFetching: false, error: null, lastUpdate: null,
    refresh: jest.fn(),
    ...over.prices,
  }
  fakeRates = {
    rates: { USD: 1 }, convert: (a) => a, convertItemValue: () => 0,
    loading: false, error: null, lastUpdate: null, refresh: jest.fn(),
    ...over.rates,
  }

  jest.doMock('../useFirestoreItems', () => ({ useFirestoreItems: () => fakeFirestore }))
  jest.doMock('../useMarketPrices', () => ({ useMarketPrices: () => fakePrices }))
  jest.doMock('../useExchangeRates', () => ({ useExchangeRates: () => fakeRates }))
  jest.doMock('../useBenchmark', () => ({
    useBenchmark: () => ({
      benchmarkData: null, benchmarkReturn: null, benchmarkName: 'S&P 500',
      loading: false, error: null, refetch: jest.fn(),
    }),
  }))
  jest.doMock('../useTabCoordination', () => ({
    useTabCoordination: () => ({ acquireLock: () => true, releaseLock: () => {} }),
  }))
  jest.doMock('../../lib/authFetch', () => ({
    authFetch: jest.fn(async () => jsonResponse({})),
    safeJson: jest.fn(async () => ({})),
  }))
  ;({ authFetch } = require('../../lib/authFetch'))
  ;({ useDashboardData } = require('../useDashboardData'))
  // El hook recibe la sesion por parametro, y `user` gatea TODOS los efectos
  // que escriben: sin sesion no se archiva nada (hay un test que lo fija).
  const opts = { user: { uid: 'u1' }, lang: 'es', activePortfolio: '__all__', activeEntity: '__all__', ...over.opts }
  return renderHook(() => useDashboardData(opts))
}

beforeEach(() => {
  jest.resetModules()
  pinReact()
  try { localStorage.clear() } catch { /* jsdom sin storage */ }
})

// ⛔ FASE JS. El bug que este archivo existe para hacer imposible.
//
// `useDashboardData` envuelve a `useFirestoreItems` y re-exporta una lista
// EXPLÍCITA de campos. `incomePlan` no estaba en esa lista, así que la tarjeta
// de proyección recibía `undefined`, mostraba "no hay ingresos planeados"
// sobre un plan que sí existía, y su `onSave` tampoco existía: las ediciones
// no se guardaban. Ni el build ni los tests lo veían — desestructurar un campo
// inexistente es JavaScript válido y devuelve undefined en silencio.
describe('el contrato del return: nada se pierde al re-exportar', () => {
  it('un plan de ingresos guardado LLEGA al consumidor', async () => {
    const plan = { chips: [{ id: 'c1', kind: 'monthly', amount: 15000 }], returnRate: 7 }
    const { result, unmount } = setup({ firestore: { incomePlan: plan } })
    await act(async () => {})

    expect(result.current.incomePlan).toBe(plan)
    expect(typeof result.current.saveIncomePlan).toBe('function')
    unmount()
  })

  it('toda funcion de escritura de Firestore sigue alcanzable', async () => {
    const { result, unmount } = setup()
    await act(async () => {})

    // La lista es explícita a propósito: si alguien quita una del re-export,
    // el consumidor la recibe como undefined y falla al invocarla, en runtime
    // y solo en la pantalla que la use.
    for (const fn of [
      'addItem', 'updateItem', 'deleteItem', 'deleteItemGroup', 'bulkImport',
      'addTransaction', 'deleteTransaction', 'saveSnapshot', 'saveSettings',
      'saveGoals', 'saveProfile', 'saveIncomePlan', 'addLot', 'closeLotsFIFO',
      'transferFunds', 'executeSaleAtomic', 'addFinanceTransaction',
      'saveItemSnapshots', 'loadItemSnapshots',
    ]) {
      expect(typeof result.current[fn]).toBe('function')
    }
    unmount()
  })

  // ⛔ FASE JA3. Un fallo de LECTURA de Firestore se veia como cuenta vacia: el
  // handler de error solo logueaba, `items` quedaba en [] y `loading` pasaba a
  // false igual, asi que un usuario con 40 cuentas veia la pantalla de
  // bienvenida invitandolo a crear cuentas que ya existen. `loadError` es lo
  // que permite distinguir "no tenes nada" de "no pudimos leer".
  it('un fallo de lectura llega como error, no como cuenta vacia', async () => {
    const { result, unmount } = setup({ firestore: { items: [], loadError: 'unavailable' } })
    await act(async () => {})

    expect(result.current.loadError).toBe('unavailable')
    expect(result.current.items).toEqual([])
    unmount()
  })

  it('los datos crudos tambien pasan, no solo lo derivado', async () => {
    const it1 = item()
    const { result, unmount } = setup({ firestore: { items: [it1], transactions: [{ id: 't1' }] } })
    await act(async () => {})

    expect(result.current.items).toEqual([it1])
    expect(result.current.transactions).toHaveLength(1)
    unmount()
  })
})

// ⛔ FASE FE + FASE GB. Los semaforos que protegen lo que se ESCRIBE.
//
// El snapshot diario es permanente: con broker conectado no se corrige el
// resto del día. Escribirlo con precios a medio llegar, o a mitad de un import
// masivo (que entrega estados intermedios con items duplicados), deja un total
// inflado archivado para siempre. Eso produjo el diente de sierra.
describe('ningun escritor corre con los datos a medio asentar', () => {
  const withItems = { items: [item()] }

  // CONTROL POSITIVO, y no es opcional: sin el, los cuatro tests de "no
  // escribe" de abajo podrian estar pasando vaciamente (el efecto nunca
  // dispara por otra razon y el test da verde sin probar nada). Con este,
  // cada negativo significa "la compuerta lo detuvo", no "nunca hubo nada
  // que detener".
  it('con todas las compuertas abiertas SI archiva el dia', async () => {
    const enriched = [item()]
    const { unmount } = setup({ firestore: { items: enriched }, prices: { enrichedItems: enriched } })
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('no escribe mientras los precios estan en vuelo', async () => {
    const { result, unmount } = setup({
      firestore: withItems,
      prices: { enrichedItems: [item()], isFetching: true },
    })
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).not.toHaveBeenCalled()
    unmount()
  })

  it('no escribe durante un import masivo', async () => {
    const { result, unmount } = setup({
      firestore: { ...withItems, bulkWriting: true },
      prices: { enrichedItems: [item()] },
    })
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).not.toHaveBeenCalled()
    unmount()
  })

  it('no escribe mientras los datos cargan', async () => {
    const { result, unmount } = setup({
      firestore: { ...withItems, loading: true },
      prices: { enrichedItems: [item()] },
    })
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).not.toHaveBeenCalled()
    unmount()
  })

  it('sin ningun activo tampoco escribe', async () => {
    const { unmount } = setup()
    await act(async () => {})
    expect(fakeFirestore.saveSnapshot).not.toHaveBeenCalled()
    unmount()
  })
})

// El patrimonio: no la formula (vive en utils, ya testeada) sino que el hook la
// alimente con lo correcto.
describe('el patrimonio sale de los items ENRIQUECIDOS', () => {
  it('usa el precio vivo, no el de compra', async () => {
    const { result, unmount } = setup({
      firestore: { items: [item()] },
      prices: { enrichedItems: [item({ currentPrice: 150 })] },
    })
    await act(async () => {})
    expect(result.current.netWorth).toBe(1500)
    unmount()
  })

  it('la deuda RESTA', async () => {
    const enriched = [item({ currentPrice: 100 }), item({ id: 'd1', symbol: 'CARD', isDebt: true, quantity: 1, currentPrice: 400, type: 'Deuda' })]
    const { result, unmount } = setup({
      firestore: { items: enriched },
      prices: { enrichedItems: enriched },
    })
    await act(async () => {})
    expect(result.current.netWorth).toBe(1000 - 400)
    expect(result.current.totalAssets).toBe(1000)
    unmount()
  })
})

// ⛔ FASE LH. La carrera import ↔ auto-sync que FASE KF dejo anotada.
//
// handleIBKRSync corre DESPUES de una descarga del Flex de hasta ~90s. Con
// `items` leido del CLOSURE, la reconciliacion comparaba contra la foto de
// cuando la corrida se armo: si un import de archivo escribio posiciones en
// el medio, el sync no las veia y las volvia a CREAR con id nuevo (posiciones
// duplicadas, sin heal posterior: dataCompleteness excluye items de broker a
// proposito). El cierre tiene dos mitades y las dos se fijan aca: (1) esperar
// a que cualquier escritura masiva termine (bulkWritingRef, incluido su
// colchon de eco), y (2) tomar la foto de itemsRef DESPUES de esperar.
describe('handleIBKRSync: espera al import y reconcilia contra la foto fresca', () => {
  const feedPos = () => ({
    symbol: 'ACME', conid: 'c123', quantity: 5, currentPrice: 100,
    purchasePrice: 90, currency: 'USD', type: 'Stock', _ibkrAccountId: 'U1',
  })

  it('control: sin escritura en curso, una posicion nueva se crea de una', async () => {
    const bulkImport = jest.fn(async () => {})
    const { result, unmount } = setup({ firestore: { items: [], bulkImport } })
    await act(async () => {})
    await act(async () => {
      await result.current.handleIBKRSync({ items: [feedPos()] }, 'merge')
    })
    expect(bulkImport).toHaveBeenCalledTimes(1)
    const payload = bulkImport.mock.calls[0][0]
    expect(payload.items).toHaveLength(1)
    expect(payload.updateItems).toHaveLength(0)
    unmount()
  })

  it('una posicion creada DESPUES de armar el closure se ACTUALIZA, no se duplica', async () => {
    const bulkImport = jest.fn(async () => {})
    const bulkWritingRef = { current: true } // un import esta escribiendo
    const { result, rerender, unmount } = setup({
      firestore: { items: [], bulkImport, bulkWritingRef },
    })
    await act(async () => {})

    // El sync arranca con el portafolio VACIO en su closure...
    let syncDone
    act(() => { syncDone = result.current.handleIBKRSync({ items: [feedPos()] }, 'merge') })

    // ...y mientras espera al import, el import termina de escribir ESA misma
    // posicion (el eco del listener entrega los items nuevos).
    await act(async () => { await new Promise((r) => setTimeout(r, 300)) })
    expect(bulkImport).not.toHaveBeenCalled() // sigue esperando: no escribio a ciegas

    fakeFirestore = makeFirestore({
      items: [item({ id: 'imported-1', symbol: 'ACME', conid: 'c123', _source: 'ibkr', _ibkrAccountId: 'U1' })],
      bulkImport, bulkWritingRef,
    })
    rerender()
    bulkWritingRef.current = false

    await act(async () => { await syncDone })

    // Con el closure viejo esto salia en `items` (posicion DUPLICADA); con la
    // foto fresca sale como update sobre la que el import acaba de crear.
    expect(bulkImport).toHaveBeenCalledTimes(1)
    const payload = bulkImport.mock.calls[0][0]
    expect(payload.items).toHaveLength(0)
    expect(payload.updateItems).toHaveLength(1)
    expect(payload.updateItems[0].id).toBe('imported-1')
    unmount()
  })

  it('un import COLGADO no se espera para siempre: el sync rehusa con su razon', async () => {
    jest.useFakeTimers()
    try {
      const bulkImport = jest.fn(async () => {})
      const bulkWritingRef = { current: true } // nunca se suelta
      const { result, unmount } = setup({ firestore: { items: [], bulkImport, bulkWritingRef } })
      await act(async () => {})

      let rejection = null
      act(() => {
        result.current.handleIBKRSync({ items: [feedPos()] }, 'merge').catch((e) => { rejection = e })
      })
      await act(async () => { await jest.advanceTimersByTimeAsync(31000) })

      expect(rejection).not.toBeNull()
      expect(rejection.message).toMatch(/importaci/i)
      expect(bulkImport).not.toHaveBeenCalled() // rehusar, jamas escribir a ciegas
      unmount()
    } finally {
      jest.useRealTimers()
    }
  })
})

// ⛔ La publicación diaria a Amigos, desde el TABLERO.
//
// El defecto que cierra: los números de una persona solo se publicaban al abrir
// /friends, así que quien no entra a esa pantalla deja su fila congelada en la
// foto de la última visita mientras el grupo la rankea al lado de filas de hoy.
// Nada en la pantalla dice que esa fila es vieja: solo se ve peor o mejor.
//
// Lo que estos tests fijan NO es el payload (eso vive en lib/friendsPublish.js
// con sus propios tests) sino las COMPUERTAS, que es donde este repo ya pagó
// caro: publicar un número equivocado es peor que publicar uno viejo, y acá el
// número lo leen otras personas.
describe('publicar a Amigos: una vez por día y con los datos ya asentados', () => {
  const enriched = [item()]
  const base = { firestore: { items: enriched }, prices: { enrichedItems: enriched }, opts: { publishFriends: true } }
  const friendsCalls = () => authFetch.mock.calls.filter((c) => c[0] === '/api/friends')

  // CONTROL POSITIVO. Sin él, cada negativo de abajo podría significar "el
  // efecto nunca dispara por otra razón" en vez de "la compuerta lo detuvo".
  it('con todas las compuertas abiertas SI publica, una sola vez', async () => {
    const { unmount } = setup(base)
    await act(async () => {})
    const calls = friendsCalls()
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0][1].body)
    expect(body.action).toBe('sync')
    expect(body.stats.all).toBeTruthy()
    unmount()
  })

  it('estampa el dia SOLO despues de que la publicacion salga bien', async () => {
    const { unmount } = setup(base)
    await act(async () => {})
    const stamps = fakeFirestore.saveSettings.mock.calls.filter((c) => c[0]?._lastFriendsPublish)
    expect(stamps).toHaveLength(1)
    expect(stamps[0][0]._lastFriendsPublish).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    unmount()
  })

  // ⛔ authFetch NO lanza ante un 4xx/5xx (la lección de lib/ibkrVault.js). Sin
  // leer el status, un fallo del servidor estampaba el día igual y la fila
  // quedaba sin publicar hasta mañana, con la app creyendo que ya lo hizo.
  it('un fallo del servidor NO estampa el dia', async () => {
    const { unmount } = setup(base)
    authFetch.mockImplementation(async (url) => (
      url === '/api/friends' ? { ok: false, status: 500, json: async () => ({}) } : jsonResponse({})
    ))
    await act(async () => {})
    expect(fakeFirestore.saveSettings.mock.calls.filter((c) => c[0]?._lastFriendsPublish)).toHaveLength(0)
    unmount()
  })

  it('ya publicado HOY no vuelve a publicar', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const { unmount } = setup({
      ...base,
      firestore: { items: enriched, settings: { _lastFriendsPublish: today } },
    })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(0)
    unmount()
  })

  it('publicado AYER si vuelve a publicar', async () => {
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const { unmount } = setup({
      ...base,
      firestore: { items: enriched, settings: { _lastFriendsPublish: ayer } },
    })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(1)
    unmount()
  })

  it('con Amigos apagado NO publica nada', async () => {
    const { unmount } = setup({
      ...base,
      firestore: { items: enriched, settings: { friendsEnabled: false } },
    })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(0)
    unmount()
  })

  // /friends publica por su cuenta al montar; sin este gate la misma visita
  // escribiría dos veces lo mismo.
  it('sin publishFriends (o sea /friends) el tablero no publica', async () => {
    const { unmount } = setup({ ...base, opts: {} })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(0)
    unmount()
  })

  // Las tres compuertas de "el dato todavía no es cierto". `ratesLoading` en
  // particular: sin tasas `convert` devuelve el monto CRUDO, así que una
  // cartera en quetzales publicaría pesos calculados 1:1 (FASE JA3).
  it('no publica con los precios en vuelo', async () => {
    const { unmount } = setup({ ...base, prices: { enrichedItems: enriched, isFetching: true } })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(0)
    unmount()
  })

  it('no publica con las tasas todavia cargando', async () => {
    const { unmount } = setup({ ...base, rates: { loading: true } })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(0)
    unmount()
  })

  it('no publica mientras los datos cargan', async () => {
    const { unmount } = setup({
      ...base,
      firestore: { items: enriched, loading: true },
    })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(0)
    unmount()
  })

  it('una cartera vacia no publica una fila de puros guiones', async () => {
    const { unmount } = setup({ firestore: {}, prices: { enrichedItems: [] }, opts: { publishFriends: true } })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(0)
    unmount()
  })

  // ⛔ FASE NA. El contrato del modo demo es "cero side-effects persistentes":
  // los vetos de snapshots y dividendos ya existían, y este efecto publicaba
  // igual — con UN item de ejemplo en la mezcla, el YTD que leen tus amigos se
  // calcula sobre dinero inventado. El gate vive en lib/friendsPublish.js
  // (hasSomethingToPublish); este test fija que el efecto REAL del hook pasa
  // por él, no una copia.
  it('con datos de DEMO en la cartera no se publica nada', async () => {
    const mixed = [item(), item({ id: 'demo-1', symbol: 'AAPL', _source: 'demo' })]
    const { unmount } = setup({
      firestore: { items: mixed }, prices: { enrichedItems: mixed }, opts: { publishFriends: true },
    })
    await act(async () => {})
    expect(friendsCalls()).toHaveLength(0)
    // Y el día NO se estampa: al borrar el demo, la publicación real del día
    // tiene que poder salir.
    expect(fakeFirestore.saveSettings.mock.calls.filter((c) => c[0]?._lastFriendsPublish)).toHaveLength(0)
    unmount()
  })
})

// ⛔ FASE LU. "La deuda tampoco debería de afectar el YTD" (decisión del
// usuario, 28 ago 2026): el retorno mide ACTIVOS. El caso real: crear una
// deuda de 4,000 escribía un DEPOSIT vinculado a ella y el Dietz daba
// (−4,000 de patrimonio) − (+4,000 de flujo) = −8,000 de pérdida inventada
// (el −24.13% de la captura). Estos tests fijan la propiedad de punta a punta
// con el hook REAL: agregar una deuda, con su DEPOSIT envenenado incluido, no
// mueve returnYTD ni ytdChange ni un centavo — y el patrimonio NETO sí baja,
// porque esto cambia qué mide el rendimiento, nunca cuánto tienes.
describe('FASE LU: el YTD mide activos, la deuda no lo mueve', () => {
  const bank = () => item({ id: 'b1', symbol: 'BANK1', type: 'Bank', quantity: 1, currentPrice: 11000, purchasePrice: 10000 })
  const debt = () => item({ id: 'd9', symbol: 'AIXEN', type: 'Deuda', isDebt: true, quantity: 1, currentPrice: 4000, purchasePrice: 4000, acquisitionDate: '2026-08-25', createdAt: '2026-08-25' })
  const yr = new Date().getUTCFullYear()
  const snaps = [
    { id: `${yr}-01-01`, date: `${yr}-01-01`, netWorthUSD: 10000, totalActivosUSD: 10000, totalDebtUSD: 0, _source: 'daily' },
    { id: `${yr}-06-01`, date: `${yr}-06-01`, netWorthUSD: 10500, totalActivosUSD: 10500, totalDebtUSD: 0, _source: 'daily' },
  ]

  async function run(items, transactions = []) {
    const { result, unmount } = setup({
      firestore: { items, transactions, snapshots: snaps },
      prices: { enrichedItems: items },
    })
    await act(async () => {})
    const out = {
      returnYTD: result.current.returnYTD,
      ytdChange: result.current.ytdChange,
      netWorth: result.current.netWorth,
      totalAssets: result.current.totalAssets,
    }
    unmount()
    return out
  }

  it('línea base: banco 10,000 → 11,000 desde el ancla de enero = +10%', async () => {
    const base = await run([bank()])
    expect(base.ytdChange).toBeCloseTo(1000, 6)
    expect(base.returnYTD).toBeCloseTo(10, 6)
  })

  it('agregar la deuda CON su DEPOSIT envenenado no mueve el YTD un centavo', async () => {
    const base = await run([bank()])
    const withDebt = await run(
      [bank(), debt()],
      [{ id: 'tx1', type: 'DEPOSIT', _linkedItemId: 'd9', totalAmount: 4000, currency: 'USD', date: `${yr}-08-25`, _source: 'manual_new_account' }],
    )
    expect(withDebt.returnYTD).toBeCloseTo(base.returnYTD, 10)
    expect(withDebt.ytdChange).toBeCloseTo(base.ytdChange, 10)
    // El patrimonio NETO sí la resta: el valor no miente, el retorno no la mide.
    expect(withDebt.netWorth).toBeCloseTo(base.netWorth - 4000, 6)
    expect(withDebt.totalAssets).toBeCloseTo(base.totalAssets, 6)
  })

  it('pagar la deuda desde el banco tampoco lo mueve: el WITHDRAWAL sintético netea la bajada', async () => {
    const base = await run([bank()])
    const paidBank = item({ id: 'b1', symbol: 'BANK1', type: 'Bank', quantity: 1, currentPrice: 10678.64, purchasePrice: 10000 })
    // El pago se fecha a MITAD de la ventana YTD y no en un día del calendario
    // escrito a mano: con una fecha fija su peso Dietz cambia cada día que pasa
    // (y en enero del año siguiente queda en el FUTURO), o sea el test medía
    // distinto según el día en que se corriera.
    const anchorMs = Date.UTC(yr, 0, 1)
    const payDate = new Date(anchorMs + (Date.now() - anchorMs) / 2).toISOString().slice(0, 10)
    const after = await run(
      [paidBank, debt()],
      [{ id: 'tx2', type: 'TRANSFER', _debtItemId: 'd9', _originItemId: 'b1', _toAmount: 321.36, totalAmount: 321.36, currency: 'USD', date: payDate, _source: 'manual_debt_payment' }],
    )
    // La cuenta bajó 321.36 pagando la deuda: eso NO es una pérdida. La
    // GANANCIA vuelve a 1,000 exactos, y esa es la propiedad de FASE LU: sin el
    // WITHDRAWAL sintético serían 678.64, o sea el pago se leería como pérdida.
    expect(after.ytdChange).toBeCloseTo(base.ytdChange, 4)
    // El PORCENTAJE no puede ser idéntico al de la línea base, y eso es
    // CORRECTO: Modified Dietz pondera el retiro por el tiempo que ese dinero
    // ya no estuvo invertido, así que el capital promedio del período es algo
    // menor que 10,000 y el mismo 1,000 de ganancia rinde un pelo más. El techo
    // de ese efecto es un retiro fechado en el ancla misma (peso 1):
    // 1000/(10000−321.36) = 10.332%. El bug cae del OTRO lado (678.64/10000 =
    // 6.79%), así que el piso es lo que de verdad tiene dientes.
    expect(after.returnYTD).toBeGreaterThanOrEqual(base.returnYTD - 1e-9)
    expect(after.returnYTD).toBeLessThanOrEqual(base.returnYTD + 0.4)
  })
})

// ⛔ FASE ML. "Aportado / Retirado" es una pregunta de FLUJOS, así que tiene que
// vivir en el MISMO universo solo-activos que el resto del rendimiento (FASE
// LU). Con la lista cruda una deuda envenenaba las DOS cifras: el DEPOSIT de
// apertura de una deuda vieja contaba como capital aportado, y el WITHDRAWAL de
// `manual_loan_proceeds` (el que netea el Dietz cuando el préstamo se fue fuera
// de la app) se mostraba como "Retirado" en ROJO, dinero que nadie sacó.
//
// El NETO salía bien por casualidad, porque los dos errores se cancelan: es el
// caso de "el total correcto con las partes equivocadas", y por eso las
// aserciones son sobre las cifras BRUTAS y no sobre el neto.
describe('FASE ML: Aportado/Retirado no cuenta la deuda', () => {
  const bank = () => item({ id: 'b1', symbol: 'BANK1', type: 'Bank', quantity: 1, currentPrice: 10000, purchasePrice: 10000 })
  const debt = () => item({ id: 'd9', symbol: 'AIXEN', type: 'Deuda', isDebt: true, quantity: 1, currentPrice: 4000, purchasePrice: 4000 })

  async function run(items, transactions = []) {
    const { result, unmount } = setup({
      firestore: { items, transactions },
      prices: { enrichedItems: items },
    })
    await act(async () => {})
    const out = { ...result.current.contributionsSummary }
    unmount()
    return out
  }

  const aporteReal = { id: 't0', type: 'DEPOSIT', totalAmount: 10000, currency: 'USD', date: '2026-01-05', _linkedItemId: 'b1' }

  it('línea base: un aporte real de 10,000 y nada retirado', async () => {
    const r = await run([bank()], [aporteReal])
    expect(r.totalContributed).toBeCloseTo(10000, 6)
    expect(r.totalWithdrawn).toBeCloseTo(0, 6)
  })

  it('el DEPOSIT envenenado de una deuda vieja NO es capital aportado', async () => {
    const r = await run([bank(), debt()], [
      aporteReal,
      { id: 't1', type: 'DEPOSIT', totalAmount: 4000, currency: 'USD', date: '2026-08-25', _linkedItemId: 'd9', _source: 'manual_new_account' },
    ])
    expect(r.totalContributed).toBeCloseTo(10000, 6)
  })

  it('un préstamo que se fue FUERA de la app no se muestra como Retirado', async () => {
    const r = await run([bank(), debt()], [
      aporteReal,
      { id: 't2', type: 'WITHDRAWAL', totalAmount: 4000, currency: 'USD', date: '2026-08-25', _linkedItemId: 'd9', _loanItemId: 'd9', _source: 'manual_loan_proceeds' },
    ])
    expect(r.totalWithdrawn).toBeCloseTo(0, 6)
    expect(r.totalContributed).toBeCloseTo(10000, 6)
  })

  // Control POSITIVO: un retiro REAL sigue contando, o si no "retirado 0"
  // pasaría por haber dejado de contar retiros del todo.
  it('control: un retiro real del banco SÍ cuenta', async () => {
    const r = await run([bank()], [
      aporteReal,
      { id: 't3', type: 'WITHDRAWAL', totalAmount: 500, currency: 'USD', date: '2026-08-26', _linkedItemId: 'b1' },
    ])
    expect(r.totalWithdrawn).toBeCloseTo(500, 6)
  })
})

// ⛔ FASE MM. El MTD medía desde el DÍA 1 aunque su ancla fuera de otro día.
//
// `findMonthStartAnchor` busca el snapshot más cercano al día 1 en una ventana
// de ±5 días, así que puede devolver el del día 4 mientras `startTs` se quedaba
// en el día 1: un depósito del día 2 está DENTRO del valor de arranque y además
// se netea como flujo, o sea se resta dos veces. Es la lección de `jan1Ts`
// (FASE DV, "el ancla del YTD tiene FECHA") en la superficie que aquella pasada
// no tocó, y esta se PUBLICA a Amigos: el número mal se compara contra otras
// personas.
describe('FASE MM: el MTD mide desde donde arranca su ancla', () => {
  const bank = (price) => item({ id: 'b1', symbol: 'B', type: 'Bank', quantity: 1, currentPrice: price, purchasePrice: 10000 })
  const snap = (date, v) => ({ id: date, date, netWorthUSD: v, totalActivosUSD: v, totalDebtUSD: 0, _source: 'daily' })

  afterEach(() => jest.useRealTimers())

  async function run({ items, snapshots, transactions }) {
    const { result, unmount } = setup({ firestore: { items, snapshots, transactions }, prices: { enrichedItems: items } })
    await act(async () => {})
    const out = result.current.returnMTD
    unmount()
    return out
  }

  it('un depósito ya contenido en el ancla no se resta dos veces', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const mtd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-08-04', 10500)],
      transactions: [{ id: 'd1', type: 'DEPOSIT', totalAmount: 500, currency: 'USD', date: '2026-08-02', _linkedItemId: 'b1' }],
    })
    // Desde el ancla del día 4: (11000 − 10500) / 10500 = 4.7619%.
    // Con startTs clavado en el día 1 daba 0: el depósito se restaba dos veces.
    expect(mtd).toBeCloseTo(4.7619, 3)
  })

  it('un depósito del mes ANTERIOR, posterior al ancla, SÍ se netea', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const mtd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-07-30', 10000)],
      transactions: [{ id: 'd2', type: 'DEPOSIT', totalAmount: 500, currency: 'USD', date: '2026-07-31', _linkedItemId: 'b1' }],
    })
    // El depósito NO está en el valor del 30 de julio, así que tiene que
    // netearse. Con startTs en el día 1 caía FUERA de la ventana, no se neteaba
    // y esos 500 se leían como ganancia (10% en vez de ~5%).
    expect(mtd).toBeGreaterThan(0)
    expect(mtd).toBeLessThan(6)
  })

  // Control POSITIVO: sin flujos el número no se mueve. Sin esto, "ya no resta
  // de más" podría pasar por haber dejado de netear flujos del todo.
  it('control: sin ningún flujo el MTD es el cambio de valor puro', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const mtd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-08-01', 10000)],
      transactions: [],
    })
    expect(mtd).toBeCloseTo(10, 6)
  })
})

// ⛔ FASE MT. El YTD medía desde el 1 DE ENERO aunque su ancla fuera de otro día.
//
// Es el MISMO defecto que FASE MM cerró para el MTD, en la superficie que
// aquella pasada NO tocó a propósito: el memo `returnYTD` es la superficie
// congelada C, así que el protocolo exigía preguntar antes (OK del usuario).
//
// `findYearStartAnchor` acepta un snapshot de enero dentro de 15 días del 1, o
// uno de fines de diciembre, mientras `startTs` se quedaba clavado en
// `Date.UTC(year, 0, 1)`. La corrección `jan1Ts` que ya existía solo corre en
// la rama de RESPALDO (cuando no hay ancla), o sea justo en el camino menos
// frecuente; el camino común quedaba sin ella.
//
// El propio comentario de `findYearStartAnchor` ya documenta el mecanismo ("that
// row already holds January's deposit and gain, so anchoring YTD there would
// make Modified Dietz subtract January's flows a second time") y se defiende
// ACOTANDO la ventana a 15 días: mitigado, no cerrado.
describe('FASE MT: el YTD mide desde donde arranca su ancla', () => {
  const bank = (price) => item({
    id: 'b1', symbol: 'B', type: 'Bank', quantity: 1,
    currentPrice: price, purchasePrice: 10000,
    acquisitionDate: '2024-01-01', createdAt: '2024-01-01',
  })
  const snap = (date, v) => ({ id: date, date, netWorthUSD: v, totalActivosUSD: v, totalDebtUSD: 0, _source: 'daily' })

  afterEach(() => jest.useRealTimers())

  async function run({ items, snapshots, transactions }) {
    const { result, unmount } = setup({ firestore: { items, snapshots, transactions }, prices: { enrichedItems: items } })
    await act(async () => {})
    const out = result.current.returnYTD
    unmount()
    return out
  }

  // ANCLA DESPUÉS DEL 1: el depósito ya está DENTRO del valor de arranque y
  // además se netea como flujo, o sea se resta dos veces y el año se lee como
  // que no rindió nada.
  it('un depósito ya contenido en el ancla no se resta dos veces', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const ytd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-01-10', 10500), snap('2026-06-15', 10800)],
      transactions: [{ id: 'd1', type: 'DEPOSIT', totalAmount: 500, currency: 'USD', date: '2026-01-05', _linkedItemId: 'b1' }],
    })
    // Desde el ancla del 10 de enero: (11000 − 10500) / 10500 = 4.7619%.
    // Con startTs clavado en el 1 daba 0: el depósito se restaba dos veces.
    expect(ytd).toBeCloseTo(4.7619, 3)
  })

  // ANCLA ANTES DEL 1: el depósito NO está en el valor de arranque y tampoco se
  // netea, porque cae fuera de la ventana. Se lee como ganancia.
  it('un depósito de diciembre, posterior al ancla, SÍ se netea', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const ytd = await run({
      items: [bank(11000)],
      snapshots: [snap('2025-12-28', 10000), snap('2026-06-15', 10800)],
      transactions: [{ id: 'd2', type: 'DEPOSIT', totalAmount: 500, currency: 'USD', date: '2025-12-30', _linkedItemId: 'b1' }],
    })
    // El depósito no está en el valor del 28 de diciembre, así que tiene que
    // netearse. Con startTs en el 1 de enero caía FUERA de la ventana, no se
    // neteaba, y esos 500 se leían como ganancia (10% en vez de ~5%).
    expect(ytd).toBeGreaterThan(0)
    expect(ytd).toBeLessThan(6)
  })

  // Control POSITIVO: sin flujos el número no se mueve. Sin esto, "ya no resta
  // de más" podría pasar por haber dejado de netear flujos del todo.
  it('control: sin ningún flujo el YTD es el cambio de valor puro', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const ytd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-01-01', 10000), snap('2026-06-15', 10500)],
      transactions: [],
    })
    expect(ytd).toBeCloseTo(10, 6)
  })

  // Control POSITIVO 2: con el ancla EXACTA en el 1 de enero nada cambia, o sea
  // el caso común no se movió. Un depósito posterior se sigue neteando igual.
  it('control: con el ancla en el 1 de enero el comportamiento es el de siempre', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const ytd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-01-01', 10000), snap('2026-06-15', 10500)],
      transactions: [{ id: 'd3', type: 'DEPOSIT', totalAmount: 500, currency: 'USD', date: '2026-03-01', _linkedItemId: 'b1' }],
    })
    // El depósito de marzo se netea: la ganancia es 11000 − 10000 − 500 = 500.
    expect(ytd).toBeGreaterThan(0)
    expect(ytd).toBeLessThan(6)
  })
})

// ⛔ FASE MU. La frontera donde el `balanceAsOf` LOCAL de FASE MS se encuentra
// con el reloj UTC del motor de dividendos.
//
// El motor deriva "hoy" de UTC (`now.getUTCDate()`, `now.getUTCMonth()`) y
// `balanceAsOf` es un día CALENDARIO que el usuario vivió, o sea LOCAL. En
// Guatemala (UTC-6) las dos convenciones discrepan entre las 6pm y la
// medianoche, así que la VÍSPERA de cada día de pago el motor ya cree que el
// día de pago llegó mientras el calendario del usuario todavía dice ayer.
//
// Los dos lectores de `balanceAsOf` deciden ahí cosas que cuestan dinero, y
// con el sello UTC viejo las dos salían mal:
//   · reinvest → `dateStr <= balanceAsOf` saltaba el pago, y lo seguía
//     saltando en cada corrida posterior: el pago no se escribía NUNCA.
//   · destino  → `dateStr > balanceAsOf` decidía NO acreditar, y estampaba
//     `_destinationCredited: false`, que es permanente: el cupón queda como
//     historia sin mover el saldo de la cuenta que lo recibió.
// Con el sello LOCAL las dos hacen lo correcto, porque la foto del saldo está
// fechada el día que el usuario de verdad la tecleó.
//
// Esta suite existe porque unificar `balanceAsOf` a UTC se ve como una
// prolijidad (dos fechas con la misma forma, una de ellas "rara") y vuelve a
// tragarse un cupón en silencio.
describe('FASE MU: balanceAsOf LOCAL contra el reloj UTC del motor', () => {
  // La víspera del día de pago, de noche en Guatemala: UTC ya dice 1 de
  // septiembre, el calendario del usuario todavía dice 31 de agosto.
  const BORDE = '2026-09-01T01:00:00Z'
  const LOCAL = '2026-08-31' // lo que escribe FASE MS
  const UTC = '2026-09-01'   // lo que escribía el código viejo

  afterEach(() => jest.useRealTimers())

  // META-TEST. En UTC las dos fechas coinciden y TODO lo de abajo pasaría sin
  // probar nada. La suite corre fijada en America/Guatemala (jest.config.js).
  it('meta: la suite corre en una zona al oeste de UTC', () => {
    const d = new Date(BORDE)
    expect(d.getUTCDate()).toBe(1)
    expect(d.getDate()).toBe(31) // local
  })

  const fondo = (over = {}) => item({
    id: 'f1', name: 'Fondo', symbol: 'FONDO', type: 'Bank',
    quantity: 1, currentPrice: 5000, purchasePrice: 5000, _originalPrice: 5000,
    currency: 'USD', _originalCurrency: 'USD',
    acquisitionDate: '2026-06-15', createdAt: '2026-06-15',
    incomeMode: 'percent', incomeRate: 12, incomePayDay: 1,
    incomeMonths: [0,1,2,3,4,5,6,7,8,9,10,11], incomeMonthsExplicit: true,
    ...over,
  })

  async function pagosEscritos({ items, at = BORDE }) {
    jest.useFakeTimers().setSystemTime(new Date(at))
    const { unmount } = setup({ firestore: { items }, prices: { enrichedItems: items } })
    for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve() })
    // El efecto puede correr más de una vez por re-render; el id del documento
    // es determinístico, así que en producción es UN documento. Se dedupe por
    // fecha para afirmar sobre el HECHO y no sobre el conteo de llamadas.
    const porFecha = new Map()
    for (const [tx] of fakeFirestore.addTransaction.mock.calls) porFecha.set(tx.date, tx)
    unmount()
    return porFecha
  }

  it('reinvest: con el sello LOCAL el pago del día se escribe', async () => {
    const pagos = await pagosEscritos({
      items: [fondo({ dividendAction: 'reinvest', balanceAsOf: LOCAL })],
    })
    expect(pagos.get('2026-09-01')?.totalAmount).toBeCloseTo(50, 6)
  })

  // REGRESIÓN NEGATIVA: el comportamiento viejo, fijado. El pago no se escribe,
  // y como el guard vuelve a dar lo mismo en cada corrida, no se escribe nunca.
  it('reinvest: con el sello UTC el pago se pierde para siempre', async () => {
    const pagos = await pagosEscritos({
      items: [fondo({ dividendAction: 'reinvest', balanceAsOf: UTC })],
    })
    expect(pagos.has('2026-09-01')).toBe(false)
  })

  const caja = (asOf) => item({
    id: 'd1', name: 'Caja', symbol: 'CAJA', type: 'Bank',
    quantity: 1, currentPrice: 1000, purchasePrice: 1000, _originalPrice: 1000,
    currency: 'USD', acquisitionDate: '2026-06-15', createdAt: '2026-06-15',
    balanceAsOf: asOf,
  })

  it('destino: con el sello LOCAL el cupón SÍ acredita la cuenta que lo recibe', async () => {
    const pagos = await pagosEscritos({
      items: [fondo({ dividendAction: 'cash', incomeDestination: 'd1' }), caja(LOCAL)],
    })
    expect(pagos.get('2026-09-01')?._destinationCredited).toBe(true)
  })

  // REGRESIÓN NEGATIVA, y esta es la que cuesta dinero: el cupón se escribe
  // como historia pero jamás mueve el saldo del destino, y el flag es
  // permanente.
  it('destino: con el sello UTC el cupón queda escrito y sin acreditar', async () => {
    const pagos = await pagosEscritos({
      items: [fondo({ dividendAction: 'cash', incomeDestination: 'd1' }), caja(UTC)],
    })
    expect(pagos.get('2026-09-01')?._destinationCredited).toBe(false)
  })

  // Control POSITIVO. Lejos de la frontera las dos convenciones coinciden y el
  // comportamiento es el de siempre: sin esto, "el sello LOCAL escribe el pago"
  // podría pasar por haber dejado de respetar `balanceAsOf` del todo.
  it('control: a mediodía el saldo del propio día sigue bloqueando su pago', async () => {
    const pagos = await pagosEscritos({
      items: [fondo({ dividendAction: 'reinvest', balanceAsOf: '2026-09-01' })],
      at: '2026-09-01T18:00:00Z', // mediodía en Guatemala, ya es 1 de septiembre
    })
    expect(pagos.has('2026-09-01')).toBe(false)
  })
})

// ⛔ FASE MW. Un flujo fechado EL MISMO DÍA que el ancla ya está DENTRO del
// valor del ancla, así que netearlo lo resta dos veces y el período se lee
// plano.
//
// `computeModifiedDietz` filtra su ventana con `txTs >= startTs` (INCLUSIVO) y
// `anchorStartTs` devuelve la medianoche del día del ancla, pero estas anclas
// son snapshots DIARIOS: el del día D describe la cartera al CERRAR el día D.
//
// El YTD ya dropeaba estos flujos y SOLO cuando el ancla se movía hacia
// ADELANTE, que era el único caso posible antes de FASE MT; la rama de
// diciembre que MT habilitó quedó sin ese guard, o sea es una regresión de MT.
// El MTD nunca tuvo guard en NINGUNA dirección, y ese número se publica a
// Amigos.
describe('FASE MW: un flujo del día del ancla no se netea dos veces', () => {
  const bank = (price) => item({
    id: 'b1', symbol: 'B', type: 'Bank', quantity: 1,
    currentPrice: price, purchasePrice: 10000,
    acquisitionDate: '2024-01-01', createdAt: '2024-01-01',
  })
  const snap = (date, v) => ({ id: date, date, netWorthUSD: v, totalActivosUSD: v, totalDebtUSD: 0, _source: 'daily' })
  const dep = (date, amt = 500) => ({
    id: `d-${date}`, type: 'DEPOSIT', totalAmount: amt, currency: 'USD', date, _linkedItemId: 'b1',
  })

  afterEach(() => jest.useRealTimers())

  async function run({ items, snapshots, transactions, pick }) {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T12:00:00Z'))
    const { result, unmount } = setup({ firestore: { items, snapshots, transactions }, prices: { enrichedItems: items } })
    await act(async () => {})
    const out = pick(result.current)
    unmount()
    return out
  }

  // REGRESIÓN DE FASE MT. El ancla de diciembre existe desde MT; antes de MT
  // este flujo caía fuera de una ventana que abría el 1 de enero y por
  // casualidad el número salía bien.
  it('YTD: ancla de diciembre con un depósito de ESE día', async () => {
    const ytd = await run({
      items: [bank(11000)],
      // El snapshot del 28 de diciembre vale 10,500 y ya contiene el depósito.
      snapshots: [snap('2025-12-28', 10500), snap('2026-06-15', 10800)],
      transactions: [dep('2025-12-28')],
      pick: (r) => r.returnYTD,
    })
    expect(ytd).toBeCloseTo(4.7619, 3)
  })

  it('YTD: ancla de enero con un depósito de ESE día', async () => {
    const ytd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-01-10', 10500), snap('2026-06-15', 10800)],
      transactions: [dep('2026-01-10')],
      pick: (r) => r.returnYTD,
    })
    expect(ytd).toBeCloseTo(4.7619, 3)
  })

  it('MTD: ancla dentro del mes con un depósito de ESE día', async () => {
    const mtd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-08-04', 10500)],
      transactions: [dep('2026-08-04')],
      pick: (r) => r.returnMTD,
    })
    expect(mtd).toBeCloseTo(4.7619, 3)
  })

  it('MTD: ancla del último día del mes anterior con un depósito de ESE día', async () => {
    const mtd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-07-31', 10500)],
      transactions: [dep('2026-07-31')],
      pick: (r) => r.returnMTD,
    })
    expect(mtd).toBeCloseTo(4.7619, 3)
  })

  // Control POSITIVO: un flujo POSTERIOR al ancla se sigue neteando. Sin esto,
  // "ya no resta de más" podría pasar por haber dejado de netear flujos.
  it('control: un depósito posterior al ancla sí se netea', async () => {
    const ytd = await run({
      items: [bank(11000)],
      snapshots: [snap('2026-01-10', 10000), snap('2026-06-15', 10500)],
      transactions: [dep('2026-03-01')],
      pick: (r) => r.returnYTD,
    })
    // 11000 − 10000 − 500 = 500 de ganancia, no 1000.
    expect(ytd).toBeGreaterThan(0)
    expect(ytd).toBeLessThan(6)
  })

  // Control POSITIVO 2: el caso que da nombre a la superficie congelada. Un
  // depósito de APERTURA fechado el día del ancla y MAYOR que el valor que
  // compró (lleva la comisión adentro) sigue yendo al DENOMINADOR y solo ahí.
  it('control: el depósito de apertura sigue alimentando el costo base', async () => {
    const ytd = await run({
      items: [bank(6240)],
      // El ancla del año exige >= 2 snapshots (no es del producto, es el gate
      // de esta rama del memo): el segundo no participa del cálculo.
      snapshots: [snap('2026-01-06', 6000), snap('2026-06-15', 6100)],
      transactions: [dep('2026-01-06', 6098)],
      pick: (r) => r.returnYTD,
    })
    // Ganancia contra el PRINCIPAL (240) sobre el costo all-in (6,098) = 3.94%,
    // nunca 4.00% (comisión perdonada) ni 2.33% (comisión cobrada dos veces).
    expect(ytd).toBeCloseTo(3.94, 1)
  })
})
