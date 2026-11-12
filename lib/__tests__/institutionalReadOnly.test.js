// Modo lectura del asesor y regresión del usuario personal.
// ⛔ La vista de lectura no puede archivar, reparar ni escribir NADA del
// cliente: ni snapshot diario, ni backfill, ni una sola escritura.
jest.mock('../firebase', () => ({ auth: null, db: null }))
import fs from 'fs'
import path from 'path'
import { loadClientReadData } from '../../hooks/useClientReadData'
import { buildAdvisorSummary } from '../../hooks/useAdvisorSummary'

const ROOT = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function fakeFs(data) {
  const calls = []
  const api = new Proxy({
    doc: (_db, p) => ({ path: p }),
    collection: (_db, p) => ({ path: p }),
    getDoc: async (ref) => { calls.push(['getDoc', ref.path]); const v = data[ref.path]; return { exists: () => v != null, data: () => v } },
    getDocs: async (ref) => {
      calls.push(['getDocs', ref.path])
      if (data.__deny?.includes(ref.path)) { const e = new Error('denied'); e.code = 'permission-denied'; throw e }
      const docs = Object.keys(data).filter((k) => k.startsWith(`${ref.path}/`) && !k.slice(ref.path.length + 1).includes('/'))
      return { docs: docs.map((k) => ({ id: k.split('/').pop(), data: () => data[k] })) }
    },
  }, {
    get(target, prop) {
      if (prop in target) return target[prop]
      // Cualquier otra función de Firestore (setDoc, addDoc, onSnapshot...)
      // revienta el test: la vista de lectura no debe pedirla.
      return () => { throw new Error(`llamada prohibida en modo lectura: ${String(prop)}`) }
    },
  })
  return { api, calls }
}

const DATA = {
  'users/c/items/i1': { name: 'Bono', quantity: 1, currentPrice: 6000 },
  'users/c/transactions/t1': { date: '2026-05-15', type: 'DIVIDEND' },
  'users/c/transactions/t0': { date: '2026-01-06', type: 'DEPOSIT' },
  'users/c/snapshots/2026-01-02': { date: '2026-01-02', netWorthUSD: 6000 },
  'users/c/financeTransactions/f1': { date: '2026-08-01', amount: 50 },
  'users/c/settings/goals': { portfolioGoal: 100000 },
  'users/c/advisorSummary/latest': { netWorth: 6240, ytdPct: 3.94, baseCurrency: 'USD' },
  'users/c/advisorSummary/meta': { baseCurrency: 'USD', name: 'Caro' },
}

describe('vista de lectura del asesor', () => {
  let spy
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => spy.mockRestore())

  test('solo lee (getDoc/getDocs) y solo lo que abren los alcances concedidos', async () => {
    const { api, calls } = fakeFs(DATA)
    const out = await loadClientReadData({ fs: api, db: {}, clientUid: 'c', scopes: ['patrimonio', 'metas'] })
    expect(new Set(calls.map((c) => c[0]))).toEqual(new Set(['getDoc', 'getDocs']))
    const paths = calls.map((c) => c[1])
    expect(paths).not.toContain('users/c/financeTransactions')
    expect(paths).not.toContain('users/c/settings/sheetObservations')
    expect(paths.some((p) => /settings\/(ibkr|preferences)|grants/.test(p))).toBe(false)
    expect(out.items).toHaveLength(1)
    expect(out.transactions.map((t) => t.id)).toEqual(['t0', 't1'])
    expect(out.financeTransactions).toEqual([])
    expect(out.goals).toEqual({ portfolioGoal: 100000 })
    // Las cifras de cabecera son las que archivó el cliente, tal cual.
    expect(out.summary).toEqual(DATA['users/c/advisorSummary/latest'])
  })

  test('con solo Flujo no se piden activos ni metas', async () => {
    const { api, calls } = fakeFs(DATA)
    const out = await loadClientReadData({ fs: api, db: {}, clientUid: 'c', scopes: ['flujo'] })
    const paths = calls.map((c) => c[1])
    expect(paths).toEqual(expect.arrayContaining(['users/c/financeTransactions']))
    expect(paths).not.toContain('users/c/items')
    expect(paths).not.toContain('users/c/settings/goals')
    expect(out.summary).toBeNull()
    expect(out.financeTransactions).toHaveLength(1)
  })

  test('una lectura negada (acceso revocado) deja la sección vacía, sin romper', async () => {
    const { api } = fakeFs({ ...DATA, __deny: ['users/c/items'] })
    const out = await loadClientReadData({ fs: api, db: {}, clientUid: 'c', scopes: ['patrimonio'] })
    expect(out.items).toEqual([])
    expect(out.snapshots).toHaveLength(1)
  })

  test('el código de la vista no importa el motor que archiva ni ninguna escritura', () => {
    const files = [
      'hooks/useClientReadData.js', 'components/institutional/ClientReadView.jsx',
      'app/asesor/clientes/[clientUid]/page.jsx', 'app/asesor/page.jsx',
    ]
    for (const f of files) {
      const src = strip(read(f))
      expect(src.length).toBeGreaterThan(200)
      expect(src).not.toMatch(/useDashboardData|useFirestoreItems/)
      expect(src).not.toMatch(/saveSnapshot|saveItemSnapshots|snapshotBackfill|composeDailyTotals|migrateMisplacedNav/)
      expect(src).not.toMatch(/\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|onSnapshot)\b/)
    }
  })

  test('las tablas reutilizadas se montan en readOnly y sin manejadores de escritura', () => {
    const src = strip(read('components/institutional/ClientReadView.jsx'))
    expect(src).toMatch(/<PortfolioSpreadsheet[^>]*readOnly/s)
    expect(src).toMatch(/<GoalTracker[^>]*readOnly/s)
    expect(src).not.toMatch(/onSaveItemSnapshots|onUpdateItem|onSaveObservations|onSaveGoals=|onDelete=|onRecategorize=/)
  })
})

