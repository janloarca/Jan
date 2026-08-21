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

// ⛔ FASE KL. Un bloqueo que NO se levanta ya no es temporal.
//
// El diseño de arriba trata LOCKED como transitorio: no detiene el sync, lo
// espacia a 12h y espera que IBKR libere el token solo. Eso es correcto para el
// caso que motivó la regla (una ráfaga de intentos que el propio usuario
// disparó tocando el pill) y falso para el otro caso, que es igual de común:
// el token está VENCIDO o REVOCADO. Ahí cada reintento es un intento fallido
// más, y un intento fallido es exactamente lo que refresca el bloqueo, así que
// el lazo no puede terminar nunca por su cuenta: falla, se bloquea, reintenta,
// falla.
//
// Un usuario real quedó una SEMANA así, con la app reintentando dos veces al
// día y el pill diciéndole "se reanuda solo: no hace falta que hagas nada". Ese
// mensaje es el peor de los dos errores posibles: le pide que espere justo
// cuando esperar es lo único que garantiza que no se arregle.
//
// Después de varias corridas de la cadencia larga sin un solo éxito, la
// evidencia ya dice que no se está levantando: se deja de reintentar (dejar de
// alimentar intentos fallidos es lo único que puede permitir que el bloqueo
// expire) y el usuario recibe la instrucción real, que es generar un token
// nuevo. Cualquier sync exitoso o credenciales nuevas reinician el contador y
// con él esta condición.
//
// Cuatro y no uno: a 12h de cadencia son ~2 días, así que un bloqueo genuino
// por ráfaga (que se levanta en horas) conserva intacto su camino de sanar
// solo. El contador solo cuenta intentos AUTOMÁTICOS: un fallo manual no lo
// mueve, así que tocar el pill no puede empujar a nadie a este estado.
export const LOCK_GIVE_UP_ATTEMPTS = 4

export function ibkrLockIsStuck({ errorCode = null, failCount = 0 } = {}) {
  if (errorCode !== 'LOCKED') return false
  const n = Number(failCount)
  return Number.isFinite(n) && n >= LOCK_GIVE_UP_ATTEMPTS
}

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
