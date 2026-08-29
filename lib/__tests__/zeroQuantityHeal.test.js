import { zeroQuantityBalanceFixes, resurrectedBalanceFixes } from '../zeroQuantityHeal'
import { getItemValue } from '@/components/dashboard/utils'

// El caso REAL del usuario (28 ago 2026): su fondo líquido en quetzales quedó en
// cantidad 0 al vaciarlo, después le entró el cupón de XOCHI (+GTQ 600), y la
// Hoja siguió marcando 0.00 aunque el movimiento estaba archivado y visible en
// el historial de esa cuenta.
//
// El arreglo del camino del cupón (lib/autoDividends.js) impide que vuelva a
// pasar; esto sana lo que YA quedó escrito así, que si no es irreparable desde
// la UI: el editor de cuenta muestra el saldo bien (su pie cae a cantidad 1)
// pero al guardar reescribe la cantidad tal cual, así que abrir y guardar no
// arregla nada.
const cuentaVaciadaConCupon = {
  id: 'fondoQ',
  name: 'FONDO LÍQUIDO Q',
  type: 'Cuenta bancaria',
  currency: 'GTQ',
  quantity: 0,
  purchasePrice: 600,
  currentPrice: 600,
}

describe('zeroQuantityBalanceFixes', () => {
  it('marca la cuenta de saldo cuya cantidad quedó en cero con saldo vivo', () => {
    expect(zeroQuantityBalanceFixes([cuentaVaciadaConCupon])).toEqual(['fondoQ'])
  })

  it('el síntoma que sana: hoy vale CERO, con la cantidad en 1 vale su saldo', () => {
    // Esto es lo que veía el usuario, medido con la MISMA función que usan el
    // patrimonio, la Hoja y los reportes.
    expect(getItemValue(cuentaVaciadaConCupon)).toBe(0)
    expect(getItemValue({ ...cuentaVaciadaConCupon, quantity: 1 })).toBeCloseTo(600, 2)
  })

  it('una cuenta sana no se toca', () => {
    const sana = { ...cuentaVaciadaConCupon, quantity: 1 }
    expect(zeroQuantityBalanceFixes([sana])).toEqual([])
  })

  it('una cuenta de VERDAD vacía no se toca: sin saldo no hay nada que sanar', () => {
    // Vaciar un ítem de banco pone cantidad Y precio en cero (transferFields),
    // así que este es el estado normal de una cuenta vaciada y sanarla
    // resucitaría un saldo que no existe.
    const vacia = { ...cuentaVaciadaConCupon, quantity: 0, purchasePrice: 0, currentPrice: 0 }
    expect(zeroQuantityBalanceFixes([vacia])).toEqual([])
  })

  // ⛔ El alcance `isBankLike` es lo que hace segura la regla, no una precaución
  // de más: en un ítem que NO es de banco, vaciar deja el precio VIVO, así que
  // "cantidad 0 con precio > 0" describe una posición legítimamente vacía.
  it('un activo de MERCADO en cero es una posición vendida, jamás se sana', () => {
    const vendida = { id: 'aapl', symbol: 'AAPL', type: 'Stock', quantity: 0, currentPrice: 232.5 }
    expect(zeroQuantityBalanceFixes([vendida])).toEqual([])
  })

  it('un bono en cero tampoco: su precio sobrevive al vaciarse', () => {
    const bono = { id: 'b1', name: 'RV4', type: 'Bono', quantity: 0, currentPrice: 6000 }
    expect(zeroQuantityBalanceFixes([bono])).toEqual([])
  })

  it('una cuenta marcada como vendida se respeta aunque cumpla la forma', () => {
    expect(zeroQuantityBalanceFixes([{ ...cuentaVaciadaConCupon, soldFully: true }])).toEqual([])
    expect(zeroQuantityBalanceFixes([{ ...cuentaVaciadaConCupon, saleDate: '2026-08-01' }])).toEqual([])
  })

  it('una cantidad ausente cuenta igual que cero (FASE JD3: esas cuentas existen)', () => {
    const sinCantidad = { ...cuentaVaciadaConCupon }
    delete sinCantidad.quantity
    expect(zeroQuantityBalanceFixes([sinCantidad])).toEqual(['fondoQ'])
  })

  it('tolera basura sin reventar y no inventa ids', () => {
    expect(zeroQuantityBalanceFixes(null)).toEqual([])
    expect(zeroQuantityBalanceFixes([null, undefined, {}, { quantity: 0, currentPrice: 5 }])).toEqual([])
  })

  it('devuelve cada cuenta afectada una sola vez, en orden', () => {
    const otra = { ...cuentaVaciadaConCupon, id: 'fondoUSD', name: 'Cuenta Monetaria', currency: 'USD' }
    expect(zeroQuantityBalanceFixes([cuentaVaciadaConCupon, otra])).toEqual(['fondoQ', 'fondoUSD'])
  })
})

