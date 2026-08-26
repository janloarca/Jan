import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { getAdminDb } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import crypto from 'crypto'
import { sanitizeDayAsOf, boundedPct, publicMovers } from '@/lib/friendsStats'
import { brokerVerification } from '@/lib/friendsVerified'

// Social layer: friend groups + a YTD-return leaderboard. Like shareTokens, the
// data lives in TOP-LEVEL collections that firestore.rules leaves default-deny,
// so the browser can never read another user's row — every access goes through
// this Admin-SDK route behind verifyAuth. The cardinal privacy rule: only
// percentages and symbols are ever stored/returned — NEVER money amounts.
//
// friendProfiles/{uid}: { uid, displayName, avatar, globalOptIn, pseudonym,
//   stats: { all: {ytd, day, movers[], updatedAt}, ibkr?: {...} }, updatedAt }
// friendGroups/{groupId}: { id, name, ownerUid, inviteCode, scope:'all'|'ibkr',
//   memberUids: string[], createdAt }

const MAX_GROUPS_PER_USER = 20
const MAX_MEMBERS = 30
const MAX_MOVERS = 5
const GLOBAL_SCAN_CAP = 500
const GLOBAL_TOP = 20
// La insignia "sincronizado" ya NO sale de nada que mande el cliente: se deriva
// de los vaults de broker, cuyo `lastSync` lo estampa la ruta del propio broker
// al terminar un sync exitoso. Ver lib/friendsVerified.js.

// Human-friendly invite codes: no 0/O/1/I/L to avoid transcription errors.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function genCode(len = 7) {
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return s
}

const PSEUDO_ADJ = ['Audaz', 'Sereno', 'Veloz', 'Astuto', 'Noble', 'Intrépido', 'Sabio', 'Ágil', 'Valiente', 'Tranquilo']
const PSEUDO_NOUN = ['Quetzal', 'Jaguar', 'Colibrí', 'Tucán', 'Puma', 'Cóndor', 'Ocelote', 'Guacamayo', 'Venado', 'Búho']
function genPseudonym() {
  const a = PSEUDO_ADJ[crypto.randomBytes(1)[0] % PSEUDO_ADJ.length]
  const n = PSEUDO_NOUN[crypto.randomBytes(1)[0] % PSEUDO_NOUN.length]
  const num = crypto.randomBytes(1)[0] % 100
  return `${n} ${a} ${num}`
}

// El acotado vive en lib/friendsStats.js y se IMPORTA, no se re-escribe: es la
// misma regla del lado del productor y del validador, y dos copias es como una
// se queda atrás (lo mismo que ya se hizo con sanitizeDayAsOf). Acá tenía su
// propia copia, así que al cambiar "clampear" por "descartar fuera de banda"
// habría quedado el servidor saturando lo que el cliente ya rechazaba.

// Server-side re-validation of the stats the client publishes — the client is
// untrusted, so every number goes through the shared band and anything
// amount-shaped is stripped.
function sanitizeStatBlock(raw) {
  if (!raw || typeof raw !== 'object') return null
  // ⛔ FASE JA6. `impactPct` NO se guarda. Junto al cambio de la posición dejaba
  // despejar su peso en el portafolio con una división. El orden de la lista lo
  // decide el cliente y se conserva tal cual, así que quitar el campo no cuesta
  // el ranking. Ver lib/friendsStats.js.
  const movers = publicMovers(raw.movers)
  return {
    ytd: boundedPct(raw.ytd), mtd: boundedPct(raw.mtd), day: boundedPct(raw.day), movers,
    // FASE KO: de qué SESIÓN bursátil son `day` y `movers`. Un sábado, las
    // acciones traen el movimiento del viernes, así que sin esto el grupo
    // rankeaba "hoy" sobre datos de otra sesión. Es lo que manda el cliente y
    // el cliente no es de fiar, así que se acepta SOLO la forma exacta
    // 'YYYY-MM-DD' y nada más: una cadena arbitraria se descarta.
    dayAsOf: sanitizeDayAsOf(raw.dayAsOf),
    updatedAt: new Date().toISOString(),
  }
}

