import { authFetch } from '@/lib/authFetch'

// ⛔ FASE KN. El sondeo iba a 1 solicitud cada 3 segundos, o sea 20 por minuto:
// el DOBLE del límite de 10/min por token que reporta la documentación del Flex
// Web Service. A 6 segundos quedan 10/min, y con 15 intentos la ventana de
// espera sigue siendo la misma de siempre (90 segundos), así que el usuario no
// espera ni un segundo más: es la mitad de solicitudes por el mismo resultado.
const POLL_INTERVAL_MS = 6000
const MAX_POLL_ATTEMPTS = 15
const REQUEST_RETRIES = 2

// Pedirle a IBKR que GENERE el reporte es lento por naturaleza: el servidor
// reintenta con esperas de 0/5/15/25/40s, o sea puede tardar más de un minuto y
// medio en contestar legítimamente. Pero `authFetch` aborta a los 30 SEGUNDOS
// por defecto, así que cualquier query que IBKR no entregue en el primer o
// segundo intento moría con el cliente colgado y el servidor trabajando para
// nadie: la misma enfermedad que FASE HK, en esta ruta.
//
// Un usuario real quedó atrapado exactamente ahí: credenciales guardadas,
// `_ibkrLastAutoSync: null` (nunca funcionó ni una vez) y
// `_ibkrAutoSyncError: "signal timed out"`, que es el mensaje literal de
// AbortSignal.timeout, no de IBKR.
//
// Este presupuesto es SOLO para la petición de generación. El sondeo posterior
// se queda con el default: cada sondeo es corto (el servidor corta a los 10s) y
// quien espera es el bucle, no una sola petición.
const REQUEST_TIMEOUT_MS = 100000

// Une la señal de cancelación del usuario con nuestro propio límite de tiempo,
// y recuerda CUÁL de las dos disparó: cancelar y agotar el tiempo son cosas
// distintas y el usuario merece un mensaje distinto para cada una.
// Sin AbortSignal.any a propósito: no está en todos los Safari que usamos.
function withTimeout(signal, ms) {
  const ctrl = new AbortController()
  const state = { timedOut: false }
  if (signal?.aborted) ctrl.abort()
  const timer = setTimeout(() => { state.timedOut = true; ctrl.abort() }, ms)
  const onAbort = () => { clearTimeout(timer); ctrl.abort() }
  signal?.addEventListener('abort', onAbort, { once: true })
  state.signal = ctrl.signal
  state.done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
  return state
}

async function requestWithRetry(token, queryId, signal, onStatus) {
  for (let attempt = 0; attempt < REQUEST_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Sync cancelado.', 'AbortError')

    if (attempt > 0) {
      if (onStatus) onStatus('requesting-retry', attempt)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 15000)
        if (signal) {
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Sync cancelado.', 'AbortError')) }, { once: true })
        }
      })
    }

    const budget = withTimeout(signal, REQUEST_TIMEOUT_MS)
    let reqRes
    try {
      reqRes = await authFetch('/api/brokers/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-sync', token, queryId }),
        signal: budget.signal,
      })
    } catch (err) {
      // Un aborto NO trae errorCode, así que sin esto caía al `|| 'UNKNOWN'` de
      // más abajo y quedaba archivado como UNKNOWN con el mensaje crudo del
      // navegador ("signal timed out"), que no le dice nada a nadie. La clase de
      // fallo se decide acá, donde sí sabemos quién abortó.
      const e = new Error(budget.timedOut
        ? 'IBKR tardó demasiado en generar el reporte. Suele pasar fuera del horario de mercado.'
        : 'Sync cancelado.')
      e.errorCode = budget.timedOut ? 'TIMEOUT' : 'CANCELLED'
      throw e
    } finally {
      budget.done()
    }

    const reqData = await reqRes.json().catch(() => ({}))

    if (reqData.referenceCode) return reqData.referenceCode

    if (reqData.errorCode === 'RATE_LIMITED' && attempt < REQUEST_RETRIES - 1) continue

    const msg = reqData.error || `IBKR sync failed (${reqRes.status})`
    const err = new Error(msg)
    err.errorCode = reqData.errorCode || 'UNKNOWN'
    // Lo que IBKR dijo literal (redactado del token en el servidor): para un
    // código mapeado, `msg` ya es texto nuestro. Ver classifyError.
    err.raw = reqData.raw || null
    throw err
  }
}