describe('resumen que publica el panel del cliente', () => {
  test('copia las cifras ya calculadas y las pasa a USD con la tasa de la app', () => {
    const convert = (v, from, to) => (from === 'GTQ' && to === 'USD' ? v / 7.7 : v)
    const s = buildAdvisorSummary({ netWorth: 77000, investable: 38500, ytdPct: 3.94, ytdChange: 240, baseCurrency: 'GTQ', convert, now: new Date('2026-11-10T15:00:00Z') })
    expect(s).toMatchObject({ netWorth: 77000, investable: 38500, ytdPct: 3.94, ytdChange: 240, baseCurrency: 'GTQ', day: '2026-11-10', at: '2026-11-10T15:00:00.000Z' })
    expect(s.netWorthUSD).toBeCloseTo(10000, 6)
    expect(s.investableUSD).toBeCloseTo(5000, 6)
  })
  test('sin patrimonio medible no publica nada, y un YTD ausente queda null (no cero)', () => {
    expect(buildAdvisorSummary({ netWorth: null })).toBeNull()
    expect(buildAdvisorSummary({ netWorth: 100, ytdPct: null, baseCurrency: 'USD' })).toMatchObject({ ytdPct: null, investable: null })
  })
  test('el publicador vive fuera del motor congelado', () => {
    const hook = strip(read('hooks/useAdvisorSummary.js'))
    expect(hook).not.toMatch(/saveSnapshot|snapshotBackfill|useDashboardData/)
    expect(strip(read('hooks/useDashboardData.js'))).not.toMatch(/advisorSummary|institutional/i)
    expect(strip(read('app/dashboard/page.jsx'))).toMatch(/enabled: institutional\.hasAdvisor/)
  })
})

describe('regresión: usuario personal sin organización', () => {
  test('todo lo institucional de la navegación y de Ajustes cuelga de una señal', () => {
    const header = strip(read('components/dashboard/Header.jsx'))
    const mobile = strip(read('components/dashboard/MobileNav.jsx'))
    const settings = strip(read('components/SettingsModal.jsx'))
    // Header: cada entrada del arreglo de navegación nace de su señal.
    const entries = header.split('\n').filter((l) => /href: '\/(asesor|tu-asesor)'/.test(l))
    expect(entries).toHaveLength(2)
    for (const l of entries) expect(l).toMatch(/inst\.(isAdvisor|hasAdvisor) \?/)
    // Móvil: cada enlace vive dentro de su condición.
    expect(mobile).toMatch(/isAdvisor && \(\s*<Link href="\/asesor"/)
    expect(mobile).toMatch(/hasAdvisor && \(\s*<Link href="\/tu-asesor"/)
    expect(mobile.match(/href="\/(asesor|tu-asesor)"/g)).toHaveLength(2)
    expect(settings).toMatch(/showAdvisorSetup/)
    expect(settings).toMatch(/grants\.length > 0/)
  })

  test('sin bandera, membresía ni grants el hook no enciende nada', () => {
    const src = strip(read('hooks/useInstitutional.js'))
    expect(src).toMatch(/isAdvisor: s\.memberships\.length > 0/)
    expect(src).toMatch(/hasAdvisor: activeGrants\.length > 0/)
    expect(src).toMatch(/showAdvisorSetup: s\.flag \|\| s\.memberships\.length > 0/)
    expect(src).not.toMatch(/\b(setDoc|addDoc|updateDoc|deleteDoc|onSnapshot)\b/)
  })

  test('la landing solo conserva la bandera al redirigir; no muestra nada institucional', () => {
    const src = read('app/page.jsx').replace(/captureInstitutionalFlag|\/dashboard\?institucional=1/g, '')
    expect(src).not.toMatch(/institucional|asesor/i)
  })
})

describe('bandera institucional (revisión visual de #620)', () => {
  const fs = require('fs')
  const hook = fs.readFileSync(require('path').join(__dirname, '../../hooks/useInstitutional.js'), 'utf8')
  const landing = fs.readFileSync(require('path').join(__dirname, '../../app/page.jsx'), 'utf8')
  const clientPage = fs.readFileSync(require('path').join(__dirname, '../../app/asesor/clientes/[clientUid]/page.jsx'), 'utf8')
  test('la landing captura la bandera y conserva el query al redirigir', () => {
    expect(landing).toMatch(/captureInstitutionalFlag\(\) \? '\/dashboard\?institucional=1'/)
  })
  test('?institucional=0 apaga la bandera', () => {
    expect(hook).toMatch(/q === '0'\) localStorage\.removeItem/)
  })
  test('la vista de cliente no se queda cargando sin firma', () => {
    expect(clientPage).toMatch(/No tienes acceso a este cliente/)
    expect(clientPage).toMatch(/inst\.loading/)
  })
})
