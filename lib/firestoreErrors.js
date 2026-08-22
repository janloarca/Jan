// Qué significa un fallo de Firestore, y qué hacer con él.
//
// Firestore's daily free-tier (Spark plan) quota shows up as a raw gRPC code
// ("8 RESOURCE_EXHAUSTED: Quota exceeded") that means nothing to a user and,
// critically, resolves on its own within hours — it is not a bug to fix, just
// a limit to wait out (or a reason to upgrade to Blaze if it recurs often).
//
// Extracted from components/SettingsModal.jsx, which had this same detector
// written inline for the email-test button (FASE IE9). A second caller
// (components/finance/AutoCaptureModal.jsx) writing its own copy of the same
// regex is exactly how the two drift apart later — one place, shared.
//
// FASE KR: además de nombrar el fallo, hay que distinguir el que se arregla
// SOLO del que no. Un `14 UNAVAILABLE` en un arranque en frío de una función
// serverless es un hipo de la conexión gRPC y el mismo intento un cuarto de
// segundo después funciona; un `8 RESOURCE_EXHAUSTED` es una cuota agotada y
// reintentarlo la gasta más rápido. Tratarlos igual es cómo se pierde un cobro
// real: la automatización de Wallet dispara UNA vez por compra y no vuelve, así
// que un fallo transitorio que nadie reintenta borra ese gasto hasta que el
// estado de cuenta lo traiga un mes después.

export function isFirestoreQuotaError(raw) {
  return /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(raw || ''))
}

// El código gRPC de un error de Firestore, o null.
//
// El SDK de Admin lo pone en `err.code` como NÚMERO, pero no siempre: un error
// envuelto puede traerlo solo en el texto ("8 RESOURCE_EXHAUSTED: ..."), que es
// justamente la forma en que llega cuando alguien lo re-lanza con un mensaje
// propio. Se leen las dos, en ese orden.
export function firestoreErrorCode(err) {
  const direct = err?.code
  if (typeof direct === 'number' && isFinite(direct)) return direct
  const m = String(err?.message || err || '').match(/^\s*(\d{1,2})\s+[A-Z_]+/)
  return m ? Number(m[1]) : null
}

// Los códigos que un reintento puede resolver, y solo esos.
//
//   4  DEADLINE_EXCEEDED — la llamada tardó de más.
//   10 ABORTED           — contención; el mismo intento suele pasar.
//   13 INTERNAL          — fallo interno del lado de Google.
//   14 UNAVAILABLE       — el clásico del arranque en frío: el canal gRPC
//                          todavía no está listo.
//
// Fuera quedan a propósito: 8 (cuota, reintentar la gasta), 7/16 (permisos y
// credenciales, que no cambian por insistir) y 3/5/9 (la petición está mal, y
// repetirla igual no la arregla).
const TRANSIENT_CODES = new Set([4, 10, 13, 14])

export function isTransientFirestoreError(err) {
  const code = firestoreErrorCode(err)
  if (code != null) return TRANSIENT_CODES.has(code)
  // Sin código no se afirma que sea transitorio: reintentar un error que no
  // entendemos puede duplicar trabajo, y el caso que este helper existe para
  // cubrir SIEMPRE trae código.
  return false
}

export const DEFAULT_RETRY_ATTEMPTS = 3
export const DEFAULT_RETRY_DELAY_MS = 200

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Corre `fn` y la reintenta SOLO ante un fallo transitorio.
//
// El caller tiene que ser idempotente, y los dos que hay lo son por
// construcción: `ingestExpense` escribe bajo un id determinístico, así que
// repetirla no puede crear un segundo gasto (a lo sumo encuentra el que ya
// escribió y contesta 'duplicate'), y las lecturas no escriben nada.
//
// El presupuesto es chico a propósito: del otro lado hay un atajo de iOS
// esperando la respuesta, así que 3 intentos con 200/400ms suman menos de un
// segundo en el peor caso.
export async function withFirestoreRetry(fn, { attempts = DEFAULT_RETRY_ATTEMPTS, baseDelayMs = DEFAULT_RETRY_DELAY_MS, label = 'firestore' } = {}) {
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (i === attempts - 1 || !isTransientFirestoreError(err)) throw err
      console.warn(`[${label}] reintento ${i + 1}/${attempts - 1} tras ${firestoreErrorCode(err)}: ${err?.message}`)
      await sleep(baseDelayMs * Math.pow(2, i))
    }
  }
  throw last
}

// Cómo se nombra el fallo hacia afuera: un código corto para archivar y una
// frase para la persona.
//
// La frase importa más de lo que parece: el único lugar donde el usuario ve
// esto es una notificación en la pantalla de bloqueo del teléfono. Ahí no hay
// consola ni logs, así que "Internal server error" convierte cada fallo en una
// ronda de preguntas (la lección de "Reparar ahora", y la misma razón por la
// que existe `explainIngestError` del lado de los rechazos).
export function describeFirestoreFailure(err) {
  const code = firestoreErrorCode(err)
  if (isFirestoreQuotaError(err?.message || err) || code === 8) {
    return {
      kind: 'quota',
      code: 'error:quota',
      retryable: true,
      message: 'La base de datos llegó a su límite diario de uso. Se reinicia sola en unas horas y el gasto no se registró: agregalo a mano o esperá a que llegue por el estado de cuenta.',
    }
  }
  if (isTransientFirestoreError(err)) {
    return {
      kind: 'transient',
      code: `error:${code}`,
      retryable: true,
      message: 'La base de datos no respondió a tiempo. Es pasajero: volvé a intentar con la próxima compra, y si este gasto no aparece, agregalo a mano.',
    }
  }
  if (code === 7 || code === 16) {
    return {
      kind: 'permission',
      code: `error:${code}`,
      retryable: false,
      message: 'El servidor no pudo escribir en tu cuenta. No es algo que se arregle desde el teléfono: reportalo.',
    }
  }
  return {
    kind: 'unknown',
    code: code != null ? `error:${code}` : 'error',
    retryable: false,
    message: 'No se pudo registrar el gasto por un fallo del servidor. Agregalo a mano; el cobro va a aparecer igual cuando importes el estado de cuenta.',
  }
}
