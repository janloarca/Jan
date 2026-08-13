// Invertido en el año: aportes EXTERNOS netos del año calendario, sin
// ganancias ni intereses y descontando comisiones de entrada.
//
//   invertido = depósitos del año − retiros del año − comisiones de entrada
//               pagadas dentro de un depósito contado
//
// Qué cuenta y qué no (cada exclusión es una decisión, no un olvido):
// - DEPOSIT suma, WITHDRAWAL resta. Nada más entra.
// - TRANSFER nunca: dinero entre dos cuentas propias no es inversión nueva
//   (misma regla que el Dietz de portafolio, que solo netea DEPOSIT/WITHDRAWAL).
// - DIVIDEND / INTEREST nunca: es dinero que el portafolio GENERÓ, y el pedido
//   es explícito en que el monto va sin ganancias y sin intereses. Eso cubre
//   también los reinvertidos y los rendimientos deducidos (_source
//   'inferred_yield'), que se escriben como DIVIDEND.
// - BUY / SELL nunca: rotar un activo por otro no mete ni saca dinero.
// - _source 'manual_edit_adjustment' se excluye: es la corrección de un saldo
//   tecleado (EditAccountModal), y ese delta es casi siempre rendimiento
//   acumulado o precio que se movió, no un aporte del usuario.
// - Los flujos del broker ('ibkr') y los inferidos aceptados ('inferred_flow')
//   SÍ cuentan: son depósitos/retiros externos reales. La exclusión que hace
//   dietzTransactions existe para no doble-contar contra un baseline
//   reconstruido, un problema de MEDIR retorno que aquí no aplica (esto suma
//   flujos, no mide contra un ancla).
//
// Comisiones de entrada: el DEPOSIT de apertura de AddAccountModal vale
// principal + comisión (⛔ lógica congelada G, corporateBondWithEntryFee), así
// que la comisión YA está dentro del depósito contado y hay que restarla UNA
// vez para que "invertido" sea el capital que quedó trabajando (el 6,095.78 de
// VITALI cuenta como 6,000). En modo 'deducted' el depósito vale lo enviado y
// la comisión salió de ahí adentro: también se resta una vez. La resta se gatea
// a que exista un DEPOSIT 'manual_new_account' vinculado al ítem DENTRO de la
// ventana Y a que el ítem se haya adquirido este año: sin depósito contado no
// hay de dónde restar (cuenta fondeada desde otra cuenta propia), y un "agregar
// a posición" de este año sobre un ítem con comisión de un año viejo no puede
// traerse esa comisión vieja. Es la misma convención (invertida) que
// feeAlreadyInDeposit en PortfolioGrowthChart (FASE DV): un depósito de
// apertura vinculado se asume portador de la comisión.
//
// Todo se convierte a moneda base con el convert compartido; sin convert, los
// montos crudos (mismo respaldo que el resto de la app).

const FLOW_SIGNS = { DEPOSIT: 1, WITHDRAWAL: -1 }

export function computeYtdInvested({ transactions, items, year, convert, baseCurrency } = {}) {
  const y = Number(year) || new Date().getFullYear()
  const startTs = Date.UTC(y, 0, 1)
  const endTs = Date.UTC(y + 1, 0, 1) - 1
  const base = baseCurrency || 'USD'
  const toBase = (amt, cur) => {
    const n = Number(amt) || 0
    if (!convert) return n
    const out = convert(n, cur || 'USD', base)
    return isFinite(out) ? out : n
  }

  let deposits = 0
  let withdrawals = 0
  // Ids de ítems cuyo depósito de apertura quedó CONTADO este año: solo esas
  // comisiones se restan (la comisión viaja dentro de ese depósito).
  const openingDepositThisYear = new Set()

  for (const tx of transactions || []) {
    if (!tx || !tx.date) continue
    const type = (tx.type || '').toUpperCase()
    const sign = FLOW_SIGNS[type]
    if (sign == null) continue
    if (tx._source === 'manual_edit_adjustment') continue
    const ts = new Date(tx.date).getTime()
    if (!isFinite(ts) || ts < startTs || ts > endTs) continue
    const amt = toBase(tx.totalAmount ?? tx.amount ?? 0, tx.currency)
    if (!isFinite(amt)) continue
    if (sign > 0) deposits += amt
    else withdrawals += amt
    if (sign > 0 && tx._source === 'manual_new_account' && tx._linkedItemId) {
      openingDepositThisYear.add(tx._linkedItemId)
    }
  }

  let fees = 0
  for (const it of items || []) {
    const fee = Number(it?.entryFee) || 0
    if (fee <= 0 || !it.id) continue
    if (!openingDepositThisYear.has(it.id)) continue
    // Guard de merge: un "agregar a posición" de este año también escribe un
    // DEPOSIT 'manual_new_account', pero la comisión es de la compra ORIGINAL.
    // La fecha de adquisición dice de qué año es esa compra.
    if (it.acquisitionDate) {
      const acqTs = new Date(it.acquisitionDate).getTime()
      if (isFinite(acqTs) && (acqTs < startTs || acqTs > endTs)) continue
    }
    fees += toBase(fee, it._originalCurrency || it.currency)
  }

  const invested = deposits - withdrawals - fees
  return {
    year: y,
    deposits,
    withdrawals,
    fees,
    invested,
    // Sin ningún movimiento en el año no hay nada que mostrar: un $0.00 sobre
    // un año sin actividad sería un dato inventado (misma regla que dailyChange).
    hasActivity: deposits !== 0 || withdrawals !== 0,
  }
}
