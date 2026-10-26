// Regresión: una petición lanzada antes de que Firebase restaure la sesión
// salía sin Authorization y el servidor contestaba 401.
jest.mock('../firebase', () => ({ auth: { currentUser: null, authStateReady: null } }))

import { authFetch } from '../authFetch'
import { auth as mockAuth } from '../firebase'

describe('authFetch espera la sesión', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ status: 200, ok: true }))
    mockAuth.currentUser = null
  })

  it('manda el token si la sesión se restaura mientras espera', async () => {
    mockAuth.authStateReady = jest.fn(async () => {
      mockAuth.currentUser = { getIdToken: async () => 'tok' }
    })
    await authFetch('/api/prices', { method: 'POST' })
    expect(mockAuth.authStateReady).toHaveBeenCalled()
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('sin sesión sigue saliendo sin token (no inventa uno)', async () => {
    mockAuth.authStateReady = jest.fn(async () => {})
    await authFetch('/api/prices')
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })
})
