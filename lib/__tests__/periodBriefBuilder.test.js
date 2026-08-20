/**
 * @jest-environment node
 */
// Integración del builder mensual de punta a punta con un db FALSO: el
// pipeline real (carga → enriquecimiento → Dietz del mes cerrado → adjuntos),
// no una versión hecha a mano de sus salidas (la lección de FASE GQ3: probar
// con props armados a mano fue exactamente cómo se escapó un crash). Activos
// solo estáticos a propósito: priceItems no toca la red sin símbolos de
// mercado, así que el test no depende de ningún proveedor.

import { buildMonthlyBriefForUser, buildAnnualBriefForUser, monthRefFor } from '../periodBriefBuilder'
import { makeContextCache } from '../briefContext'

// Enviado el 1 de septiembre a las 22:00 UTC: cubre agosto completo.
const NOW = new Date('2026-09-01T22:00:00Z')

const ITEMS = [
  { id: 'bond1', name: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, purchasePrice: 6000, currentPrice: 6000, currency: 'USD' },
  { id: 'cash1', name: 'Fondo Líquido', type: 'Bank', institution: 'IDC', quantity: 1, currentPrice: 240, currency: 'USD' },
]

const SNAPSHOTS = [
  { id: '2026-01-02', date: '2026-01-02', netWorthUSD: 6000, rates: { USD: 1 }, _source: 'daily' },
  { id: '2026-07-31', date: '2026-07-31', netWorthUSD: 6100, rates: { USD: 1 }, _source: 'daily' },
  { id: '2026-08-31', date: '2026-08-31', netWorthUSD: 6240, rates: { USD: 1 }, _source: 'daily' },
]

const TXS = [
  { id: 't1', type: 'DIVIDEND', date: '2026-08-15', totalAmount: 140, currency: 'USD', _linkedItemId: 'bond1' },
]

const ITEM_SNAPSHOT_DOCS = {
  // Solo enero cacheado, y bajo la versión VIGENTE: los demás meses quedan en
  // blanco y agosto (el mes cubierto) sale de los valores en vivo.
  '2026-01': { _version: 999, _currency: 'USD', items: { bond1: { value: 6000 }, cash1: { value: 0 } } },
}

function makeFakeDb() {
  return {
    collection: (path) => ({
      get: async () => {
        const name = path.split('/').pop()
        const rows = name === 'items' ? ITEMS : name === 'transactions' ? TXS : name === 'snapshots' ? SNAPSHOTS : []
        return { docs: rows.map((r) => ({ id: r.id, data: () => r })) }
      },
    }),
    doc: (path) => ({
      get: async () => {
        const mk = path.split('/').pop()
        const data = ITEM_SNAPSHOT_DOCS[mk]
        // Admin SDK: `exists` es PROPIEDAD, no función (el cliente usa exists()).
        return { exists: !!data, data: () => data }
      },
    }),
  }
}

describe('buildMonthlyBriefForUser (integración con db falso)', () => {
  test('arma el correo del mes cerrado con sus DOS adjuntos reales', async () => {
    const mail = await buildMonthlyBriefForUser({ db: makeFakeDb(), uid: 'u1', prefs: {}, market: null, now: NOW })
    expect(mail).toBeTruthy()

    // El mes cubierto es AGOSTO (el de ayer), no septiembre.
    expect(mail.subject).toBe('Chispudo Monthly · August 2026')

    // Retorno del mes: ancla 31 jul (6,100) → hoy (6,240), con el cupón de
    // 140 cobrado EN efectivo a mitad de mes. No hay depósitos que netear.
    expect(mail.text).toContain('this month')
    expect(mail.text).toContain('Income collected')

    // Los dos adjuntos reales: PDF (firma %PDF) y XLSX (firma ZIP "PK").
    expect(mail.attachments).toHaveLength(2)
    const pdf = mail.attachments.find((a) => a.filename.endsWith('.pdf'))
    const xlsx = mail.attachments.find((a) => a.filename.endsWith('.xlsx'))
    expect(pdf.content.slice(0, 4).toString('latin1')).toBe('%PDF')
    expect(xlsx.content.slice(0, 2).toString('latin1')).toBe('PK')
    expect(xlsx.filename).toBe('chispudo-spreadsheet-2026.xlsx')
    expect(mail.text).toContain('year-to-date report (PDF)')
    expect(mail.text).toContain('monthly spreadsheet (Excel)')

    // El caché solo tenía enero: el correo avisa de los meses en blanco.
    expect(mail.text).toMatch(/blank.*open the Spreadsheet/i)
  })

  test('portafolio vacío devuelve null en vez de un correo hueco', async () => {
    const emptyDb = {
      collection: () => ({ get: async () => ({ docs: [] }) }),
      doc: () => ({ get: async () => ({ exists: false, data: () => null }) }),
    }
    expect(await buildMonthlyBriefForUser({ db: emptyDb, uid: 'u1', now: NOW })).toBeNull()
  })

  test('monthRefFor: el 1 del mes referencia al mes anterior', () => {
    const ref = monthRefFor(NOW)
    expect(ref.getUTCMonth()).toBe(7) // agosto
    expect(ref.getUTCFullYear()).toBe(2026)
  })
})

