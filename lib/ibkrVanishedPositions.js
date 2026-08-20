// Posiciones que YA NO están en IBKR y hay que sacar del portafolio.
//
// El defecto: la limpieza del sync solo borraba items de IBKR con cantidad <= 0
// CUYO SÍMBOLO VINIERA EN EL FEED, y el formateador filtra las posiciones en
// cero antes de armarlo (`lib/ibkrSync.js`: `.filter(p => p.quantity !== 0)`).
// O sea que una posición liquidada nunca vuelve a aparecer en el reporte y por
// lo tanto nunca se borraba: el usuario vendía todo en IBKR y la posición
// seguía en Chispu para siempre, con su última cantidad y precio, inflando el
// patrimonio con algo que ya no tiene.
//
// Borrar es la semántica correcta (no tenés el activo), y no destruye historia:
// las compras y ventas viven en documentos de transacción aparte y la
// reconstrucción histórica se apoya en ellas, no en el item.
//
// PERO borrar por ausencia es peligroso, porque "no vino en el feed" también es
// lo que produce un reporte parcial. Los cuatro guardas de abajo existen para
// que un reporte incompleto no pueda vaciarle el portafolio a nadie. Ante
// cualquier duda: no se borra. Una posición de más es un error visible que el
// usuario puede reportar; una cartera borrada no se recupera.

const CASH_RE = /^CASH-/i

const upper = (v) => String(v || '').trim().toUpperCase()

export function vanishedIbkrPositionIds({
  storedItems = [],
  feedItems = [],
  feedAccounts = [],
  // Si el Flex Query NO trae la sección Cash Report, el efectivo no viene en el
  // feed por configuración, no porque se haya gastado.
  hasCashSection = false,
} = {}) {
  // GUARDA 1: un feed sin posiciones no autoriza NINGÚN borrado. Es la firma de
  // un reporte vacío, de una sección Open Positions sin marcar, o de un parseo
  // que falló: exactamente los casos donde "no está en el feed" no significa
  // "ya no lo tenés".
  const live = (feedItems || []).filter((it) => it && it.symbol)
  if (live.length === 0) return []

  const liveSymbols = new Set(live.map((it) => upper(it.symbol)))
  const accounts = new Set((feedAccounts || []).map(upper).filter(Boolean))

  const out = []
  for (const it of storedItems || []) {
    if (!it || !it.id) continue
    // GUARDA 2: SOLO lo que el propio sync creó. La heurística por nombre de
    // institución que usa la otra rama de limpieza alcanzaría a un item que el
    // usuario tecleó a mano y llamó "Interactive Brokers", y borrar datos
    // escritos a mano durante un sync de broker sería imperdonable.
    if (it._source !== 'ibkr') continue
    const sym = upper(it.symbol)
    if (!sym || liveSymbols.has(sym)) continue

    // GUARDA 3: el efectivo solo se puede borrar si la sección que lo trae vino
    // en este reporte.
    if (CASH_RE.test(sym) && !hasCashSection) continue

    // GUARDA 4: multi-cuenta. Solo se borra lo que pertenece a una cuenta que
    // ESTE reporte cubre; si el item no dice a qué cuenta pertenece (importado
    // antes de que se guardara ese dato), solo se borra cuando el feed trae
    // exactamente una cuenta, porque ahí no hay ambigüedad posible.
    const itemAccount = upper(it._ibkrAccountId)
    if (itemAccount) {
      if (accounts.size > 0 && !accounts.has(itemAccount)) continue
    } else if (accounts.size > 1) {
      continue
    }

    out.push(it.id)
  }
  return out
}
