// La insignia "sincronizado" de Amigos, decidida con datos que el SERVIDOR
// escribe.
//
// El hueco que esto cierra, y estaba anotado en el propio código: `syncedPct`
// (qué fracción del portafolio viene de un broker en vivo) lo calculaba el
// CLIENTE y lo mandaba en el cuerpo. El servidor derivaba `verified` de ese
// número, lo que impedía la mentira directa (`verified: true` con un pct que la
// contradice) pero no la de fondo: un cliente modificado manda `syncedPct: 1` y
// se auto-otorga la insignia. Y la insignia no le habla al usuario, le habla a
// SUS AMIGOS: es una afirmación sobre él que otras personas leen.
//
// Por qué NO se recalcula el porcentaje en el servidor, que sería lo obvio:
// necesita el pipeline completo (items + transacciones + snapshots + cotizar
// precios en vivo contra Yahoo/CoinGecko) en CADA publicación, sobre un plan
// cuya cuota diaria ya se agotó una vez en producción. Un badge no justifica
// eso.
//
// Así que la insignia pasa a afirmar algo MÁS CHICO y verificable: que hay un
// broker conectado y sincronizando de verdad. Eso vive en los vaults
// (`users/{uid}/settings/{brokerId}`), y su `lastSync` lo estampa la RUTA al
// terminar un sync exitoso, no el cliente. Una sola lectura de la subcolección
// `settings` trae todos los vaults de una.
//
// Módulo puro + tests.

// Cuánto puede llevar sin sincronizar antes de que la insignia deje de ser
// cierta. Un broker conectado hace un año y sin sincronizar desde entonces ya
// no describe un portafolio que se mantiene solo.
export const VERIFIED_MAX_STALE_DAYS = 45

const DAY_MS = 86400000

// Los ids de vault que corresponden a una conexión de broker. Es una lista
// CERRADA a propósito: `settings` guarda también preferences, profile, ingest,
// incomePlan y demás, y un doc cualquiera con un campo `lastSync` no puede
// terminar otorgando una insignia.
export const BROKER_VAULT_IDS = new Set([
  'ibkr', 'blockchain', 'ledger',
  'alpaca', 'binance', 'bitso', 'coinbase', 'etoro', 'ig',
  'kraken', 'saxo', 'schwab', 'tastytrade', 'tradestation',
])

function ts(value) {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return isFinite(ms) ? ms : null
}

// settings: [{ id, data }] — los docs de users/{uid}/settings.
//
// Devuelve { verified, brokerId, lastSync } para que el caller pueda decir POR
// QUÉ, en vez de solo sí o no.
export function brokerVerification(settings, now = Date.now()) {
  let best = null
  for (const entry of settings || []) {
    if (!BROKER_VAULT_IDS.has(entry?.id)) continue
    const at = ts(entry.data?.lastSync)
    if (at == null) continue
    // Una marca en el FUTURO no es evidencia de nada: solo puede venir de un
    // reloj corrido o de un dato escrito a mano.
    if (at > now) continue
    if (!best || at > best.lastSyncMs) best = { brokerId: entry.id, lastSyncMs: at }
  }
  if (!best) return { verified: false, brokerId: null, lastSync: null }
  return {
    verified: now - best.lastSyncMs <= VERIFIED_MAX_STALE_DAYS * DAY_MS,
    brokerId: best.brokerId,
    lastSync: new Date(best.lastSyncMs).toISOString(),
  }
}
