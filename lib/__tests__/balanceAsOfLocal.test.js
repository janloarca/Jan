import fs from 'fs'
import path from 'path'
import { todayLocalISO } from '@/lib/localDate'

// ⛔ FASE MS. `balanceAsOf` es la FECHA de la foto de un saldo, y la regla que
// gobierna todo lo demás es "HASTA `balanceAsOf` manda el saldo, DESPUÉS manda
// la tasa" (lib/assetLogic/liquidFundYield.js).
//
// Las tres puertas que lo sellan lo hacían con `toISOString()`, o sea el día
// UTC. En Guatemala (UTC-6) ese día rota a las 6pm, así que guardar un saldo de
// noche lo fechaba MAÑANA, y con la foto en el futuro un cupón del día
// siguiente cae DENTRO de ella y no se acredita nunca: un cobro tragado, que es
// el error que este repo declara irrecuperable.

// El instante exacto del borde: 7pm del 31 de agosto en Guatemala, que ya es el
// 1 de septiembre en UTC.
const BORDE = new Date('2026-09-01T01:00:00Z')

describe('el sello de la foto es el dia que el usuario vivio (FASE MS)', () => {
  // META-TEST. Todo lo de abajo depende de que la suite corra fijada en
  // America/Guatemala (FASE LF). En UTC las dos lecturas coinciden y estos
  // tests pasarían sin probar nada.
  it('la suite corre al oeste de UTC, o esto no prueba nada', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Guatemala')
  })

  it('a las 7pm del 31 de agosto el dia UTC ya es septiembre', () => {
    jest.useFakeTimers().setSystemTime(BORDE)
    // El valor VIEJO, para que el defecto quede fijado y no vuelva de a poco.
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-01')
    expect(todayLocalISO()).toBe('2026-08-31')
    jest.useRealTimers()
  })

  // La consecuencia, con el predicado REAL que el motor usa. Es comparación de
  // TEXTO ('YYYY-MM-DD' ordena cronológicamente), así que no la puede corromper
  // ninguna zona horaria: lo único que decide es qué se selló.
  it('con el sello viejo, el cupon del dia siguiente cae DENTRO de la foto', () => {
    jest.useFakeTimers().setSystemTime(BORDE)
    const cupon = '2026-09-01' // paga el 1, el dia despues de guardar el saldo

    const selloViejo = new Date().toISOString().slice(0, 10)
    const selloNuevo = todayLocalISO()

    // `processDividends`: un ingreso reinvertido con fecha <= balanceAsOf se
    // SALTA (nunca se escribe), y uno pagado en efectivo solo acredita al
    // destino cuando su fecha es > balanceAsOf.
    const seSalta = (asOf) => cupon <= asOf
    const acredita = (asOf) => cupon > asOf

    expect(seSalta(selloViejo)).toBe(true)   // el defecto: se traga el cupon
    expect(acredita(selloViejo)).toBe(false) // y tampoco mueve el saldo

    expect(seSalta(selloNuevo)).toBe(false)  // el arreglo
    expect(acredita(selloNuevo)).toBe(true)
    jest.useRealTimers()
  })

  // CONTROL POSITIVO: la regla que el campo existe para hacer cumplir sigue
  // valiendo. Un cupon del MISMO dia en que se guardo el saldo sigue estando
  // dentro de la foto (el usuario acaba de teclear ese numero), o sea el
  // arreglo no aflojo el campo, solo lo fecho bien.
  it('un cupon del mismo dia sigue estando dentro de la foto', () => {
    jest.useFakeTimers().setSystemTime(BORDE)
    const asOf = todayLocalISO()
    expect('2026-08-31' <= asOf).toBe(true)
    jest.useRealTimers()
  })

  it('a mediodia las dos lecturas coinciden: el arreglo no mueve el caso comun', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-31T18:00:00Z')) // 12pm local
    expect(todayLocalISO()).toBe(new Date().toISOString().slice(0, 10))
    jest.useRealTimers()
  })
})

// Las tres puertas viven en JSX que jest no puede montar sin sus modales
// completos, así que la adopción se fija LEYENDO LA FUENTE (precedente
// `moneyInputs.test.js`). No es cosmética: una puerta que se quede con el sello
// viejo deja al motor midiendo contra una fecha que no ocurrió.
describe('las TRES puertas sellan con el dia local (FASE MS)', () => {
  const root = path.join(__dirname, '../..')
  const PUERTAS = [
    'components/AddAccountModal.jsx',
    'components/EditAccountModal.jsx',
    'components/dashboard/PortfolioSpreadsheet.jsx',
  ]

  it.each(PUERTAS)('%s sella con todayLocalISO', (rel) => {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    expect(src).toMatch(/balanceAsOf\s*[:=]\s*todayLocalISO\(\)/)
  })

  it.each(PUERTAS)('%s ya no usa el dia UTC para sellar', (rel) => {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    // La firma exacta del sello viejo, en cualquiera de sus dos formas.
    expect(src).not.toMatch(/balanceAsOf\s*[:=]\s*new Date\(\)\.toISOString\(\)/)
  })

  // Si aparece una CUARTA puerta, este test la nombra: un sello olvidado es
  // justo el defecto que la lista de superficies de la spec existe para evitar.
  it('no hay una cuarta puerta que selle el campo sin pasar por acá', () => {
    const scan = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__') continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) scan(full, out)
        else if (/\.(js|jsx)$/.test(e.name)) out.push(full)
      }
      return out
    }
    const files = [...scan(path.join(root, 'components')), ...scan(path.join(root, 'app')), ...scan(path.join(root, 'hooks'))]
    // Horizontal whitespace SOLO: con `\s*` el barrido cruzaba el salto de
    // linea y confundia el `:` de un ternario (`> it.balanceAsOf\n : ...`) con
    // una asignacion, o sea reportaba como escritor a un archivo que solo LEE.
    // Un escaner con un hueco es peor que ninguno (leccion FASE JI2).
    const ESCRIBE = /balanceAsOf[^\S\n]*[:=][^\S\n]*[^=\s]/
    const sellan = files.filter((f) => ESCRIBE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f))
      .filter((rel) => !PUERTAS.includes(rel))
    // El hook LEE el campo, nunca lo sella: si aparece acá, o empezó a sellarlo
    // o el barrido dejó de distinguir lectura de escritura.
    expect(sellan).toEqual([])
  })
})
