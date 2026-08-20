// Cada cuánto reintenta el auto-sync de IBKR, según cómo viene fallando.
//
// El problema que resuelve: la cadencia era 30 minutos para CUALQUIER error no
// fatal, indefinidamente. Un token vencido cuyo código IBKR no estuviera
// mapeado (caía a UNKNOWN, que no es fatal) producía ~48 intentos fallidos por
// día, para siempre. Y los intentos fallidos son exactamente lo que dispara el
// bloqueo de IBKR ("Too many failed attempts"), así que el defecto no solo
// escondía la causa: empujaba hacia un problema peor.
//
// Mapear más códigos ayuda, pero es perseguir una lista que no controlamos y
// que puede cambiar. Esto es la red que no depende de esa lista: si el MISMO
// sync falla tres veces seguidas, algo está roto de verdad y reintentar cada
// media hora no lo va a arreglar. Se pasa a la cadencia larga, la misma que
// FASE EZ3 ya usa para un bloqueo temporal, hasta que un sync exitoso
// reinicie el contador.
//
// No detiene el sync (eso es solo para los errores fatales, que necesitan que
// el usuario actúe): sigue reintentando, porque un fallo transitorio que dura
// días tiene que poder sanar solo, sin que nadie toque nada.

export const NORMAL_INTERVAL_MS = 30 * 60 * 1000
export const BACKOFF_INTERVAL_MS = 12 * 60 * 60 * 1000
// Tres seguidos: uno o dos fallos son ruido normal de IBKR (sobre todo fuera de
// horario de mercado, que el usuario ya reportó). Tres seguidos ya no lo son.
export const REPEATED_FAILURE_THRESHOLD = 3

// `errorCode` y `failCount` salen del doc de settings del usuario.
export function ibkrSyncIntervalMs({ errorCode = null, failCount = 0 } = {}) {
  // Un bloqueo temporal de IBKR se espacia siempre, desde el primer fallo:
  // reintentar durante el bloqueo lo REFRESCA.
  if (errorCode === 'LOCKED') return BACKOFF_INTERVAL_MS
  const n = Number(failCount)
  if (Number.isFinite(n) && n >= REPEATED_FAILURE_THRESHOLD) return BACKOFF_INTERVAL_MS
  return NORMAL_INTERVAL_MS
}

// Cuántos fallos seguidos lleva, después de este. Se guarda en settings; un
// sync exitoso lo pone en 0.
export function nextFailCount(current) {
  const n = Number(current)
  return (Number.isFinite(n) && n > 0 ? n : 0) + 1
}
