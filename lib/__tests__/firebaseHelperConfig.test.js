import { buildFirebaseInitJson, resolveHelperHost, INIT_JSON_PATH } from '../firebaseHelperConfig'

const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'key-123',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'chispudo',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'chispudo.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'chispudo.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '999',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:999:web:abc',
}

describe('buildFirebaseInitJson', () => {
  test('carries the config the helper needs to start', () => {
    const init = buildFirebaseInitJson(ENV)
    expect(init.apiKey).toBe('key-123')
    expect(init.projectId).toBe('chispudo')
    expect(init.appId).toBe('1:999:web:abc')
    expect(init.messagingSenderId).toBe('999')
  })

  test('mirrors what Hosting would have served, not the host serving the fallback', () => {
    // This file exists to stand in for Firebase's own init.json, so it must
    // look like it. Emitting our own host instead was a guess of mine that
    // overrode the convention, and it is the only value here that could be
    // actively wrong.
    expect(buildFirebaseInitJson(ENV, { authDomain: 'chispu.xyz' }).authDomain).toBe('chispudo.firebaseapp.com')
    expect(buildFirebaseInitJson(ENV).authDomain).toBe('chispudo.firebaseapp.com')
  })

  test('refuses to emit a half config, which would hide the real problem', () => {
    // A clear 404 beats a config the helper accepts and then fails on.
    expect(buildFirebaseInitJson({ ...ENV, NEXT_PUBLIC_FIREBASE_API_KEY: '' })).toBeNull()
    expect(buildFirebaseInitJson({ ...ENV, NEXT_PUBLIC_FIREBASE_PROJECT_ID: undefined })).toBeNull()
    expect(buildFirebaseInitJson({})).toBeNull()
  })

  test('derives the conventional defaults when only the essentials are set', () => {
    const init = buildFirebaseInitJson({
      NEXT_PUBLIC_FIREBASE_API_KEY: 'k', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'p',
    })
    expect(init.authDomain).toBe('p.firebaseapp.com')
    expect(init.storageBucket).toBe('p.appspot.com')
  })
})

describe('resolveHelperHost', () => {
  test('the authDomain is authoritative while it is still the Firebase domain', () => {
    expect(resolveHelperHost(ENV)).toBe('chispudo.firebaseapp.com')
    expect(resolveHelperHost({ ...ENV, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'otro.firebaseapp.com' }))
      .toBe('otro.firebaseapp.com')
  })

  test('a custom authDomain falls back to the project, never proxies to itself', () => {
    // Proxying /__/firebase to our own domain would send the route back here
    // in a loop.
    expect(resolveHelperHost({ ...ENV, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'chispu.xyz' }))
      .toBe('chispudo.firebaseapp.com')
  })

  test('no project at all means no host to proxy to', () => {
    expect(resolveHelperHost({})).toBeNull()
  })
})

test('the special-cased path is the one the helper reads', () => {
  expect(INIT_JSON_PATH).toBe('init.json')
})