// ── FASE IE6: el anual, de punta a punta con el builder REAL ──────────────
describe('buildAnnualBriefForUser', () => {
  // Enviado el 1 de enero de 2027: cubre 2026 completo.
  const JAN1 = new Date('2027-01-01T22:00:00Z')

  test('cubre el año que acaba de cerrar, con sus dos adjuntos', async () => {
    const mail = await buildAnnualBriefForUser({ db: makeFakeDb(), uid: 'u1', prefs: {}, market: null, now: JAN1 })
    expect(mail).toBeTruthy()
    expect(mail.subject).toBe('Chispudo Annual · 2026')
    expect(mail.text).toContain('YOUR YEAR')

    expect(mail.attachments).toHaveLength(2)
    const pdf = mail.attachments.find((a) => a.filename.endsWith('.pdf'))
    const xlsx = mail.attachments.find((a) => a.filename.endsWith('.xlsx'))
    expect(pdf.content.slice(0, 4).toString('latin1')).toBe('%PDF')
    expect(xlsx.content.slice(0, 2).toString('latin1')).toBe('PK')
    // El spreadsheet es el del año CUBIERTO, no el del año nuevo.
    expect(xlsx.filename).toBe('chispudo-spreadsheet-2026.xlsx')
  })

  test('el spreadsheet del anual abarca los 12 meses del año cubierto', async () => {
    const mail = await buildAnnualBriefForUser({ db: makeFakeDb(), uid: 'u1', now: JAN1 })
    const xlsx = mail.attachments.find((a) => a.filename.endsWith('.xlsx'))
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(xlsx.content)
    const head = wb.worksheets[0].getRow(4)
    // Dos columnas de etiqueta + 12 meses.
    expect(head.cellCount).toBe(14)
    expect(head.getCell(3).value).toBe('Jan')
    expect(head.getCell(14).value).toContain('Dec')
  })

  test('una prueba a mitad de año cubre el año EN CURSO, etiquetado (to date)', async () => {
    const midYear = new Date('2026-08-15T22:00:00Z')
    const mail = await buildAnnualBriefForUser({ db: makeFakeDb(), uid: 'u1', now: midYear })
    expect(mail.subject).toBe('Chispudo Annual · 2026 (to date)')
  })
})

// ── FASE IE7: lo que el reporte adjunto imprimía mal ──────────────────────
// El PDF real que recibió el usuario decía "Income collected $579.06" y dos
// líneas abajo "Dividends, trailing 12 months $0.00": un cero inventado que
// además se contradecía a sí mismo. Y "Since inception" salía en guion en un
// documento que sí declaraba años calendario completos.
describe('el reporte adjunto no imprime ceros falsos', () => {
  const pdfText = async (mail) => {
    const pdf = mail.attachments.find((a) => a.filename.endsWith('.pdf'))
    const s = pdf.content.toString('latin1')
    return [...s.matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)]
      .map((m) => m[0].slice(1, -4).replace(/\\([()])/g, '$1')).join('\n')
  }

  test('los dividendos de 12 meses salen del ledger, no en cero', async () => {
    const mail = await buildMonthlyBriefForUser({ db: makeFakeDb(), uid: 'u1', now: NOW })
    const txt = await pdfText(mail)
    const i = txt.indexOf('Dividends, trailing 12 months')
    expect(i).toBeGreaterThan(-1)
    // El fixture tiene un dividendo de 140 dentro de los últimos 12 meses.
    // (La proyección de la fila siguiente sí puede ser 0 y sería correcto:
    // ninguna posición de este fixture declara una tasa.)
    expect(txt.slice(i, i + 45)).toContain('$140.00')
    expect(txt.slice(i, i + 45)).not.toContain('$0.00')
  })

  test('la proyección anual sale de las tasas declaradas de las posiciones', async () => {
    // Un bono al 8% sobre 6,000 proyecta 480 al año, 40 al mes: antes salía
    // en cero porque el servidor no pasaba la cifra al reporte.
    const withYield = {
      collection: (path) => ({ get: async () => {
        const name = path.split('/').pop()
        const rows = name === 'items'
          ? [{ id: 'b1', name: 'VITALI', symbol: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, purchasePrice: 6000, currentPrice: 6000, currency: 'USD', dividendYield: 8 }]
          : name === 'transactions' ? [] : name === 'snapshots' ? SNAPSHOTS : []
        return { docs: rows.map((r) => ({ id: r.id, data: () => r })) }
      } }),
      doc: () => ({ get: async () => ({ exists: false, data: () => null }) }),
    }
    const mail = await buildMonthlyBriefForUser({ db: withYield, uid: 'u1', now: NOW })
    const txt = await pdfText(mail)
    const i = txt.indexOf('Projected annual income')
    expect(txt.slice(i, i + 45)).toContain('$480.00')
  })

  test('"Since inception" se resuelve con la serie archivada en vez de un guion', async () => {
    const mail = await buildMonthlyBriefForUser({ db: makeFakeDb(), uid: 'u1', now: NOW })
    const txt = await pdfText(mail)
    const i = txt.indexOf('Since inception')
    expect(i).toBeGreaterThan(-1)
    expect(txt.slice(i, i + 40)).toMatch(/[+(]?\d+\.\d\d%/)
  })
})

