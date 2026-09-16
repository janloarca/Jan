// Qué se publica a Amigos, y cuándo. Módulo puro.
//
// ⛔ POR QUÉ EXISTE: hasta hoy los números de una persona se publicaban SOLO al
// abrir /friends. Quien no entra a esa pantalla en un mes deja su fila congelada
// en la foto de hace un mes, y el resto del grupo la sigue viendo rankeada al
// lado de filas de hoy. O sea el ranking comparaba gente medida en días
// distintos sin decirlo: la fila más vieja no se ve distinta de la más fresca,
// solo se ve peor o mejor. Ahora el tablero (la pantalla donde la gente sí entra
// a diario) publica una vez por día, así que todas las filas del grupo son del
// mismo día por construcción.
//
// El armado del payload vive acá y NO en la pantalla porque ahora hay DOS
// superficies que publican, y dos copias de "qué se publica" es exactamente cómo
// una se queda atrás (la lección que este repo ya tiene escrita para `InfoTip`,
// `lib/transferTx.js` y la lista de códigos ISO). Si escribieran distinto, la
// misma persona tendría dos formas de fila según por qué puerta pasó.
//
// El contrato de privacidad NO se mueve: todo lo que sale de acá lo arma
// `buildFriendStats`, que solo emite porcentajes y símbolos, jamás montos.

import { buildFriendStats } from '@/lib/friendsStats'
import { hasDemoData } from '@/lib/demoData'

// La unidad de la cadencia es el DÍA UTC, la misma que usa el backfill diario
// (`useDashboardData`). UTC y no local a propósito: es la convención de todo
// corte de fecha del repo, y con hora local una pestaña abierta cruzando
// medianoche republicaría según la zona del datacenter en vez de la del usuario.
export function publishDayKey(nowTs = Date.now()) {
  return new Date(nowTs).toISOString().slice(0, 10)
}

// Solo se publica una vez por día. `lastDay` es lo que quedó guardado en
// settings, así que la cadencia sobrevive a recargas Y a cambiar de dispositivo:
// un ref de sesión solo protege de republicar dentro de la misma pestaña.
export function shouldPublishToday({ lastDay, nowTs = Date.now() } = {}) {
  return publishDayKey(nowTs) !== (lastDay || null)
}

// ⛔ CUÁNDO ES SEGURO PUBLICAR, en UNA sola definición.
//
// Publicar un número EQUIVOCADO es peor que publicar uno viejo, porque acá el
// número lo leen OTRAS personas y queda rankeado al lado de los suyos. Estas son
// las mismas compuertas que usan los cuatro escritores de snapshots
// (`useDashboardData`), y por la misma razón:
//
//   - `ratesLoading`: sin tasas, `convert` devuelve el monto CRUDO, así que una
//     cartera en quetzales publica movers calculados 1:1 (FASE JA3).
//   - `ytdResolved`: el ancla del año todavía reconstruyéndose, o sea un YTD que
//     aún no es cierto.
//   - `bulkWriting` / `ibkrAutoSyncing`: un import masivo escribe en lotes y el
//     listener entrega cada estado INTERMEDIO, así que el portafolio se ve a
//     medias o duplicado (FASE GB, el mecanismo que produjo la meseta de $35K).
//
// Vive acá y no en cada pantalla porque hay DOS superficies que publican y las
// dos tienen que decidir igual: la lista literal ya había divergido una vez (el
// tablero se olvidó de las dos últimas mientras su propio comentario afirmaba
// que eran las mismas, y /friends no miraba ninguna).
//   - `scopedView` (FASE OG): el tablero con un portafolio o una entidad
//     seleccionados mide un SUBCONJUNTO, y lo que se publica se lee como "tu
//     retorno". /friends siempre corre sin scope y lo pasa en falso.
export const PUBLISH_GATES = [
  'dataLoading', 'pricesLoading', 'pricesFetching', 'ratesLoading',
  'bulkWriting', 'ibkrAutoSyncing', 'scopedView',
]

// Devuelve el NOMBRE de la primera compuerta cerrada, o null si se puede
// publicar. Devolver el nombre y no un booleano es a propósito: es lo que
// permite decirle al usuario por qué su toque no publicó todavía, en vez de
// dejarlo mirando un botón que no hace nada.
export function publishBlockedBy(state = {}) {
  for (const k of PUBLISH_GATES) if (state[k]) return k
  // `ytdResolved` va aparte porque es la única que bloquea cuando es FALSA.
  if (!state.ytdResolved) return 'ytdResolved'
  return null
}

// Cómo te ves en la lista. Misma cascada que ya usaba /friends; se comparte para
// que el tablero no publique un nombre distinto del que la pantalla muestra.
export function publishIdentity({ profile, user } = {}) {
  const displayName = profile?.name
    || user?.displayName
    || (user?.email ? String(user.email).split('@')[0] : 'Anónimo')
  return { displayName, avatar: (displayName || '?').trim().charAt(0).toUpperCase() }
}

// El bloque por alcance. El bloque `ibkr` usa los retornos ESCOPADOS al broker
// (NAV y flujos del broker), no los del portafolio completo, para que un grupo
// "Solo IBKR" compare esa cuenta sola.
export function buildPublishStats({
  enrichedItems, returnYTD, returnMTD, dailyChange, totalAssets,
  ibkrReturnYTD, ibkrReturnMTD, ibkrDayChange,
} = {}) {
  const items = Array.isArray(enrichedItems) ? enrichedItems : []
  const all = buildFriendStats({ enrichedItems: items, returnYTD, returnMTD, dailyChange, totalAssets })
  const out = { all }
  if (items.some((it) => it && it._source === 'ibkr')) {
    out.ibkr = buildFriendStats({
      enrichedItems: items,
      returnYTD: ibkrReturnYTD, returnMTD: ibkrReturnMTD, dailyChange: ibkrDayChange,
      scopeFilter: (it) => it._source === 'ibkr',
    })
  }
  return out
}

// ¿Hay algo que publicar? Una cartera vacía no tiene nada que decir, y publicar
// una fila de puros "-" la mete al ranking como si participara.
//
// Ojo: `buildFriendStats` SIEMPRE devuelve un objeto (nunca null), así que la
// pregunta real es si ese objeto trae alguna cifra medible.
export function hasSomethingToPublish({ stats, enrichedItems } = {}) {
  // ⛔ Con datos de DEMO presentes no se publica NADA, y filtrar los items no
  // alcanza: los retornos (YTD/MTD/día) llegan ya calculados sobre el conjunto
  // COMPLETO, así que un solo item de ejemplo contamina la cifra entera. El
  // modo demo promete "cero side-effects persistentes" (lib/demoData.js) y ya
  // veta snapshots y dividendos; publicarle a un grupo de amigos un ranking
  // con dinero inventado es el side-effect que faltaba vetar, y es el peor:
  // lo leen otras personas.
  if (hasDemoData(enrichedItems)) return false
  const all = stats?.all
  if (!all) return false
  if ((Array.isArray(enrichedItems) ? enrichedItems.length : 0) > 0) return true
  return all.ytd != null || all.day != null || (all.movers?.length || 0) > 0
}

// El payload completo, o null cuando no hay nada que publicar. Es lo que las dos
// superficies le mandan a `action: 'sync'`.
export function buildPublishPayload(input = {}) {
  const stats = buildPublishStats(input)
  if (!hasSomethingToPublish({ stats, enrichedItems: input.enrichedItems })) return null
  const { displayName, avatar } = publishIdentity(input)
  return { displayName, avatar, stats }
}
