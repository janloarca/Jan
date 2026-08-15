// Qué hacer cuando una sincronización con IBKR falla.
//
// Existe por dos razones concretas.
//
// (1) IBKR no bloquea por VOLUMEN, bloquea por intentos FALLIDOS: su mensaje es
//     "Too many failed attempts. Please review your configuration.". El
//     auto-sync ya está protegido (un token malo clasifica como TOKEN_EXPIRED y
//     detiene la cadencia; LOCKED espera 12h), pero el pill del header fuerza un
//     sync inmediato saltándose toda espera y sin límite de toques. Un usuario
//     con el token vencido ve el error, toca otra vez, y otra: cada toque es un
//     intento fallido más, y así es como se llega al bloqueo. El enfriamiento de
//     acá es lo que corta ese lazo.
//
// (2) Un reintento a ciegas no arregla un token vencido: hay que ir a pegar uno
//     nuevo. Cuando el fallo es de configuración, el toque tiene que ABRIR esa
//     pantalla en vez de disparar otra petición condenada a fallar. Un botón que
//     no hace nada visible es exactamente lo que frustra.
//
// Puro y sin imports para que toast, enfriamiento y destino del toque salgan
// todos de la MISMA decisión y no puedan divergir.

// Códigos que no se arreglan reintentando: necesitan que el usuario cambie algo.
export const FIXABLE_BY_USER = ['TOKEN_EXPIRED', 'INVALID_QUERY']

const MIN = 60 * 1000

export function ibkrFailureFeedback(errorCode, lang = 'es') {
  const es = lang !== 'en'
  const code = String(errorCode || 'UNKNOWN').toUpperCase()

  if (code === 'TOKEN_EXPIRED') {
    return {
      code,
      // Ámbar, nunca rojo: un token vencido es un trámite de dos minutos, no una
      // emergencia financiera. En una app de dinero el rojo tiene que significar
      // algo grave o irreversible, y esto no lo es.
      tone: 'warn',
      message: es
        ? 'Tu Flex Token de IBKR venció. Genera uno nuevo y pégalo aquí: toma dos minutos.'
        : 'Your IBKR Flex Token expired. Generate a new one and paste it here: it takes two minutes.',
      // Reintentar no puede funcionar hasta que cambie el token, así que el toque
      // lleva directo a donde se cambia.
      action: 'open-connection',
      cooldownMs: 0,
    }
  }

  if (code === 'INVALID_QUERY') {
    return {
      code,
      tone: 'warn',
      message: es
        ? 'IBKR no encontró ese Query ID. Revísalo en IBKR → Flex Queries y vuelve a pegarlo.'
        : 'IBKR could not find that Query ID. Check it in IBKR → Flex Queries and paste it again.',
      action: 'open-connection',
      cooldownMs: 0,
    }
  }

  if (code === 'LOCKED') {
    return {
      code,
      tone: 'warn',
      message: es
        ? 'IBKR pausó el acceso un rato por intentos seguidos. Se reanuda solo: no hace falta que hagas nada.'
        : 'IBKR paused access for a while after repeated attempts. It resumes on its own: nothing for you to do.',
      // Nada que abrir: la configuración puede estar perfecta. Reintentar ahora
      // solo refresca el bloqueo, así que el pill se queda quieto una hora.
      action: null,
      cooldownMs: 60 * MIN,
    }
  }

  if (code === 'RATE_LIMITED') {
    return {
      code,
      tone: 'warn',
      message: es
        ? 'IBKR está ocupado generando el reporte. Lo reintentamos solos en unos minutos.'
        : 'IBKR is busy generating the report. We will retry on our own in a few minutes.',
      action: null,
      cooldownMs: 5 * MIN,
    }
  }

  if (code === 'TIMEOUT') {
    return {
      code,
      tone: 'warn',
      message: es
        ? 'IBKR no respondió a tiempo. Suele pasar fuera del horario de mercado; lo reintentamos solos.'
        : 'IBKR did not respond in time. This is common outside market hours; we will retry on our own.',
      action: null,
      cooldownMs: 5 * MIN,
    }
  }

  return {
    code,
    tone: 'warn',
    message: es
      ? 'No pudimos actualizar IBKR esta vez. Lo reintentamos solos en unos minutos.'
      : 'We could not refresh IBKR this time. We will retry on our own in a few minutes.',
    action: null,
    cooldownMs: 5 * MIN,
  }
}

// Lo que el pill debe hacer cuando el usuario lo toca DENTRO del enfriamiento:
// nunca una petición nueva. O lleva a la pantalla que arregla, o repite la
// explicación, que es mejor que un botón que aparenta no hacer nada.
export function ibkrCooldownRemainingMs(cooldownUntil, now = Date.now()) {
  if (!cooldownUntil || !isFinite(cooldownUntil)) return 0
  return Math.max(0, cooldownUntil - now)
}

export function formatCooldown(ms, lang = 'es') {
  const es = lang !== 'en'
  const mins = Math.ceil(ms / MIN)
  if (mins >= 60) {
    const hours = Math.round(mins / 60)
    return es ? `en ~${hours} hora${hours === 1 ? '' : 's'}` : `in ~${hours} hour${hours === 1 ? '' : 's'}`
  }
  return es ? `en ~${mins} min` : `in ~${mins} min`
}