// FASE IE8. Los dos PDFs de la MISMA tanda se contradecían: el del mensual
// decía "Dividends, trailing 12 months $784.87" y el del semanal "$0.00" con
// los mismos datos, porque solo el builder mensual pasaba esas cifras. Son de
// 12 meses y de tasas declaradas: no dependen del período que cubre el correo.
describe('el reporte del SEMANAL trae las mismas cifras de ingreso', () => {
  test('los dividendos de 12 meses no dependen de la ventana del correo', async () => {
    const { buildWeeklyBriefForUser } = await import('../weeklyBriefBuilder')
    const mail = await buildWeeklyBriefForUser({ db: makeFakeDb(), uid: 'u1', now: NOW })
    const pdf = mail.attachments.find((a) => a.filename.endsWith('.pdf'))
    const s = pdf.content.toString('latin1')
    const txt = [...s.matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)]
      .map((m) => m[0].slice(1, -4).replace(/\\([()])/g, '$1')).join('\n')
    const i = txt.indexOf('Dividends, trailing 12 months')
    expect(i).toBeGreaterThan(-1)
    expect(txt.slice(i, i + 45)).toContain('$140.00')
  })
})

// FASE IE9. El día 1 (y el 1 de enero) un mismo usuario recibe dos o tres
// cadencias en la MISMA corrida del cron. Leer su portafolio una vez por
// cadencia no cambia ningún número y sí cuenta doble contra la cuota diaria
// de Firestore, que el usuario ya agotó probando ("8 RESOURCE_EXHAUSTED").
describe('el caché de corrida evita releer el mismo portafolio', () => {
  const countingDb = () => {
    let reads = 0
    const base = makeFakeDb()
    return {
      reads: () => reads,
      db: {
        collection: (p) => ({ get: async () => { reads++; return base.collection(p).get() } }),
        doc: (p) => base.doc(p),
      },
    }
  }

  test('dos cadencias con caché leen las colecciones UNA sola vez', async () => {
    const { db, reads } = countingDb()
    const cache = makeContextCache()
    await buildMonthlyBriefForUser({ db, uid: 'u1', now: NOW, cache })
    const afterFirst = reads()
    await buildAnnualBriefForUser({ db, uid: 'u1', now: NOW, cache })
    expect(reads()).toBe(afterFirst)
  })

  test('sin caché, cada cadencia vuelve a leer (comportamiento de siempre)', async () => {
    const { db, reads } = countingDb()
    await buildMonthlyBriefForUser({ db, uid: 'u1', now: NOW })
    const afterFirst = reads()
    await buildAnnualBriefForUser({ db, uid: 'u1', now: NOW })
    expect(reads()).toBeGreaterThan(afterFirst)
  })

  test('usuarios distintos NO comparten contexto', async () => {
    const { db, reads } = countingDb()
    const cache = makeContextCache()
    await buildMonthlyBriefForUser({ db, uid: 'u1', now: NOW, cache })
    const afterFirst = reads()
    await buildMonthlyBriefForUser({ db, uid: 'u2', now: NOW, cache })
    expect(reads()).toBeGreaterThan(afterFirst)
  })
})
