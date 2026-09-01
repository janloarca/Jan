import { transactionDocId, accountIdSuffix } from '@/lib/transactionDocId'

const dep = (over = {}) => ({
  date: '2026-01-20', symbol: 'CASH', type: 'DEPOSIT', totalAmount: 5000, ...over,
})

describe('transactionDocId (FASE MO)', () => {
  // EL CASO QUE MOTIVA TODO. Dos depósitos reales, mismo monto, mismo día, en
  // dos cuentas distintas del mismo broker, sin `transactionID` en la query.
  // Antes resolvían al MISMO documento y el segundo se perdía en silencio.
  it('dos cuentas distintas, mismo monto y mismo dia, dan documentos DISTINTOS', () => {
    const a = transactionDocId(dep({ _ibkrAccountId: 'U111' }))
    const b = transactionDocId(dep({ _ibkrAccountId: 'U222' }))
    expect(a).not.toEqual(b)
  })

  // La propiedad por la que la llave es determinística: el mismo evento
  // reintentado tiene que caer en el mismo documento, o cada reintento
  // escribiría un movimiento nuevo.
  it('el mismo evento reintentado da el MISMO documento', () => {
    expect(transactionDocId(dep({ _ibkrAccountId: 'U111' })))
      .toEqual(transactionDocId(dep({ _ibkrAccountId: 'U111' })))
  })

  it('el id del broker manda cuando existe, y la cuenta no lo altera', () => {
    const conCuenta = transactionDocId(dep({ _ibkrTxnId: 'T9', _ibkrAccountId: 'U111' }))
    const sinCuenta = transactionDocId(dep({ _ibkrTxnId: 'T9' }))
    expect(conCuenta).toEqual(sinCuenta)
    expect(conCuenta).toContain('-T9')
  })

  it('dos eventos con id de broker distinto nunca colapsan', () => {
    expect(transactionDocId(dep({ _ibkrTxnId: 'T1' })))
      .not.toEqual(transactionDocId(dep({ _ibkrTxnId: 'T2' })))
  })

  // REGRESIÓN NEGATIVA: sin cuenta ni id de broker la llave queda EXACTAMENTE
  // como siempre. Es lo que garantiza que este cambio no mueva un solo
  // documento de nadie que no estuviera afectado.
  it('sin cuenta ni id de broker la llave es la de siempre', () => {
    expect(transactionDocId(dep())).toEqual('2026-01-20-CASH-DEPOSIT-500000')
  })

  it('un movimiento manual (sin campos de broker) no cambia de llave', () => {
    const manual = dep({ _source: 'manual_contribution', symbol: 'vitali' })
    expect(transactionDocId(manual)).toEqual('2026-01-20-VITALI-DEPOSIT-500000')
  })

  it('el monto entra en centavos y distingue un centavo de diferencia', () => {
    expect(transactionDocId(dep({ totalAmount: 5000.01 })))
      .not.toEqual(transactionDocId(dep({ totalAmount: 5000 })))
  })

  it('cae a `amount` cuando no hay `totalAmount`', () => {
    expect(transactionDocId({ ...dep({ totalAmount: undefined }), amount: 5000 }))
      .toEqual('2026-01-20-CASH-DEPOSIT-500000')
  })

  it('una fila sin fecha ni simbolo sigue produciendo una llave usable', () => {
    expect(transactionDocId({ totalAmount: 10 })).toEqual('nodate-NOSYM-tx-1000')
  })
})

describe('accountIdSuffix (FASE MO)', () => {
  it('sin cuenta no agrega nada', () => {
    expect(accountIdSuffix(undefined)).toEqual('')
    expect(accountIdSuffix('')).toEqual('')
  })

  // El sanador de la transición compara contra este sufijo exacto: si esta
  // forma cambia, la comparación tiene que cambiar con ella, y por eso las dos
  // salen de la misma función.
  it('con cuenta agrega el guion y la cuenta', () => {
    expect(accountIdSuffix('U111')).toEqual('-U111')
  })

  it('el sufijo es el que de verdad usa la llave', () => {
    const id = transactionDocId(dep({ _ibkrAccountId: 'U111' }))
    expect(id.endsWith(accountIdSuffix('U111'))).toBe(true)
  })
})
