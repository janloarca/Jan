import { buildBrokerConnectSteps } from '../brokerConnectSteps'

const brokerWithApi = {
  id: 'alpaca', name: 'Alpaca Markets', hasApi: true,
  fields: [{ key: 'apiKey', label: 'API Key' }, { key: 'apiSecret', label: 'API Secret', type: 'password' }],
  instructions: { es: 'Instrucciones ES', en: 'Instructions EN' },
}
const brokerNoApi = {
  id: 'degiro', name: 'DEGIRO', hasApi: false,
  instructions: { es: 'Instrucciones ES', en: 'Instructions EN' },
}
const brokerOAuth = { id: 'schwab', name: 'Charles Schwab', hasApi: true, authType: 'oauth', fields: [] }

const howToFull = {
  csv: { steps: [{ es: 'Paso csv 1', en: 'CSV step 1' }], note: { es: 'Nota csv', en: 'CSV note' } },
  api: { steps: [{ es: 'Paso api 1', en: 'API step 1' }], note: { es: 'Nota api', en: 'API note' } },
}

describe('buildBrokerConnectSteps', () => {
  it('returns null for a null broker', () => {
    expect(buildBrokerConnectSteps(null, null)).toEqual([])
  })

  it('always returns exactly 3 steps, in file/screenshot/api order', () => {
    const steps = buildBrokerConnectSteps(brokerWithApi, howToFull)
    expect(steps.map((s) => s.key)).toEqual(['file', 'screenshot', 'api'])
  })

  it('every step is available for a broker with an API', () => {
    const steps = buildBrokerConnectSteps(brokerWithApi, howToFull)
    expect(steps.every((s) => s.available)).toBe(true)
  })

  it('the api step is NOT available for a broker without one, but still present', () => {
    const steps = buildBrokerConnectSteps(brokerNoApi, null)
    const api = steps.find((s) => s.key === 'api')
    expect(api).toBeDefined()
    expect(api.available).toBe(false)
  })

  it('file/screenshot stay available even with no researched howTo at all (graceful fallback)', () => {
    const steps = buildBrokerConnectSteps(brokerNoApi, null)
    expect(steps.find((s) => s.key === 'file').available).toBe(true)
    expect(steps.find((s) => s.key === 'screenshot').available).toBe(true)
  })

  it('file step falls back to broker.instructions when there is no researched CSV howTo', () => {
    const steps = buildBrokerConnectSteps(brokerNoApi, null, 'es')
    const file = steps.find((s) => s.key === 'file')
    expect(file.instructionSteps).toBeNull()
    expect(file.fallbackText).toBe('Instrucciones ES')
  })

  it('file step uses the researched howTo steps when present, no fallback text', () => {
    const steps = buildBrokerConnectSteps(brokerWithApi, howToFull)
    const file = steps.find((s) => s.key === 'file')
    expect(file.instructionSteps).toEqual(howToFull.csv.steps)
    expect(file.fallbackText).toBeNull()
  })

  it('api step carries the credential fields for a key/secret broker', () => {
    const steps = buildBrokerConnectSteps(brokerWithApi, howToFull)
    const api = steps.find((s) => s.key === 'api')
    expect(api.fields).toEqual(brokerWithApi.fields)
    expect(api.authType).toBeNull()
    expect(api.cta).toBe('Conectar')
  })

  it('an OAuth broker\'s api step CTA reads "Autorizar", not "Conectar"', () => {
    const steps = buildBrokerConnectSteps(brokerOAuth, null)
    const api = steps.find((s) => s.key === 'api')
    expect(api.authType).toBe('oauth')
    expect(api.cta).toBe('Autorizar')
  })

  it('respects lang=en for titles and CTAs', () => {
    const steps = buildBrokerConnectSteps(brokerWithApi, howToFull, 'en')
    expect(steps.find((s) => s.key === 'file').title).toBe('File (CSV / Excel)')
    expect(steps.find((s) => s.key === 'api').cta).toBe('Connect')
  })
})
