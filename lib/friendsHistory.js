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
  const shared = rows.filter((r) => r.ytd != null && prevRanked.has(r.uid))

  // ⛔ Se cuenta A CUÁNTAS PERSONAS PASASTE, que es literalmente lo que la
  // frase del correo dice, y NO una resta de puestos.
  //
  // Restar puestos parece equivalente y no lo es en un EMPATE: si estabas 2º y
  // alcanzaste al 1º, tu puesto mejora de 2 a 1 sin que hayas adelantado a
  // nadie, y el correo terminaba diciendo "pasaste a una persona" en el mismo
  // cuerpo donde la tabla los muestra a los dos en el primer puesto. Con la
  // versión anterior (puestos estrictamente distintos, i+1) era peor todavía:
  // el desempate lo decidía el ORDEN DEL ARREGLO, así que dos personas
  // empatadas recibían el mismo domingo correos que se contradecían.
  //
  // "Pasar" exige orden ESTRICTO en las dos puntas: estaba arriba y ahora está
  // abajo. Un empate no cuenta en ninguna dirección, que es la verdad.
  const prevOf = (uid) => prevRanked.get(uid).ytd

  return rows.map((r) => {
    if (r.ytd == null || !prevRanked.has(r.uid)) return { ...r, rankDelta: null, previousWeek: null }
    let passed = 0
    let passedBy = 0
    for (const o of shared) {
      if (o.uid === r.uid) continue
      if (prevOf(o.uid) > prevOf(r.uid) && o.ytd < r.ytd) passed++
      if (prevOf(o.uid) < prevOf(r.uid) && o.ytd > r.ytd) passedBy++
    }
    return { ...r, rankDelta: passed - passedBy, previousWeek: previous?.weekKey || null }
  })
}

// Cuántas semanas SEGUIDAS viene liderando la misma persona, contando desde la
// foto más reciente hacia atrás. Null cuando no hay al menos dos fotos: con una
// sola, "viene liderando" no dice nada que la tabla de hoy no diga ya.
//
// `snapshots` llega ordenado de la más NUEVA a la más vieja, y el caller tiene
// que incluir la semana EN CURSO: la frase se imprime al lado de la tabla de
// HOY, así que una racha calculada solo con fotos pasadas puede nombrar al
// líder anterior mientras la tabla muestra a otro.
//
// ⛔ Las semanas tienen que ser CONTIGUAS. `snapshotAllGroups` salta los grupos
// que esa semana tenían menos de dos personas con número, y los que fallaron,
// así que la historia puede tener huecos: dos fotos separadas por tres meses
// producían "ha liderado 2 semanas seguidas", y la palabra que se usa es
// justamente "seguidas". Es el mismo cuidado que `movementSentence` ya tenía al
// NOMBRAR la semana comparada en vez de decir "la semana pasada".
export function leaderStreak(snapshots = []) {
  const leaders = snapshots.map((s) => ({
    who: (s?.rows || []).find((r) => r.rank === 1) || null,
    weekKey: s?.weekKey || null,
  }))
  if (leaders.length < 2 || !leaders[0].who) return null
  let weeks = 1
  for (let i = 1; i < leaders.length; i++) {
    const prev = leaders[i]
    if (!prev.who || prev.who.uid !== leaders[0].who.uid) break
    if (!isPreviousWeek(prev.weekKey, leaders[i - 1].weekKey)) break
    weeks++
  }
  if (weeks < 2) return null
  return { uid: leaders[0].who.uid, displayName: leaders[0].who.displayName, weeks }
}

// ¿`older` es exactamente la semana anterior a `newer`? Siete días en UTC entre
// dos llaves de domingo. Sin las dos fechas no se puede afirmar contigüidad, así
// que se rehúsa: cortar la racha es el lado correcto del error, porque el que
// sobra afirma un "seguidas" que nadie verificó.
function isPreviousWeek(older, newer) {
  const a = Date.parse(`${older}T00:00:00Z`)
  const b = Date.parse(`${newer}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return b - a === 7 * 86400000
}
