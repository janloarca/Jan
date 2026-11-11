import {
  SCOPES, DEFAULT_SCOPES, sanitizeScopes, inviteState, accessFromGrants, shouldLogView,
  isClientVisibleActivity, bookRow, bookTotals, sortByNoContact, messagesCsv, auditDocId,
  canSeeClients, SCREEN_SCOPE, VIEW_SCREENS, INVITE_TTL_MS,
} from '../institutional/model'

const NOW = Date.parse('2026-11-10T12:00:00Z')

test('Flujo existe como alcance pero va apagado por defecto', () => {
  expect(SCOPES).toContain('flujo')
  expect(DEFAULT_SCOPES).not.toContain('flujo')
  expect(sanitizeScopes(['flujo', 'otro', 'metas'])).toEqual(['metas', 'flujo'])
  expect(sanitizeScopes('patrimonio')).toEqual([])
})

test('cada pantalla de la vista de lectura depende de un alcance real', () => {
  for (const s of VIEW_SCREENS) expect(SCOPES).toContain(SCREEN_SCOPE[s])
})

test('una invitación usada, revocada o vencida nunca está ok', () => {
  const exp = new Date(NOW + INVITE_TTL_MS).toISOString()
  expect(inviteState({ status: 'invited', expiresAt: exp }, NOW)).toBe('ok')
  expect(inviteState({ status: 'accepted', expiresAt: exp }, NOW)).toBe('used')
  expect(inviteState({ status: 'revoked', expiresAt: exp }, NOW)).toBe('revoked')
  expect(inviteState({ status: 'invited', expiresAt: exp }, NOW + INVITE_TTL_MS + 1)).toBe('expired')
  expect(inviteState({ status: 'invited' }, NOW)).toBe('expired')
  expect(inviteState(null, NOW)).toBe('not-found')
})

test('el espejo de acceso sale solo de grants ACTIVOS, uniendo alcances por asesor', () => {
  const m = accessFromGrants([
    { orgId: 'a', status: 'active', scopes: ['patrimonio'], advisorUids: ['u1', 'u2'] },
    { orgId: 'b', status: 'active', scopes: ['flujo'], advisorUids: ['u1'] },
    { orgId: 'c', status: 'revoked', scopes: ['hoja'], advisorUids: ['u1', 'u3'] },
  ])
  expect(m.get('u1')).toEqual({ status: 'active', scopes: ['patrimonio', 'flujo'], orgIds: ['a', 'b'] })
  expect(m.get('u2').scopes).toEqual(['patrimonio'])
  expect(m.has('u3')).toBe(false)
})

test('una vista se registra a lo sumo una vez cada 10 minutos', () => {
  expect(shouldLogView(null, NOW)).toBe(true)
  expect(shouldLogView(new Date(NOW - 9 * 60000).toISOString(), NOW)).toBe(false)
  expect(shouldLogView(new Date(NOW - 10 * 60000).toISOString(), NOW)).toBe(true)
})

test('el cliente ve vistas y mensajes de la firma, nunca una nota interna ni lo suyo', () => {
  expect(isClientVisibleActivity({ action: 'view.panel', actorRole: 'advisor' })).toBe(true)
  expect(isClientVisibleActivity({ action: 'message.send', actorRole: 'advisor' })).toBe(true)
  expect(isClientVisibleActivity({ action: 'note.create', actorRole: 'advisor', meta: { visibility: 'shared' } })).toBe(true)
  expect(isClientVisibleActivity({ action: 'note.create', actorRole: 'advisor', meta: { visibility: 'internal' } })).toBe(false)
  expect(isClientVisibleActivity({ action: 'message.send', actorRole: 'client' })).toBe(false)
  expect(isClientVisibleActivity({ action: 'member.invite', actorRole: 'admin' })).toBe(false)
})

test('el book copia las cifras archivadas y deja null lo que no existe', () => {
  const link = { id: 'o_c', clientUid: 'c', clientName: 'Caro', status: 'active', scopes: ['patrimonio'], acceptedAt: new Date(NOW - 100 * 86400000).toISOString(), unreadForOrg: 2 }
  const row = bookRow(link, { netWorth: 77000, investable: 50000, ytdPct: 3.94, baseCurrency: 'GTQ', netWorthUSD: 10000, investableUSD: 6500, at: '2026-11-09T10:00:00Z' }, NOW)
  expect(row).toMatchObject({ netWorth: 77000, investable: 50000, ytdPct: 3.94, currency: 'GTQ', netWorthUSD: 10000, snapshotAt: '2026-11-09T10:00:00Z', daysNoContact: 100, hasContact: false, unread: 2 })
  const empty = bookRow({ ...link, id: 'o_d', clientUid: 'd' }, null, NOW)
  expect(empty).toMatchObject({ netWorth: null, ytdPct: null, netWorthUSD: null })
  const totals = bookTotals([row, empty, { ...row, status: 'revoked' }])
  expect(totals).toEqual({ activeClients: 2, declaredUSD: 10000, investableUSD: 6500, withoutSnapshot: 1, noContact90: 2 })
})

test('ordenar por días sin contacto: más días primero, sin fecha al final', () => {
  const rows = sortByNoContact([{ n: 'a', daysNoContact: 3 }, { n: 'b', daysNoContact: null }, { n: 'c', daysNoContact: 120 }])
  expect(rows.map((r) => r.n)).toEqual(['c', 'a', 'b'])
})

test('el CSV conserva el historial de ediciones y neutraliza fórmulas', () => {
  const csv = messagesCsv([{ createdAt: '2026-11-01', authorName: 'Ana', authorRole: 'advisor', body: '=SUM(A1)', editedAt: '2026-11-02', previousBodies: [{ body: 'antes "x"', at: '2026-11-01' }] }])
  const lines = csv.split('\r\n')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toContain(`"'=SUM(A1)"`)
  expect(lines[1]).toContain('antes ""x""')
})

test('los ids de auditoría ordenan lo más reciente primero', () => {
  expect(auditDocId(NOW + 1000, 'a') < auditDocId(NOW, 'a')).toBe(true)
})

test('un asistente no abre clientes', () => {
  expect(canSeeClients('assistant')).toBe(false)
  expect(canSeeClients('advisor')).toBe(true)
})
