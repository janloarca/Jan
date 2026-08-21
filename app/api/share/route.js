import { NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/apiAuth'
import { getAdminDb } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'
import { loadUserPortfolioContext, loadOwnerProfile } from '@/lib/briefContext'
import { buildReportData } from '@/lib/reportData'
import { buildSharePayload, sanitizeDisplay, sanitizeLang, sanitizeAdvisor, expiresAtFrom, shareTokenExpired } from '@/lib/sharePayload'
import { itemAnnualIncomeInBase } from '@/lib/serverPortfolio'
import { projectItemAnnualIncome } from '@/components/dashboard/utils'
import { kvGetJSON, kvSetJSON, kvDel } from '@/lib/kvClient'
import { publicInstrument, sanitizeInstrumentIds } from '@/lib/instrumentSheet'
import crypto from 'crypto'

// El GET cotiza posiciones de mercado, así que es más pesado que una lectura
// suelta de Firestore. Lección de FASE HJ/HK: declarar el presupuesto y
// preferir una respuesta parcial que LLEGA sobre una completa que nadie recibe.
export const maxDuration = 30

// Scoped share links: each link carries what it exposes — the whole portfolio,
// one entity, or a set of institutions (e.g. "just my IBKR"). Multiple links
// can coexist; revoking one never touches the others.
//
// settings/share doc: { links: [{ token, label, scope, createdAt }] }
// shareTokens/{token}: { uid, createdAt, scope, label } — GET resolves from here.
// scope: { type: 'all' } | { type: 'entity', entityId, entityName }
//        | { type: 'institutions', institutions: string[] }
// Legacy single-token docs ({ token, enabled }) are migrated on first 'list'.

const MAX_LINKS = 10

// TTL del caché del núcleo del payload (FASE KP). Corto a propósito: acota el
// desfase de las CIFRAS; revocar/expirar ganan siempre (el token doc se lee de
// Firestore primero) y etiqueta/asesor se releen frescos en cada GET.
const SHARE_CACHE_TTL_S = 600

function sanitizeScope(raw) {
  if (!raw || typeof raw !== 'object') return { type: 'all' }
  if (raw.type === 'entity') {
    const entityId = String(raw.entityId || '').slice(0, 60)
    if (!entityId) return null
    return { type: 'entity', entityId, entityName: String(raw.entityName || '').slice(0, 60) }
  }
  // FASE KK. El tablero escopa por portafolio activo
  // (`useDashboardData.js`: `(it.portfolioId || '__default__') === activePortfolio`)
  // y el link no tenía forma de hacer lo mismo: 'all' publicaba TODOS los items
  // de la cuenta, así que quien tiene más de un portafolio compartía algo que
  // él mismo no ve junto en ninguna pantalla.
  if (raw.type === 'portfolio') {
    const portfolioId = String(raw.portfolioId || '').slice(0, 60)
    if (!portfolioId) return null
    return { type: 'portfolio', portfolioId, portfolioName: String(raw.portfolioName || '').slice(0, 60) }
  }
  if (raw.type === 'institutions') {
    const institutions = Array.isArray(raw.institutions)
      ? raw.institutions.map((i) => String(i).slice(0, 60)).filter(Boolean).slice(0, 20)
      : []
    if (institutions.length === 0) return null
    return { type: 'institutions', institutions }
  }
  if (raw.type === 'all') return { type: 'all' }
  return null
}

// El predicado del alcance, con la MISMA regla de default que el tablero.
function scopeFilter(scope) {
  if (scope.type === 'entity') return (it) => (it.entityId || 'default') === scope.entityId
  if (scope.type === 'portfolio') return (it) => (it.portfolioId || '__default__') === scope.portfolioId
  if (scope.type === 'institutions') return (it) => scope.institutions.includes((it.institution || '').trim())
  return null
}

function scopeLabelOf(scope) {
  if (scope.type === 'entity') return scope.entityName || null
  if (scope.type === 'portfolio') return scope.portfolioName || null
  if (scope.type === 'institutions') return scope.institutions.join(' · ')
  return null
}

// La tarjeta de ingresos lista la TASA de cada fuente, que no es una cifra que
// el motor del reporte produzca (él da el total proyectado). Se arma de los
// items ya enriquecidos, con el mismo helper que usa el tablero para el monto.
function incomeSourcesOf(items, convert, baseCurrency) {
  return (items || [])
    .filter((it) => !it.isDebt && (it.incomeRate > 0 || it.dividendYield > 0 || (it.rateType === 'variable' && it.rateMin > 0)))
    .map((it) => ({
      name: it.name || it.symbol || '',
      rateLabel: it.rateType === 'variable' ? `${it.rateMin}-${it.rateMax}%` : `${it.incomeRate || it.dividendYield}%`,
      annual: itemAnnualIncomeInBase(it, { convert, baseCurrency, projectItemAnnualIncome }),
    }))
    .sort((a, b) => (b.annual || 0) - (a.annual || 0))
    .slice(0, 8)
}

// `maskAmounts` vivía acá: escalaba `quantity` y seis campos de precio por √k
// para que un link 'percent' conservara sus razones sin publicar los montos.
// Con el payload calculado (FASE KK) el enmascarado dejó de hacer falta: los
// montos no se emiten, punto. Menos código y una garantía más fuerte, porque
// ya no depende de que una transformación preserve exactamente los ratios
// correctos sobre CADA campo que alguien agregue después.

// Las fichas adjuntas se leen FRESCAS en cada GET, con o sin caché caliente
// (≤6 docs: el cap vive en sanitizeInstrumentIds): una corrección del asesor a
// su ficha no puede quedar 10 minutos detrás. Cada doc pasa por
// publicInstrument, la proyección ALLOWLIST: solo claves conocidas salen al
// público, y un doc ilegible simplemente no se muestra.
async function loadInstruments(db, uid, ids) {
  if (!ids.length) return []
  const reads = await Promise.all(ids.map(async (id) => {
    try {
      const doc = await db.doc(`users/${uid}/instruments/${id}`).get()
      if (!doc || !doc.exists) return null
      return publicInstrument({ id: doc.id, ...doc.data() })
    } catch {
      return null
    }
  }))
  return reads.filter(Boolean)
}

async function readLinks(shareRef, db, uid) {
  const doc = await shareRef.get()
  const data = doc.exists ? doc.data() : {}
  if (Array.isArray(data.links)) return data.links
  // Migrate the legacy single token into the links list (scope: everything).
  if (data.token) {
    const links = [{ token: data.token, label: 'Portafolio completo', scope: { type: 'all' }, createdAt: data.createdAt || new Date().toISOString() }]
    await shareRef.set({ links, uid, updatedAt: new Date().toISOString() })
    return links
  }
  return []
}

export async function POST(request) {
  const { uid, error } = await verifyAuth(request)
  if (error) return error

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { action } = body

  if (!action || !['list', 'create', 'revoke', 'update'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    const shareRef = db.collection('users').doc(uid).collection('settings').doc('share')

    if (action === 'list') {
      const links = await readLinks(shareRef, db, uid)
      return NextResponse.json({ links })
    }

    if (action === 'create') {
      const scope = sanitizeScope(body.scope)
      if (!scope) return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
      const links = await readLinks(shareRef, db, uid)
      if (links.length >= MAX_LINKS) {
        return NextResponse.json({ error: `Max ${MAX_LINKS} links` }, { status: 400 })
      }
      const label = String(body.label || '').slice(0, 40).trim() || 'Portafolio'
      const display = sanitizeDisplay(body.display)
      // FASE KP: idioma y vigencia se eligen AL CREAR y quedan inmutables (la
      // acción update no los toca). Vigencia indefinida por default: ausencia
      // de expiresAt = nunca vence.
      const lang = sanitizeLang(body.lang)
      const expiresAt = expiresAtFrom(body.expiry)
      const instrumentIds = sanitizeInstrumentIds(body.instrumentIds)
      const token = crypto.randomBytes(16).toString('hex')
      const link = {
        token, label, scope, display, lang, createdAt: new Date().toISOString(),
        ...(expiresAt ? { expiresAt } : {}),
        ...(instrumentIds.length ? { instrumentIds } : {}),
      }
      await db.collection('shareTokens').doc(token).set({
        uid, createdAt: link.createdAt, scope, label, display, lang,
        ...(expiresAt ? { expiresAt } : {}),
        ...(instrumentIds.length ? { instrumentIds } : {}),
      })
      await shareRef.set({ links: [...links, link], uid, updatedAt: new Date().toISOString() })
      return NextResponse.json({ link })
    }

    // Editar un link EXISTENTE: el workflow central del asesor es adjuntarle
    // una ficha nueva (o corregir la etiqueta) a un link que el cliente YA
    // tiene. Solo label y fichas son mutables: scope/display/lang/expiry
    // quedan fijos, porque ensanchar la exposición de un link ya enviado (más
    // alcance, más números) cambiaría lo que el cliente ve sin que nadie se lo
    // dijera. Para eso se crea OTRO link. Las fichas SÍ, porque son el
    // producto del emisor, no datos del cliente.
    if (action === 'update') {
      const token = String(body.token || '')
      if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
      const links = await readLinks(shareRef, db, uid)
      const existing = links.find((l) => l.token === token)
      if (!existing) return NextResponse.json({ error: 'Unknown link' }, { status: 404 })
      const patch = {}
      if (typeof body.label === 'string') {
        const label = body.label.slice(0, 40).trim()
        if (label) patch.label = label
      }
      // Un [] explícito LIMPIA las fichas; omitir el campo las deja como están.
      if (body.instrumentIds !== undefined) patch.instrumentIds = sanitizeInstrumentIds(body.instrumentIds)
      if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
      const updated = { ...existing, ...patch }
      await db.collection('shareTokens').doc(token).set(patch, { merge: true })
      await shareRef.set({ links: links.map((l) => (l.token === token ? updated : l)), uid, updatedAt: new Date().toISOString() })
      // La entrada cacheada quedó vieja: purga inmediata, best-effort (si
      // falla, el TTL corto acota el desfase).
      await kvDel(`share:${token}`)
      return NextResponse.json({ link: updated })
    }

    if (action === 'revoke') {
      const token = String(body.token || '')
      if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
      const links = await readLinks(shareRef, db, uid)
      if (!links.some((l) => l.token === token)) return NextResponse.json({ error: 'Unknown link' }, { status: 404 })
      await db.collection('shareTokens').doc(token).delete()
      await shareRef.set({ links: links.filter((l) => l.token !== token), uid, updatedAt: new Date().toISOString() })
      // La revocación ya es inmediata SIN esta purga (el GET lee el token doc
      // de Firestore ANTES de consultar el caché), pero dejar la entrada viva
      // hasta su TTL es basura que no le sirve a nadie.
      await kvDel(`share:${token}`)
      return NextResponse.json({ ok: true })
    }
  } catch (err) {
    console.error('[api/share] POST error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request) {
  const { limited } = await rateLimit(request, { maxRequests: 30 })
  if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  const wantPdf = searchParams.get('format') === 'pdf'

  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 })
  }

  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'Server not configured' }, { status: 500 })

  try {
    // El token doc se resuelve de Firestore SIEMPRE y ANTES de mirar el caché:
    // revocar borra el doc y expirar lo invalida acá, así que las dos ganan al
    // instante aunque el caché esté caliente.
    const tokenDoc = await db.collection('shareTokens').doc(token).get()
    if (!tokenDoc.exists) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })

    const tokenData = tokenDoc.data()
    // FASE KP: la vigencia la elige el dueño al crear (indefinida por default).
    // El tope fijo de 90 días que vivía acá se fue: ausencia de expiresAt =
    // nunca vence, con lo que los links viejos ya vencidos REVIVEN, que es la
    // decisión explícita del usuario.
    if (shareTokenExpired(tokenData)) return NextResponse.json({ error: 'Link expired' }, { status: 410 })

    const { uid } = tokenData
    if (!uid) return NextResponse.json({ error: 'Invalid token data' }, { status: 404 })

    // Legacy tokens carry no scope — they always meant "everything".
    const scope = sanitizeScope(tokenData.scope) || { type: 'all' }
    const display = sanitizeDisplay(tokenData.display)
    // El idioma lo eligió el dueño al crear el link (default español); los
    // tokens anteriores a este campo no lo llevan y caen a 'es'.
    const lang = sanitizeLang(tokenData.lang)

    // Caché best-effort del NÚCLEO del payload (lo derivado del reporte, que
    // es lo caro: cotizar + reconstruir). TTL corto. Lo que puede corregirse
    // del lado del dueño sin re-crear el link se relee FRESCO en cada GET y
    // pisa lo cacheado: etiqueta e idioma del token doc (ya leídos), y la
    // identidad del asesor (una lectura de doc, por la misma frontera
    // sanitizeAdvisor que el camino sin caché).
    const instrumentIds = sanitizeInstrumentIds(tokenData.instrumentIds)

    // FASE KP. El PDF descargable del CLIENTE. Dos compuertas del lado del
    // SERVIDOR (el botón oculto en la página no es una frontera): solo un link
    // 'both' (en 'amounts'/'percent' un PDF con la plantilla completa
    // contradiría lo que el link decidió esconder) y solo alcance completo
    // (la sección de flujos del reporte suma TODAS las transacciones del
    // dueño, así que en un link escopado imprimiría depósitos fuera del
    // alcance: la misma razón por la que el payload gatea `flows`).
    if (wantPdf && (display !== 'both' || scope.type !== 'all')) {
      return NextResponse.json({ error: 'PDF is only available for full-scope links that share amounts and returns' }, { status: 403 })
    }

    const cacheKey = `share:${token}`
    // El PDF no usa el caché del payload: necesita el contexto completo para
    // re-armar el documento, y es una descarga ocasional, no una carga de
    // página.
    const cached = wantPdf ? null : await kvGetJSON(cacheKey)
    if (cached && cached.empty !== true) {
      const [profile, instruments] = await Promise.all([
        loadOwnerProfile(db, uid),
        loadInstruments(db, uid, instrumentIds),
      ])
      return NextResponse.json({
        ...cached,
        label: tokenData.label || null,
        lang,
        owner: profile.name || cached.owner || '',
        advisor: sanitizeAdvisor(profile.advisor),
        instruments,
      })
    }

    // FASE KK. El payload sale del MISMO pipeline que el reporte PDF, en vez
    // de mandar los documentos crudos para que el navegador los sume a mano.
    // Sin caché a propósito: se llavea por uid, y un contexto escopado no puede
    // terminar sirviendole al correo de este usuario como si fuera todo.
    const ctx = await loadUserPortfolioContext({
      db, uid,
      filterItem: scopeFilter(scope),
      // Los snapshots son patrimonio GLOBAL: en un link escopado describirian
      // (y etiquetarian mal) la historia del portafolio entero, no la de la
      // rebanada compartida. Sin ellos no hay serie, y la pagina lo DICE.
      includeSnapshots: scope.type === 'all',
    })

    const scopeLabel = scopeLabelOf(scope)
    if (!ctx) {
      // Portafolio vacio, o un alcance que hoy no matchea nada. No es un error:
      // es una respuesta legitima, y decirlo asi deja que la pagina lo explique
      // en vez de mostrar una pantalla de link roto. Las fichas SÍ viajan: el
      // caso real de un asesor es mandarle una oportunidad a un prospecto que
      // todavía no tiene posiciones registradas.
      const [profile, instruments] = await Promise.all([
        loadOwnerProfile(db, uid),
        loadInstruments(db, uid, instrumentIds),
      ])
      return NextResponse.json({
        empty: true, display, lang, label: tokenData.label || null, scopeLabel,
        baseCurrency: 'USD', owner: profile.name || '', advisor: sanitizeAdvisor(profile.advisor),
        asOf: Date.now(), instruments,
      })
    }

    if (wantPdf) {
      // El generador comparte motor con el reporte del dueño (buildReportData
      // corre adentro); `audience: 'share'` aplica la allowlist en el papel.
      const { renderReportPdf } = await import('@/lib/generateReport')
      const { buffer, filename } = await renderReportPdf({
        items: ctx.items,
        snapshots: ctx.augmented,
        transactions: ctx.transactions,
        netWorth: ctx.netWorth,
        totalAssets: ctx.totalAssets,
        annualDividends: ctx.annualDividends,
        estimatedAnnualIncome: ctx.estimatedAnnualIncome,
        baseCurrency: ctx.baseCurrency,
        convert: ctx.convert,
        profileName: ctx.profileName,
        lang,
        period: 'ytd',
        audience: 'share',
        clientLabel: tokenData.label || null,
        advisor: ctx.advisor,
      })
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const report = buildReportData({
      items: ctx.items,
      transactions: ctx.transactions,
      snapshots: ctx.augmented,
      netWorth: ctx.netWorth,
      totalAssets: ctx.totalAssets,
      annualDividends: ctx.annualDividends,
      estimatedAnnualIncome: ctx.estimatedAnnualIncome,
      baseCurrency: ctx.baseCurrency,
      convert: ctx.convert,
      profileName: ctx.profileName,
      lang: 'en',
      period: 'ytd',
      topN: 12,
    })

    const payload = buildSharePayload(report, {
      display,
      lang,
      advisor: ctx.advisor,
      label: tokenData.label || null,
      scopeLabel,
      hasSeries: scope.type === 'all',
      incomeSources: incomeSourcesOf(ctx.items, ctx.convert, ctx.baseCurrency),
      degraded: (ctx.failedSymbols || []).length > 0,
      failedSymbols: ctx.failedSymbols || [],
    })

    // Un portafolio vacío no se cachea (arriba retorna antes): puede llenarse
    // en cualquier momento y un `empty` cacheado lo escondería 10 minutos.
    // Las fichas se adjuntan DESPUÉS de guardar: el núcleo cacheado nunca las
    // lleva, porque se releen frescas en cada GET.
    await kvSetJSON(cacheKey, payload, SHARE_CACHE_TTL_S)
    payload.instruments = await loadInstruments(db, uid, instrumentIds)

    return NextResponse.json(payload)
  } catch (err) {
    console.error('[api/share] GET error:', err.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
