// La TABLA de un grupo de amigos: quién va dónde, con qué número y de cuándo.
//
// ⛔ POR QUÉ ES COMPARTIDA. Esta forma la producían dos superficies: la acción
// `list` de app/api/friends/route.js (la pantalla) y, desde FASE LR, el correo
// semanal del grupo. Con dos copias, el correo del domingo y la pantalla del
// lunes podrían ordenar distinto, o decidir distinto qué es "sin datos", sobre
// los MISMOS perfiles. Es la enfermedad que este repo ya documenta para
// `InfoTip`, `lib/transferTx.js` y la lista de códigos ISO.
//
// El contrato de privacidad NO se mueve: acá solo entran porcentajes, símbolos
// y fechas, que es exactamente lo que `lib/friendsStats.js` publica. Ningún
// monto pasa por este módulo.

import { publicMovers } from '@/lib/friendsStats'

// El bloque que le corresponde al ALCANCE del grupo, y nunca un respaldo.
//
// Un grupo "Solo IBKR" promete comparar esa cuenta sola. Caer al bloque `all`
// cuando alguien no tiene broker hace dos daños a la vez: la comparación deja
// de ser la que el grupo dice ser (una cuenta de broker contra un patrimonio
// entero) y esa persona publica MÁS de lo que aceptó al entrar. Sin bloque para
// el alcance no hay fila con cifras, y eso se DICE (`outOfScope`).
export function statsForScope(profile, scope) {
  const stats = profile?.stats || {}
  if (scope === 'ibkr') return stats.ibkr || null
  return stats.all || null
}

// Hace cuántos días se publicó esa fila. Null cuando no se sabe: "no tengo la
// fecha" y "se publicó hoy" son cosas distintas y no pueden verse iguales.
export function staleDaysOf(updatedAt, nowTs) {
  if (!updatedAt) return null
  const ts = Date.parse(updatedAt)
  if (!Number.isFinite(ts)) return null
  const days = Math.floor((nowTs - ts) / 86400000)
  return days >= 0 ? days : 0
}

// A partir de cuántos días una fila deja de describir el presente. Ocho y no
// siete: desde FASE LN el tablero publica una vez por día, así que una fila
// sana se refresca sola; pasada una semana entera sin publicar, el número ya no
// es de esta comparación y hay que decirlo en vez de rankearlo callado.
export const STALE_AFTER_DAYS = 8

// Ranking de COMPETENCIA: dos empatados reciben el MISMO puesto y el siguiente
// salta (1, 1, 3). Extraído para poder correrlo por métrica, y porque
// `lib/friendsHistory.js` tenía su propia versión con puestos estrictamente
// distintos (i+1) que no coincidía con esta: en un empate el desempate lo
// decidía el orden del arreglo, así que el correo llegaba a decir "pasaste a
// una persona" con las dos en el mismo puesto de la tabla de al lado.
//
// Ordena una COPIA por la métrica en vez de asumir que el arreglo ya lo está:
// las filas llegan ordenadas por YTD, así que rankear `mtd` sobre ese orden
// repartiría los puestos del año con la etiqueta del mes.
export function assignRanks(rows, metric, field) {
  const ordered = [...rows].sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity))
  let rank = 0
  let seen = 0
  let prev = null
  for (const r of ordered) {
    if (r[metric] == null) { r[field] = null; continue }
    seen++
    if (prev === null || r[metric] !== prev) rank = seen
    prev = r[metric]
    r[field] = rank
  }
  return rows
}

/**
 * La tabla de un grupo.
 *
 * @param {object}   group      El doc de friendGroups (necesita `scope` y `memberUids`).
 * @param {Array}    profiles   [{ uid, profile }] de los perfiles que EXISTEN.
 * @param {string}   viewerUid  Para marcar cuál fila es la de quien mira.
 * @param {number}   nowTs      Para medir la frescura de cada fila.
 * @returns {{ scope, memberCount, pendingCount, rows }}
 */
export function groupStandings({ group, profiles = [], viewerUid = null, nowTs = Date.now() } = {}) {
  const scope = group?.scope || 'all'
  const memberUids = Array.isArray(group?.memberUids) ? group.memberUids : []

  const rows = profiles
    .filter((p) => p && p.profile)
    .map(({ uid, profile }) => {
      const scoped = statsForScope(profile, scope)
      const st = scoped || {}
      const updatedAt = st.updatedAt || profile.updatedAt || null
      return {
        uid,
        isYou: uid === viewerUid,
        displayName: profile.displayName || 'Anónimo',
        avatar: profile.avatar || '',
        verified: !!profile.verified,
        outOfScope: !scoped,
        ytd: st.ytd ?? null,
        mtd: st.mtd ?? null,
        day: st.day ?? null,
        // Se limpia también al LEER, no solo al escribir: todo perfil ya
        // publicado tiene `impactPct` guardado, y devolverlo tal cual dejaría
        // la fuga abierta hasta que cada persona vuelva a publicar.
        movers: publicMovers(st.movers),
        // De qué sesión son `day` y `movers` de ESTA persona. Dos miembros del
        // mismo grupo pueden tenerla distinta (quien solo tiene cripto mide
        // 24 h rodantes y nunca queda congelado; quien tiene acciones sí).
        dayAsOf: st.dayAsOf || null,
        updatedAt,
        staleDays: staleDaysOf(updatedAt, nowTs),
      }
    })
    .sort((a, b) => (b.ytd ?? -Infinity) - (a.ytd ?? -Infinity))

  // Puesto SOLO para quien tiene número. Una fila sin cifra no está última, no
  // está en la carrera, y darle un puesto la haría ver como si hubiera perdido.
  // Empates con ranking de competencia (dos primeros, después un tercero).
  //
  // ⛔ Se calcula para las DOS métricas publicables, y no solo para el año.
  // La pantalla tiene un selector "Año / Este mes" que REORDENA las filas por
  // la métrica elegida, pero el número, la medalla y la corona salían de un
  // `rank` que siempre era el del AÑO: con "Este mes" la lista se leía 2, 1, 3,
  // la corona marcaba al líder del año aunque no estuviera arriba, y quien
  // tenía mes publicado y año no salía primero mostrando un guión de puesto.
  // El campo se emitía sin decir de qué métrica era, y el consumidor lo tomó
  // como "el puesto" a secas.
  assignRanks(rows, 'ytd', 'rank')
  assignRanks(rows, 'mtd', 'rankMtd')

  return {
    scope,
    memberCount: memberUids.length,
    // Cuántos entraron al grupo y todavía no publican nada. Sin decirlo, la
    // tarjeta anunciaba "5 miembros" y mostraba 3 sin explicar los otros dos, y
    // desde afuera una fila que falta y una tabla rota se ven igual.
    pendingCount: Math.max(0, memberUids.length - rows.length),
    rows,
  }
}

// Cuántas filas de este grupo tienen de verdad un número comparable. Es lo que
// decide si vale la pena mandar un correo de posiciones: una tabla de una sola
// persona no es una comparación.
export function rankedCount(rows) {
  return (rows || []).filter((r) => r.ytd != null).length
}
