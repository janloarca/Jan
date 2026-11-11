/**
 * @jest-environment node
 */
// Reglas de Firestore del modo institucional, contra el EMULADOR.
// Sin emulador (el `npx jest` de todos los días) la suite se salta entera:
//   npm run test:rules
const fs = require('fs')
const path = require('path')

const HAS_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST
const d = HAS_EMULATOR ? describe : describe.skip

d('firestore.rules: modo institucional', () => {
  let rut
  let env
  const CLIENT = 'cliente1'
  const ADV = 'asesor1'
  const OTHER = 'ajeno1'
  const ASSIST = 'asist1'
  const ORG = 'firma-abc'
  const LINK = `${ORG}_${CLIENT}`

  beforeAll(async () => {
    rut = require('@firebase/rules-unit-testing')
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
    env = await rut.initializeTestEnvironment({
      projectId: 'demo-chispu',
      firestore: { rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8'), host, port: Number(port) },
    })
  })
  afterAll(async () => { if (env) await env.cleanup() })

  async function seed({ access = { status: 'active', scopes: ['patrimonio', 'metas'], orgIds: [ORG] }, linkStatus = 'active' } = {}) {
    await env.clearFirestore()
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await db.doc(`users/${CLIENT}/items/i1`).set({ name: 'Bono', quantity: 1, currentPrice: 6000 })
      await db.doc(`users/${CLIENT}/financeTransactions/f1`).set({ amount: 50 })
      await db.doc(`users/${CLIENT}/settings/goals`).set({ portfolioGoal: 100000 })
      await db.doc(`users/${CLIENT}/settings/ibkr`).set({ token: 'secreto' })
      await db.doc(`users/${CLIENT}/grants/${ORG}`).set({ status: 'active', scopes: ['patrimonio', 'metas'], advisorUids: [ADV] })
      if (access) await db.doc(`users/${CLIENT}/advisorAccess/${ADV}`).set(access)
      await db.doc(`organizations/${ORG}`).set({ name: 'Firma', status: 'active' })
      await db.doc(`organizations/${ORG}/memberships/${ADV}`).set({ role: 'advisor', status: 'active' })
      await db.doc(`organizations/${ORG}/memberships/${ASSIST}`).set({ role: 'assistant', status: 'active' })
      await db.doc(`organizations/${ORG}/notes/n1`).set({ clientUid: CLIENT, visibility: 'internal', body: 'privada' })
      await db.doc(`organizations/${ORG}/notes/n2`).set({ clientUid: CLIENT, visibility: 'shared', body: 'para ti' })
      await db.doc(`clientLinks/${LINK}`).set({ orgId: ORG, clientUid: CLIENT, advisorUid: ADV, advisorUids: [ADV], status: linkStatus, scopes: ['patrimonio', 'metas'] })
      await db.doc(`threads/${LINK}/messages/m1`).set({ authorUid: ADV, body: 'hola' })
      await db.doc('auditLog/e1').set({ action: 'view.panel', clientUid: CLIENT })
    })
  }
  const as = (uid) => env.authenticatedContext(uid).firestore()

  test('asesor con grant activo y alcance lee los datos del cliente', async () => {
    await seed()
    await rut.assertSucceeds(as(ADV).doc(`users/${CLIENT}/items/i1`).get())
    await rut.assertSucceeds(as(ADV).collection(`users/${CLIENT}/items`).get())
    await rut.assertSucceeds(as(ADV).doc(`users/${CLIENT}/settings/goals`).get())
  })

  test('asesor sin el alcance: lectura negada (flujo apagado, credenciales nunca)', async () => {
    await seed()
    await rut.assertFails(as(ADV).collection(`users/${CLIENT}/financeTransactions`).get())
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/settings/ibkr`).get())
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/settings/preferences`).get())
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/grants/${ORG}`).get())
  })

  test('grant revocado (espejo borrado o inactivo): lectura negada', async () => {
    await seed({ access: null, linkStatus: 'revoked' })
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/items/i1`).get())
    await seed({ access: { status: 'revoked', scopes: ['patrimonio'] }, linkStatus: 'revoked' })
    await rut.assertFails(as(ADV).collection(`users/${CLIENT}/items`).get())
  })

  test('un ajeno y un asistente no leen datos del cliente', async () => {
    await seed()
    await rut.assertFails(as(OTHER).doc(`users/${CLIENT}/items/i1`).get())
    await rut.assertFails(as(ASSIST).doc(`users/${CLIENT}/items/i1`).get())
    await rut.assertFails(as(ASSIST).doc(`threads/${LINK}/messages/m1`).get())
  })

  test('asesor intenta escribir datos del cliente: negado', async () => {
    await seed()
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/items/i1`).set({ currentPrice: 1 }, { merge: true }))
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/items/nuevo`).set({ name: 'x' }))
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/items/i1`).delete())
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/snapshots/2026-11-11`).set({ netWorthUSD: 1 }))
    await rut.assertFails(as(ADV).doc(`users/${CLIENT}/advisorSummary/latest`).set({ netWorth: 1 }))
  })

  test('cliente intenta escribir auditLog: negado (y tampoco lo lee)', async () => {
    await seed()
    await rut.assertFails(as(CLIENT).doc('auditLog/falso').set({ action: 'view.panel' }))
    await rut.assertFails(as(CLIENT).doc('auditLog/e1').delete())
    await rut.assertFails(as(CLIENT).doc('auditLog/e1').get())
    await rut.assertFails(as(ADV).doc('auditLog/e1').set({ action: 'x' }))
  })

  test('cliente no escribe su vínculo ni sus grants: revocar va por el servidor', async () => {
    await seed()
    // Escritura directa negada en los dos sentidos; la ruta de servidor
    // (cubierta en institutionalStore.test.js) es la que revoca.
    await rut.assertFails(as(CLIENT).doc(`clientLinks/${LINK}`).set({ status: 'revoked' }, { merge: true }))
    await rut.assertFails(as(CLIENT).doc(`users/${CLIENT}/grants/${ORG}`).set({ status: 'revoked' }, { merge: true }))
    await rut.assertFails(as(CLIENT).doc(`users/${CLIENT}/advisorAccess/${ADV}`).delete())
    await rut.assertSucceeds(as(CLIENT).doc(`clientLinks/${LINK}`).get())
    await rut.assertSucceeds(as(CLIENT).doc(`users/${CLIENT}/grants/${ORG}`).get())
  })

  test('cliente intenta activar un vínculo o concederse acceso: negado', async () => {
    await seed({ access: null, linkStatus: 'invited' })
    await rut.assertFails(as(CLIENT).doc(`clientLinks/${LINK}`).set({ status: 'active' }, { merge: true }))
    await rut.assertFails(as(CLIENT).doc(`clientLinks/${ORG}_x`).set({ orgId: ORG, clientUid: CLIENT, status: 'active' }))
    await rut.assertFails(as(CLIENT).doc(`users/${CLIENT}/advisorAccess/${OTHER}`).set({ status: 'active', scopes: ['patrimonio'] }))
    await rut.assertFails(as(CLIENT).doc(`users/${CLIENT}/orgMemberships/${ORG}`).set({ role: 'admin', status: 'active' }))
    await rut.assertFails(as(OTHER).doc(`organizations/${ORG}/memberships/${OTHER}`).set({ role: 'admin', status: 'active' }))
  })

  test('mensajes: las partes leen, nadie borra ni escribe desde el navegador', async () => {
    await seed()
    await rut.assertSucceeds(as(CLIENT).collection(`threads/${LINK}/messages`).get())
    await rut.assertSucceeds(as(ADV).doc(`threads/${LINK}/messages/m1`).get())
    await rut.assertFails(as(OTHER).doc(`threads/${LINK}/messages/m1`).get())
    await rut.assertFails(as(CLIENT).doc(`threads/${LINK}/messages/m1`).delete())
    await rut.assertFails(as(ADV).doc(`threads/${LINK}/messages/m1`).delete())
    await rut.assertFails(as(CLIENT).doc(`threads/${LINK}/messages/m2`).set({ body: 'x' }))
  })

  test('cliente lee su nota compartida pero no la interna', async () => {
    await seed()
    await rut.assertFails(as(CLIENT).doc(`organizations/${ORG}/notes/n1`).get())
    await rut.assertSucceeds(as(CLIENT).doc(`organizations/${ORG}/notes/n2`).get())
    await rut.assertSucceeds(as(ADV).doc(`organizations/${ORG}/notes/n1`).get())
    await rut.assertFails(as(ASSIST).doc(`organizations/${ORG}/notes/n1`).get())
    await rut.assertFails(as(OTHER).doc(`organizations/${ORG}/notes/n2`).get())
  })

  test('usuario personal: sus datos siguen siendo suyos, igual que antes', async () => {
    await seed()
    await rut.assertSucceeds(as(CLIENT).doc(`users/${CLIENT}/items/i1`).set({ currentPrice: 6100 }, { merge: true }))
    await rut.assertSucceeds(as(CLIENT).doc(`users/${CLIENT}/items/i2`).set({ name: 'Nuevo' }))
    await rut.assertSucceeds(as(CLIENT).doc(`users/${CLIENT}/settings/goals`).set({ portfolioGoal: 1 }))
    await rut.assertSucceeds(as(CLIENT).doc(`users/${CLIENT}/advisorSummary/latest`).set({ netWorth: 1 }))
    await rut.assertSucceeds(as(CLIENT).doc(`users/${CLIENT}/items/i2`).delete())
    await rut.assertSucceeds(as(CLIENT).collection(`users/${CLIENT}/transactions`).get())
    await rut.assertFails(as(OTHER).collection(`users/${CLIENT}/transactions`).get())
  })
})
