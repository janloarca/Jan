// FASE LO: los cinco arreglos del tier "muerde hoy" de la auditoría de seis
// agentes. Cada bloque fija el COMPORTAMIENTO, y varios fijan además el
// comportamiento viejo como regresión negativa explícita.

import fs from 'fs'
import path from 'path'
import { categorizeExpense } from '../expenseCategorize'
import { suggestCategoryForLabel } from '../merchantLabels'
import { FINANCE_CATEGORIES, isTransferCategory } from '../financeCategories'
import { expenseDocId, normalizeExpenseInput } from '../expenseIngest'
import { computeScopedReturns } from '../../components/dashboard/utils'
import { boundedPct } from '../friendsStats'

// ── 1. Un gasto real que dice "TRANSFERENCIA" no puede salirse del mes ──────
//
// Las dos categorías de transferencia están EXCLUIDAS de todos los totales
// desde FASE KV, así que una regla de texto que las asigne saca dinero real de
// la vista sin decirlo. `financeCategories.js` deja sus arreglos vacíos a
// propósito y lo explica; esta tabla tenía la regla igual.
describe('ningún clasificador de TEXTO puede asignar una categoría de transferencia', () => {
  const reales = [
    'TRANSFERENCIA A JUAN PEREZ',
    'TRANSFERENCIA ACH TERCEROS',
    'ZELLE TO M RODRIGUEZ',
    'PAYPAL *TIENDA',
    'WESTERN UNION ENVIO',
    'REMESA FAMILIAR',
    'ENVIO DE DINERO',
  ]

  it.each(reales)('%s no cae en una categoría de transferencia', (desc) => {
    const { category } = categorizeExpense(desc)
    expect(isTransferCategory(category)).toBe(false)
  })

  it('cae al fallback, que SÍ cuenta en el mes', () => {
    const { category } = categorizeExpense('TRANSFERENCIA A JUAN PEREZ')
    expect(category).toBe('Otros Gastos')
    expect(FINANCE_CATEGORIES.EXPENSE).toContain(category)
  })

  it('el sugeridor por etiqueta tampoco las ofrece', () => {
    for (const label of ['transferencia', 'remesa', 'le mande', 'pago a persona']) {
      const hit = suggestCategoryForLabel(label)
      if (hit) expect(isTransferCategory(hit.category)).toBe(false)
    }
  })

  // Las dos siguen existiendo y siguen excluidas: se llega a ellas por
  // evidencia (el neteo) o porque el usuario las elige a mano.
  it('las categorías no se borraron, solo dejaron de asignarse por texto', () => {
    expect(FINANCE_CATEGORIES.EXPENSE).toContain('Transferencia Enviada')
    expect(isTransferCategory('Transferencia Enviada')).toBe(true)
    expect(isTransferCategory('Transferencia Recibida')).toBe(true)
  })

  // Guardián de FUENTE: el arreglo vacío de `financeCategories` es la regla
  // escrita, y una tabla paralela que la contradiga es cómo volvió a pasar.
  it('ninguna tabla de palabras clave nombra una categoría de transferencia', () => {
    const files = ['expenseCategorize.js', 'merchantLabels.js']
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
      const sinComentarios = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(sinComentarios).not.toMatch(/category:\s*'Transferencia/)
    }
  })
})

