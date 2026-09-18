import fs from 'fs'
import path from 'path'

// FASE OQ. Guardián de FUENTE sobre `app/finances/page.jsx`.
//
// Es de fuente y no de comportamiento porque estas tres reglas viven en JSX que
// jest no puede montar sin la página entera (auth + Firestore + el hook de
// tasas). Mismo precedente que `moneyInputs.test.js` y `ibkrImportGate.test.js`:
// lo que se fija es el CABLEADO, y la aritmética ya está probada aparte
// (financeMonthEmpty.test.js, financeZeroAndNotice.test.js).
//
// Se lee SIN comentarios a propósito: los comentarios de esta misma fase citan
// literalmente la forma prohibida (`annualInMonth.total`) para explicar por qué
// estaba mal, y un guardián que se dispara con su propia documentación es un
// guardián que alguien apaga (la lección de FASE LE).
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const RAW = fs.readFileSync(path.join(process.cwd(), 'app/finances/page.jsx'), 'utf8')
const SRC = stripComments(RAW)

describe('FASE OQ: el cableado de Flujo', () => {
  it('control positivo: el barrido de verdad leyó el render', () => {
    // Sin esto, cualquier aserción negativa de abajo pasaría por haber leído
    // un archivo vacío o por haberse comido el JSX al quitar comentarios.
    expect(SRC.length).toBeGreaterThan(5000)
    expect(SRC).toMatch(/<PnlStatement/)
    expect(SRC).toMatch(/<CategoryDonut/)
    expect(SRC).toMatch(/<YearInViewCard/)
    expect(SRC).toMatch(/<RecurringChargesCard/)
  })

  it('el mes vacío se decide con el motor, no contando filas convertidas', () => {
    // `monthTransactions` ya viene filtrado y convertido a GTQ, así que usarlo
    // sería una SEGUNDA definición de "¿está vacío este mes?" al lado del
    // badge de MonthStatusBar, que sale de `analysis.status`.
    expect(SRC).toMatch(/const monthIsEmpty = analysis\.status === 'empty'/)
    expect(SRC).not.toMatch(/monthIsEmpty\s*=\s*monthTransactions/)
  })

  it('el estado de resultados NO se dibuja en un mes vacío', () => {
    // Regresión: sin este guard, `bottom.amount === 0` se imprimía como
    // "Resultado del mes Q0.00" sobre un mes donde no hay nada capturado.
    const branch = SRC.indexOf('monthIsEmpty ?')
    const pnl = SRC.indexOf('<PnlStatement')
    expect(branch).toBeGreaterThan(-1)
    expect(pnl).toBeGreaterThan(branch)
  })

  it('el año queda FUERA del guard del mes: habla del año, no del mes', () => {
    const close = SRC.indexOf('</>)}')
    const year = SRC.indexOf('<YearInViewCard')
    expect(close).toBeGreaterThan(-1)
    expect(year).toBeGreaterThan(close)
  })

  it('la línea de pagos anuales lee el campo que el módulo de verdad devuelve', () => {
    // `annualPaymentsOfMonth` devuelve `{ totalGtq, rows }`. Leer `.total` daba
    // `undefined > 0`, o sea la línea nunca se renderizó para nadie.
    expect(SRC).toMatch(/annualInMonth\.totalGtq/)
    expect(SRC).not.toMatch(/annualInMonth\.total\b(?!Gtq)/)
  })

  it('la recurrencia se detecta UNA vez y se pasa a los dos consumidores', () => {
    const calls = SRC.match(/detectRecurringCharges\(/g) || []
    expect(calls.length).toBe(1)
    expect(SRC).toMatch(/<RecurringChargesCard[\s\S]{0,300}?recurring=\{recurring\}/)
    expect(SRC).toMatch(/<YearInViewCard[\s\S]{0,300}?recurring=\{recurring\}/)
  })
})
