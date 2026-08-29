import fs from 'fs'
import path from 'path'

// Guardian de FUENTE, no de comportamiento, y la razon esta en el precedente
// de `moneyInputs.test.js`: las dos reglas viven inline dentro de
// `handleSubmit` y del pie de `EditAccountModal`, que en jest son inalcanzables
// sin montar el modal entero con su Firestore. Reproducir la expresion en un
// test seria probar una COPIA, que es justo la enfermedad que este repo ya
// documenta. Asi que se leen los ARCHIVOS.
//
// Lo que protegen, y por que importa: el editor es la UNICA pantalla donde
// alguien intentaria arreglar a mano el saldo de una cuenta, y era justamente
// la que no podia (el formulario se siembra con la cantidad guardada, asi que
// abrir y presionar Guardar reescribia el cero tal cual). Y su pie mostraba el
// saldo con una convencion propia, distinta de la que usa la app, asi que las
// dos superficies se contradecian en silencio.

const SRC = fs.readFileSync(path.join(process.cwd(), 'components/EditAccountModal.jsx'), 'utf8')

// Los comentarios explican las dos reglas, asi que buscarlas sobre el texto
// crudo daria verde con el codigo borrado.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('EditAccountModal: guardar una cuenta de saldo no puede dejarla ilegible', () => {
  it('el guardado usa la definicion COMPARTIDA de cantidad, no una copia', () => {
    expect(CODE).toMatch(/import\s*\{[^}]*balanceQuantityPatch[^}]*\}\s*from\s*'@\/lib\/contributions'/)
    expect(CODE).toMatch(/balanceQuantityPatch\(/)
  })

  it('el patch va escopado a cuentas de SALDO', () => {
    // En un activo por CANTIDAD el precio es por unidad y la cantidad es un
    // dato real del usuario (cantidad 0 es una posicion VENDIDA, no un
    // defecto), asi que normalizarla ahi le cambiaria el valor al item.
    const m = CODE.match(/if \(isBankLike\)[^\n]*balanceQuantityPatch\(/)
    expect(m).not.toBeNull()
  })

  it('el patch se aplica DESPUES de la cantidad cruda, o no la corrige', () => {
    // Un spread en un literal de objeto lo gana el ULTIMO que escribe la
    // llave: puesto antes, el `quantity: parseQuantity(...)` crudo lo pisaria
    // y el arreglo seria inerte.
    const crudo = CODE.indexOf('quantity: parseQuantity(form.quantity),\n        purchasePrice')
    const patch = CODE.indexOf('balanceQuantityPatch(')
    expect(crudo).toBeGreaterThan(-1)
    expect(patch).toBeGreaterThan(crudo)
  })

  // ⛔ EL BUG QUE ESTO EXISTE PARA IMPEDIR, y que costo una ronda entera.
  //
  // En una cuenta de saldo el usuario ve UN solo campo (el saldo), que escribe
  // `form.purchasePrice`; `currentPrice` se DERIVA de el al guardar. Juzgar la
  // cantidad contra `form.currentPrice` agarraba el valor VIEJO: teclear 0
  // dejaba ese campo en 240, la cantidad se conservaba en 1, y la cuenta se
  // guardaba con los dos precios en cero y cantidad 1 — o sea `getItemPrice`
  // caia en cascada a `price`/`cost` y un residuo ahi la RESUCITABA. Ese era
  // el saldo que volvia a 240 despues de vaciarla.
  it('la cantidad se juzga contra el saldo que SE VA A GUARDAR, no contra el campo viejo', () => {
    const m = CODE.match(/balanceQuantityPatch\(\s*\{\s*quantity:\s*updated\.quantity\s*\}\s*,\s*updated\.currentPrice\s*\)/)
    expect(m).not.toBeNull()
    // Y jamas contra los campos crudos del formulario, que para una cuenta de
    // saldo estan desincronizados por construccion.
    expect(CODE).not.toMatch(/balanceQuantityPatch\([\s\S]{0,120}form\.currentPrice/)
  })

  it('corre DESPUES de que currentPrice quedo resuelto', () => {
    const resuelto = CODE.indexOf('if (isBank) updated.currentPrice = parseAmount(form.purchasePrice)')
    const patch = CODE.indexOf('balanceQuantityPatch(')
    expect(resuelto).toBeGreaterThan(-1)
    expect(patch).toBeGreaterThan(resuelto)
  })
})

describe('EditAccountModal: el pie no puede contradecir a la app en silencio', () => {
  it('compara contra getItemValue, la funcion que usa el resto de la app', () => {
    expect(CODE).toMatch(/import\s*\{[^}]*getItemValue[^}]*\}\s*from\s*'@\/components\/dashboard\/utils'/)
    expect(CODE).toMatch(/getItemValue\(item\)/)
  })

  it('avisa cuando lo almacenado se lee distinto de la vista previa', () => {
    // Se exige la COMPARACION, no que la palabra aparezca: un `drift = false`
    // deja el aviso muerto y pasaria igual (comprobado, este test no tenia
    // dientes en su primera version).
    expect(CODE).toMatch(/const\s+stored\s*=\s*getItemValue\(item\)/)
    expect(CODE).toMatch(/const\s+drift\s*=[^\n]*stored[^\n]*total/)
    expect(CODE).toMatch(/\{drift\s*&&/)
    expect(SRC).toMatch(/Hoy la app lo lee como/)
  })

  it('un saldo en CERO se imprime, no desaparece', () => {
    // "esta cuenta vale cero" y "no hay nada que mostrar" no pueden verse
    // igual, y menos justo despues de vaciar una cuenta.
    expect(CODE).toMatch(/if \(isBank && !isDebtType\) return/)
  })
})
