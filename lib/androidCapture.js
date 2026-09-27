// El cuerpo que la app de automatización de Android manda, y cómo reconocer que
// se pegó SIN reemplazar los marcadores.
//
// Vive en un módulo compartido porque la plantilla la muestra el modal y los
// marcadores los reconoce el SERVIDOR: dos copias de esa lista es exactamente
// cómo una se queda atrás y el mensaje deja de corresponder con lo que el usuario
// tiene pegado en el teléfono (la lección de `lib/transferTx.js` y de la lista de
// códigos ISO).
//
// ⛔ Los marcadores son VISIBLES a propósito. Antes iban vacíos (`"title":""`), y
// una cadena vacía es el peor marcador posible: se ve terminada, así que quien
// pega el cuerpo tal cual no tiene ninguna señal de que le falta un paso, y lo
// que recibe de vuelta es un error sobre el MONTO (un campo que este camino ni
// manda). Con sentinelas a la vista, pegar sin reemplazar es evidente antes de
// probar, y si igual se prueba el servidor puede nombrar exactamente esa causa.
export const ANDROID_PLACEHOLDERS = {
  title: 'TITULO_DE_LA_NOTIFICACION',
  text: 'TEXTO_DE_LA_NOTIFICACION',
  occurredAt: 'FECHA_Y_HORA_CON_ZONA',
}

export const ANDROID_BODY_TEMPLATE = JSON.stringify({
  source: 'android',
  title: ANDROID_PLACEHOLDERS.title,
  text: ANDROID_PLACEHOLDERS.text,
  occurredAt: ANDROID_PLACEHOLDERS.occurredAt,
})

const SENTINELS = new Set(Object.values(ANDROID_PLACEHOLDERS))

// Una variable de texto mágico que la app NO resolvió llega literal. No se
// afirma ningún nombre concreto (cada app tiene los suyos y desde acá no se
// pueden verificar): lo que se reconoce es la FORMA, un token solo, entre
// corchetes o con prefijo de porcentaje, sin espacios. Ningún título de
// notificación real tiene esa forma.
const UNRESOLVED_VARIABLE = /^(?:\[[a-z0-9_.]+\]|%[a-z0-9_.]+)$/i

/**
 * ¿Este valor sigue siendo el marcador en vez del dato?
 *
 * Cubre las tres formas en que llega sin reemplazar: vacío, la sentinela tal
 * cual, o una variable que la app de automatización no resolvió.
 */
export function isUnreplacedPlaceholder(value) {
  const v = String(value ?? '').trim()
  if (!v) return true
  if (SENTINELS.has(v)) return true
  return UNRESOLVED_VARIABLE.test(v)
}

/**
 * ¿El cuerpo de una captura por texto llegó sin los datos de la notificación?
 *
 * Es la diferencia entre "la automatización está mal configurada" y "llegó un
 * aviso que no era un cobro", que hasta ahora se contestaban con el mismo
 * mensaje y mandaban a revisar lugares distintos.
 */
export function alertBodyIsUnconfigured({ title, text } = {}) {
  return isUnreplacedPlaceholder(title) && isUnreplacedPlaceholder(text)
}
