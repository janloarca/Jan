// Una sola definición de "¿estas credenciales de IBKR pueden funcionar?".
//
// Existe por el patrón que la auditoría de 8 usuarios encontró una y otra vez:
// la protección no estaba rota, estaba cableada en UNA de las varias puertas
// por las que se puede entrar. Acá había TRES:
//
//   1. IBKRSyncModal.handleQuickConnect (conectar por primera vez): validaba
//      la forma completa.
//   2. IBKRSyncModal.handleSync (un usuario YA conectado cambiando sus
//      credenciales): solo chequeaba que no estuvieran vacías.
//   3. ConnectionsModal.handleIbkrSave (el wizard "Empezar"): tampoco
//      validaba, y además mandaba los valores CRUDOS al vault mientras
//      guardaba el queryId ya recortado en settings, o sea el mismo dato
//      quedaba escrito de dos formas distintas en dos lugares.
//
// Y equivocarse acá no es gratis: IBKR NO bloquea por volumen, bloquea por
// intentos FALLIDOS ("Too many failed attempts. Please review your
// configuration."). Cada credencial mal formada que sale a la red es una
// moneda gastada hacia ese bloqueo, así que la forma se juzga ANTES de tocar
// la red y cero intentos se gastan en algo que no podía funcionar.
//
// ⛔ Devuelve los valores NORMALIZADOS y los callers usan ESOS, nunca los
// suyos. Esa es la mitad que impide que la próxima puerta vuelva a divergir:
// un `.trim()` agregado en cada caller se olvida, un valor de retorno no.
// El caso real que lo motiva es invisible: un token pegado desde una página
// web se lleva un espacio al final, se guarda CON el espacio, y a partir de
// ahí cada sync falla con un error que se lee como "token inválido" sin que
// nada apunte al espacio.

// Sentinela: el servidor tiene el token en el vault y el cliente nunca lo ve.
export const STORED_TOKEN = '__stored__'

// Un Flex Token es una cadena larga (los reales rondan los 40 caracteres).
// Menos de 15 es un pegado truncado, no un token.
export const MIN_TOKEN_LENGTH = 15

// Un Query ID es el número corto de la Flex Query (p.ej. 1603751). 15+ dígitos
// es la firma de haber pegado el TOKEN en el campo equivocado, que es el error
// más común al tener los dos campos uno encima del otro.
export const MAX_QUERY_ID_DIGITS = 14

/**
 * Normaliza y juzga la FORMA de unas credenciales de IBKR.
 *
 * @param {string} token       lo que el usuario tecleó (vacío = usar el vault)
 * @param {string} queryId     el Query ID tecleado
 * @param {boolean} hasVaultCreds  el servidor ya tiene un token guardado
 * @returns {{ok: boolean, token: string, typedToken: string, queryId: string,
 *            reason: string|null}}
 *   `token` es lo que hay que mandarle al servidor (el tecleado ya recortado,
 *   o el sentinela del vault). `typedToken` es solo lo tecleado: vacío
 *   significa "no hay token nuevo que guardar".
 */
export function normalizeIbkrCredentials({ token = '', queryId = '', hasVaultCreds = false } = {}) {
  const typedToken = String(token ?? '').trim()
  const qid = String(queryId ?? '').trim()
  const effToken = typedToken || (hasVaultCreds ? STORED_TOKEN : '')
  const base = { token: effToken, typedToken, queryId: qid }

  if (!effToken || !qid) return { ...base, ok: false, reason: 'missing' }

  // El orden importa: "todo dígitos pero larguísimo" tiene una explicación
  // mucho más útil ("pegaste el token acá") que "no son solo números".
  if (!/^\d+$/.test(qid)) return { ...base, ok: false, reason: 'query-not-numeric' }
  if (qid.length > MAX_QUERY_ID_DIGITS) return { ...base, ok: false, reason: 'query-looks-like-token' }

  // Solo se juzga un token TECLEADO. El sentinela del vault no tiene longitud
  // que revisar: el servidor ya lo tiene y el cliente nunca lo vio.
  if (typedToken && typedToken.length < MIN_TOKEN_LENGTH) {
    return { ...base, ok: false, reason: 'token-too-short' }
  }

  return { ...base, ok: true, reason: null }
}

/**
 * El texto de cada rechazo. Vive acá, junto a la regla, para que la decisión y
 * su explicación no puedan divergir (mismo criterio que ibkrSyncFeedback.js).
 */
export function ibkrCredentialMessage(reason, lang = 'es') {
  const es = lang !== 'en'
  switch (reason) {
    case 'missing':
      return es ? 'Ingresa tu token y Query ID.' : 'Enter your token and Query ID.'
    case 'query-not-numeric':
      return es
        ? 'El Query ID solo lleva números (p.ej. 1603751). Revisa que no hayas pegado otra cosa.'
        : 'The Query ID is numbers only (e.g. 1603751). Check you did not paste something else.'
    case 'query-looks-like-token':
      return es
        ? 'Ese Query ID se ve demasiado largo: parece el token. El Query ID es el número corto de tu Flex Query (p.ej. 1603751).'
        : 'That Query ID looks too long: it looks like the token. The Query ID is your Flex Query\'s short number (e.g. 1603751).'
    case 'token-too-short':
      return es
        ? 'Ese token se ve demasiado corto: un Flex Token tiene 15+ caracteres. Copia el token completo desde IBKR.'
        : 'That token looks too short: a Flex Token is 15+ characters. Copy the full token from IBKR.'
    default:
      return es ? 'Revisa tu token y Query ID.' : 'Check your token and Query ID.'
  }
}
