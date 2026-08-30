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
