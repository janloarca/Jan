// FASE SK. Cuentas con LEDGER: el dinero que de verdad entró y salió de una
// cuenta de broker es el único "aporte" de esa cuenta.
//
// ⛔ Extensión de las superficies congeladas C (YTD) y D (gráfica), y de la
// lectura del depósito de apertura G, aprobada por el usuario (17 nov 2026):
// cambia SOLO qué movimientos entran a esos cálculos; ninguna fórmula cambia.
//
// El problema que resuelve: una cuenta de broker cargada a mano escribe un
// DEPOSIT de "dinero nuevo" por CADA compra (AddAccountModal / QuickAddModal)
// y un WITHDRAWAL por cada venta "fuera de la app" (lib/saleTx.js). Una compra
// pagada con el efectivo de una venta, o con dividendos, contaba como capital
// nuevo, y una cuenta de IBKR real se leía con una pérdida grande y más
// "aportes" que sus depósitos reales, mientras el broker reportaba ganancia.
//
// Una cuenta pasa a tener ledger SOLO por la conciliación explícita contra el
// archivo del broker (lib/ledgerReconcile.js, "Conciliar con mi cuenta"), que
// marca:
//   - cada ítem de la cuenta con `_ledgerAccount: <clave>`;
//   - los depósitos/retiros reales con `_source: 'account_ledger'` y la misma
//     `_ledgerAccount`;
//   - los DEPOSIT/WITHDRAWAL manuales de esa cuenta con `_ledgerSuperseded`.
// Sin esas marcas, todo sale idéntico a antes (misma lista, misma identidad).

export const LEDGER_SOURCE = 'account_ledger'

const isFlowType = (tx) => {
  const t = (tx?.type || '').toUpperCase()
  return t === 'DEPOSIT' || t === 'WITHDRAWAL'
}

export function isLedgerFlow(tx) {
  return !!tx && tx._source === LEDGER_SOURCE && isFlowType(tx)
}

// Ids de los ítems que pertenecen a una cuenta con ledger.
export function ledgerItemIds(items) {
  const out = new Set()
  for (const it of items || []) {
    if (it && it.id && it._ledgerAccount) out.add(it.id)
  }
  return out
}

// La clave de ledger de un grupo de ítems (la vista de UNA institución), o
// null si ninguno es de una cuenta con ledger.
export function ledgerKeyOf(items) {
  for (const it of items || []) {
    if (it && it._ledgerAccount) return String(it._ledgerAccount)
  }
  return null
}

// Quita los DEPOSIT/WITHDRAWAL que el ledger reemplaza: los marcados en la
// conciliación y los vinculados a un ítem de una cuenta con ledger (una
// compra manual registrada DESPUÉS de conciliar). Los movimientos del ledger
// y todo lo que no es depósito/retiro pasan intactos. Sin nada que quitar
// devuelve la MISMA lista.
export function dropLedgerSupersededFlows(transactions, ledgerIds) {
  const list = transactions || []
  if (list.length === 0) return list
  const ids = ledgerIds || new Set()
  const out = list.filter((tx) => {
    if (!tx || !isFlowType(tx)) return true
    if (tx._source === LEDGER_SOURCE) return true
    if (tx._ledgerSuperseded) return false
    return !(tx._linkedItemId && ids.has(tx._linkedItemId))
  })
  return out.length === list.length ? list : out
}

// En la vista de UNA cuenta con ledger, los únicos flujos externos son los
// de su ledger. Lo demás (BUY/SELL/DIVIDEND...) pasa intacto.
export function onlyLedgerFlows(transactions, key) {
  const list = transactions || []
  if (!key) return list
  const out = list.filter((tx) => !isFlowType(tx) || (isLedgerFlow(tx) && String(tx._ledgerAccount) === String(key)))
  return out.length === list.length ? list : out
}

// Los depósitos/retiros del ledger de una cuenta que no están en la lista
// escopada (no traen símbolo de un ítem ni vínculo).
export function ledgerFlowsOf(transactions, key) {
  if (!key) return []
  return (transactions || []).filter((tx) => isLedgerFlow(tx) && String(tx._ledgerAccount) === String(key))
}
