// La MEMORIA por semana de un grupo de amigos. Módulo puro.
//
// Sin esto, un grupo solo sabía cómo va HOY. La tabla de posiciones no podía
// decir si subiste o bajaste, ni quién viene liderando, y el correo semanal lo
// declaraba explícitamente: "no se afirma ningún movimiento de posición, porque
// eso exige memoria por semana que hoy no existe y compararse contra nada sería
// un dato con cara de dato" (FASE LR, con un test que prohibía esas frases).
// Esto es esa memoria.
//
// Vive en `friendGroups/{groupId}/history/{weekKey}`, o sea una subcolección de
// una colección TOP-LEVEL que firestore.rules deja en default-deny: el navegador
// no la puede leer y todo acceso pasa por el Admin SDK, igual que el resto de
// Amigos.
//
// Privacidad: se guarda lo MISMO que ya se publica (nombre, porcentajes,
// puesto), jamás un monto. Es una foto de lo que el grupo ya veía esa semana.

// La llave es el DOMINGO de esa semana, en UTC, para que dos corridas del mismo
// fin de semana escriban el mismo doc en vez de dos. El cron corre en domingo,
// así que normalmente es la fecha de hoy; normalizarlo igual hace que una
// corrida tardía (un lunes, un reintento manual) caiga en la semana correcta.
export function weekKeyFor(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

// Qué se guarda de cada fila. Deliberadamente MENOS que lo que la pantalla
// muestra: sin movers (son de una sesión, no de la semana) y sin `dayAsOf`
// (describe un dato que ya no vamos a mostrar). El nombre SÍ se guarda, para
// que la historia siga siendo legible aunque esa persona deje el grupo.
export function historyRow(r) {
  return {
    uid: r.uid,
    displayName: r.displayName || 'Anónimo',
    ytd: r.ytd ?? null,
    mtd: r.mtd ?? null,
    rank: r.rank ?? null,
  }
}

export function buildSnapshot({ group, standings, now = new Date() }) {
  return {
    weekKey: weekKeyFor(now),
    takenAt: now.toISOString(),
    groupId: group?.id || null,
    scope: standings?.scope || 'all',
    memberCount: standings?.memberCount ?? null,
    rows: (standings?.rows || []).map(historyRow),
  }
}

// ⛔ EL MOVIMIENTO SE MIDE SOBRE LA MISMA GENTE, y esa es la decisión que hace
// que la frase sea cierta.
//
// Si alguien SE VA del grupo, todos los que estaban debajo suben un puesto sin
// haber hecho nada: comparar el puesto crudo de una semana contra el de la otra
// fabricaría un ascenso que nadie se ganó. Lo mismo al revés cuando alguien
// entra o publica por primera vez. Así que las dos posiciones se recalculan
// sobre la INTERSECCIÓN de quienes tenían número en AMBAS semanas, y entonces
// "subiste dos puestos" significa exactamente "pasaste a dos personas que
// también estaban la semana pasada", pase lo que pase con el resto.
//
// Y solo se afirma con número en las dos puntas: sin el de antes no hay contra
// qué comparar, y "entraste al ranking" no es un movimiento.
export function withMovement({ rows = [], previous = null } = {}) {
  const prevRows = previous?.rows || []
  const prevRanked = new Map(prevRows.filter((r) => r.ytd != null).map((r) => [r.uid, r]))
  const nowRanked = rows.filter((r) => r.ytd != null && prevRanked.has(r.uid))

  // Posición dentro del conjunto compartido, en las dos semanas.
  const posIn = (list) => {
    const m = new Map()
    list.slice().sort((a, b) => (b.ytd ?? -Infinity) - (a.ytd ?? -Infinity))
      .forEach((r, i) => m.set(r.uid, i + 1))
    return m
  }
  const posNow = posIn(nowRanked)
  const posPrev = posIn(nowRanked.map((r) => prevRanked.get(r.uid)))

  return rows.map((r) => {
    const a = posPrev.get(r.uid)
    const b = posNow.get(r.uid)
    if (a == null || b == null) return { ...r, rankDelta: null, previousWeek: null }
    // Puesto 1 es el mejor, así que bajar de número es SUBIR de posición.
    return { ...r, rankDelta: a - b, previousWeek: previous?.weekKey || null }
  })
}

// Cuántas semanas seguidas viene liderando la misma persona, contando desde la
// foto más reciente hacia atrás. Null cuando no hay al menos dos fotos: con una
// sola, "viene liderando" no dice nada que la tabla de hoy no diga ya.
//
// `snapshots` llega ordenado de la más NUEVA a la más vieja.
export function leaderStreak(snapshots = []) {
  const leaders = snapshots.map((s) => (s.rows || []).find((r) => r.rank === 1) || null)
  if (leaders.length < 2 || !leaders[0]) return null
  let weeks = 1
  for (let i = 1; i < leaders.length; i++) {
    if (!leaders[i] || leaders[i].uid !== leaders[0].uid) break
    weeks++
  }
  if (weeks < 2) return null
  return { uid: leaders[0].uid, displayName: leaders[0].displayName, weeks }
}
