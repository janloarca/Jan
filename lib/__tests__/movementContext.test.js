// FASE NF — la deducción de para qué se movió el dinero.
//
// El caso REAL que la motivó, con los números del usuario: sacó Q392.25 de su
// fondo líquido y ese mismo día bajó su deuda de $4,000 a $3,610. Los montos NO
// coinciden (Q392.25 ≈ $50, y el pago fue de $390: el resto lo cubrió otra
// persona), así que todo lo que empareje por MONTO se equivocaría acá.
import { explainMovement, movementNote } from '../movementContext'

const CUENTA = { id: 'idc', name: 'FONDO LÍQUIDO Q', type: 'Cuenta monetaria', currency: 'GTQ' }
const OTRA = { id: 'bi', name: 'Cuenta monetaria BI', type: 'Cuenta monetaria', currency: 'USD' }
const DEUDA = { id: 'aixen', name: 'Deuda AIXEN', type: 'Deuda', isDebt: true, currency: 'USD' }
const ITEMS = [CUENTA, OTRA, DEUDA]

const pagoDeuda = (date, amount = 390) => ({
  id: 'p1', type: 'TRANSFER', date, totalAmount: amount, currency: 'USD',
  _debtItemId: 'aixen', _source: 'manual_debt_payment',
})
const depositoA = (itemId, date, amount = 500) => ({
  id: 'd1', type: 'DEPOSIT', date, totalAmount: amount, currency: 'USD', _linkedItemId: itemId,
})
const retiroDe = (itemId, date, amount = 500) => ({
  id: 'w1', type: 'WITHDRAWAL', date, totalAmount: amount, currency: 'GTQ', _linkedItemId: itemId,
})

