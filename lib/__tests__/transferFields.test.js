import { accountValue, debitFields, creditFields, DUST } from '../transferFields'
import { getItemValue } from '@/components/dashboard/utils'

// FASE OM: `todayLocalISO()` depende del reloj real, así que se fija con
// timers falsos para que las aserciones de abajo sean deterministas.
const TODAY = '2026-08-28'
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T15:00:00Z`))
})
afterEach(() => {
  jest.useRealTimers()
})

const bank = { id: 'bi', type: 'Cuenta Monetaria', currency: 'USD', quantity: 1, currentPrice: 5350, purchasePrice: 5350 }
const fund = { id: 'fliq', type: 'Fondo Líquido', currency: 'USD', quantity: 1, currentPrice: 482, purchasePrice: 482 }

// Aplicar los campos como lo hace Firestore, y leer el valor como lo lee la app.
const after = (item, fields) => getItemValue({ ...item, ...fields })

describe('accountValue', () => {
  it('una cuenta tipo banco vale su saldo', () => {
    expect(accountValue(bank)).toBe(5350)
  })

  it('un fondo vale cantidad x precio', () => {
    expect(accountValue(fund)).toBe(482)
    expect(accountValue({ ...fund, quantity: 2 })).toBe(964)
  })
})

// ⛔ EL INVARIANTE. El bug que el usuario reportó ("se agrega a la cuenta
// destino pero no se reduce el origen") era que la resta se escribía en un
// campo que `getItemValue` no lee. Lo único que hay que garantizar es esto:
// después de la escritura, la cuenta vale exactamente lo que valía menos lo
// transferido, leído con la MISMA función que usa el tablero.
describe('el origen baja EXACTAMENTE lo transferido, en cualquier forma de cuenta', () => {
  const shapes = [
    ['banco q=1', { type: 'Cuenta Monetaria', quantity: 1, currentPrice: 5350, purchasePrice: 5350 }],
    // Guardada como cantidad=saldo con precio 1: la pantalla decía "Disponible: 1".
    ['banco cantidad=saldo', { type: 'Cuenta Monetaria', quantity: 5350, currentPrice: 1, purchasePrice: 1 }],
    ['fondo q=1', { type: 'Fondo Líquido', quantity: 1, currentPrice: 482, purchasePrice: 482 }],
    ['fondo con unidades', { type: 'Fondo', quantity: 40, currentPrice: 12.05, purchasePrice: 11 }],
    // getItemPrice antepone lastManualValuation; la copia vieja usaba currentPrice.
    ['ilíquido con valuación manual', { type: 'Alternativo', isIlliquid: true, lastManualValuation: 200, quantity: 5, currentPrice: 10 }],
    // getItemPrice cae a price/cost/averagePrice; la copia vieja usaba `|| 1`.
    ['precio solo en price', { type: 'Fondo', quantity: 10, price: 50 }],
    ['precio solo en cost', { type: 'Fondo', quantity: 10, cost: 50 }],
  ]

  for (const [label, item] of shapes) {
    it(`${label}: baja el monto exacto`, () => {
      const before = getItemValue(item)
      expect(before).toBeGreaterThan(0)
      const amt = Math.round(before * 0.3 * 100) / 100
      const fields = debitFields(item, amt)
      expect(fields).not.toBeNull()
      expect(after(item, fields)).toBeCloseTo(before - amt, 6)
    })

    it(`${label}: transferir todo la deja en CERO exacto`, () => {
      const fields = debitFields(item, getItemValue(item))
      expect(after(item, fields)).toBe(0)
    })

    it(`${label}: acreditar sube el monto exacto`, () => {
      const before = getItemValue(item)
      const fields = creditFields(item, 100)
      expect(fields).not.toBeNull()
      expect(after(item, fields)).toBeCloseTo(before + 100, 6)
    })
  }
})

// Una cuenta de saldo SIN cantidad vale 0 para toda la app (el tablero, la Hoja
// y los reportes la suman con getItemValue). La pantalla vieja leía su
// currentPrice y decía "Disponible: 5,350" sobre una cuenta que en todos lados
// figura en cero: ofrecía mover dinero que la app no cree tener, y la resta se
// escribía donde nadie la lee. Ahora se rehúsa, que es lo que el resto de la
// app ya afirmaba, y acreditarla la deja sana.
describe('una cuenta de saldo sin cantidad', () => {
  const roto = { type: 'Cuenta Monetaria', currentPrice: 5350, purchasePrice: 5350 }

  it('vale cero, igual que en el resto de la app', () => {
    expect(getItemValue(roto)).toBe(0)
    expect(accountValue(roto)).toBe(0)
  })

  it('no puede ser origen: se rehúsa en vez de escribir un no-op', () => {
    expect(debitFields(roto, 100)).toBeNull()
    expect(debitFields({ ...roto, quantity: 0 }, 100)).toBeNull()
  })

  it('acreditarla la deja sana y valiendo lo acreditado', () => {
    const fields = creditFields(roto, 100)
    expect(fields.quantity).toBe(1)
    expect(after(roto, fields)).toBe(100)
  })
})

// ⛔ La regla de "esto es una cuenta de saldo" vive en lib/contributions.js
// (isBankLikeItem) y se IMPORTA. Los dos modales tenían su propia copia
// ANGOSTA (`/bank|banco|cash/i`), así que una "Cuenta Monetaria" caía del
// lado no-banco: la resta se hacía por cantidad y `purchasePrice` quedaba
// viejo.
describe('una cuenta con "cuenta"/"ahorro" en el tipo es de SALDO', () => {
  for (const type of ['Cuenta Monetaria', 'Ahorro BI', 'Savings', 'Checking', 'Efectivo']) {
    it(`"${type}" escribe los DOS campos, no cantidad`, () => {
      const out = debitFields({ type, quantity: 1, currentPrice: 1000, purchasePrice: 1000 }, 200)
      expect(out).toEqual({ currentPrice: 800, purchasePrice: 800, balanceAsOf: TODAY })
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
    expect(debitFields(fund, 482).quantity).toBe(0)
  })

  it('una cuenta de saldo transferida completa queda en 0', () => {
    expect(debitFields(bank, 5350)).toEqual({ quantity: 0, currentPrice: 0, purchasePrice: 0, balanceAsOf: TODAY })
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
    expect(debitFields(fund, 482 - DUST / 2).quantity).toBe(0)
  })

  // Un residuo REAL no se borra. El caso del usuario: la app tenia 482 y el
  // puso 242. Quedan 240, y eso NO es polvo: es dinero que sigue ahi.
  it('transferir de menos deja lo que queda', () => {
    expect(after(fund, debitFields(fund, 242))).toBeCloseTo(240, 8)
  })
})

describe('el credito al destino', () => {
  it('suma al saldo de una cuenta de saldo, con los dos campos', () => {
    expect(creditFields(bank, 324.5)).toEqual({ currentPrice: 5674.5, purchasePrice: 5674.5, balanceAsOf: TODAY })
  })

  // FASE PH: este test ANTES afirmaba que un "fondo" con cantidad 1 sumaba
  // CANTIDAD al acreditarlo (dividiendo el monto entre el precio, como una
  // posición de mercado). Eso describía el bug: `fund` es un Fondo Líquido
  // real (id 'fliq'), y en producción `AddAccountModal` fuerza cantidad 1
  // para TODO ítem no-mercado (`effectiveQuantity`), así que un fondo así
  // SIEMPRE tiene cantidad 1 — es exactamente el caso que `isBankLikeItem`
  // existe para reconocer. El valor esperado describía el comportamiento
  // viejo, no un invariante: corregirlo es correcto (a diferencia del
  // candado de 3.94%, que sí es una fórmula congelada).
  it('un fondo con cantidad 1 suma al SALDO, no a la cantidad', () => {
    expect(creditFields(fund, 241)).toEqual({ currentPrice: 723, purchasePrice: 723, balanceAsOf: TODAY })
  })

  it('el credito NUNCA vacia nada: solo suma', () => {
    expect(creditFields(bank, 0.001)).toEqual({ currentPrice: 5350.001, purchasePrice: 5350.001, balanceAsOf: TODAY })
  })

  // ⛔ FASE OM: dientes contra el fix. Sin esto, un TRANSFER o el crédito de una
  // venta (SellModal) dejaba la foto vieja y el motor de rendimiento deducido
  // (lib/liquidYield.js) leía el monto acreditado como interés que la cuenta
  // nunca generó — ver la integración completa en liquidYield.test.js.
  it('sella balanceAsOf a HOY en las dos direcciones', () => {
    expect(debitFields(bank, 100).balanceAsOf).toBe(TODAY)
    expect(creditFields(bank, 100).balanceAsOf).toBe(TODAY)
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
  it('una cuenta vacia no puede ser origen', () => {
    expect(debitFields({ type: 'Fondo', quantity: 0, currentPrice: 10 }, 5)).toBeNull()
  })
  // Nunca en silencio: un item sin ningun precio utilizable no se puede
  // expresar, y quien llama TIENE que avisar en vez de escribir un no-op.
  // FASE PH: un ítem de SALDO (isBankLikeItem) nunca cae acá — su rama no
  // necesita `getItemPrice`, escribe el target directo. Por eso el fixture
  // tiene que ser de MERCADO de verdad (isBankLikeItem=false) para seguir
  // ejercitando el `return null` de la rama de cantidad.
  it('un activo de mercado sin precio devuelve null en vez de escribir nada', () => {
    expect(creditFields({ type: 'Stock', quantity: 10 }, 100)).toBeNull()
  })
})

// ⛔ FASE PH: `isBankLike` (utils.js, solo texto) era angosta para lo que
// `balanceFields` necesita preguntar. Un BONO o un ALTERNATIVO (tipo que no
// dice "banco" ni "cash") con cantidad 1 caía en la rama de cantidad:
// `quantity: value/price` corrompía la cantidad que ese activo TIENE que
// mantener en 1 (lib/assetLogic/corporateBondWithEntryFee.js asume
// exactamente eso), y `purchasePrice` nunca se tocaba. Ahora usa
// `isBankLikeItem` (lib/contributions.js), la MISMA pregunta que ya contesta
// `buildContributionFields` para la operación gemela (aportar/retirar).
describe('FASE PH: un activo NO-mercado con cantidad 1 (bono, alternativo, fondo) es de SALDO, no de cantidad', () => {
  const bond = { id: 'vitali', type: 'Bono', currency: 'USD', quantity: 1, currentPrice: 6000, purchasePrice: 6000 }
  const alt = { id: 'alt1', type: 'Alternativo', currency: 'USD', quantity: 1, currentPrice: 1000, purchasePrice: 1000 }

  it('transferir de un bono desplaza el precio y deja la cantidad en 1, nunca una fracción', () => {
    // Dientes: la copia vieja (isBankLike) daba `{quantity: 5500/6000}`
    // (≈0.9167), que NO matchea este objeto — sin quantity, con los dos
    // precios y su fecha.
    expect(debitFields(bond, 500)).toEqual({ currentPrice: 5500, purchasePrice: 5500, balanceAsOf: TODAY })
  })

  it('acreditar un alternativo suma al precio y no divide en "acciones"', () => {
    expect(creditFields(alt, 250)).toEqual({ currentPrice: 1250, purchasePrice: 1250, balanceAsOf: TODAY })
  })

  it('vaciar un bono completo zerea TAMBIÉN currentPrice/purchasePrice (no solo cantidad)', () => {
    // Con la copia vieja, un bono vaciado quedaba en `{quantity: 0}` a secas:
    // currentPrice/purchasePrice sobrevivían con su valor viejo, y como
    // getItemValue = quantity × precio, mostraba 0 igual — pero un residuo en
    // `price`/`cost` (los respaldos de getItemPrice) podía resucitar el saldo.
    expect(debitFields(bond, 6000)).toEqual({ quantity: 0, currentPrice: 0, purchasePrice: 0, balanceAsOf: TODAY })
  })

  it('control: un activo de MERCADO real (cantidad ≠ 1, tipo acción/cripto) sigue por cantidad, sin cambios', () => {
    const stock = { id: 'aapl', type: 'Stock', currency: 'USD', quantity: 10, currentPrice: 50 }
    const fields = debitFields(stock, 250)
    expect(fields).toEqual({ quantity: 5 })
  })
})
