/**
 * @jest-environment node
 */
// La única decisión del despachador que puede dejar a alguien sin correo (o
// mandarle uno de más) es QUÉ CADENCIA toca hoy. Vive en una función pura y
// exportada justamente para poder fijarla con tests, en vez de quedar
// enterrada en una expresión cron que nadie puede probar.
jest.mock('../../lib/firebase-admin', () => ({ getAdminDb: () => null }))
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: jest.fn(), close: jest.fn() }) }))

import { dueCadences, findSubscribers, makeSubscriberScanCache } from '../../app/api/cron/notifications/route'

const utc = (iso) => new Date(`${iso}T22:00:00Z`)

describe('qué cadencia toca hoy', () => {
  test('el domingo toca la semanal', () => {
    expect(dueCadences(utc('2026-08-16'))).toContain('weekly') // domingo
  })

  test('el día 1 toca la mensual (FASE IE)', () => {
    expect(dueCadences(utc('2026-09-01'))).toContain('monthly') // martes 1
    expect(dueCadences(utc('2026-09-01'))).not.toContain('weekly')
  })

  test('un domingo que cae en día 1 manda TODAS las que tocan: contenidos distintos, cadencias independientes', () => {
    // 1 de noviembre de 2026 es domingo. El valor esperado subió de dos a tres
    // al agregarse el correo de grupos (FASE LR): describía el conjunto de
    // cadencias de entonces, no un invariante, así que actualizarlo es correcto.
    expect(dueCadences(utc('2026-11-01'))).toEqual(['weekly', 'friendsWeekly', 'monthly'])
  })

  // ⛔ El correo de grupos es una cadencia SEPARADA del resumen semanal, no una
  // sección suya: uno habla de vos y el otro de otras personas, así que querer
  // ver cómo va el grupo no implica querer el reporte del propio portafolio.
  test('el domingo toca también la de grupos, y solo el domingo', () => {
    expect(dueCadences(utc('2026-08-16'))).toContain('friendsWeekly') // domingo
    expect(dueCadences(utc('2026-09-01'))).not.toContain('friendsWeekly') // martes 1
  })

  test('la de grupos sale exactamente cada domingo, ni más ni menos', () => {
    let n = 0
    for (let i = 0; i < 28; i++) {
      if (dueCadences(new Date(Date.UTC(2026, 7, 1 + i, 22))).includes('friendsWeekly')) n++
    }
    expect(n).toBe(4)
  })

  test('un día cualquiera (ni domingo ni día 1) no toca nada', () => {
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']) {
      expect(dueCadences(utc(d))).toEqual([])
    }
  })

  test('el 1 de enero salen la mensual (diciembre) y la anual (el año), FASE IE6', () => {
    const due = dueCadences(utc('2027-01-01')) // viernes
    expect(due).toContain('monthly')
    expect(due).toContain('annual')
    expect(due).not.toContain('weekly')
  })

  test('el 1 de CUALQUIER otro mes no dispara la anual', () => {
    for (const d of ['2026-09-01', '2026-10-01', '2026-12-01']) {
      expect(dueCadences(utc(d))).not.toContain('annual')
    }
  })

  test('en un año completo la anual sale exactamente una vez', () => {
    let annual = 0
    for (let i = 0; i < 365; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i, 22))
      if (dueCadences(d).includes('annual')) annual++
    }
    expect(annual).toBe(1)
  })

  test('en un mes completo: la semanal sale exactamente cada domingo y la mensual exactamente el 1', () => {
    let weekly = 0, monthly = 0
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 7, 1 + i, 22))
      const due = dueCadences(d)
      if (due.includes('weekly')) weekly++
      if (due.includes('monthly')) monthly++
    }
    expect(weekly).toBe(4)
    expect(monthly).toBe(1)
  })
})


// ⛔ Un hipo de Firestore no puede dejar sin correo al resto del día.
// `scanAllPrefs` cacheaba la PROMESA antes de saber si resolvía, así que un
// fallo transitorio en la primera cadencia le entregaba la misma promesa
// rechazada a todas las siguientes: `findSubscribers` la atrapa y devuelve
// `via:'failed'` con cero suscriptores, o sea el fallo es mudo. El 1 de enero
// en domingo eso son cuatro cadencias, y la anual no tiene repesca hasta el año
// que viene.
describe('el barrido de suscriptores no cachea un fallo', () => {
  const mkDb = (failFirst) => {
    let scans = 0
    return {
      scans: () => scans,
      collectionGroup: () => ({ where: () => ({ get: async () => { throw new Error('no index') } }) }),
      collection: () => ({
        listDocuments: async () => {
          scans++
          if (failFirst && scans === 1) throw new Error('14 UNAVAILABLE')
          return [{
            collection: () => ({ doc: () => ({ get: async () => ({
              exists: true, id: 'u1', data: () => ({ notifyWeekly: true, notifyAnnual: true }),
            }) }) }),
          }]
        },
      }),
    }
  }

  test('tras un fallo transitorio, la siguiente cadencia REINTENTA y encuentra', async () => {
    const db = mkDb(true)
    const cache = makeSubscriberScanCache()
    const a = await findSubscribers(db, 'notifyWeekly', cache)
    expect(a.via).toBe('failed')
    expect(a.docs).toHaveLength(0)
    const b = await findSubscribers(db, 'notifyAnnual', cache)
    expect(b.via).toBe('userScan')
    expect(b.docs).toHaveLength(1)
    expect(db.scans()).toBe(2)
  })

  // CONTROL POSITIVO: el caché sigue existiendo. Sin esto, "reintenta" podría
  // significar que el caché dejó de funcionar y cada cadencia rebarre a todos
  // los usuarios, que es el costo que ese caché existe para evitar.
  test('sin fallo, el barrido se hace UNA sola vez para todas las cadencias', async () => {
    const db = mkDb(false)
    const cache = makeSubscriberScanCache()
    await findSubscribers(db, 'notifyWeekly', cache)
    await findSubscribers(db, 'notifyAnnual', cache)
    expect(db.scans()).toBe(1)
  })
})


// ⛔ El botón "Probar el de grupos" de Ajustes reventaba con 502 sobre un correo
// que SÍ había salido: la ruta leía `mail.attachments.length` y el correo de
// grupos no adjunta nada (no lee el portafolio, así que no hay PDF que
// generar). El `sendMail` ya se había ejecutado, así que el error mandaba a
// diagnosticar un SMTP que funcionaba.
describe('el reporte de la prueba no asume adjuntos', () => {
  const fs = require('fs')
  const path = require('path')
  const routeSrc = () => fs.readFileSync(
    path.join(__dirname, '..', '..', 'app/api/notifications/test/route.js'), 'utf8')

  test('la ruta de prueba no lee .attachments.length sin guard', () => {
    expect(routeSrc()).not.toMatch(/mail\.attachments\.length/)
    // Control positivo: sigue reportando si adjuntó algo, con el acceso seguro.
    expect(routeSrc()).toMatch(/mail\.attachments\?\.length/)
  })

  test('el builder de grupos de verdad no trae attachments', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'friendsWeeklyEmail.js'), 'utf8')
    expect(src).not.toMatch(/attachments/)
  })
})
