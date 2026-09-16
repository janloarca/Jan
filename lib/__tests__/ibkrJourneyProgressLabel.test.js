// FASE NZ. Las tres superficies que hablan del avance del viaje de IBKR
// (la barra del viaje, el panel de requisitos y la baldosa del tablero) no
// pueden volver a inventar cada una su propia cuenta.
//
// El defecto que motiva estos tests, medido con las funciones reales: la barra
// contaba PANTALLAS (5, incluida la de resumen) y el panel REQUISITOS (4), así
// que en el paso 5 la barra decía "Paso 5 de 5" (que se lee como "terminaste")
// tres centímetros arriba de un panel que decía "3 de 4 listos". Y un paso
// legítimamente innecesario sumaba al 75% mientras la barra lo dibujaba igual
// que uno pendiente, porque solo miraba `done`.
import fs from 'fs'
import path from 'path'
import {
  ibkrJourneyProgress,
  journeyProgressLabel,
  journeySatisfiedSteps,
} from '../ibkrJourney'

// El escenario COMÚN: API conectada, el sync ya trajo NAV, la cuenta es más
// joven que el tope de ~365 días (así que transcribir no hace falta) y todavía
// no se copiaron los retornos.
const COMMON = {
  ibkrConnected: true,
  ibkrNavDays: 259,
  hasQuarterlyHistory: false,
  ibkrSnapshotSpanDays: 400,
  earliestNeededDays: 300,
  hasIbkrCalibration: false,
}
const ALL_DONE = {
  ibkrConnected: true,
  ibkrNavDays: 259,
  hasQuarterlyHistory: true,
  ibkrSnapshotSpanDays: 400,
  earliestNeededDays: 900,
  hasIbkrCalibration: true,
}

describe('journeyProgressLabel', () => {
  it('cuenta REQUISITOS, nunca pantallas: el paso 5 es el resumen y no suma', () => {
    const p = ibkrJourneyProgress(COMMON)
    expect(p.total).toBe(4)
    expect(journeyProgressLabel(p, 'es')).toBe('3 de 4 listos')
    expect(journeyProgressLabel(p, 'en')).toBe('3 of 4 done')
  })

  it('completo dice que está completo, no "4 de 4"', () => {
    const p = ibkrJourneyProgress(ALL_DONE)
    expect(p.complete).toBe(true)
    expect(journeyProgressLabel(p, 'es')).toBe('Todo listo')
    expect(journeyProgressLabel(p, 'en')).toBe('All set')
  })

  it('sin avance devuelve cadena vacía en vez de un "0 de 0"', () => {
    expect(journeyProgressLabel(null, 'es')).toBe('')
    expect(journeyProgressLabel({ total: 0, steps: [] }, 'es')).toBe('')
  })
})

describe('journeySatisfiedSteps', () => {
  it('incluye el paso que NO hace falta: cuenta para el % igual que uno hecho', () => {
    const p = ibkrJourneyProgress(COMMON)
    // El escenario tiene 3 satisfechos (2 hechos + 1 innecesario) sobre 4.
    expect(p.satisfied).toBe(3)
    expect(p.pct).toBe(75)
    const marks = journeySatisfiedSteps(p)
    expect(marks.map((s) => s.step).sort()).toEqual([1, 2, 3])
    // REGRESIÓN: la barra marcaba solo `done`, así que el paso 3 (que ya sumaba
    // al 75%) se dibujaba idéntico a un pendiente.
    const onlyDone = p.steps.filter((s) => s.done).map((s) => s.step)
    expect(onlyDone).toEqual([1, 2])
    expect(marks.map((s) => s.step)).not.toEqual(onlyDone)
  })

  it('distingue hecho de innecesario: no son la misma marca', () => {
    const marks = journeySatisfiedSteps(ibkrJourneyProgress(COMMON))
    expect(marks.find((s) => s.step === 2).status).toBe('done')
    expect(marks.find((s) => s.step === 3).status).toBe('skippable')
  })

  it('el paso 5 (resumen) nunca aparece: no es un requisito', () => {
    const marks = journeySatisfiedSteps(ibkrJourneyProgress(ALL_DONE))
    expect(marks.map((s) => s.step)).toEqual([1, 2, 3, 4])
  })

  it('sin progreso devuelve lista vacía, nunca lanza', () => {
    expect(journeySatisfiedSteps(null)).toEqual([])
    expect(journeySatisfiedSteps({})).toEqual([])
  })
})

// Guardián de FUENTE (precedente: moneyInputs.test.js, ibkrCredentialDoors.test.js):
// estas reglas viven en JSX que jest no puede montar sin el tablero entero.
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const BAR = 'components/dashboard/IBKRJourneyBar.jsx'
const PANEL = 'components/dashboard/BrokerProgressPanel.jsx'
const TILE = 'components/dashboard/QuickActionsCard.jsx'
const PAGE = 'app/dashboard/page.jsx'

describe('ninguna superficie arma su propia cuenta del avance', () => {
  it('la barra pide la frase en vez de escribirla', () => {
    const src = read(BAR)
    expect(src).toContain('journeyProgressLabel')
    // El "Paso X de Y" visible introducía un SEGUNDO denominador al lado del
    // panel. Sobrevive solo como texto para lectores de pantalla, donde los
    // círculos no se escanean de un vistazo.
    const paso = src.indexOf('Paso ${step} de ${total}')
    expect(paso).toBeGreaterThan(-1)
    expect(src.slice(Math.max(0, paso - 200), paso)).toContain('sr-only')
  })

  it('el panel pide la MISMA frase en vez de escribir la suya', () => {
    const src = read(PANEL)
    expect(src).toContain('journeyProgressLabel(progress, lang)')
    expect(src).not.toContain('${satisfied} de ${total} listos')
    expect(src).not.toContain('${satisfied} of ${total} done')
  })

  it('la barra marca los pasos SATISFECHOS, no solo los hechos', () => {
    expect(read(BAR)).toContain('journeySatisfiedSteps')
    // El caller no puede volver a filtrar por su cuenta: pasaba
    // doneSteps={...filter((s) => s.done)...}, que dejaba fuera al innecesario.
    expect(read(PAGE)).not.toContain('doneSteps=')
  })

  it('un paso innecesario no se pinta como uno pendiente', () => {
    const src = read(PANEL)
    const i = src.indexOf(': isSkippable')
    expect(i).toBeGreaterThan(-1)
    const branch = src.slice(i, i + 600)
    // El gris neutro es EXACTAMENTE lo que usa un pendiente sin turno.
    expect(branch).not.toContain("backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }\n                    : isNext")
    expect(branch).toContain('accent-green')
  })

  it('la baldosa del tablero nombra un setup a medias', () => {
    const src = read(TILE)
    expect(src).toContain('journeyProgressLabel')
    expect(src).toContain('ibkrProgress.started')
    expect(src).toContain('!ibkrProgress.complete')
    // No puede competir con una alarma real de sincronización.
    expect(src).toContain('!ibkrNeedsAttention')
    expect(read(PAGE)).toContain('ibkrProgress={ibkrProgress}')
  })
})