export async function syncIBKR(token, queryId, { signal, onStatus } = {}) {
  if (onStatus) onStatus('requesting')

  const referenceCode = await requestWithRetry(token, queryId, signal, onStatus)

  if (onStatus) onStatus('polling')

  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    if (signal?.aborted) {
      const err = new Error('Sync cancelado.')
      err.errorCode = 'CANCELLED'
      throw err
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS)
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Sync cancelado.', 'AbortError'))
        }, { once: true })
      }
    })

    if (onStatus) onStatus('polling', i + 1, MAX_POLL_ATTEMPTS)

    const pollRes = await authFetch('/api/brokers/ibkr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'poll-sync', referenceCode, token, queryId }),
      signal,
    })

    const pollData = await pollRes.json().catch(() => ({}))

    if (pollData.status === 'ready') {
      if (onStatus) onStatus('processing')
      return formatResult(pollData)
    }

    if (pollData.status === 'error') {
      const msg = pollData.error || `IBKR poll failed (${pollRes.status})`
      const err = new Error(msg)
      err.errorCode = pollData.errorCode || 'UNKNOWN'
      err.raw = pollData.raw || null
      throw err
    }

    // status === 'pending' → continue polling
  }

  const err = new Error('IBKR no respondió después de varios intentos. Intenta de nuevo en unos minutos.')
  err.errorCode = 'TIMEOUT'
  throw err
}

