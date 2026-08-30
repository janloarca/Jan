import fs from 'fs'
import path from 'path'
import { vanishedIbkrPositionIds } from '@/lib/ibkrVanishedPositions'

// ⛔ FASE MH. Deseleccionar una cuenta en la vista previa del import BORRABA
// las posiciones guardadas de esa cuenta.
//
// El mecanismo: `dataToImport` filtraba `items` y `transactions` por las cuentas
// activas pero NO `accounts`, que viajaba entero por el spread de `preview`.
// `vanishedIbkrPositionIds` usa esa lista como "qué cuentas cubre ESTE reporte"
// (su GUARDA 4), así que con la lista completa concluía que el reporte cubre la
// cuenta deseleccionada, no encontraba sus símbolos en el feed (porque los
// acababan de filtrar) y las daba por vendidas.
//
// El daño es del peor tipo que este repo reconoce: el usuario hace una acción
// deliberada y explícita ("importá solo esta cuenta") y el resultado es que la
// OTRA desaparece, sin aviso y sin forma de recuperarla.
describe('el filtro de cuentas no puede borrar la cuenta que se deja fuera', () => {
  const stored = [
    { id: 'a1', _source: 'ibkr', symbol: 'AAPL', _ibkrAccountId: 'U1' },
    { id: 'b1', _source: 'ibkr', symbol: 'MSFT', _ibkrAccountId: 'U2' },
    { id: 'b2', _source: 'ibkr', symbol: 'TSLA', _ibkrAccountId: 'U2' },
  ]
  // Lo que llega tras deseleccionar U2: solo los items de U1.
  const feedItems = [{ symbol: 'AAPL', _ibkrAccountId: 'U1' }]

  it('con la lista de cuentas FILTRADA no se borra nada', () => {
    expect(vanishedIbkrPositionIds({ storedItems: stored, feedItems, feedAccounts: ['U1'] })).toEqual([])
  })

  // Regresión NEGATIVA explícita: así se comportaba, y es lo que no puede volver.
  it('con la lista SIN filtrar se borraban las dos posiciones de U2', () => {
    expect(vanishedIbkrPositionIds({ storedItems: stored, feedItems, feedAccounts: ['U1', 'U2'] }))
      .toEqual(['b1', 'b2'])
  })

  // Control POSITIVO: la limpieza sigue haciendo su trabajo real. Sin esto, el
  // primer test podría pasar porque la función dejó de borrar NADA nunca.
  it('control: una posición de verdad vendida en la cuenta importada SÍ se borra', () => {
    const feedSoloAAPL = [{ symbol: 'AAPL', _ibkrAccountId: 'U1' }]
    const conVendida = [...stored, { id: 'a2', _source: 'ibkr', symbol: 'NVDA', _ibkrAccountId: 'U1' }]
    expect(vanishedIbkrPositionIds({ storedItems: conVendida, feedItems: feedSoloAAPL, feedAccounts: ['U1'] }))
      .toEqual(['a2'])
  })
})

// El guard vive en JSX que jest no puede montar sin el modal entero, así que se
// fija leyendo la FUENTE (mismo precedente que `moneyInputs.test.js`).
describe('guardián de fuente: dataToImport filtra las tres listas', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'components/IBKRSyncModal.jsx'), 'utf8')

  it('el bloque filtrado incluye `accounts: activeAccounts`', () => {
    const i = SRC.indexOf('const dataToImport = hasFilter ? {')
    expect(i).toBeGreaterThan(-1)
    const bloque = SRC.slice(i, i + 1400)
    expect(bloque).toMatch(/items:\s*preview\.items\.filter/)
    expect(bloque).toMatch(/transactions:\s*preview\.transactions\.filter/)
    expect(bloque).toMatch(/accounts:\s*activeAccounts/)
  })

  it('el resultado reportado usa las cuentas ACTIVAS, no todas', () => {
    expect(SRC).toMatch(/accounts:\s*activeAccounts/)
    // `preview.accounts` crudo no puede volver a alimentar el import.
    const i = SRC.indexOf('const dataToImport = hasFilter ? {')
    const bloque = SRC.slice(i, i + 1400)
    expect(bloque).not.toMatch(/accounts:\s*preview\.accounts/)
  })
})
