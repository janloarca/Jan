import { brokerVerification, BROKER_VAULT_IDS, VERIFIED_MAX_STALE_DAYS } from '../friendsVerified'

const NOW = Date.parse('2026-08-26T12:00:00Z')
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString()

const vault = (id, lastSync) => ({ id, data: { lastSync } })

describe('la insignia sale de un sync real, no de lo que diga el cliente', () => {
  it('un broker sincronizado hace poco la otorga', () => {
    const out = brokerVerification([vault('ibkr', daysAgo(2))], NOW)
    expect(out.verified).toBe(true)
    expect(out.brokerId).toBe('ibkr')
  })

  it('sin ningún vault de broker, no', () => {
    expect(brokerVerification([], NOW).verified).toBe(false)
  })

  it('un vault sin ningún sync exitoso tampoco', () => {
    // Guardar credenciales no es sincronizar: la insignia afirma que los datos
    // se mantienen solos, y eso solo lo prueba un sync que trajo algo.
    expect(brokerVerification([{ id: 'ibkr', data: { flexQueryId: '123' } }], NOW).verified).toBe(false)
  })

  it('un broker abandonado la pierde', () => {
    expect(brokerVerification([vault('ibkr', daysAgo(VERIFIED_MAX_STALE_DAYS + 1))], NOW).verified).toBe(false)
    expect(brokerVerification([vault('ibkr', daysAgo(VERIFIED_MAX_STALE_DAYS - 1))], NOW).verified).toBe(true)
  })

  it('cualquier broker sirve, no solo IBKR', () => {
    expect(brokerVerification([vault('kraken', daysAgo(1))], NOW).verified).toBe(true)
    expect(brokerVerification([vault('blockchain', daysAgo(1))], NOW).verified).toBe(true)
  })

  it('con varios, manda el más reciente', () => {
    const out = brokerVerification([vault('ibkr', daysAgo(90)), vault('kraken', daysAgo(3))], NOW)
    expect(out.verified).toBe(true)
    expect(out.brokerId).toBe('kraken')
  })
})

describe('lo que NO puede otorgar la insignia', () => {
  it('un doc de settings que no es un vault de broker', () => {
    // `settings` guarda también preferences, profile, ingest e incomePlan. Un
    // doc cualquiera con un campo `lastSync` no puede terminar dando una
    // insignia: por eso la lista de ids es CERRADA.
    expect(brokerVerification([{ id: 'preferences', data: { lastSync: daysAgo(1) } }], NOW).verified).toBe(false)
    expect(brokerVerification([{ id: 'ingest', data: { lastSync: daysAgo(1) } }], NOW).verified).toBe(false)
    expect(BROKER_VAULT_IDS.has('preferences')).toBe(false)
  })

  it('una fecha en el FUTURO', () => {
    // Solo puede venir de un reloj corrido o de un dato escrito a mano, y no es
    // evidencia de nada.
    expect(brokerVerification([vault('ibkr', new Date(NOW + 86400000).toISOString())], NOW).verified).toBe(false)
  })

  it('una fecha que no se puede leer', () => {
    expect(brokerVerification([vault('ibkr', 'ayer')], NOW).verified).toBe(false)
    expect(brokerVerification([vault('ibkr', null)], NOW).verified).toBe(false)
  })

  it('entradas basura no revientan ni otorgan nada', () => {
    expect(brokerVerification(null, NOW).verified).toBe(false)
    expect(brokerVerification([null, {}, { id: 'ibkr' }], NOW).verified).toBe(false)
  })
})

// Guardián de FUENTE: lee el archivo de la ruta, no una copia de sus cadenas.
// El hueco original no era una fórmula mal escrita, era CONFIARLE al cliente un
// dato sobre sí mismo, y eso solo se puede vigilar mirando de dónde sale.
const fs = require('fs')
const path = require('path')

// Sin los comentarios: el guardián mira el CÓDIGO, no la prosa que explica por
// qué el código dejó de hacer algo.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('la ruta no puede volver a creerle al cliente', () => {
  const src = stripComments(fs.readFileSync(path.join(process.cwd(), 'app/api/friends/route.js'), 'utf8'))

  it('no lee la insignia ni su porcentaje del cuerpo', () => {
    expect(src).not.toMatch(/body\.verified/)
    expect(src).not.toMatch(/body\.syncedPct/)
  })

  it('la deriva del módulo compartido', () => {
    expect(src).toMatch(/brokerVerification\(/)
    expect(src).toMatch(/verified: verification\.verified/)
  })
})

describe('el sync del broker deja constancia en el servidor', () => {
  // Es lo que sostiene todo lo anterior: si la ruta del broker no estampara
  // `lastSync`, no habría ningún dato server-side del que derivar la insignia y
  // esto volvería a depender de lo que diga el cliente.
  const ibkr = fs.readFileSync(path.join(process.cwd(), 'app/api/brokers/ibkr/route.js'), 'utf8')

  it('IBKR estampa lastSync en su vault al traer datos', () => {
    expect(ibkr).toMatch(/lastSync: new Date\(\)\.toISOString\(\)/)
    // Los DOS caminos de éxito: el moderno (poll-sync) y el legacy (sync).
    expect((ibkr.match(/await stampLastSync\(uid\)/g) || []).length).toBe(2)
  })
})
