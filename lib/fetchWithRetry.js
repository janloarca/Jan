const inflight = new Map()

export async function fetchWithRetry(url, opts = {}, { retries = 2, backoff = 1000 } = {}) {
  const method = (opts.method || 'GET').toUpperCase()
  if (method === 'GET') {
    const existing = inflight.get(url)
    if (existing) return existing.then((r) => r.clone())
  }

  const promise = _doFetch(url, opts, retries, backoff)

  if (method === 'GET') {
    inflight.set(url, promise)
    promise.finally(() => inflight.delete(url)).catch(() => {})
  }

  return promise
}

// Retry for BROKER upstream calls: takes an attempt FACTORY instead of a fixed
// url/opts, so per-attempt state (nonce, signature timestamp, AbortSignal) is
// regenerated on every try. No in-flight dedup on purpose — broker requests are
// per-user (signed headers), and fetchWithRetry's URL-keyed dedup would hand one
// user's response to another. Retries on network errors and 5xx; never on 4xx.
export async function retryRequest(makeAttempt, { retries = 2, backoff = 1000 } = {}) {
  let lastRes
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await makeAttempt(i)
      if (res.ok || res.status < 500) return res
      lastRes = res
      if (i < retries) await new Promise((r) => setTimeout(r, backoff * (i + 1)))
    } catch (err) {
      if (i === retries) throw err
      await new Promise((r) => setTimeout(r, backoff * (i + 1)))
    }
  }
  return lastRes
}

async function _doFetch(url, opts, retries, backoff) {
  let lastRes
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        // Don't follow cross-host redirects: these URLs target fixed upstreams
        // (Yahoo/CoinGecko/FX). A compromised/MitM upstream could otherwise 30x to
        // an internal host (SSRF, e.g. cloud metadata). Callers may override.
        redirect: opts.redirect || 'error',
        signal: opts.signal || AbortSignal.timeout(10000),
      })
      if (res.ok || res.status < 500) return res
      lastRes = res
      if (i < retries) await new Promise((r) => setTimeout(r, backoff * (i + 1)))
    } catch (err) {
      if (i === retries) throw err
      await new Promise((r) => setTimeout(r, backoff * (i + 1)))
    }
  }
  return lastRes
}
