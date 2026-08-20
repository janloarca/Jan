// FASE IE. La carga del portafolio de UN usuario del lado del servidor,
// extraída de lib/weeklyBriefBuilder.js para que el correo MENSUAL no traiga
// su propia copia del pipeline (dos copias de "cargar + cotizar + enriquecer +
// aumentar snapshots" es exactamente cómo una se queda atrás: la lección de
// los dos generadores de reporte que divergieron hasta el +1148%).
//
// Reproduce el pipeline del CLIENTE en el mismo orden: cotizar solo lo
// isMarketPriced, convertir a moneda base, y aumentar los snapshots
// (preferFullPortfolioPerDay + augmentSnapshots) para que un día cuyo único
// doc es NAV solo-broker nunca se lea como el portafolio entero (el -62.9% de
// la primera prueba real del semanal).

import { priceItems } from './marketPrices'
import { makeConvert, enrichItemsServerSide, netWorthFromItems, trailingDividends, projectedAnnualIncome } from './serverPortfolio'
import { getItemValue, isExcludedFromNetWorth, augmentSnapshots, projectItemAnnualIncome } from '../components/dashboard/utils'
import { preferFullPortfolioPerDay } from './snapshotSelect'

async function loadCollection(db, uid, name) {
  const snap = await db.collection(`users/${uid}/${name}`).get()
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// El nombre del dueño, para la portada del PDF adjunto.
//
// FASE KB. Los builders leían `prefs.profileName`, o sea el doc
// `settings/preferences`, y NADIE escribe nunca ese campo: ninguno de los 15
// call sites de `saveSettings` lo pasa. El nombre real vive en OTRO doc,
// `settings/profile` bajo `.name`, que es el que la app usa en pantalla
// (`app/dashboard/page.jsx`: `profile?.name || user?.displayName || ''`). O sea
// no es que faltara el nombre: el servidor lo buscaba donde nunca estuvo, y los
// reportes salían sin él desde que existen.
//
// No se consulta el `displayName` de Firebase Auth desde acá, a propósito: el
// cron no tiene el registro de Auth a mano (saca el correo de prefs, no de
// `getUser`), así que pedirlo sería una llamada por destinatario para un campo
// que esta app NUNCA escribe (cero call sites de `updateProfile`; solo lo
// llenaría un sign-in de Google). El campo de Ajustes materializa ese nombre en
// `settings/profile`, así que cliente y servidor leen el mismo lugar.
//
// Best-effort: un perfil ilegible deja el nombre vacío y el correo sale igual.
// Perder un resumen entero por la portada sería peor que mandarlo sin nombre.
async function loadProfileName(db, uid) {
  try {
    const snap = await db.doc(`users/${uid}/settings/profile`).get()
    // Admin SDK: `exists` es PROPIEDAD, no función (el cliente usa `exists()`).
    if (!snap || !snap.exists) return ''
    const name = snap.data()?.name
    return typeof name === 'string' ? name.trim() : ''
  } catch (e) {
    console.error('[briefContext] profile read failed for', uid, e?.message)
    return ''
  }
}

/**
 * Devuelve el contexto completo o null si el portafolio está vacío:
 * { items (enriquecidos), transactions, snapshots (crudos), augmented,
 *   netWorth, totalAssets, baseCurrency, convert, profileName }
 */
// FASE IE9. Caché por corrida: el 1 de enero un mismo usuario recibe el
// mensual Y el anual (y el 1 de un mes que caiga domingo, el semanal también),
// y cada builder cargaba su portafolio completo por separado. Leer dos veces
// los mismos cientos de documentos no cambia el resultado y sí cuenta doble
// contra la cuota diaria de Firestore, que el usuario ya agotó probando.
// El caché lo crea el CALLER y vive lo que dura la corrida: nada persiste
// entre invocaciones, así que un correo nunca puede salir con datos viejos.
export function makeContextCache() {
  return new Map()
}

export async function loadUserPortfolioContext({ db, uid, prefs = {}, cache = null }) {
  if (cache && cache.has(uid)) return cache.get(uid)
  const ctx = await loadPortfolioContextUncached({ db, uid, prefs })
  if (cache) cache.set(uid, ctx)
  return ctx
}

async function loadPortfolioContextUncached({ db, uid, prefs = {} }) {
  // El perfil viaja en el MISMO Promise.all, no después del corte de abajo: una
  // lectura de más para un portafolio vacío (que no recibe correo igual) sale
  // más barata que un viaje serial extra para todos los demás. Y al vivir
  // dentro del contexto cacheado, las cadencias que coinciden el mismo día
  // (mensual + anual el 1 de enero) la comparten en vez de repetirla.
  const [items, transactions, snapshots, profileName] = await Promise.all([
    loadCollection(db, uid, 'items'),
    loadCollection(db, uid, 'transactions'),
    loadCollection(db, uid, 'snapshots'),
    loadProfileName(db, uid),
  ])
  if (items.length === 0) return null

  // Las tasas salen del último snapshot, que las archiva: son las mismas con
  // las que la app calculó, sin una llamada extra de FX.
  const sorted = [...snapshots].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const latest = sorted[sorted.length - 1] || {}
  const baseCurrency = prefs.baseCurrency || latest.baseCurrency || 'USD'
  const convert = makeConvert(latest.rates || { USD: 1 }, baseCurrency)

  const { prices } = await priceItems(items)
  const enriched = enrichItemsServerSide(items, prices, convert, baseCurrency)

  const augmented = augmentSnapshots(preferFullPortfolioPerDay(snapshots), enriched, convert)
  const { netWorth, totalAssets } = netWorthFromItems(enriched, {
    isExcluded: isExcludedFromNetWorth, getValue: getItemValue,
  })

  // FASE IE7: las cifras de ingreso que el hook del cliente le pasa al reporte.
  // Sin ellas, el PDF adjunto imprimía "$0.00" de dividendos en el mismo
  // documento que declaraba cientos de dólares cobrados en el período.
  const now = new Date()
  // items va a propósito: sin ellos la regla de "¿esto es reinvertido?" cae a
  // la bandera sola y esta cifra podía contradecir a la de ingreso del período,
  // en el MISMO correo (FASE JW).
  const annualDividends = trailingDividends(transactions, { convert, baseCurrency, now, items: enriched })
  const estimatedAnnualIncome = projectedAnnualIncome(enriched, { convert, baseCurrency, projectItemAnnualIncome })

  return {
    items: enriched, transactions, snapshots, augmented,
    netWorth, totalAssets, baseCurrency, convert,
    annualDividends, estimatedAnnualIncome, profileName,
  }
}

/**
 * Lee los docs mensuales del caché del Spreadsheet (users/{uid}/itemSnapshots)
 * para una lista de claves 'YYYY-MM'. Respeta la MISMA versión mínima que el
 * cliente (lib/snapshotVersion.js): un doc calculado bajo lógica vieja no se
 * lee, igual que loadItemSnapshots se niega en el navegador.
 * Devuelve { [mk]: { items: {...}, currency } } solo con los meses presentes.
 */
export async function loadItemSnapshotDocs({ db, uid, monthKeys, minVersion }) {
  const out = {}
  await Promise.all((monthKeys || []).map(async (mk) => {
    try {
      const doc = await db.doc(`users/${uid}/itemSnapshots/${mk}`).get()
      if (!doc.exists) return
      const data = doc.data()
      if ((data._version || 0) < minVersion) return
      out[mk] = { items: data.items || {}, currency: data._currency || null }
    } catch { /* un mes ilegible se queda como hueco honesto */ }
  }))
  return out
}
