/**
 * @jest-environment node
 */
// FASE KP. El contrato de loadUserPortfolioContext sobre settings/profile:
// `profileName` EXACTO como siempre (los email builders lo leen tal cual) y el
// bloque `advisor` nuevo (firma, teléfono, correo) que alimenta el "Preparado
// por" del link compartido. Se ejercita el pipeline REAL con un db falso, no
// una versión a mano de sus salidas (lección FASE GQ3). Activos solo estáticos
// a propósito: priceItems no toca la red sin símbolos de mercado.

import { loadUserPortfolioContext, scopeSourceExists } from '../briefContext'

const ITEMS = [
  { id: 'bond1', name: 'VITALI', type: 'Bond', institution: 'IDC', quantity: 1, purchasePrice: 6000, currentPrice: 6000, currency: 'USD' },
]
const SNAPSHOTS = [
  { id: '2026-08-01', date: '2026-08-01', netWorthUSD: 6000, rates: { USD: 1 }, _source: 'daily' },
]

function makeFakeDb({ profile = null, profileThrows = false } = {}) {
  return {
    collection: (path) => ({
      get: async () => {
        const name = path.split('/').pop()
        const rows = name === 'items' ? ITEMS : name === 'snapshots' ? SNAPSHOTS : []
        return { docs: rows.map((r) => ({ id: r.id, data: () => r })) }
      },
    }),
    doc: (path) => ({
      get: async () => {
        if (path.endsWith('/settings/profile')) {
          if (profileThrows) throw new Error('boom')
          // Admin SDK: `exists` es PROPIEDAD, no función.
          return { exists: !!profile, data: () => profile }
        }
        return { exists: false, data: () => null }
      },
    }),
  }
}

describe('loadUserPortfolioContext: identidad del perfil', () => {
  test('lee nombre y asesor del doc ensanchado; profileName conserva su contrato exacto', async () => {
    const ctx = await loadUserPortfolioContext({
      db: makeFakeDb({ profile: {
        name: '  Jan Marco  ',
        advisorFirm: ' IDC Valores ',
        advisorPhone: '+502 5555 5555',
        advisorEmail: 'jan@idc.gt',
      } }),
      uid: 'u1', prefs: {},
    })
    expect(ctx.profileName).toBe('Jan Marco')
    expect(ctx.advisor).toEqual({ firm: 'IDC Valores', phone: '+502 5555 5555', email: 'jan@idc.gt' })
  })

  test('rechazo POR CAMPO: un teléfono guardado como número no tumba la firma', async () => {
    const ctx = await loadUserPortfolioContext({
      db: makeFakeDb({ profile: { name: 'Jan', advisorFirm: 'IDC', advisorPhone: 55555555, advisorEmail: '   ' } }),
      uid: 'u1', prefs: {},
    })
    expect(ctx.advisor).toEqual({ firm: 'IDC', phone: null, email: null })
  })

  test('sin ningún campo de asesor, advisor es null (una sola pregunta para los consumidores)', async () => {
    const ctx = await loadUserPortfolioContext({
      db: makeFakeDb({ profile: { name: 'Jan' } }),
      uid: 'u1', prefs: {},
    })
    expect(ctx.profileName).toBe('Jan')
    expect(ctx.advisor).toBeNull()
  })

  test('sin doc de perfil: nombre vacío, advisor null, y el contexto igual se arma', async () => {
    const ctx = await loadUserPortfolioContext({ db: makeFakeDb(), uid: 'u1', prefs: {} })
    expect(ctx).toBeTruthy()
    expect(ctx.profileName).toBe('')
    expect(ctx.advisor).toBeNull()
    expect(ctx.netWorth).toBe(6000)
  })

  test('best-effort: un perfil ilegible no tumba el contexto', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = await loadUserPortfolioContext({ db: makeFakeDb({ profileThrows: true }), uid: 'u1', prefs: {} })
    errSpy.mockRestore()
    expect(ctx).toBeTruthy()
    expect(ctx.profileName).toBe('')
    expect(ctx.advisor).toBeNull()
  })
})

// Un link compartido escopado a un portafolio o entidad congela su scope al
// crearse. Si el dueño borra ESE portafolio/entidad después (FASE OI:
// `deletePortfolio`/`deleteEntity` re-ubican los ítems Y borran el doc de
// registro), la respuesta `empty` del route tiene que poder distinguir "sigue
// existiendo, vacío" de "esto ya no existe" — y es lo que este helper contesta.
describe('scopeSourceExists', () => {
  function makeRegistryDb({ portfolioExists = false, entityExists = false, throwsOn = null } = {}) {
    return {
      doc: (path) => ({
        get: async () => {
          if (throwsOn && path.includes(`/${throwsOn}/`)) throw new Error('boom')
          if (path.includes('/portfolios/')) return { exists: portfolioExists }
          if (path.includes('/entities/')) return { exists: entityExists }
          return { exists: false }
        },
      }),
    }
  }

  test('portafolio con doc de registro presente: existe', async () => {
    const db = makeRegistryDb({ portfolioExists: true })
    const exists = await scopeSourceExists(db, 'u1', { type: 'portfolio', portfolioId: 'p1' })
    expect(exists).toBe(true)
  })

  test('portafolio SIN doc de registro (borrado): no existe', async () => {
    const db = makeRegistryDb({ portfolioExists: false })
    const exists = await scopeSourceExists(db, 'u1', { type: 'portfolio', portfolioId: 'p1' })
    expect(exists).toBe(false)
  })

  test('entidad SIN doc de registro (borrada): no existe', async () => {
    const db = makeRegistryDb({ entityExists: false })
    const exists = await scopeSourceExists(db, 'u1', { type: 'entity', entityId: 'e1' })
    expect(exists).toBe(false)
  })

  test('entidad con doc de registro presente: existe', async () => {
    const db = makeRegistryDb({ entityExists: true })
    const exists = await scopeSourceExists(db, 'u1', { type: 'entity', entityId: 'e1' })
    expect(exists).toBe(true)
  })

  test('alcance "all" o "institutions" no tiene doc de registro que borrar: siempre existe', async () => {
    const db = makeRegistryDb()
    expect(await scopeSourceExists(db, 'u1', { type: 'all' })).toBe(true)
    expect(await scopeSourceExists(db, 'u1', { type: 'institutions', institutions: ['IDC'] })).toBe(true)
  })

  test('fail-safe: un fallo de lectura NO afirma que se borró', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeRegistryDb({ throwsOn: 'portfolios' })
    const exists = await scopeSourceExists(db, 'u1', { type: 'portfolio', portfolioId: 'p1' })
    errSpy.mockRestore()
    expect(exists).toBe(true)
  })

  test('scope sin id (malformado) no dispara ninguna lectura y se asume existente', async () => {
    const db = makeRegistryDb()
    expect(await scopeSourceExists(db, 'u1', { type: 'portfolio' })).toBe(true)
    expect(await scopeSourceExists(db, 'u1', { type: 'entity' })).toBe(true)
    expect(await scopeSourceExists(db, 'u1', null)).toBe(true)
  })
})