describe('explainMovement', () => {
  it('el caso real: el retiro se explica con el pago de deuda del mismo día', () => {
    const found = explainMovement({
      item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL',
      items: ITEMS, transactions: [pagoDeuda('2026-09-04')],
    })
    expect(found).toEqual({ kind: 'debt', label: 'Deuda AIXEN', amount: 390, currency: 'USD', sameDay: true })
  })

  // ⛔ LO QUE HACE HONESTO AL MÓDULO. Emparejar por monto habría dejado este
  // caso (el del usuario) sin explicación, porque Q392.25 y $390 no son el
  // mismo número ni convertidos: solo una PARTE del pago salió de esa cuenta.
  it('no empareja por monto: montos y monedas distintos igual se explican', () => {
    const found = explainMovement({
      item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL',
      items: ITEMS, transactions: [pagoDeuda('2026-09-04', 12345.67)],
    })
    expect(found.kind).toBe('debt')
    expect(found.amount).toBe(12345.67)
  })

  it('sin nada cerca no inventa una explicación', () => {
    expect(explainMovement({
      item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL',
      items: ITEMS, transactions: [pagoDeuda('2026-06-01')],
    })).toBe(null)
  })

  it('la ventana es de días, no de semanas', () => {
    const dentro = explainMovement({ item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL', items: ITEMS, transactions: [pagoDeuda('2026-09-07')] })
    const fuera = explainMovement({ item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL', items: ITEMS, transactions: [pagoDeuda('2026-09-08')] })
    expect(dentro?.kind).toBe('debt')
    expect(dentro.sameDay).toBe(false)
    expect(fuera).toBe(null)
  })

  it('un retiro se explica con dinero ENTRANDO a otra cuenta, no con otro retiro', () => {
    const conDeposito = explainMovement({ item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL', items: ITEMS, transactions: [depositoA('bi', '2026-09-04')] })
    expect(conDeposito).toEqual(expect.objectContaining({ kind: 'account', label: 'Cuenta monetaria BI' }))
    // Dos retiros el mismo día no se explican entre sí: los dos sacaron dinero.
    expect(explainMovement({ item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL', items: ITEMS, transactions: [retiroDe('bi', '2026-09-04')] })).toBe(null)
  })

  it('y al revés: un aporte se explica con dinero SALIENDO de otra cuenta', () => {
    const found = explainMovement({ item: CUENTA, date: '2026-09-04', kind: 'DEPOSIT', items: ITEMS, transactions: [retiroDe('bi', '2026-09-04')] })
    expect(found).toEqual(expect.objectContaining({ kind: 'account', label: 'Cuenta monetaria BI' }))
  })

  it('un pago de deuda se explica con el retiro que lo financió', () => {
    const found = explainMovement({ item: DEUDA, date: '2026-09-04', kind: 'DEBT_PAYMENT', items: ITEMS, transactions: [retiroDe('idc', '2026-09-04', 392.25)] })
    expect(found).toEqual(expect.objectContaining({ kind: 'account', label: 'FONDO LÍQUIDO Q', amount: 392.25 }))
  })

  it('el propio movimiento del ítem nunca se explica a sí mismo', () => {
    expect(explainMovement({
      item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL',
      items: ITEMS, transactions: [retiroDe('idc', '2026-09-04'), depositoA('idc', '2026-09-04')],
    })).toBe(null)
  })

  it('el pago de deuda le gana a la transferencia: es la explicación más específica', () => {
    const found = explainMovement({
      item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL', items: ITEMS,
      transactions: [depositoA('bi', '2026-09-04'), pagoDeuda('2026-09-04')],
    })
    expect(found.kind).toBe('debt')
  })

  it('es estable: dos corridas sobre los mismos datos dicen lo mismo', () => {
    const txs = [pagoDeuda('2026-09-03', 100), { ...pagoDeuda('2026-09-03', 200), id: 'p2' }]
    const a = explainMovement({ item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL', items: ITEMS, transactions: txs })
    const b = explainMovement({ item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL', items: ITEMS, transactions: [...txs].reverse() })
    expect(a).toEqual(b)
  })

  it('una fecha ilegible no revienta ni inventa nada', () => {
    expect(explainMovement({ item: CUENTA, date: '2026-09-04', kind: 'WITHDRAWAL', items: ITEMS, transactions: [{ ...pagoDeuda('2026-09-04'), date: 'ayer' }] })).toBe(null)
    expect(explainMovement({ item: CUENTA, date: null, kind: 'WITHDRAWAL', items: ITEMS, transactions: [pagoDeuda('2026-09-04')] })).toBe(null)
    expect(explainMovement({})).toBe(null)
  })
})

describe('movementNote', () => {
  it('nombra el hecho, sin afirmar que los montos cuadran', () => {
    const found = { kind: 'debt', label: 'Deuda AIXEN', amount: 390, currency: 'USD', sameDay: true }
    const nota = movementNote(found, { kind: 'WITHDRAWAL', lang: 'es' })
    expect(nota).toContain('Deuda AIXEN')
    expect(nota).toContain('390')
    expect(nota).toContain('probablemente')
  })

  // ⛔ El "no hay nada" también se dice: es la otra mitad de la deducción
  // ("si no hay ningún movimiento adicional probablemente se gastó").
  it('sin hallazgo dice que cuenta como gasto, en vez de callarse', () => {
    expect(movementNote(null, { kind: 'WITHDRAWAL', lang: 'es' })).toContain('gasto')
    expect(movementNote(null, { kind: 'WITHDRAWAL', lang: 'en' })).toContain('spending')
  })

  it('un pago de deuda sin origen manda a donde SÍ se registra', () => {
    expect(movementNote(null, { kind: 'DEBT_PAYMENT', lang: 'es' })).toContain('Movimiento')
  })

  it('es bilingüe en los dos caminos', () => {
    const found = { kind: 'account', label: 'Cuenta BI', amount: 500, currency: 'USD', sameDay: false }
    expect(movementNote(found, { kind: 'WITHDRAWAL', lang: 'en' })).toMatch(/Around that date/)
    expect(movementNote(found, { kind: 'WITHDRAWAL', lang: 'es' })).toMatch(/Por esas fechas/)
  })
})
