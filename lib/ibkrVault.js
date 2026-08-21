// ⛔ FASE KC. El vault de credenciales de IBKR, con la regla que faltaba: un
// 500 NO es un guardado.
//
// `authFetch` DEVUELVE la respuesta pase lo que pase (nunca lanza por un 4xx o
// un 5xx), así que `await authFetch(...)` seguido de "listo, guardado" es
// exactamente el defecto: seis sitios trataban cualquier respuesta como éxito.
//
// Y la ruta sí puede fallar, por razones nada exóticas: sin
// `CRYPTO_MASTER_KEY` el cifrado del token lanza, sin credenciales de admin no
// hay base, y el rate limit puede contestar 429.
//
// Lo que hacía cada caller después de "guardar" es lo que lo vuelve grave:
//
//   - El camino de MIGRACIÓN (useDashboardData) escribía
//     `{ ibkrToken: null, _ibkrVaultMigrated: true }`, o sea BORRABA la única
//     copia del token que existía (la legacy, cifrada del lado del cliente)
//     creyendo que ya estaba a salvo en el servidor.
//   - Peor todavía, `ibkrConnected` mira esa bandera, así que la app quedaba
//     diciendo "conectado" con el vault vacío y seguía intentando sincronizar
//     con `'__stored__'`. Cada intento fallido acerca el bloqueo de IBKR
//     ("Too many failed attempts"), que es justo lo que lib/ibkrRetryPolicy.js
//     existe para no alimentar.
//   - El paso 1 del viaje aterrizaba en la pantalla "Credenciales guardadas"
//     después de no guardarlas.
//
// Estas funciones LANZAN cuando el servidor no confirmó. Los callers ya tenían
// el try/catch en su lugar (esperando una excepción que nunca llegaba), así que
// con esto la rama de éxito deja de correr sola.

import { authFetch } from '@/lib/authFetch'

async function post(body) {
  const res = await authFetch('/api/brokers/ibkr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return true
  // El mensaje del servidor viaja de vuelta cuando lo hay: en un teléfono no
  // hay consola, y "Failed to save credentials" al menos dice de qué lado
  // está el problema. Una respuesta sin JSON (un 502 del proxy, un HTML de
  // error) no puede tumbar el manejo del error, así que cae al status.
  let detail = ''
  try {
    const data = await res.json()
    detail = (data && data.error) || ''
  } catch { /* respuesta sin cuerpo JSON: manda el status */ }
  throw new Error(detail || `El servidor respondió ${res.status}`)
}

// Guardar un token recién tecleado (o migrar el legacy) al vault del servidor.
export function saveIbkrCredentials(token, queryId) {
  return post({ action: 'save-credentials', token, queryId })
}

// Borrar el doc del vault. Es la misma acción con token/queryId vacíos: la ruta
// lo interpreta como delete.
export function clearIbkrCredentials() {
  return post({ action: 'save-credentials', token: null, queryId: null })
}
