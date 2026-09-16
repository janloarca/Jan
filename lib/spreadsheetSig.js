// FASE OA. La FIRMA de los insumos con los que se calculo un mes de la Hoja,
// persistida en el propio doc del cache (`_sig`) para que un mes guardado
// pueda decir si sigue siendo cierto.
//
// El defecto que cierra: el cache mensual (`users/{uid}/itemSnapshots/{mes}`)
// no guardaba NADA sobre con que datos se calculo. La invalidacion en
// sesion (`generation`, PortfolioSpreadsheet) si mira transacciones, lotes y
// campos del item, pero vive en memoria: al montar de nuevo, un mes
// guardado se daba por bueno solo por EXISTIR (chequeo por presencia). Asi
// que un cupon escrito por el motor de dividendos en una sesion posterior
// (el caso real del usuario: "al agregar un bono pagadero semestral no lo
// leyo en el spreadsheet") nunca llegaba a los meses ya cacheados hasta que
// alguien editara algo en esa misma sesion.
//
// Es un hash corto y determinista de los MISMOS strings de firma que ya usa
// la invalidacion en sesion, nunca una segunda definicion de que cambia un
// mes: si esas firmas cambian, esta cambia con ellas.
//
// Un doc SIN firma (guardado antes de esta fase) se trata como VIEJO: no
// puede probar que sigue vigente, y darlo por bueno es exactamente el
// defecto. Cuesta un recomputo por mes en la primera apertura, el mismo
// precio que un bump de SNAPSHOT_VERSION, que este repo paga sin problema.

// djb2 sobre el string completo; suficiente para distinguir "cambio algo" y
// lo bastante corto para vivir en cada doc.
function hash32(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function spreadsheetInputSig(parts) {
  const joined = (parts || []).map((p) => String(p ?? '')).join('')
  // Dos hashes con entrada distinta bajan la chance de colision a algo que
  // no importa para un cache que en el peor caso recomputa un mes de mas.
  return `${hash32(joined)}${hash32(`${joined.length}:${joined}`)}`
}

// Un mes cacheado es confiable SOLO cuando trae la MISMA firma que los
// insumos de hoy. Ausente o distinta: hay que recomputarlo.
export function cachedMonthIsCurrent(savedSig, currentSig) {
  if (!savedSig || !currentSig) return false
  return savedSig === currentSig
}
