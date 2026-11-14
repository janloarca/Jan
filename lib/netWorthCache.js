// Caché local del ÚLTIMO patrimonio conocido, para el primer pintado del
// tablero (bloque A2).
//
// Al abrir /dashboard, las cifras del hero esperan a que asienten precios,
// tasas y el ancla del año. Mientras tanto se mostraba un esqueleto. Con este
// caché se muestra de inmediato la última cifra que el usuario ya vio, marcada
// como «actualizando…», y la cifra real la reemplaza cuando llega.
//
// Reglas, cada una con su test:
// - Solo es una PISTA de presentación: nunca alimenta ningún cálculo, ningún
//   snapshot ni nada que se escriba a Firestore.
// - La llave lleva el uid (dos cuentas en el mismo navegador no se cruzan) y
//   una versión (un cambio de forma invalida lo viejo sin migrar nada).
// - Se descarta si es de OTRA moneda base (la cifra estaría en otra unidad) o
//   si tiene más de 7 días (ya no describe el patrimonio de hoy).
// - localStorage puede no existir o lanzar (navegación privada, cuota, datos
//   bloqueados): todo va envuelto y falla a "no hay caché", nunca a un error.

const VERSION = 1
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function netWorthCacheKey(uid) {
  return `chispu-networth-v${VERSION}:${uid}`
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null)

function storage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

export function readNetWorthCache(uid, baseCurrency, now = Date.now()) {
  if (!uid) return null
  try {
    const ls = storage()
    if (!ls) return null
    const raw = ls.getItem(netWorthCacheKey(uid))
    if (!raw) return null
    const c = JSON.parse(raw)
    if (!c || typeof c !== 'object') return null
    if (num(c.netWorth) == null) return null
    if (baseCurrency && c.baseCurrency !== baseCurrency) return null
    const savedAt = num(c.savedAt)
    if (savedAt == null || now - savedAt > MAX_AGE_MS || savedAt - now > 60 * 1000) return null
    const daily = c.dailyChange && num(c.dailyChange.abs) != null && num(c.dailyChange.pct) != null
      ? { abs: c.dailyChange.abs, pct: c.dailyChange.pct }
      : null
    return {
      netWorth: c.netWorth,
      baseCurrency: c.baseCurrency || null,
      returnYTD: num(c.returnYTD),
      ytdChange: num(c.ytdChange),
      dailyChange: daily,
      savedAt,
    }
  } catch {
    return null
  }
}

export function writeNetWorthCache(uid, { netWorth, baseCurrency, returnYTD, ytdChange, dailyChange, savedAt } = {}) {
  if (!uid || num(netWorth) == null) return false
  try {
    const ls = storage()
    if (!ls) return false
    const daily = dailyChange && num(dailyChange.abs) != null && num(dailyChange.pct) != null
      ? { abs: dailyChange.abs, pct: dailyChange.pct }
      : null
    ls.setItem(netWorthCacheKey(uid), JSON.stringify({
      netWorth,
      baseCurrency: baseCurrency || null,
      returnYTD: num(returnYTD),
      ytdChange: num(ytdChange),
      dailyChange: daily,
      savedAt: num(savedAt) ?? Date.now(),
    }))
    return true
  } catch {
    return false
  }
}
