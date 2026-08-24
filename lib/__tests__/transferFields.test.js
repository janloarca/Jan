import { accountValue, debitFields, creditFields, DUST } from '../transferFields'

const bank = { id: 'bi', type: 'Cuenta Monetaria', currency: 'USD', currentPrice: 5350, purchasePrice: 5350 }
const fund = { id: 'fliq', type: 'Fondo Líquido', currency: 'USD', quantity: 1, currentPrice: 482, purchasePrice: 482 }

describe('accountValue', () => {
  it('una cuenta tipo banco vale su saldo', () => {
    expect(accountValue(bank)).toBe(5350)
  })

  it('un fondo vale cantidad x precio', () => {
    expect(accountValue(fund)).toBe(482)
    expect(accountValue({ ...fund, quantity: 2 })).toBe(964)
  })
})

// ⛔ La regla de "esto es una cuenta de saldo" vive en utils.js (isBankLike) y
// se IMPORTA. Los dos modales tenían su propia copia ANGOSTA
// (`/bank|banco|cash/i`), así que una "Cuenta Monetaria" caía del lado
// no-banco: la resta se hacía por cantidad y `purchasePrice` quedaba viejo.
describe('una cuenta con "cuenta"/"ahorro" en el tipo es de SALDO', () => {
  for (const type of ['Cuenta Monetaria', 'Ahorro BI', 'Savings', 'Checking', 'Efectivo']) {
    it(`"${type}" escribe los DOS campos, no cantidad`, () => {
      const out = debitFields({ type, currentPrice: 1000, purchasePrice: 1000 }, 200)
      expect(out).toEqual({ currentPrice: 800, purchasePrice: 800 })
      expect(out.quantity).toBeUndefined()
    })
  }

  // Sin esto el tablero lee la diferencia como ganancia (la lección de FASE JA).
  it('el costo se mueve junto al saldo, nunca medio par', () => {
    const out = debitFields(bank, 1000)
    expect(out.currentPrice).toBe(out.purchasePrice)
  })
})

describe('vaciar una cuenta la deja en CERO exacto', () => {
  it('un fondo transferido completo queda en 0, sin polvo de punto flotante', () => {
    const out = debitFields(fund, 482)
    expect(out.quantity).toBe(0)
  })

  it('una cuenta de saldo transferida completa queda en 0', () => {
    expect(debitFields(bank, 5350)).toEqual({ currentPrice: 0, purchasePrice: 0 })
  })

  // El caso REAL que produce polvo: la pantalla muestra el saldo redondeado a
  // centavos, así que el monto tecleado no divide exacto contra el precio
  // guardado. Sin el umbral, esta cuenta queda en cantidad NEGATIVA.
  it('un monto redondeado a centavos tambien deja la cuenta en 0 exacto', () => {
    const feo = { type: 'Fondo', quantity: 11.2446, currentPrice: 690.84 }
    const crudo = feo.quantity - 7768.22 / feo.currentPrice
    expect(crudo).toBeLessThan(0) // sin umbral, saldo negativo
    expect(debitFields(feo, 7768.22).quantity).toBe(0)
  })

  it('lo que queda por debajo de medio centavo cuenta como cero', () => {
    const out = debitFields(fund, 482 - DUST / 2)
    expect(out.quantity).toBe(0)
  })

  it('un resto REAL no se borra: transferir de menos deja lo que queda', () => {
    // El caso del usuario: la app tenia 482 y el puso 242. Quedan 240, y eso NO
    // es polvo: es dinero que sigue ahi.
    const out = debitFields(fund, 242)
    expect(out.quantity).toBeCloseTo(240 / 482, 10)
    expect(accountValue({ ...fund, quantity: out.quantity })).toBeCloseTo(240, 8)
  })
})

describe('el credito al destino', () => {
  it('suma al saldo de una cuenta de saldo, con los dos campos', () => {
    expect(creditFields(bank, 324.5)).toEqual({ currentPrice: 5674.5, purchasePrice: 5674.5 })
  })

  it('suma cantidad en un fondo', () => {
    expect(creditFields(fund, 241).quantity).toBeCloseTo(1.5, 10)
  })

  it('el credito NUNCA vacia nada: solo suma', () => {
    expect(creditFields(bank, 0.001)).toEqual({ currentPrice: 5350.001, purchasePrice: 5350.001 })
  })
})

describe('rehusa lo que no describe un movimiento real', () => {
  for (const bad of [0, -5, 'abc', null, undefined, NaN]) {
    it(`monto ${String(bad)} devuelve null en ambos lados`, () => {
      expect(debitFields(bank, bad)).toBeNull()
      expect(creditFields(bank, bad)).toBeNull()
    })
  }
  it('sin item, null', () => {
    expect(debitFields(null, 10)).toBeNull()
    expect(creditFields(null, 10)).toBeNull()
  })
})