// El segundo sintoma del mismo hueco (captura del usuario, 28 ago 2026): vacio
// FONDO LIQUIDO $ y el saldo VOLVIO a 240. El retiro si quedo archivado (su
// historial de junio y julio subio 240, que es el rebobinado leyendolo bien) y
// el saldo de hoy resucito por un residuo en price/cost.
describe('resurrectedBalanceFixes', () => {
  const vaciadaConResiduo = {
    id: 'fondoUSD', name: 'FONDO LÍQUIDO $', type: 'Cuenta bancaria', currency: 'USD',
    quantity: 1, currentPrice: 0, purchasePrice: 0, cost: 240,
  }

  it('marca la cuenta vaciada cuyo saldo resucita', () => {
    expect(resurrectedBalanceFixes([vaciadaConResiduo])).toEqual(['fondoUSD'])
  })

  it('el sintoma que sana: hoy vale 240, con la cantidad en cero vale 0', () => {
    expect(getItemValue(vaciadaConResiduo)).toBeCloseTo(240, 2)
    expect(getItemValue({ ...vaciadaConResiduo, quantity: 0 })).toBe(0)
  })

  it('sin residuo no hay nada que sanar', () => {
    const limpia = { ...vaciadaConResiduo, cost: 0 }
    expect(resurrectedBalanceFixes([limpia])).toEqual([])
  })

  // ⛔ La firma pide los DOS precios en cero: es la escritura literal de un
  // vaciado, y nadie mas deja ese par. Con uno solo en cero, el otro puede ser
  // el saldo bueno.
  it('con un solo precio en cero NO se toca', () => {
    expect(resurrectedBalanceFixes([{ ...vaciadaConResiduo, currentPrice: 500 }])).toEqual([])
    expect(resurrectedBalanceFixes([{ ...vaciadaConResiduo, purchasePrice: 500 }])).toEqual([])
  })

  it('un precio AUSENTE no cuenta como cero: eso es una cuenta sin escribir', () => {
    const sinPrecio = { id: 'x', type: 'Cuenta bancaria', quantity: 1, currentPrice: 0, cost: 240 }
    expect(resurrectedBalanceFixes([sinPrecio])).toEqual([])
  })

  it('un activo de MERCADO nunca se toca: ahi el precio vive en esos campos', () => {
    const accion = { id: 'a', symbol: 'AAPL', type: 'Stock', quantity: 5, currentPrice: 0, purchasePrice: 0, cost: 232 }
    expect(resurrectedBalanceFixes([accion])).toEqual([])
  })

  it('una posicion vendida se respeta', () => {
    expect(resurrectedBalanceFixes([{ ...vaciadaConResiduo, soldFully: true }])).toEqual([])
  })

  it('con la cantidad ya en cero no hay nada que hacer', () => {
    expect(resurrectedBalanceFixes([{ ...vaciadaConResiduo, quantity: 0 }])).toEqual([])
  })

  // Los dos sanadores son disjuntos POR CONSTRUCCION: uno pide cantidad 0 y el
  // otro cantidad > 0, asi que jamas pueden reclamar el mismo item.
  it('los dos sanadores nunca se pisan', () => {
    const todos = [cuentaVaciadaConCupon, vaciadaConResiduo]
    const a = zeroQuantityBalanceFixes(todos)
    const b = resurrectedBalanceFixes(todos)
    expect(a).toEqual(['fondoQ'])
    expect(b).toEqual(['fondoUSD'])
    expect(a.filter((id) => b.includes(id))).toEqual([])
  })

  // ⛔ EL INVARIANTE QUE DE VERDAD IMPORTA, y que el test de arriba NO cubre.
  //
  // Aquel mide un UNICO instante ("no reclaman el mismo item a la vez"), que es
  // cierto y es insuficiente: el ref de la sesion impide re-sanar un id dentro
  // de una sesion, pero la sesion SIGUIENTE arranca con el ref limpio. Lo que
  // hay que exigir es que aplicar un sanador no cree la precondicion del otro,
  // o sea que el estado sanado sea un PUNTO FIJO.
  //
  // Sin el guard de vaciado esto fallaba con el sintoma exacto que reporto el
  // usuario: la cuenta vaciada volvia a valer 240 en la siguiente carga.
  it('una cuenta vaciada se queda en cero por mas sesiones que pasen', () => {
    let it = { ...vaciadaConResiduo }
    expect(getItemValue(it)).toBeCloseTo(240, 2) // el residuo la tiene viva

    // Sesion 1: el sanador de resucitados la apaga.
    expect(resurrectedBalanceFixes([it])).toEqual(['fondoUSD'])
    it = { ...it, quantity: 0 }
    expect(getItemValue(it)).toBe(0)

    // Sesiones siguientes (ref limpio): NINGUNO la vuelve a tocar.
    for (let sesion = 2; sesion <= 4; sesion++) {
      expect(zeroQuantityBalanceFixes([it])).toEqual([])
      expect(resurrectedBalanceFixes([it])).toEqual([])
      expect(getItemValue(it)).toBe(0)
    }
  })

  // El caso legitimo del sanador de cantidad cero NO puede perderse por el
  // guard: ahi el cupon escribio un precio REAL, no un residuo.
  it('el cupon posterior a un vaciado se sigue sanando, y queda estable', () => {
    let it = { ...cuentaVaciadaConCupon }
    expect(zeroQuantityBalanceFixes([it])).toEqual(['fondoQ'])
    it = { ...it, quantity: 1 }
    expect(getItemValue(it)).toBeCloseTo(600, 2)
    // Punto fijo: nadie lo vuelve a tocar.
    expect(zeroQuantityBalanceFixes([it])).toEqual([])
    expect(resurrectedBalanceFixes([it])).toEqual([])
  })

  // Una cuenta cuyo saldo vive SOLO en los respaldos (FASE JD3: esas existen)
  // no es una cuenta vaciada, asi que se sigue sanando.
  it('un saldo que vive solo en price/cost se sigue sanando', () => {
    const soloRespaldo = { id: 'fondoQ', name: 'FONDO', type: 'Cuenta bancaria', quantity: 0, cost: 240 }
    expect(zeroQuantityBalanceFixes([soloRespaldo])).toEqual(['fondoQ'])
  })

  it('tolera basura sin reventar', () => {
    expect(resurrectedBalanceFixes(null)).toEqual([])
    expect(resurrectedBalanceFixes([null, {}, { quantity: 1 }])).toEqual([])
  })
})
