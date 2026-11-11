import { makeFakeAdminDb } from '../../test-utils/fakeAdminDb'
import * as S from '../institutional/store'
import { CONSENT_VERSION, INVITE_TTL_MS, linkIdFor } from '../institutional/model'

const DAY = 86400000
function world(seed = {}) {
  const db = makeFakeAdminDb(seed)
  const clock = { now: Date.parse('2026-11-10T15:00:00Z') }
  const mails = []
  let n = 0
  const tokens = []
  const as = (uid, email, name = uid) => ({
    db, uid, email, name,
    now: () => clock.now,
    token: () => { const t = `tok-${++n}-${'x'.repeat(30)}`; tokens.push(t); return t },
    hash: (t) => `h${Buffer.from(String(t)).toString('hex')}`,
    rand: () => `r${(++n).toString(16).padStart(8, '0')}`,
    sendEmail: async (to, mail) => { mails.push({ to, subject: mail.subject, text: mail.text, html: mail.html }) },
  })
  const audits = () => db.__paths('auditLog/').map((p) => db.__get(p))
  return { db, clock, mails, tokens, as, audits }
}

// Firma con admin (ana) y asesor (beto), y un cliente (caro) ya vinculado.
async function linked(scopes = ['patrimonio', 'hoja', 'dividendos', 'metas']) {
  const w = world({ 'users/caro/items/i1': { name: 'Bono', purchasePrice: 6000 }, 'users/caro/settings/profile': { name: 'Carolina' } })
  const ana = w.as('ana', 'ana@firma.com', 'Ana')
  const beto = w.as('beto', 'beto@firma.com', 'Beto')
  const caro = w.as('caro', 'caro@mail.com')
  const { orgId } = await S.createOrg(ana, { name: 'Firma Uno' })
  await S.inviteMember(ana, { orgId, email: 'Beto@Firma.com', role: 'advisor' })
  await S.acceptInvite(beto, { token: w.tokens[0] })
  await S.inviteClient(beto, { orgId, email: 'caro@mail.com' })
  await S.acceptInvite(caro, { token: w.tokens[1], scopes, consentVersion: CONSENT_VERSION })
  return { ...w, ana, beto, caro, orgId, linkId: linkIdFor(orgId, 'caro') }
}

