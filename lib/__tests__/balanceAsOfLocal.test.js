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

// Las tres puertas de alta/edición viven en JSX que jest no puede montar sin
// sus modales completos, así que la adopción se fija LEYENDO LA FUENTE
// (precedente `moneyInputs.test.js`). No es cosmética: una puerta que se
// quede con el sello viejo deja al motor midiendo contra una fecha que no
// ocurrió. Las otras dos son los "DOS MOTORES COMPARTIDOS" que la propia
// spec congelada ya nombra (liquidFundYield.js, sección 5a): mueven el saldo
// desde CashFlowModal/"Agregar·Retirar" (lib/contributions.js) y desde
// Transferir/Vender (lib/transferFields.js), y sellan la MISMA foto por la
// misma razón.
//
// FASE PL (auditoría de toggles, hallazgo 2): el escaneo de la última prueba
// de este describe vivía acotado a `components/`/`app/`/`hooks/`, así que
// 3 de estas 5 puertas (las que viven en `lib/`) nunca entraban al barrido —
// un sexto escritor ahí habría pasado en silencio. Ver el ensanchado del
// escaneo y sus dos exclusiones documentadas más abajo.
describe('las CINCO puertas sellan con el dia local (FASE MS)', () => {
  const root = path.join(__dirname, '../..')
  const PUERTAS = [
    'components/AddAccountModal.jsx',
    'components/EditAccountModal.jsx',
    'components/dashboard/PortfolioSpreadsheet.jsx',
    'lib/contributions.js',
    'lib/transferFields.js',
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

  // Dos archivos matchean el barrido ampliado y NO son un sexto sello
  // olvidado — cada uno con su propia razón, escrita, y verificada abajo en
  // sus propios tests para que no se puedan quedar viejas en silencio:
  //
  //  - `lib/cardDebt.js` SÍ sella en Firestore, pero a propósito con la fecha
  //    de CORTE del estado de cuenta (`cutDate`) y no con hoy — ver su propia
  //    cabecera, punto 3: ahí no es el usuario quien afirma el saldo, es el
  //    banco, sobre una fecha que ya pasó. Es una puerta real con una regla
  //    distinta, documentada, no un olvido.
  //
  //  - `lib/incomeSchedule.js` matchea en una sola línea
  //    (`monthlyAccrual({..., balanceAsOf: accrualBalanceAsOf})`) que no
  //    sella nada: es puro reenvío de un parámetro hacia OTRA función pura
  //    (`monthlyAccrual`, en lib/dailyAccrual.js), que solo lo usa para
  //    contar días dentro de un mes. Nunca toca Firestore. El parámetro
  //    EXTERNO de `monthlyIncomeAmount` se renombró a propósito (ver su
  //    propio comentario, FASE OM) para no colisionar con esta firma al
  //    escanear `hooks/`; el barrido ampliado a `lib/` encuentra la llamada
  //    INTERNA, que usa el nombre real del parámetro de `monthlyAccrual` y
  //    no el renombrado — un problema distinto que el rename de FASE OM no
  //    podía prevenir porque todavía no existía este alcance.
  const NO_ES_PUERTA = ['lib/cardDebt.js', 'lib/incomeSchedule.js']

  // Si aparece una SEXTA puerta que de verdad sella, este test la nombra: un
  // sello olvidado es justo el defecto que la lista de superficies de la spec
  // existe para evitar.
  it('no hay una sexta puerta que selle el campo sin pasar por acá', () => {
    const scan = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        // `assetLogic` es prosa (specs `export {}`, nunca código real) y sus
        // comentarios CITAN la firma de sello para explicarla — un falso
        // positivo garantizado (ej. liquidFundYield.js:360). Un directorio
        // que no puede ejecutar nunca es un escritor.
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '__tests__' || e.name === 'assetLogic') continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) scan(full, out)
        else if (/\.(js|jsx)$/.test(e.name)) out.push(full)
      }
      return out
    }
    const files = [
      ...scan(path.join(root, 'components')),
      ...scan(path.join(root, 'app')),
      ...scan(path.join(root, 'hooks')),
      ...scan(path.join(root, 'lib')),
    ]
    // Horizontal whitespace SOLO: con `\s*` el barrido cruzaba el salto de
    // linea y confundia el `:` de un ternario (`> it.balanceAsOf\n : ...`) con
    // una asignacion, o sea reportaba como escritor a un archivo que solo LEE.
    // Un escaner con un hueco es peor que ninguno (leccion FASE JI2).
    const ESCRIBE = /balanceAsOf[^\S\n]*[:=][^\S\n]*[^=\s]/
    const sellan = files.filter((f) => ESCRIBE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f))
      .filter((rel) => !PUERTAS.includes(rel) && !NO_ES_PUERTA.includes(rel))
    // El hook LEE el campo, nunca lo sella: si aparece acá, o empezó a sellarlo
    // o el barrido dejó de distinguir lectura de escritura.
    expect(sellan).toEqual([])
  })

  // Las dos exclusiones de arriba no son un cheque en blanco: si cualquiera
  // deja de ser EXACTAMENTE lo que dice ser, este test lo nota.
  it('cardDebt.js sigue sellando cutDate, nunca hoy', () => {
    const src = fs.readFileSync(path.join(root, 'lib/cardDebt.js'), 'utf8')
    expect(src).toMatch(/balanceAsOf\s*[:=]\s*cutDate/)
    expect(src).not.toMatch(/balanceAsOf\s*[:=]\s*todayLocalISO\(\)/)
  })

  it('incomeSchedule.js solo REENVÍA el parámetro a monthlyAccrual, nunca sella un documento', () => {
    const src = fs.readFileSync(path.join(root, 'lib/incomeSchedule.js'), 'utf8')
    expect(src).toMatch(/monthlyAccrual\(\{[^}]*balanceAsOf:\s*accrualBalanceAsOf/)
    // Nunca debe aparecer sellando con el reloj: eso SÍ sería una puerta nueva.
    expect(src).not.toMatch(/balanceAsOf\s*[:=]\s*todayLocalISO\(\)/)
    expect(src).not.toMatch(/balanceAsOf\s*[:=]\s*new Date\(\)\.toISOString\(\)/)
  })
})
