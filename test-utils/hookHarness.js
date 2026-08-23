// Arnés compartido para probar hooks de React (FASE JB2).
//
// Vive FUERA de `__tests__/` a propósito: el testMatch por defecto de Jest toma
// cualquier archivo dentro de esa carpeta como suite, y este no tiene tests
// (fallaría con "Your test suite must contain at least one test"). No lo
// importa ningún módulo de producción, así que tampoco entra al bundle.
//
// ⚠️ LAS TRES TRAMPAS DEL ARNÉS, en un solo lugar para no volver a pagarlas.
// Se descubrieron escribiendo el primer test de hook del repo.
//
// 1. El alias `@/` NO resuelve dentro de `jest.mock()`/`jest.doMock()` en este
//    repo (ya estaba documentado al testear la ruta de historial de precios).
//    Hay que usar ruta RELATIVA al archivo de test. El mock igual intercepta el
//    import aliasado que hace el hook, porque Jest mockea por módulo RESUELTO y
//    los dos caminos llegan al mismo archivo.
//
//    Y por eso el `doMock` de una ruta relativa NO se puede mover a este
//    helper: se resolvería contra ESTE archivo, no contra el test. Cada test
//    declara los suyos.
//
// 2. Casi todos los hooks de este repo tienen un caché a NIVEL DE MÓDULO
//    (precios, tasas), así que sin resetear el registro el primer test
//    contamina a los siguientes y ninguno puede volver a observar la transición
//    "sin datos -> con datos", que suele ser justo donde vive el bug.
//    Pero `jest.isolateModules()`, que es lo que uno intenta primero, AÍSLA
//    TAMBIÉN A REACT: el hook queda con una instancia distinta de la del arnés
//    y revienta con "Cannot read properties of null (reading 'useState')",
//    porque se queda sin dispatcher.
//
// 3. Y re-pedir `@testing-library/react` dentro del `beforeEach` para que
//    comparta el registro fresco tampoco sirve: al importarse registra su
//    propio `afterAll`, y Jest prohíbe definir un hook de test dentro de otro
//    ("Hooks cannot be defined inside tests").
//
// La salida es `jest.resetModules()` + `pinReact()`: se resetea el registro
// pero se fija React a la instancia que el arnés YA tiene, así el hook recién
// pedido y `renderHook` comparten dispatcher.
//
// Uso:
//
//   const { renderHook, act, pinReact } = require('../../test-utils/hookHarness')
//   let useAlgo, authFetch
//   beforeEach(() => {
//     jest.resetModules()
//     pinReact()
//     jest.doMock('../../lib/authFetch', () => ({ authFetch: jest.fn() }))
//     ;({ authFetch } = require('../../lib/authFetch'))
//     ;({ useAlgo } = require('../useAlgo'))
//   })

const React = require('react')
const { renderHook, act } = require('@testing-library/react')

// Llamar DESPUÉS de jest.resetModules() y ANTES de requerir el hook.
// 'react' es un nombre de paquete, así que resuelve al mismo módulo desde acá
// que desde el test: por eso este sí puede vivir en el helper.
function pinReact() {
  jest.doMock('react', () => React)
}

// Respuesta de fetch mínima con forma de `Response`, que es lo que devuelve
// `authFetch`. Nunca lanza ante un 4xx/5xx: hay que leer `ok`, igual que en
// producción.
function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

module.exports = { React, renderHook, act, pinReact, jsonResponse }
