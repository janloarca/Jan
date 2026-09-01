// La fecha de un reporte Flex de IBKR, normalizada a 'YYYY-MM-DD'.
//
// ⛔ UNA sola definición para todo el pipeline de IBKR. Vive en su propio módulo
// porque `ibkrFlex` ya importa `ibkrEquitySummary` (importar al revés sería un
// ciclo), igual que `xmlEntities`, que los dos ya comparten.
//
// El defecto que cierra: había DOS copias de esta función y cada una fallaba con
// un separador distinto, medido ejecutándolas.
//
//   'YYYYMMDD;HHmmss'  formatDate ✓   normalizeFlexDate ✗
//   'YYYYMMDD,HHmmss'  formatDate ✗   normalizeFlexDate ✗
//
// Las DOS formas están documentadas por los autores previos de este repo: la
// cabecera de `formatDate` listaba `"20260115;103000"` entre lo que IBKR emite, y
// la de `normalizeFlexDate` decía "sometimes with stray ; or ,". O sea las dos
// sabían que la coma existe (por eso el `.replace(/,/g,'')`) y ninguna la trataba
// como lo que es. No se pudo confirmar contra la documentación de IBKR desde acá
// (el proxy de este entorno bloquea interactivebrokers.com, ver FASE FX), así que
// esto se apoya en lo que el propio repo ya afirmaba.
//
// Las dos QUITABAN el separador en vez de PARTIR por él, así que la hora quedaba
// pegada a la fecha ('20260120120000', 14 dígitos) y no matcheaba ninguna de las
// dos formas: `undefined`. Y todo caller descarta una fila sin fecha, así que el
// movimiento **desaparece entero y en silencio**. Medido con el parser real: un
// depósito de $5,000 con `dateTime="20260120,120000"` producía `[]`.
//
// El comentario de `formatDate` ya documentaba exactamente esta lección para el
// `;` ("gluing the time onto the date... vanished in silence") mientras el
// `.replace(/,/g,'')` que quedaba al lado seguía haciendo lo mismo con la coma:
// el arreglo viejo era el residuo del enfoque roto, no una regla aparte.
//
// La pieza que muerde MÁS fuerte es la del NAV: si un `reportDate` trae hora, se
// pierde el historial de valor COMPLETO, que es justo lo que la cabecera de
// `ibkrEquitySummary` dice que esa sección existe para traer.
//
// Un separador que no reconocemos NO se adivina: se devuelve `undefined`, porque
// inventar una fecha archiva dinero real contra el día equivocado.
export function normalizeFlexDate(dt) {
  if (!dt) return undefined
  // PARTIR por el separador, nunca quitarlo: `;` `,` y espacio, que son las tres
  // formas que el Flex Query ofrece configurar.
  const clean = String(dt).trim().split(/[;,\s]/)[0]
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(0, 10)
  return undefined
}