describe('organización y equipo', () => {
  test('crear una org deja al creador como admin, con su espejo y su evento', async () => {
    const w = world()
    const { orgId } = await S.createOrg(w.as('ana', 'ana@firma.com'), { name: '  Firma Uno ' })
    expect(w.db.__get(`organizations/${orgId}`)).toMatchObject({ name: 'Firma Uno', status: 'active', createdBy: 'ana' })
    expect(w.db.__get(`organizations/${orgId}/memberships/ana`)).toMatchObject({ role: 'admin', status: 'active' })
    expect(w.db.__get(`users/ana/orgMemberships/${orgId}`)).toMatchObject({ role: 'admin', status: 'active' })
    expect(w.audits().map((a) => a.action)).toEqual(['org.create'])
  })

  test('el admin invita a un asesor por correo en inglés y la membresía pasa a activa al aceptar', async () => {
    const w = world()
    const ana = w.as('ana', 'ana@firma.com')
    const { orgId } = await S.createOrg(ana, { name: 'Firma Uno' })
    await S.inviteMember(ana, { orgId, email: 'beto@firma.com', role: 'advisor' })
    expect(w.mails[0].to).toBe('beto@firma.com')
    expect(w.mails[0].subject).toMatch(/invited to join Firma Uno/)
    await S.acceptInvite(w.as('beto', 'beto@firma.com'), { token: w.tokens[0] })
    expect(w.db.__get(`organizations/${orgId}/memberships/beto`)).toMatchObject({ role: 'advisor', status: 'active' })
    expect(w.db.__paths(`organizations/${orgId}/memberships/inv_`)).toEqual([])
    expect(w.audits().map((a) => a.action).sort()).toEqual(['member.accept', 'member.invite', 'org.create'])
  })

  test('solo el dueño del correo invitado puede entrar a la firma', async () => {
    const w = world()
    const ana = w.as('ana', 'ana@firma.com')
    const { orgId } = await S.createOrg(ana, { name: 'Firma Uno' })
    await S.inviteMember(ana, { orgId, email: 'beto@firma.com', role: 'advisor' })
    await expect(S.acceptInvite(w.as('eva', 'eva@otro.com'), { token: w.tokens[0] })).rejects.toMatchObject({ code: 'EMAIL_MISMATCH' })
    expect(w.db.__get(`organizations/${orgId}/memberships/eva`)).toBeUndefined()
  })

  test('quien no es admin no invita ni quita miembros', async () => {
    const w = await linked()
    await expect(S.inviteMember(w.beto, { orgId: w.orgId, email: 'x@y.com', role: 'advisor' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(S.removeMember(w.caro, { orgId: w.orgId, memberId: 'beto' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('quitar a un asesor le corta el acceso y pasa sus clientes a quien lo quitó', async () => {
    const w = await linked()
    await S.removeMember(w.ana, { orgId: w.orgId, memberId: 'beto' })
    expect(w.db.__get('users/caro/advisorAccess/beto')).toBeUndefined()
    expect(w.db.__get('users/caro/advisorAccess/ana')).toMatchObject({ status: 'active' })
    expect(w.db.__get(`clientLinks/${w.linkId}`)).toMatchObject({ advisorUid: 'ana', advisorUids: ['ana'] })
  })
})

describe('invitación de cliente', () => {
  test('se guarda SOLO el hash del token, con expiración a 14 días', async () => {
    const w = world()
    const ana = w.as('ana', 'ana@firma.com')
    const { orgId } = await S.createOrg(ana, { name: 'Firma Uno' })
    await S.inviteClient(ana, { orgId, email: 'caro@mail.com' })
    const raw = w.tokens[0]
    expect(JSON.stringify([...w.db.__store.entries()])).not.toContain(raw)
    const stub = w.db.__get(w.db.__paths('clientLinks/inv_')[0])
    expect(stub).toMatchObject({ status: 'invited', invitedEmail: 'caro@mail.com', scopes: ['patrimonio', 'hoja', 'dividendos', 'metas'] })
    expect(Date.parse(stub.inviteExpiresAt) - w.clock.now).toBe(INVITE_TTL_MS)
    expect(w.mails[0].text).toContain(raw)
    expect(w.mails[0].subject).toMatch(/read-only access/)
  })

  test('aceptar vincula la cuenta existente: nace el permiso y no se copia ningún dato', async () => {
    const w = await linked()
    expect(w.db.__get(`clientLinks/${w.linkId}`)).toMatchObject({
      status: 'active', clientUid: 'caro', advisorUid: 'beto', clientName: 'Carolina',
      scopes: ['patrimonio', 'hoja', 'dividendos', 'metas'], consentVersion: CONSENT_VERSION,
    })
    expect(w.db.__get(`users/caro/grants/${w.orgId}`)).toMatchObject({ status: 'active', advisorUids: ['beto', 'ana'] })
    expect(w.db.__get('users/caro/advisorAccess/beto')).toMatchObject({ status: 'active', scopes: ['patrimonio', 'hoja', 'dividendos', 'metas'] })
    // Los datos del cliente siguen donde estaban, una sola vez.
    expect(w.db.__paths('users/caro/items/')).toEqual(['users/caro/items/i1'])
    expect(w.db.__paths('users/').filter((p) => /\/items\//.test(p))).toEqual(['users/caro/items/i1'])
    expect(w.db.__paths('clientLinks/inv_')).toEqual([])
    const ev = w.audits().find((a) => a.action === 'link.accept')
    expect(ev).toMatchObject({ actorUid: 'caro', actorRole: 'client', clientUid: 'caro', orgId: w.orgId })
  })

  test('un token ya usado da un error claro y no cambia nada', async () => {
    const w = await linked()
    const before = JSON.stringify([...w.db.__store.entries()])
    await expect(S.acceptInvite(w.as('dan', 'dan@mail.com'), { token: w.tokens[1], scopes: ['patrimonio'], consentVersion: CONSENT_VERSION }))
      .rejects.toMatchObject({ code: 'TOKEN_USED' })
    expect(JSON.stringify([...w.db.__store.entries()])).toBe(before)
    expect(w.db.__get(`clientLinks/${linkIdFor(w.orgId, 'dan')}`)).toBeUndefined()
  })

  test('una invitación de más de 14 días no activa el vínculo y queda auditada como expirada', async () => {
    const w = world()
    const ana = w.as('ana', 'ana@firma.com')
    const { orgId } = await S.createOrg(ana, { name: 'Firma Uno' })
    await S.inviteClient(ana, { orgId, email: 'caro@mail.com' })
    w.clock.now += 14 * DAY + 1000
    const caro = w.as('caro', 'caro@mail.com')
    expect((await S.getInvite(caro, { token: w.tokens[0] })).state).toBe('expired')
    await expect(S.acceptInvite(caro, { token: w.tokens[0], scopes: ['patrimonio'], consentVersion: CONSENT_VERSION }))
      .rejects.toMatchObject({ code: 'INVITE_EXPIRED' })
    expect(w.db.__get(`clientLinks/${linkIdFor(orgId, 'caro')}`)).toBeUndefined()
    expect(w.db.__paths('users/caro/')).toEqual([])
    expect(w.audits().some((a) => a.action === 'link.expire')).toBe(true)
  })

  test('sin el consentimiento vigente o sin alcances no se activa nada', async () => {
    const w = world()
    const ana = w.as('ana', 'ana@firma.com')
    const { orgId } = await S.createOrg(ana, { name: 'Firma Uno' })
    await S.inviteClient(ana, { orgId, email: 'caro@mail.com' })
    const caro = w.as('caro', 'caro@mail.com')
    await expect(S.acceptInvite(caro, { token: w.tokens[0], scopes: ['patrimonio'] })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' })
    await expect(S.acceptInvite(caro, { token: w.tokens[0], scopes: ['inventado'], consentVersion: CONSENT_VERSION })).rejects.toMatchObject({ code: 'NO_SCOPES' })
    expect(w.db.__paths('users/caro/')).toEqual([])
  })

  test('Flujo solo se concede si el cliente lo marca', async () => {
    const w = await linked(['patrimonio', 'flujo'])
    expect(w.db.__get('users/caro/advisorAccess/beto').scopes).toEqual(['patrimonio', 'flujo'])
  })
})

describe('revocar', () => {
  test('el cliente revoca: vínculo, grant, espejo y auditoría cambian en UNA transacción', async () => {
    const w = await linked()
    const spy = jest.spyOn(w.db, 'runTransaction')
    const mark = w.db.__writes.length
    await S.revokeLink(w.caro, { orgId: w.orgId })
    expect(spy).toHaveBeenCalledTimes(1)
    const touched = w.db.__writes.slice(mark).map((x) => x.path.replace(/auditLog\/.*/, 'auditLog'))
    expect(touched.sort()).toEqual([
      'auditLog', `clientLinks/${w.linkId}`, 'users/caro/advisorAccess/ana', 'users/caro/advisorAccess/beto', `users/caro/grants/${w.orgId}`,
    ].sort())
    expect(w.db.__get(`clientLinks/${w.linkId}`)).toMatchObject({ status: 'revoked', revokedBy: 'client' })
    expect(w.db.__get(`users/caro/grants/${w.orgId}`)).toMatchObject({ status: 'revoked', advisorUids: [] })
    expect(w.db.__get('users/caro/advisorAccess/beto')).toBeUndefined()
    expect(w.audits().filter((a) => a.action === 'link.revoke')).toHaveLength(1)
    // Y el cliente desaparece del book activo.
    const book = await S.getBook(w.beto, { orgId: w.orgId })
    expect(book.rows).toEqual([])
    expect(book.revoked).toHaveLength(1)
  })

  test('revocar dos veces no duplica el evento', async () => {
    const w = await linked()
    await S.revokeLink(w.caro, { orgId: w.orgId })
    await S.revokeLink(w.caro, { orgId: w.orgId })
    expect(w.audits().filter((a) => a.action === 'link.revoke')).toHaveLength(1)
  })

  test('el asesor o el admin también pueden terminar el vínculo; un tercero no', async () => {
    const w = await linked()
    await expect(S.revokeLink(w.as('eva', 'eva@otro.com'), { orgId: w.orgId, clientUid: 'caro' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await S.revokeLink(w.ana, { orgId: w.orgId, clientUid: 'caro' })
    expect(w.db.__get(`clientLinks/${w.linkId}`)).toMatchObject({ status: 'revoked', revokedBy: 'admin' })
  })

  test('un cliente con dos firmas conserva el acceso de la que no revocó', async () => {
    const w = await linked()
    const zoe = w.as('zoe', 'zoe@dos.com')
    const { orgId: org2 } = await S.createOrg(zoe, { name: 'Firma Dos' })
    await S.inviteClient(zoe, { orgId: org2, email: 'caro@mail.com' })
    await S.acceptInvite(w.caro, { token: w.tokens[w.tokens.length - 1], scopes: ['metas'], consentVersion: CONSENT_VERSION })
    await S.revokeLink(w.caro, { orgId: w.orgId })
    expect(w.db.__get('users/caro/advisorAccess/zoe')).toMatchObject({ status: 'active', scopes: ['metas'] })
    expect(w.db.__get('users/caro/advisorAccess/beto')).toBeUndefined()
  })
})

describe('book, vistas y transparencia', () => {
  test('el book muestra los montos que archivó el panel del cliente, sin recalcular', async () => {
    const w = await linked()
    w.db.__store.set('users/caro/advisorSummary/latest', { netWorth: 27292.25, investable: 20100.5, ytdPct: 2.38, baseCurrency: 'USD', netWorthUSD: 27292.25, investableUSD: 20100.5, at: '2026-11-10T14:00:00.000Z' })
    const book = await S.getBook(w.beto, { orgId: w.orgId })
    expect(book.rows[0]).toMatchObject({ name: 'Carolina', netWorth: 27292.25, investable: 20100.5, ytdPct: 2.38, snapshotAt: '2026-11-10T14:00:00.000Z', daysNoContact: 0, unread: 0 })
    expect(book.totals).toMatchObject({ activeClients: 1, declaredUSD: 27292.25, noContact90: 0 })
  })

  test('más de 90 días sin contacto se cuenta, y un mensaje del asesor reinicia el reloj', async () => {
    const w = await linked()
    w.clock.now += 95 * DAY
    expect((await S.getBook(w.ana, { orgId: w.orgId })).totals.noContact90).toBe(1)
    await S.sendMessage(w.beto, { linkId: w.linkId, body: 'Hola' })
    const book = await S.getBook(w.ana, { orgId: w.orgId })
    expect(book.totals.noContact90).toBe(0)
    expect(book.rows[0].daysNoContact).toBe(0)
  })

  test('un asesor solo ve su cartera; el asistente ve el book pero no abre clientes', async () => {
    const w = await linked()
    await S.inviteMember(w.ana, { orgId: w.orgId, email: 'asi@firma.com', role: 'assistant' })
    const asi = w.as('asi', 'asi@firma.com')
    await S.acceptInvite(asi, { token: w.tokens[w.tokens.length - 1] })
    expect((await S.getBook(asi, { orgId: w.orgId })).rows).toHaveLength(1)
    await expect(S.getClient(asi, { orgId: w.orgId, clientUid: 'caro' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(S.sendMessage(asi, { linkId: w.linkId, body: 'hola' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(w.db.__get('users/caro/advisorAccess/asi')).toBeUndefined()
  })

  test('cada pantalla se audita una vez cada 10 minutos, y Flujo sin alcance se niega', async () => {
    const w = await linked()
    const v = { orgId: w.orgId, clientUid: 'caro' }
    expect((await S.logView(w.beto, { ...v, screen: 'panel' })).logged).toBe(true)
    expect((await S.logView(w.beto, { ...v, screen: 'panel' })).logged).toBe(false)
    expect((await S.logView(w.beto, { ...v, screen: 'hoja' })).logged).toBe(true)
    w.clock.now += 10 * 60 * 1000
    expect((await S.logView(w.beto, { ...v, screen: 'panel' })).logged).toBe(true)
    await expect(S.logView(w.beto, { ...v, screen: 'flujo' })).rejects.toMatchObject({ code: 'FORBIDDEN_SCOPE' })
    expect(w.audits().filter((a) => a.action.startsWith('view.')).map((a) => a.action).sort()).toEqual(['view.hoja', 'view.panel', 'view.panel'])
  })

  test('el cliente ve la actividad de su asesor, con fecha y hora, y nunca una nota interna', async () => {
    const w = await linked()
    await S.logView(w.beto, { orgId: w.orgId, clientUid: 'caro', screen: 'panel' })
    w.clock.now += 60000
    await S.sendMessage(w.beto, { linkId: w.linkId, body: 'Revisé tu portafolio' })
    await S.createNote(w.beto, { orgId: w.orgId, clientUid: 'caro', body: 'Llamar en enero', visibility: 'internal' })
    await S.sendMessage(w.caro, { linkId: w.linkId, body: 'Gracias' })
    const { events } = await S.clientActivity(w.caro, { orgId: w.orgId })
    expect(events.map((e) => e.action)).toEqual(['message.send', 'view.panel'])
    expect(events[0].at).toMatch(/^2026-11-10T15:01/)
    const links = await S.listClientLinks(w.caro)
    expect(links.links[0]).toMatchObject({ orgName: 'Firma Uno', status: 'active', scopes: ['patrimonio', 'hoja', 'dividendos', 'metas'] })
  })

  test('un cliente no lee la actividad de otro', async () => {
    const w = await linked()
    await S.logView(w.beto, { orgId: w.orgId, clientUid: 'caro', screen: 'panel' })
    expect((await S.clientActivity(w.as('dan', 'dan@mail.com'), { orgId: w.orgId })).events).toEqual([])
  })
})

describe('mensajes y notas', () => {
  test('van en los dos sentidos, avisan por correo sin el contenido y quedan en audit', async () => {
    const w = await linked()
    const n0 = w.mails.length
    await S.sendMessage(w.beto, { linkId: w.linkId, body: 'Texto privado uno' })
    await S.sendMessage(w.caro, { linkId: w.linkId, body: 'Texto privado dos' })
    const msgs = w.db.__paths(`threads/${w.linkId}/messages/`).map((p) => w.db.__get(p))
    expect(msgs.map((m) => m.authorRole).sort()).toEqual(['advisor', 'client'])
    const sent = w.mails.slice(n0)
    expect(sent.map((m) => m.to)).toEqual(['caro@mail.com', 'beto@firma.com'])
    for (const m of sent) {
      expect(m.subject).toBe('New message on Chispu')
      expect(`${m.text}${m.html}`).not.toMatch(/Texto privado/)
    }
    expect(w.audits().filter((a) => a.action === 'message.send')).toHaveLength(2)
    expect(JSON.stringify(w.audits())).not.toMatch(/Texto privado/)
    expect(w.db.__get(`clientLinks/${w.linkId}`)).toMatchObject({ unreadForOrg: 1, unreadForClient: 1 })
  })

  test('editar conserva el historial, solo el autor edita, y marcar leído deja constancia', async () => {
    const w = await linked()
    const { msgId } = await S.sendMessage(w.beto, { linkId: w.linkId, body: 'Versión uno' })
    await expect(S.editMessage(w.caro, { linkId: w.linkId, msgId, body: 'Otra' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await S.editMessage(w.beto, { linkId: w.linkId, msgId, body: 'Versión dos' })
    const m = w.db.__get(`threads/${w.linkId}/messages/${msgId}`)
    expect(m.body).toBe('Versión dos')
    expect(m.previousBodies).toEqual([{ body: 'Versión uno', at: m.createdAt }])
    expect(w.audits().some((a) => a.action === 'message.edit')).toBe(true)
    await S.markThreadRead(w.caro, { linkId: w.linkId })
    expect(w.db.__get(`threads/${w.linkId}/messages/${msgId}`).readBy.caro).toBeTruthy()
    expect(w.db.__get(`clientLinks/${w.linkId}`).unreadForClient).toBe(0)
  })

  test('el hilo lo leen sus partes; un tercero y un asistente no', async () => {
    const w = await linked()
    await S.sendMessage(w.beto, { linkId: w.linkId, body: 'Hola' })
    const forClient = await S.listMessages(w.caro, { linkId: w.linkId })
    expect(forClient).toMatchObject({ role: 'client', status: 'active', orgName: 'Firma Uno', clientUid: 'caro' })
    expect(forClient.messages.map((m) => m.body)).toEqual(['Hola'])
    expect((await S.listMessages(w.beto, { linkId: w.linkId })).role).toBe('advisor')
    await expect(S.listMessages(w.as('zoe', 'zoe@x.com'), { linkId: w.linkId })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  test('la exportación CSV funciona para ambos lados y queda en audit', async () => {
    const w = await linked()
    await S.sendMessage(w.beto, { linkId: w.linkId, body: '=SUMA(A1) "hola"' })
    const out = await S.exportMessages(w.caro, { linkId: w.linkId })
    expect(out.count).toBe(1)
    expect(out.csv.split('\r\n')[0]).toBe('"date","author","role","kind","body","edited_at","previous_versions"')
    expect(out.csv).toContain('"\'=SUMA(A1) ""hola"""')
    await S.exportMessages(w.beto, { linkId: w.linkId })
    expect(w.audits().filter((a) => a.action === 'export.messages').map((a) => a.actorRole).sort()).toEqual(['advisor', 'client'])
  })

  test('con el vínculo revocado el hilo queda en solo lectura, pero se puede exportar', async () => {
    const w = await linked()
    await S.sendMessage(w.beto, { linkId: w.linkId, body: 'Antes' })
    await S.revokeLink(w.caro, { orgId: w.orgId })
    await expect(S.sendMessage(w.beto, { linkId: w.linkId, body: 'Después' })).rejects.toMatchObject({ code: 'LINK_NOT_ACTIVE' })
    await expect(S.sendMessage(w.caro, { linkId: w.linkId, body: 'Después' })).rejects.toMatchObject({ code: 'LINK_NOT_ACTIVE' })
    expect((await S.exportMessages(w.ana, { linkId: w.linkId })).count).toBe(1)
  })

  test('una nota compartida aparece en el hilo; una interna no sale de la firma', async () => {
    const w = await linked()
    await S.createNote(w.beto, { orgId: w.orgId, clientUid: 'caro', body: 'Solo para la firma', visibility: 'internal' })
    await S.createNote(w.beto, { orgId: w.orgId, clientUid: 'caro', body: 'Para ti', visibility: 'shared' })
    const msgs = w.db.__paths(`threads/${w.linkId}/messages/`).map((p) => w.db.__get(p))
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ kind: 'note', body: 'Para ti', authorRole: 'advisor' })
    expect((await S.listNotes(w.beto, { orgId: w.orgId, clientUid: 'caro' })).notes.map((n) => n.visibility).sort()).toEqual(['internal', 'shared'])
    await expect(S.listNotes(w.caro, { orgId: w.orgId, clientUid: 'caro' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(w.audits().filter((a) => a.action === 'note.create')).toHaveLength(2)
  })

  test('un mensaje vacío o enorme se rechaza', async () => {
    const w = await linked()
    await expect(S.sendMessage(w.beto, { linkId: w.linkId, body: '   ' })).rejects.toMatchObject({ code: 'EMPTY_BODY' })
    await expect(S.sendMessage(w.beto, { linkId: w.linkId, body: 'a'.repeat(4001) })).rejects.toMatchObject({ code: 'BODY_TOO_LONG' })
  })
})

test('ninguna operación escribe en los datos financieros del cliente', async () => {
  const w = await linked(['patrimonio', 'hoja', 'dividendos', 'metas', 'flujo'])
  await S.logView(w.beto, { orgId: w.orgId, clientUid: 'caro', screen: 'panel' })
  await S.sendMessage(w.beto, { linkId: w.linkId, body: 'Hola' })
  await S.createNote(w.beto, { orgId: w.orgId, clientUid: 'caro', body: 'Nota', visibility: 'shared' })
  await S.revokeLink(w.ana, { orgId: w.orgId, clientUid: 'caro' })
  const userWrites = w.db.__writes.map((x) => x.path).filter((p) => p.startsWith('users/caro/'))
  expect(userWrites.every((p) => /^users\/caro\/(grants|advisorAccess)\//.test(p))).toBe(true)
})