// ── 2. Dos compras reales del mismo día no pueden colapsar ─────────────────
describe('el id del documento separa dos cobros reales, no solo los reportados', () => {
  const compra = (occurredAt, receivedAt, source) => normalizeExpenseInput({
    amount: 20, currency: 'GTQ', merchant: 'PARQUEO CENTRO',
    date: '2026-08-20', occurredAt, receivedAt, source,
  })

  it('Android: dos parqueos de Q20 a horas distintas dan ids DISTINTOS', () => {
    // Android nunca reporta hora: la ruta pasa offsetMinutes = null, así que
    // `occurredAt` cae a la de llegada. Era el caso que seguía tragando.
    const a = compra(null, '2026-08-20T18:00:00.000Z', 'android')
    const b = compra(null, '2026-08-20T23:30:00.000Z', 'android')
    expect(a.timeSource).toBe('received')
    expect(b.timeSource).toBe('received')
    expect(expenseDocId(a)).not.toBe(expenseDocId(b))
  })

  it('el mismo evento reintentado con la misma hora da el MISMO id', () => {
    const a = compra(null, '2026-08-20T18:00:00.000Z', 'email')
    const b = compra(null, '2026-08-20T18:00:00.000Z', 'email')
    expect(expenseDocId(a)).toBe(expenseDocId(b))
  })

  it('con hora reportada sigue separando, igual que antes', () => {
    const a = compra('2026-08-20T18:00:00.000Z', null, 'shortcut')
    const b = compra('2026-08-20T23:30:00.000Z', null, 'shortcut')
    expect(a.timeSource).toBe('reported')
    expect(expenseDocId(a)).not.toBe(expenseDocId(b))
  })

  // Regresión negativa: la llave vieja (solo instante REPORTADO) colapsaba los
  // dos parqueos de Android en un documento.
  it('la llave vieja SÍ los colapsaba', () => {
    const viejo = (i) => `${i.date}|${Math.round(i.amount * 100)}|${i.currency}|${i.merchant}|${i.source}` +
      (i.timeSource === 'reported' && i.occurredAt ? `|${i.occurredAt}` : '')
    const a = compra(null, '2026-08-20T18:00:00.000Z', 'android')
    const b = compra(null, '2026-08-20T23:30:00.000Z', 'android')
    expect(viejo(a)).toBe(viejo(b))
  })
})

// ── 4. La banda de ±200 la aplica boundedPct, no un clamp anterior ─────────
//
// Saturar antes dejaba a `boundedPct` sin poder ver un valor fuera de banda,
// así que el YTD más roto se publicaba como +200.00% exacto y encabezaba el
// ranking (el defecto que FASE JA5 vino a cerrar).
describe('un retorno fuera de banda llega SIN saturar al publicador', () => {
  // Un ancla minúscula contra un valor de hoy grande: Dietz produce un
  // porcentaje muy por encima de la banda.
  const scoped = (startVal) => computeScopedReturns({
    snapshots: [{ date: '2026-01-01', netWorthUSD: startVal, _source: 'ibkr' }],
    items: [{ id: 'a', _source: 'ibkr', quantity: 1, currentPrice: 10000, type: 'Stock' }],
    transactions: [],
    source: 'ibkr',
    convert: (v) => v,
    baseCurrency: 'USD',
    nowTs: Date.UTC(2026, 7, 20),
  })

  it('computeScopedReturns no satura', () => {
    const { ytd } = scoped(10)
    expect(ytd).toBeGreaterThan(200)
  })

  it('y boundedPct puede entonces hacer su trabajo', () => {
    const { ytd } = scoped(10)
    expect(boundedPct(ytd)).toBeNull()
  })

  // Regresión negativa: con el valor saturado, boundedPct lo acepta como si
  // fuera un +200% real.
  it('saturado antes, boundedPct lo deja pasar como +200', () => {
    const { ytd } = scoped(10)
    const saturado = Math.max(-200, Math.min(200, ytd))
    expect(boundedPct(saturado)).toBe(200)
  })

  it('un retorno normal pasa intacto', () => {
    const { ytd } = scoped(9000)
    expect(ytd).toBeLessThan(200)
    expect(boundedPct(ytd)).toBeCloseTo(ytd, 6)
  })
})

// ── 3. El importador no puede contar como éxito una escritura fallida ──────
//
// `updateFinanceTransaction` NO lanza: atrapa su error y devuelve false, así
// que el `catch` era código muerto y el retorno no se leía. Guardián de FUENTE
// porque el confirm del modal es inalcanzable en jest sin montarlo con un
// archivo real (mismo precedente que moneyInputs.test.js).
describe('los bucles de update del importador leen el valor de retorno', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'FileImportModal.jsx'), 'utf8'
  )

  it('ninguna llamada a onUpdateFinanceTransaction descarta su retorno', () => {
    // Toda llamada `await onUpdateFinanceTransaction(...)` tiene que asignarse.
    const sueltas = src
      .split('\n')
      .filter((l) => /await onUpdateFinanceTransaction\(/.test(l))
      .filter((l) => !/=\s*await onUpdateFinanceTransaction\(/.test(l))
    expect(sueltas).toEqual([])
  })

  it('y comparan contra false explícito, no truthy', () => {
    // `undefined` cuenta como éxito a propósito, para no romper a un caller
    // que no devuelva nada: la misma regla que el bucle de addFinanceTransaction.
    const comparaciones = src.match(/if \(ok === false\) failed\+\+/g) || []
    expect(comparaciones.length).toBeGreaterThanOrEqual(2)
  })
})
