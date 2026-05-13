export async function fetchWithRetry(url, opts = {}, { retries = 2, backoff = 1000 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        signal: opts.signal || AbortSignal.timeout(10000),
      })
      if (res.ok || res.status < 500) return res
      if (i < retries) await new Promise((r) => setTimeout(r, backoff * (i + 1)))
    } catch (err) {
      if (i === retries) throw err
      await new Promise((r) => setTimeout(r, backoff * (i + 1)))
    }
  }
}
