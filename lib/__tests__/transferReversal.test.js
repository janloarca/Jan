import { transferReversalPlan, reversalWritesSomething } from '../transferReversal'
import { buildTransferTransaction, buildDebtPaymentTransaction } from '../transferTx'
import { accountValue } from '../transferFields'

// Las dos cuentas del reporte real (FASE JD): un fondo liquido en quetzales y
// una cuenta monetaria en dolares.
const fondoQ = { id: 'fondo', name: 'Fondo Liquido', type: 'Cuenta Monetaria', currency: 'GTQ', quantity: 1, currentPrice: 12500, purchasePrice: 12500 }
const cuentaUSD = { id: 'cuenta', name: 'Cuenta Monetaria', type: 'Bank', currency: 'USD', quantity: 1, currentPrice: 5350, purchasePrice: 5350 }

describe('transferReversalPlan', () => {
  test('una fila que no es transferencia no produce plan', () => {
    expect(transferReversalPlan({ type: 'DIVIDEND', totalAmount: 240 }, [fondoQ])).toBeNull()
    expect(transferReversalPlan({ type: 'DEPOSIT', totalAmount: 100 }, [fondoQ])).toBeNull()
    expect(transferReversalPlan(null, [])).toBeNull()
  })

  test('misma moneda: devuelve al origen y quita del destino el MISMO monto', () => {
    const a = { ...fondoQ, currency: 'USD' }
    // Despues de transferir 2500 los saldos quedaron asi.
    const origen = { ...a, currentPrice: 10000, purchasePrice: 10000 }
    const destino = { ...cuentaUSD, currentPrice: 7850, purchasePrice: 7850 }
    const tx = buildTransferTransaction({ fromItem: a, toItem: cuentaUSD, amount: 2500, date: '2026-08-20' })

    const plan = transferReversalPlan(tx, [origen, destino])
    expect(plan.kind).toBe('transfer')
    expect(plan.missing).toEqual([])
    expect(plan.refused).toEqual([])
    // El origen vuelve a 12,500 y el destino a 5,350.
    expect(accountValue({ ...origen, ...plan.from.fields })).toBeCloseTo(12500, 6)
    expect(accountValue({ ...destino, ...plan.to.fields })).toBeCloseTo(5350, 6)
  })

  // ⛔ EL CASO QUE DA DIENTES: los dos lados NO valen lo mismo. Si la reversion
  // devolviera un solo monto a las dos cuentas, el destino en dolares bajaria
  // 2,500 en vez de 324.68, que es el bug de FASE JD al reves.
  test('cruzada: cada lado se revierte con SU monto y SU moneda', () => {
    const origen = { ...fondoQ, currentPrice: 10000, purchasePrice: 10000 }
    const destino = { ...cuentaUSD, currentPrice: 5674.68, purchasePrice: 5674.68 }
    const tx = buildTransferTransaction({
      fromItem: fondoQ, toItem: cuentaUSD, amount: 2500, toAmount: 324.68, date: '2026-08-20',
    })

    const plan = transferReversalPlan(tx, [origen, destino])
    expect(plan.from.amount).toBeCloseTo(2500, 6)
    expect(plan.from.currency).toBe('GTQ')
    expect(plan.to.amount).toBeCloseTo(324.68, 6)
    expect(plan.to.currency).toBe('USD')
    // Y los saldos resultantes son los de antes de la transferencia.
    expect(accountValue({ ...origen, ...plan.from.fields })).toBeCloseTo(12500, 6)
    expect(accountValue({ ...destino, ...plan.to.fields })).toBeCloseTo(5350, 6)
    // El monto del destino NO es el del origen.
    expect(plan.to.amount).not.toBeCloseTo(plan.from.amount, 2)
  })

  // Toda fila escrita antes de que `_toAmount` existiera. `transferCredit` cae
  // a `totalAmount`, que es lo correcto para ellas: se escribieron cuando las
  // dos cuentas se asumian en la misma moneda.
  test('fila vieja sin _toAmount: el destino usa totalAmount', () => {
    const origen = { ...cuentaUSD, id: 'a', currentPrice: 1000, purchasePrice: 1000 }
    const destino = { ...cuentaUSD, id: 'b', currentPrice: 3000, purchasePrice: 3000 }
    const tx = {
      type: 'TRANSFER', date: '2026-01-05', totalAmount: 500, currency: 'USD',
      _originItemId: 'a', _linkedItemId: 'b',
    }
    const plan = transferReversalPlan(tx, [origen, destino])
    expect(plan.from.amount).toBeCloseTo(500, 6)
    expect(plan.to.amount).toBeCloseTo(500, 6)
    expect(accountValue({ ...origen, ...plan.from.fields })).toBeCloseTo(1500, 6)
    expect(accountValue({ ...destino, ...plan.to.fields })).toBeCloseTo(2500, 6)
  })

  // ⛔ SEGUNDO CASO CON DIENTES. Una deuda se guarda en POSITIVO, asi que
  // deshacer un pago SUBE su magnitud. Acreditarla (el camino de una cuenta
  // normal) la bajaria todavia mas, o sea el pago se contaria dos veces.
  test('pago de deuda: el efectivo vuelve y la deuda SUBE', () => {
    const banco = { id: 'banco', name: 'Banco', type: 'Bank', currency: 'USD', quantity: 1, currentPrice: 11000, purchasePrice: 11000 }
    const deuda = { id: 'hipoteca', name: 'Hipoteca', type: 'Debt', isDebt: true, currency: 'USD', quantity: 1, currentPrice: 39000, purchasePrice: 39000 }
    const tx = buildDebtPaymentTransaction({
      fromItem: { ...banco, currentPrice: 12000 }, debtItem: { ...deuda, currentPrice: 40000 },
      amount: 1000, date: '2026-08-01',
    })

    const plan = transferReversalPlan(tx, [banco, deuda])
    expect(plan.kind).toBe('debt')
    expect(accountValue({ ...banco, ...plan.from.fields })).toBeCloseTo(12000, 6)
    // La deuda vuelve a 40,000: SUBE, no baja.
    expect(plan.to.fields.currentPrice).toBeCloseTo(40000, 6)
    expect(plan.to.fields.purchasePrice).toBeCloseTo(40000, 6)
    expect(plan.to.after).toBeGreaterThan(plan.to.before)
  })

  test('pago de deuda cruzado: la deuda sube en SU moneda', () => {
    const fondo = { id: 'f', name: 'Fondo Q', type: 'Cuenta Monetaria', currency: 'GTQ', quantity: 1, currentPrice: 30000, purchasePrice: 30000 }
    const deuda = { id: 'd', name: 'Hipoteca USD', type: 'Debt', isDebt: true, currency: 'USD', quantity: 1, currentPrice: 19000, purchasePrice: 19000 }
    const tx = buildDebtPaymentTransaction({
      fromItem: fondo, debtItem: deuda, amount: 7700, toAmount: 1000, date: '2026-08-01',
    })
    const plan = transferReversalPlan(tx, [fondo, deuda])
    expect(plan.from.amount).toBeCloseTo(7700, 6)   // quetzales de vuelta
    expect(plan.to.amount).toBeCloseTo(1000, 6)     // dolares de deuda
    expect(plan.to.fields.currentPrice).toBeCloseTo(20000, 6)
  })

  test('un lado borrado no bloquea al otro', () => {
    const origen = { ...cuentaUSD, id: 'a', currentPrice: 1000, purchasePrice: 1000 }
    const tx = buildTransferTransaction({
      fromItem: origen, toItem: { ...cuentaUSD, id: 'b' }, amount: 200, date: '2026-02-02',
    })
    const plan = transferReversalPlan(tx, [origen]) // 'b' ya no existe
    expect(plan.missing).toEqual(['to'])
    expect(plan.to).toBeNull()
    expect(plan.from).not.toBeNull()
    expect(reversalWritesSomething(plan)).toBe(true)
  })

  // Nunca en silencio: un item sin ningun precio utilizable no se puede
  // expresar, y `{}` a Firestore es un no-op mudo. Se REPORTA.
  test('un item sin precio utilizable se rehusa y se dice cual', () => {
    const origen = { ...cuentaUSD, id: 'a', currentPrice: 1000, purchasePrice: 1000 }
    // Un activo NO bank-like sin ningun precio: getItemPrice no resuelve.
    const roto = { id: 'b', name: 'Roto', type: 'Bond', currency: 'USD', quantity: 3 }
    const tx = buildTransferTransaction({ fromItem: origen, toItem: roto, amount: 100, date: '2026-03-03' })
    const plan = transferReversalPlan(tx, [origen, roto])
    expect(plan.refused).toEqual(['to'])
    expect(plan.to).toBeNull()
    expect(plan.from).not.toBeNull()
  })

  test('sin ningun lado escribible el plan no escribe nada', () => {
    const tx = {
      type: 'TRANSFER', date: '2026-04-04', totalAmount: 50, currency: 'USD',
      _originItemId: 'x', _linkedItemId: 'y',
    }
    const plan = transferReversalPlan(tx, [])
    expect(plan.missing.sort()).toEqual(['from', 'to'])
    expect(reversalWritesSomething(plan)).toBe(false)
  })

  test('una fila sin ids (anterior al constructor unico) no produce plan', () => {
    const tx = { type: 'TRANSFER', date: '2026-05-05', totalAmount: 50, currency: 'USD' }
    expect(transferReversalPlan(tx, [cuentaUSD])).toBeNull()
  })

  test('monto no positivo o transferencia a si misma no producen plan', () => {
    const base = { type: 'TRANSFER', date: '2026-06-06', currency: 'USD', _originItemId: 'a', _linkedItemId: 'b' }
    expect(transferReversalPlan({ ...base, totalAmount: 0 }, [])).toBeNull()
    expect(transferReversalPlan({ ...base, totalAmount: -5 }, [])).toBeNull()
    expect(transferReversalPlan({ ...base, totalAmount: 10, _linkedItemId: 'a' }, [])).toBeNull()
  })

  // El destino puede haber gastado el dinero desde entonces: el delta va contra
  // el saldo de HOY. FASE OB: este test fijaba que en ese caso la cuenta se
  // dejaba en CERO, o sea describia el defecto (la diferencia entre lo recibido
  // y lo que queda desaparecia sin decirlo, y la fila se borraba igual). Ahora
  // se REHUSA y se dice: el usuario ajusta el saldo del destino primero.
  test('quitar mas de lo que hay hoy se REHUSA en vez de dejar la cuenta en cero', () => {
    const origen = { ...cuentaUSD, id: 'a', currentPrice: 100, purchasePrice: 100 }
    const destino = { ...cuentaUSD, id: 'b', currentPrice: 30, purchasePrice: 30 }
    const tx = buildTransferTransaction({ fromItem: origen, toItem: destino, amount: 500, date: '2026-07-07' })
    const plan = transferReversalPlan(tx, [origen, destino])
    expect(plan.to).toBeNull()
    expect(plan.refused).toEqual(['to'])
    // control: con saldo suficiente sigue devolviendo el delta contra hoy
    const holgado = { ...destino, currentPrice: 600, purchasePrice: 600 }
    const ok = transferReversalPlan(tx, [origen, holgado])
    expect(ok.refused).toEqual([])
    expect(accountValue({ ...holgado, ...ok.to.fields })).toBe(100)
  })
})