// Un grupo escopado NUNCA cae al portafolio completo.
//
// FASE JA5. Esto hacía `(scope === 'ibkr' && stats.ibkr) ? stats.ibkr :
// stats.all`, o sea un miembro SIN broker conectado dentro de un grupo "Solo
// IBKR" publicaba el retorno de TODO su portafolio, en silencio. Dos daños a la
// vez: la comparación deja de ser la que el grupo dice ser (una cuenta de
// broker contra un patrimonio entero), y esa persona está publicando MÁS de lo
// que aceptó al entrar a un grupo cuyo rótulo prometía que solo se comparte la
// cuenta del broker. Sin bloque para el alcance del grupo no se publica nada:
// la fila queda sin cifras y la tarjeta dice por qué.
function statsForScope(profile, scope) {
  const stats = profile?.stats || {}
  if (scope === 'ibkr') return stats.ibkr || null
  return stats.all || null
}

async function readGroup(db, groupId) {
  const doc = await db.collection('friendGroups').doc(groupId).get()
  return doc.exists ? { ...doc.data(), id: doc.id } : null
}

export async function POST(request) {
  const { limited } = await rateLimit(request, { maxRequests: 40 })
  if (limited) return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })

  const { uid, error } = await verifyAuth(request)
  if (error) return error

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { action } = body || {}

  try {
    const profileRef = db.collection('friendProfiles').doc(uid)

    // ---- sync: publish my public stats + display meta ------------------------
    if (action === 'sync') {
      const all = sanitizeStatBlock(body.stats?.all)
      if (!all) return NextResponse.json({ error: 'Missing stats', code: 'missing_stats' }, { status: 400 })
      const ibkr = sanitizeStatBlock(body.stats?.ibkr)

      // La insignia se decide acá, con lo que el servidor SÍ es dueño de saber.
      // Antes salía de `body.syncedPct`, o sea el cliente se la auto-otorgaba
      // mandando un 1; y no le habla al usuario, le habla a sus amigos. Una
      // sola lectura de la subcolección trae todos los vaults de broker de una
      // (`settings` tiene un puñado de docs: preferences, profile, ingest y los
      // vaults), en vez del pipeline completo que costaría recalcular el
      // porcentaje real.
      let verification = { verified: false }
      try {
        const settingsSnap = await db.collection('users').doc(uid).collection('settings').get()
        verification = brokerVerification(settingsSnap.docs.map((d) => ({ id: d.id, data: d.data() })))
      } catch (err) {
        // Best-effort: un fallo de lectura no puede impedir publicar tus
        // números. Sin insignia es el lado correcto del error.
        console.error('[api/friends] verification read error:', err.message)
      }

      const update = {
        uid,
        displayName: String(body.displayName || '').slice(0, 40) || 'Anónimo',
        avatar: String(body.avatar || '').slice(0, 8),
        stats: ibkr ? { all, ibkr } : { all },
        // Señal de confianza: tiene un broker conectado y sincronizando. Nada
        // de esto viene del cuerpo, así que ya no se puede auto-otorgar.
        //
        // `syncedPct` se quita: era auto-reportado y NINGUNA superficie lo
        // leía, o sea el patrón "se escribe y nadie lo lee" que este archivo ya
        // documenta. Un doc viejo lo conserva hasta la próxima publicación de
        // esa persona; no sale a ningún lado.
        verified: verification.verified,
        updatedAt: new Date().toISOString(),
      }
      await profileRef.set(update, { merge: true })
      // Se devuelve para que la pantalla muestre lo que de verdad quedó
      // guardado, en vez de una copia local que podría no coincidir.
      return NextResponse.json({ ok: true, verified: update.verified })
    }

    // ---- list: my groups + each group's leaderboard --------------------------
    if (action === 'list') {
      const snap = await db.collection('friendGroups').where('memberUids', 'array-contains', uid).get()
      const groups = []
      for (const gd of snap.docs) {
        const g = { id: gd.id, ...gd.data() }
        const memberUids = Array.isArray(g.memberUids) ? g.memberUids.slice(0, MAX_MEMBERS) : []
        // getAll en vez de N .get() sueltos: con 20 grupos de 30 miembros esto
        // pasaba de 600 lecturas por llamada, y desde que la pantalla tiene
        // jalar-para-refrescar se puede pedir muchas veces seguidas. Esta app ya
        // tocó el techo de cuota de Firestore en producción (FASE IE9).
        // ⚠️ getAll() SIN argumentos lanza (validateMinNumberOfArguments), así
        // que un grupo sin miembros tiene que cortocircuitar.
        const profs = memberUids.length === 0
          ? []
          : await db.getAll(...memberUids.map((m) => db.collection('friendProfiles').doc(m)))
        const rows = profs.filter((p) => p.exists).map((p) => {
          const prof = p.data()
          const scoped = statsForScope(prof, g.scope)
          const st = scoped || {}
          return {
            uid: p.id,
            isYou: p.id === uid,
            displayName: prof.displayName || 'Anónimo',
            avatar: prof.avatar || '',
            verified: !!prof.verified,
            // Sin datos para el alcance del grupo: la fila existe (la persona
            // ESTÁ en el grupo) pero no tiene cifras, y hay que decir por qué o
            // se lee igual que una tarjeta rota. Nunca se sustituye por el
            // portafolio completo, ver statsForScope.
            outOfScope: !scoped,
            ytd: st.ytd ?? null,
            mtd: st.mtd ?? null,
            day: st.day ?? null,
            // Se limpia también al LEER, no solo al escribir. Todo perfil ya
            // publicado tiene `impactPct` guardado, y devolverlo tal cual
            // dejaría la fuga abierta hasta que cada persona vuelva a publicar
            // por su cuenta: un arreglo que solo cambia lo que se escribe de
            // aquí en adelante no cierra nada hoy. El campo viejo se queda en
            // Firestore hasta el próximo sync de esa persona, pero ya no sale.
            movers: publicMovers(st.movers),
            // FASE KO: de qué sesión son `day` y `movers` de ESTA persona. Dos
            // miembros del mismo grupo pueden tenerla distinta (quien solo tiene
            // cripto mide 24 h rodantes y nunca queda congelado; quien tiene
            // acciones sí), así que viaja por fila, no por grupo.
            dayAsOf: st.dayAsOf || null,
            updatedAt: st.updatedAt || prof.updatedAt || null,
          }
        }).sort((a, b) => (b.ytd ?? -Infinity) - (a.ytd ?? -Infinity))
        groups.push({
          id: g.id, name: g.name, scope: g.scope || 'all',
          inviteCode: g.inviteCode, isOwner: g.ownerUid === uid,
          memberCount: memberUids.length,
          // Cuántos entraron al grupo y todavía no publican nada. `rows` sale de
          // los perfiles que EXISTEN, así que la tarjeta decía "5 miembros" y
          // mostraba 3 sin explicar los otros dos: desde afuera, una fila que
          // falta y una tarjeta rota se ven igual. Con el número dicho, es un
          // dato ("2 aún no publican") en vez de un hueco.
          pendingCount: Math.max(0, memberUids.length - rows.length),
          rows,
        })
      }
      groups.sort((a, b) => a.name.localeCompare(b.name))
      return NextResponse.json({ groups })
    }

    // ---- create-group --------------------------------------------------------
    if (action === 'create-group') {
      const name = String(body.name || '').slice(0, 40).trim()
      if (!name) return NextResponse.json({ error: 'Name required', code: 'name_required' }, { status: 400 })
      const scope = body.scope === 'ibkr' ? 'ibkr' : 'all'
      const owned = await db.collection('friendGroups').where('ownerUid', '==', uid).get()
      if (owned.size >= MAX_GROUPS_PER_USER) {
        return NextResponse.json({ error: `Max ${MAX_GROUPS_PER_USER} groups`, code: 'max_groups' }, { status: 400 })
      }
      const groupId = crypto.randomBytes(12).toString('hex')
      const inviteCode = genCode()
      const group = { id: groupId, name, ownerUid: uid, inviteCode, scope, memberUids: [uid], createdAt: new Date().toISOString() }
      await db.collection('friendGroups').doc(groupId).set(group)
      return NextResponse.json({ group: { id: groupId, name, scope, inviteCode, isOwner: true, memberCount: 1, rows: [] } })
    }

    // ---- join: enforce the member cap atomically -----------------------------
    if (action === 'join') {
      const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (!code) return NextResponse.json({ error: 'Code required', code: 'code_required' }, { status: 400 })
      const snap = await db.collection('friendGroups').where('inviteCode', '==', code).limit(1).get()
      if (snap.empty) return NextResponse.json({ error: 'Invalid code', code: 'invalid_code' }, { status: 404 })
      const groupRef = snap.docs[0].ref
      const result = await db.runTransaction(async (tx) => {
        const doc = await tx.get(groupRef)
        const g = doc.data()
        const members = Array.isArray(g.memberUids) ? g.memberUids : []
        if (members.includes(uid)) return { already: true, id: doc.id }
        if (members.length >= MAX_MEMBERS) return { full: true }
        tx.update(groupRef, { memberUids: [...members, uid] })
        return { id: doc.id }
      })
      if (result.full) return NextResponse.json({ error: 'Group is full', code: 'group_full' }, { status: 400 })
      return NextResponse.json({ ok: true, groupId: result.id })
    }

    // ---- leave: owner leaving transfers ownership, or deletes if last --------
    if (action === 'leave' || action === 'kick') {
      const groupId = String(body.groupId || '')
      const group = await readGroup(db, groupId)
      if (!group) return NextResponse.json({ error: 'Unknown group', code: 'group_gone' }, { status: 404 })
      const target = action === 'kick' ? String(body.uid || '') : uid
      if (action === 'kick' && group.ownerUid !== uid) {
        return NextResponse.json({ error: 'Only the owner can remove members', code: 'owner_only' }, { status: 403 })
      }
      const members = (group.memberUids || []).filter((m) => m !== target)
      const groupRef = db.collection('friendGroups').doc(groupId)
      if (members.length === 0) {
        await groupRef.delete()
      } else {
        const patch = { memberUids: members }
        if (group.ownerUid === target) patch.ownerUid = members[0] // transfer to oldest remaining
        await groupRef.update(patch)
      }
      return NextResponse.json({ ok: true })
    }

    // ---- rename / delete-group (owner only) ----------------------------------
    if (action === 'rename') {
      const groupId = String(body.groupId || '')
      const name = String(body.name || '').slice(0, 40).trim()
      if (!name) return NextResponse.json({ error: 'Name required', code: 'name_required' }, { status: 400 })
      const group = await readGroup(db, groupId)
      if (!group) return NextResponse.json({ error: 'Unknown group', code: 'group_gone' }, { status: 404 })
      if (group.ownerUid !== uid) return NextResponse.json({ error: 'Only the owner can rename', code: 'owner_only' }, { status: 403 })
      await db.collection('friendGroups').doc(groupId).update({ name })
      return NextResponse.json({ ok: true })
    }
    if (action === 'delete-group') {
      const groupId = String(body.groupId || '')
      const group = await readGroup(db, groupId)
      if (!group) return NextResponse.json({ error: 'Unknown group', code: 'group_gone' }, { status: 404 })
      if (group.ownerUid !== uid) return NextResponse.json({ error: 'Only the owner can delete' }, { status: 403 })
      await db.collection('friendGroups').doc(groupId).delete()
      return NextResponse.json({ ok: true })
    }

    // ---- global anonymous leaderboard ---------------------------------------
    if (action === 'global-optin') {
      const on = !!body.on
      const patch = { globalOptIn: on }
      if (on) {
        const cur = await profileRef.get()
        if (!cur.exists) return NextResponse.json({ error: 'Sync your profile first' }, { status: 400 })
        if (!cur.data().pseudonym) patch.pseudonym = String(body.pseudonym || '').slice(0, 30) || genPseudonym()
      }
      await profileRef.set(patch, { merge: true })
      return NextResponse.json({ ok: true, pseudonym: patch.pseudonym })
    }
    if (action === 'global') {
      // Qué métrica se rankea. El orden y el corte del top TIENEN que ocurrir
      // acá: la respuesta se recorta a GLOBAL_TOP, así que reordenar del lado
      // del cliente reordenaría una lista ya truncada por la otra métrica (los
      // primeros 20 del año no son los primeros 20 del mes). Sale UNA sola
      // métrica por respuesta, nunca las dos: menos de lo que ya se publicaba.
      const metric = body.metric === 'mtd' ? 'mtd' : 'ytd'
      // Anonymity: return ONLY pseudonym + the ranked % — never uid, movers, or symbols.
      const snap = await db.collection('friendProfiles').where('globalOptIn', '==', true).limit(GLOBAL_SCAN_CAP).get()
      const all = snap.docs.map((d) => {
        const p = d.data()
        return { uid: d.id, pseudonym: p.pseudonym || 'Anónimo', verified: !!p.verified, value: statsForScope(p, 'all')?.[metric] ?? null }
      }).filter((r) => r.value != null).sort((a, b) => b.value - a.value)
      const yourRank = all.findIndex((r) => r.uid === uid)
      const top = all.slice(0, GLOBAL_TOP).map((r, i) => ({ rank: i + 1, pseudonym: r.pseudonym, verified: r.verified, value: r.value, isYou: r.uid === uid }))
      // `optedIn` sale del PROPIO documento, no se deduce del ranking. El
      // cliente lo deducía de `yourRank != null`, y `yourRank` se calcula sobre
      // una lista ya filtrada por `ytd != null`: alguien que SÍ está apuntado
      // pero todavía no tiene YTD quedaba fuera, y el botón le decía
      // "Participar" cuando ya participaba. Es un booleano sobre uno mismo, así
      // que no abre ninguna ventana a los datos de nadie más.
      const mine = await profileRef.get()
      return NextResponse.json({
        top,
        metric,
        yourRank: yourRank >= 0 ? yourRank + 1 : null,
        total: all.length,
        optedIn: mine.exists ? !!mine.data().globalOptIn : false,
        // Cuándo publicaste por última vez. Viaja acá porque esta acción YA lee
        // tu propio documento para `optedIn`, así que cuesta CERO lecturas
        // extra, y esta app ya tocó el techo de cuota de Firestore en
        // producción (FASE IE9). Antes la pantalla lo sacaba de tu fila dentro
        // de un grupo, así que sin grupos nunca se veía: se leía un porcentaje
        // sin nada que dijera que es una foto quieta hasta que la republiques.
        yourUpdatedAt: mine.exists ? (mine.data().updatedAt || null) : null,
        // Tu propia insignia, por la misma razón y al mismo costo cero: ahora
        // la decide el servidor, así que el cliente ya no la puede derivar por
        // su cuenta y tiene que preguntarla.
        yourVerified: mine.exists ? !!mine.data().verified : false,
      })
    }

    // ---- disable: purge my public presence -----------------------------------
    if (action === 'disable') {
      const snap = await db.collection('friendGroups').where('memberUids', 'array-contains', uid).get()
      await Promise.all(snap.docs.map(async (gd) => {
        const g = gd.data()
        const members = (g.memberUids || []).filter((m) => m !== uid)
        if (members.length === 0) return gd.ref.delete()
        const patch = { memberUids: members }
        if (g.ownerUid === uid) patch.ownerUid = members[0]
        return gd.ref.update(patch)
      }))
      await profileRef.delete().catch(() => {})
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    console.error('[api/friends] error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