// Map an IBKR cash transaction (deposit/withdrawal) to the canonical flow shape
// Modified Dietz consumes. Mirrors the file-import parser (ibkrFileParser) but
// keeps the real currency and carries transactionID for collision-safe dedup.
export function cashTxToTransaction(ct) {
  const amount = Math.abs(ct.amount || 0)
  const type = (ct.amount || 0) >= 0 ? 'DEPOSIT' : 'WITHDRAWAL'
  return {
    type,
    symbol: 'CASH',
    description: ct.description || (type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'),
    date: ct.date || new Date().toISOString().split('T')[0],
    quantity: 1,
    pricePerUnit: amount,
    totalAmount: amount,
    commission: 0,
    currency: ct.currency || 'USD',
    _ibkrAccountId: ct.accountId || '',
    _ibkrTxnId: ct.txnId || '',
    _source: 'ibkr',
  }
}

function formatResult(data) {
  const accountIds = new Set()

  const items = (data.positions || [])
    .filter(p => p.quantity !== 0)
    .map(p => {
      if (p._ibkrAccountId) accountIds.add(p._ibkrAccountId)
      return {
        symbol: (p.symbol || '').toUpperCase(),
        name: p.name || p.symbol,
        type: p.type || 'Stock',
        quantity: Math.abs(p.quantity || 0),
        purchasePrice: p.purchasePrice || 0,
        currentPrice: p.currentPrice || 0,
        institution: p.institution || 'Interactive Brokers',
        currency: p.currency || 'USD',
        acquisitionDate: p.acquisitionDate,
        conid: p._ibkrConId || '',
        _ibkrAccountId: p._ibkrAccountId || '',
        _isShort: p.isDebt || false,
        _source: 'ibkr',
        // How this position entered the app. `_source` alone can't tell an API sync
        // apart from an uploaded statement (both are 'ibkr'), so the per-account
        // delete in Settings could not offer them as separate rows.
        _origin: 'api',
      }
    })

  const transactions = (data.trades || []).map(t => {
    const isBuy = (t.buySell || '').toUpperCase() === 'BUY'
    if (t.accountId) accountIds.add(t.accountId)
    return {
      type: isBuy ? 'BUY' : 'SELL',
      symbol: (t.symbol || '').toUpperCase(),
      description: `${t.description || t.symbol}: ${isBuy ? 'Buy' : 'Sell'} ${Math.abs(t.quantity)} @ ${t.tradePrice}`,
      date: t.tradeDate || new Date().toISOString().split('T')[0],
      quantity: Math.abs(t.quantity || 0),
      pricePerUnit: t.tradePrice || 0,
      totalAmount: Math.abs(t.proceeds || 0),
      commission: Math.abs(t.commission || 0),
      currency: t.currency || 'USD',
      _ibkrAccountId: t.accountId || '',
      _ibkrCostBasis: t.costBasis,
      _ibkrRealizedPL: t.realizedPL,
      // ⛔ FASE KG. El id del trade, igual que el adaptador del ARCHIVO
      // (ibkrXmlFileAdapter). El id del documento se deriva de
      // fecha+símbolo+tipo+centavos y, si hay `_ibkrTxnId`, lo agrega
      // (useFirestoreItems); así que estampándolo en una ruta y no en la otra,
      // el MISMO trade se escribía DOS veces con ids distintos. Y el viaje
      // manda a hacer justo eso: paso 1 sincroniza por API, paso 2 sube el
      // mismo XML. Con los trades duplicados, el rebobinado de posiciones
      // (buildTxEvents) ve el doble de acciones compradas y la reconstrucción
      // histórica y la gráfica quedan mal. Los dos caminos usan el MISMO
      // parser, así que este campo vale lo mismo en los dos; sin `tradeID` en
      // la query, ambos caen al id base y siguen coincidiendo.
      ...(t.tradeId ? { _ibkrTxnId: t.tradeId } : {}),
      _source: 'ibkr',
    }
  })

  // External deposits/withdrawals — needed so Modified Dietz strips contributions.
  // Dividend rows (kind:'dividend') become DIVIDEND transactions instead: they are
  // income, not external flows, and feed the cash-rewind line + the income module.
  // Fee/tax/interest rows (kind fee/tax/interest) become FEE/TAX/INTEREST
  // transactions for the Costs view. They are NOT external flows, so Modified Dietz
  // and the cash-rewind (buildCashFlows) ignore them by type.
  const COST_TYPE = { fee: 'FEE', tax: 'TAX', interest: 'INTEREST' }
  for (const ct of (data.cashTransactions || [])) {
    if (ct.accountId) accountIds.add(ct.accountId)
    if (ct.kind === 'dividend') {
      transactions.push({
        type: 'DIVIDEND',
        symbol: ct.symbol || 'CASH',
        description: ct.description || 'Dividend',
        date: ct.date || new Date().toISOString().split('T')[0],
        quantity: 1,
        pricePerUnit: Math.abs(ct.amount || 0),
        totalAmount: Math.abs(ct.amount || 0),
        commission: 0,
        currency: ct.currency || 'USD',
        _ibkrAccountId: ct.accountId || '',
        _ibkrTxnId: ct.txnId || '',
        _source: 'ibkr',
      })
    } else if (COST_TYPE[ct.kind]) {
      transactions.push({
        type: COST_TYPE[ct.kind],
        symbol: ct.symbol || 'CASH',
        description: ct.description || COST_TYPE[ct.kind],
        date: ct.date || new Date().toISOString().split('T')[0],
        quantity: 1,
        pricePerUnit: Math.abs(ct.amount || 0),
        totalAmount: Math.abs(ct.amount || 0),
        commission: 0,
        currency: ct.currency || 'USD',
        // Signed original: negative = the account paid (cost), positive = received
        // (e.g. broker interest received). The Costs view splits on this sign.
        _signedAmount: ct.amount || 0,
        _ibkrAccountId: ct.accountId || '',
        _ibkrTxnId: ct.txnId || '',
        _source: 'ibkr',
      })
    } else {
      transactions.push(cashTxToTransaction(ct))
    }
  }

  return {
    items,
    transactions,
    equityHistory: data.equityHistory || [],
    sections: data.sections || null,
    accounts: [...accountIds],
    syncedAt: data.syncedAt,
  }
}
