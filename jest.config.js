const nextJest = require('next/jest')

// ⛔ FASE LF. La suite corre en una zona horaria que NO es UTC, a propósito.
//
// UTC es la única zona donde un bug de "hora local vs UTC" es invisible: ahí
// `new Date(y,0,1)` y `Date.UTC(y,0,1)` dan el mismo instante, así que un test
// escrito en UTC pasa con el defecto adentro. Eso ya pasó con los bordes del
// año calendario (ver `lib/__tests__/yearBoundaryUtc.test.js`), y su propio
// comentario dice por qué tuvo que resolverse leyendo la FUENTE en vez de
// medir valores: "jest no fija TZ, así que con el runner en UTC getFullYear()
// y getUTCFullYear() devuelven lo MISMO y ningún test de valores puede notar
// la diferencia". Esta línea es lo que levanta esa limitación, y no solo para
// esos módulos: cualquier suposición de hora local en CUALQUIER parte del repo
// puede ahora fallar de forma observable, incluidas las que un guardián de
// fuente con lista fija de archivos no puede ver.
//
// Se elige America/Guatemala porque es la zona del usuario, está al OESTE de
// UTC (la dirección que rompe) y NO tiene horario de verano, así que no puede
// introducir tests que fallan dos veces al año.
//
// Se respeta un TZ ya definido en el entorno: así se puede correr la suite en
// otra zona (`TZ=Asia/Tokyo npx jest`) para revisar el otro lado del meridiano
// sin editar este archivo.
//
// Ojo: esto tiene que quedarse ACÁ y no dentro de un archivo de test. Dentro de
// jsdom, asignar `process.env.TZ` en caliente NO surte efecto (el contexto ya
// tiene su Date con la zona cacheada, verificado); la zona hay que fijarla
// antes de que jest cree sus workers, y este archivo se evalúa antes.
process.env.TZ = process.env.TZ || 'America/Guatemala'

const createJestConfig = nextJest({ dir: './' })

module.exports = createJestConfig({
  testEnvironment: 'jest-environment-jsdom',
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
})
