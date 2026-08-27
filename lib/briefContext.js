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

// Un solo doc, para quedarse con sus tasas de cambio y su moneda base.
// Best-effort: sin él las tasas caen a { USD: 1 } igual que hoy sin snapshots.
async function loadLatestSnapshot(db, uid) {
  try {
    const snap = await db.collection(`users/${uid}/snapshots`).orderBy('date', 'desc').limit(1).get()
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (e) {
    console.error('[briefContext] latest snapshot read failed for', uid, e?.message)
    return []
  }
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
//
// FASE KP. El mismo doc gana la identidad de ASESOR (firma, teléfono, correo):
// el link compartido la imprime como "Preparado por" y bloque de contacto, y
// leerla aparte sería una segunda lectura del MISMO documento. Cada campo se
// valida por separado (un teléfono guardado como número no tumba la firma), y
// `advisor` sale null cuando los tres están vacíos, para que los consumidores
// pregunten UNA cosa ("¿hay asesor?") en vez de tres. `profileName` conserva
// su contrato EXACTO: los email builders lo leen tal cual.
// Exportada (FASE KP) porque el GET del link compartido la usa también SOLO
// en el camino de caché KV caliente: el núcleo del payload puede tener hasta
// ~10 min, pero la identidad del asesor se relee fresca en cada GET para que
// una corrección suya no quede detrás del caché. Un solo lector de ese doc,
// dos consumidores: dos copias es cómo una se queda atrás.
export async function loadOwnerProfile(db, uid) {
  try {
    const snap = await db.doc(`users/${uid}/settings/profile`).get()
    // Admin SDK: `exists` es PROPIEDAD, no función (el cliente usa `exists()`).
    if (!snap || !snap.exists) return { name: '', advisor: null }
    const data = snap.data() || {}
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    const field = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    const firm = field(data.advisorFirm)
    const phone = field(data.advisorPhone)
    const email = field(data.advisorEmail)
    const advisor = firm || phone || email ? { firm, phone, email } : null
    return { name, advisor }
  } catch (e) {
    console.error('[briefContext] profile read failed for', uid, e?.message)
    return { name: '', advisor: null }
  }
}

/**
 * Devuelve el contexto completo o null si el portafolio está vacío:
 * { items (enriquecidos), transactions, snapshots (crudos), augmented,
 *   netWorth, totalAssets, baseCurrency, convert, profileName,
 *   advisor ({ firm, phone, email } o null), failedSymbols, usedStale }
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

// FASE KK. Un tercer consumidor: el link de compartir, que necesita el MISMO
// pipeline (cargar, cotizar, convertir, aumentar snapshots) pero acotado a lo
// que ese link expone. Los dos parámetros son OPCIONALES y sin ellos el
// comportamiento es byte-idéntico, así que el cron no se entera:
//
//   filterItem       predicado sobre el ítem CRUDO, aplicado ANTES de cotizar
//                    y enriquecer (así no se paga una cotización por algo que
//                    el link no muestra).
//   includeSnapshots false salta la lectura de la colección entera. Un link
//                    escopado no puede usar los snapshots (son patrimonio
//                    GLOBAL), así que leerlos sería gastar cuota para tirarlos.
//
// El caché queda PROHIBIDO junto con un filtro, y es a propósito: se llavea
// solo por uid, así que un contexto escopado guardado ahí se le serviría
// después al correo de ese mismo usuario como si fuera su portafolio entero.
export async function loadUserPortfolioContext({ db, uid, prefs = {}, cache = null, filterItem = null, includeSnapshots = true }) {
  const scoped = typeof filterItem === 'function' || includeSnapshots === false
  if (scoped && cache) throw new Error('loadUserPortfolioContext: un contexto escopado no puede compartir caché')
  if (cache && cache.has(uid)) return cache.get(uid)
  const ctx = await loadPortfolioContextUncached({ db, uid, prefs, filterItem, includeSnapshots })
  if (cache) cache.set(uid, ctx)
  return ctx
}

async function loadPortfolioContextUncached({ db, uid, prefs = {}, filterItem = null, includeSnapshots = true }) {
  // El perfil viaja en el MISMO Promise.all, no después del corte de abajo: una
  // lectura de más para un portafolio vacío (que no recibe correo igual) sale
  // más barata que un viaje serial extra para todos los demás. Y al vivir
  // dentro del contexto cacheado, las cadencias que coinciden el mismo día
  // (mensual + anual el 1 de enero) la comparten en vez de repetirla.
  const [allItems, transactions, snapshots, profile] = await Promise.all([
    loadCollection(db, uid, 'items'),
    loadCollection(db, uid, 'transactions'),
    // Sin la serie completa se lee IGUAL el último snapshot, porque de ahí
    // salen las tasas de cambio: dejarlo vacío haría que `convert` cayera a la
    // identidad y un saldo en quetzales se sumaría como si fueran dólares,
    // que es justo el defecto que este pipeline existe para no cometer.
    includeSnapshots ? loadCollection(db, uid, 'snapshots') : loadLatestSnapshot(db, uid),
    loadOwnerProfile(db, uid),
  ])
  // El filtro corre sobre el ítem CRUDO y antes de cotizar: un link escopado a
  // una institución no debe disparar una llamada de precios por posiciones que
  // no va a mostrar.
  const items = filterItem ? allItems.filter((it) => { try { return !!filterItem(it) } catch { return false } }) : allItems
  if (items.length === 0) return null

  // Las tasas salen del último snapshot, que las archiva: son las mismas con
  // las que la app calculó, sin una llamada extra de FX.
  // FASE LO: el último doc QUE TRAIGA TASAS, nunca el último por fecha.
  //
  // Desde FASE FU una misma fecha puede tener varios documentos: el `daily` con
  // id plano, el NAV paralelo del broker (`fecha~nav~ibkr`) y las anclas de
  // calibración por cuenta (`fecha~kind~cuenta`). El único escritor de `rates`
  // es el snapshot diario; los otros dos guardan cuatro campos y ninguno es la
  // tasa. Ordenando solo por `date` el sort es estable, así que entre docs de
  // la MISMA fecha manda el orden de llegada de Firestore (por id ascendente),
  // y `~` (0x7E) ordena DESPUÉS del id plano: ganaba justo el que no las trae.
  //
  // Con `latest` sin tasas, `makeConvert` cae a la identidad y devuelve el
  // monto CRUDO: una cuenta de Q10,000 se sumaba como $10,000 y el correo
  // entero (patrimonio, asignación, retornos, Excel) salía mal, etiquetado en
  // la moneda base. `baseCurrency` sale del MISMO doc a propósito: el snapshot
  // diario escribe las dos cosas juntas.
  const sorted = [...snapshots].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const withRates = sorted.filter((s) => s && s.rates && Object.keys(s.rates).length > 0)
  const latest = withRates[withRates.length - 1] || sorted[sorted.length - 1] || {}
  const baseCurrency = prefs.baseCurrency || latest.baseCurrency || 'USD'
  const convert = makeConvert(latest.rates || { USD: 1 }, baseCurrency)

  const { prices, requested = [], usedStale = false } = await priceItems(items)
  const enriched = enrichItemsServerSide(items, prices, convert, baseCurrency)

  // FASE KK. Qué NO se pudo cotizar. `priceItems` ya lo sabe (devuelve
  // `requested`) y este módulo lo tiraba. Un símbolo sin precio se reconstruye
  // plano en su costo y aporta cero al retorno, así que presentarlo como
  // medido es la degradación muda que el invariante 5 prohíbe: el caller lo
  // recibe declarado y decide si lo dice.
  const failedSymbols = requested.filter((s) => !prices[s])

  // Sin la serie completa, lo leído es UN doc que solo existe por sus tasas:
  // devolverlo como serie invitaría a un caller a dibujar una historia de un
  // punto. La serie sale vacía y las tasas ya viajan dentro de `convert`.
  const seriesDocs = includeSnapshots ? snapshots : []
  const augmented = augmentSnapshots(preferFullPortfolioPerDay(seriesDocs), enriched, convert)
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
    items: enriched, transactions, snapshots: seriesDocs, augmented,
    netWorth, totalAssets, baseCurrency, convert,
    annualDividends, estimatedAnnualIncome,
    profileName: profile.name, advisor: profile.advisor,
    failedSymbols, usedStale,
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
