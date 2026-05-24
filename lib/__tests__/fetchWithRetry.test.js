import { fetchWithRetry } from '../fetchWithRetry'

const mockFetch = (responses) => {
  let callCount = 0
  global.fetch = jest.fn(() => {
    const response = responses[callCount] || responses[responses.length - 1]
    callCount++
    if (response.error) return Promise.reject(response.error)
    return Promise.resolve(response)
  })
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('fetchWithRetry', () => {
  test('returns on first success', async () => {
    mockFetch([{ ok: true, status: 200 }])
    const result = await fetchWithRetry('https://example.com', {}, { retries: 2, backoff: 1 })
    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('retries on 5xx and returns last response', async () => {
    mockFetch([
      { ok: false, status: 500 },
      { ok: false, status: 502 },
      { ok: false, status: 503 },
    ])
    const result = await fetchWithRetry('https://example.com', {}, { retries: 2, backoff: 1 })
    expect(result.status).toBe(503)
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  test('does not retry on 4xx', async () => {
    mockFetch([{ ok: false, status: 404 }])
    const result = await fetchWithRetry('https://example.com', {}, { retries: 2, backoff: 1 })
    expect(result.status).toBe(404)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('retries on network error and succeeds', async () => {
    mockFetch([
      { error: new Error('Network failed') },
      { ok: true, status: 200 },
    ])
    const result = await fetchWithRetry('https://example.com', {}, { retries: 2, backoff: 1 })
    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  test('throws after exhausting retries on network error', async () => {
    mockFetch([
      { error: new Error('fail 1') },
      { error: new Error('fail 2') },
      { error: new Error('fail 3') },
    ])
    await expect(
      fetchWithRetry('https://example.com', {}, { retries: 2, backoff: 1 })
    ).rejects.toThrow('fail 3')
  })

  test('returns response not undefined after all 5xx retries', async () => {
    mockFetch([
      { ok: false, status: 500 },
      { ok: false, status: 500 },
    ])
    const result = await fetchWithRetry('https://example.com', {}, { retries: 1, backoff: 1 })
    expect(result).toBeDefined()
    expect(result.status).toBe(500)
  })
})
