// ── El universo del RENDIMIENTO son los ACTIVOS: la deuda queda fuera ──
//
// ⛔ DECISIÓN DEL USUARIO (FASE LU, 28 ago 2026): "La deuda tampoco debería de
// afectar el YTD". Una deuda no es una inversión: pedir prestado no es perder
// dinero y pagarla no es ganarlo, así que el RETORNO (el YTD del encabezado,
// su desglose por cuenta, el MTD que se publica a Amigos, y la gráfica de
// Valor con sus pestañas TWR/MWR) mide SOLO los activos. El PATRIMONIO NETO
// (activos − deuda) sigue siendo la cifra grande de la tarjeta y el TOTAL de
// la Hoja: esto cambia qué mide el rendimiento, nunca cuánto tienes.
//
// Las dos piezas:
//
//  1. `snapshotAssetsUSD(s)`: el valor SOLO-ACTIVOS de un snapshot archivado.
//     Cada doc diario/backfill guarda `totalActivosUSD` y `totalDebtUSD` desde
//     siempre junto a `netWorthUSD`, así que el ancla sin deuda YA está en el
//     archivo: no hay que reescribir historia ni bumpear SNAPSHOT_VERSION.
//     ⚠ La preferencia por `totalActivosUSD` exige que el doc DECLARE
//     `totalDebtUSD`: en un doc de NAV de broker (`_source:'ibkr'`) ese campo
//     no existe y su `totalActivosUSD` NO es confiable (FASE FX documenta que
//     el parser lo guarda como totalLong + cash y puede duplicar el efectivo),
//     así que ahí manda `netWorthUSD`, que es la lectura de siempre. Un doc de
//     una era sin deuda da el mismo número por cualquiera de los dos caminos.
//
//  2. `assetOnlyFlows(transactions, debtIds)`: la lista de movimientos vista
//     desde el universo de activos. Un flujo vinculado a una deuda se DESCARTA
//     (el DEPOSIT de apertura envenenado de una deuda vieja, el WITHDRAWAL de
//     `manual_loan_proceeds`: ninguno movió un activo), y una transferencia
//     que CRUZA la frontera se convierte en el flujo externo que de verdad es:
//       - pago de deuda desde una cuenta registrada (`_debtItemId` +
//         `_originItemId`): el dinero SALIÓ de los activos → WITHDRAWAL
//         sintético vinculado a la cuenta que pagó. Sin esto, la cuenta baja
//         y el retorno lo lee como pérdida.
//       - desembolso de un préstamo a una cuenta (`_loanItemId` +
//         `_linkedItemId`): el dinero ENTRÓ a los activos → DEPOSIT sintético.
//         Sin esto, la cuenta sube y el retorno lo lee como ganancia.
//       - pago desde la Hoja (sin origen): ningún activo se movió → se
//         descarta entero.
//     Todo lo demás pasa INTACTO (misma referencia de objeto). Sin deudas se
//     devuelve la MISMA lista (misma identidad), así que un portafolio sin
//     deuda es byte-idéntico y ningún memo/caché aguas abajo se invalida.
//
// Los sintéticos son EFÍMEROS (viven en memoria, jamás se escriben) y llevan
// `_assetFlowSynth: true` por si alguna superficie necesita distinguirlos.

// Medio centavo: los tres campos se archivan convertidos a USD, así que la
// identidad de abajo puede no cerrar EXACTO por punto flotante.
const IDENTITY_EPS = 0.005

export function snapshotAssetsUSD(s) {
  if (!s) return 0
  const debt = Number(s.totalDebtUSD)
  const assets = Number(s.totalActivosUSD)
  const net = Number(s.netWorthUSD)
  const hasDebt = s.totalDebtUSD != null && isFinite(debt)
  const hasAssets = s.totalActivosUSD != null && isFinite(assets)
  const hasNet = s.netWorthUSD != null && isFinite(net)

  // ⛔ `totalActivosUSD` solo se cree cuando el doc se VALIDA a sí mismo.
  //
  // El guard original preguntaba "¿el doc declara `totalDebtUSD`?", asumiendo
  // que un NAV de broker no lo trae. Es falso: `parseEquitySummary` SIEMPRE
  // emite `totalDebtUSD: |totalShort|` (0 en una cuenta normal) y
  // `ibkrSnapshotPlan` siempre lo archiva, así que la rama de respaldo que su
  // propio comentario reservaba para "broker NAV" era CÓDIGO MUERTO y todo
  // doc de broker se leía por `totalActivosUSD = totalLong + cash`, que FASE
  // FX documenta como no confiable (puede duplicar el efectivo). Medido: un
  // NAV real de $10,000 se leía como $11,000, o sea la gráfica principal
  // salía inflada TODOS los días.
  //
  // La vara nueva no es una lista de nombres de fuente (que se queda vieja en
  // cuanto aparece otro broker) sino la EVIDENCIA que el propio doc trae: los
  // que escribimos nosotros cumplen `activos - deuda = neto` por construcción,
  // y uno de broker no (sus tres campos vienen de columnas distintas del Flex).
  // Cuando la identidad cierra, las dos lecturas dan lo mismo de todos modos:
  // el guard solo puede ayudar, nunca cambiar un caso que ya estaba bien.
  if (hasDebt && hasAssets) {
    if (!hasNet) return assets
    if (Math.abs(assets - Math.abs(debt) - net) <= IDENTITY_EPS) return assets
    // No cierra: el doc no fue escrito con nuestra convención. Manda el neto,
    // que en un NAV de broker es el valor que el broker de verdad reporta.
    return net + Math.abs(debt)
  }
  if (hasDebt && hasNet) return net + Math.abs(debt)
  // Doc sin noción de deuda (calibración, docs viejos): la lectura de siempre.
  // En una era sin deuda, netWorthUSD ES el total de activos.
  const fallback = Number(s.netWorthUSD ?? s.totalActivosUSD)
  return isFinite(fallback) ? fallback : 0
}

export function debtItemIds(items) {
  const out = new Set()
  for (const it of items || []) {
    if (it && it.isDebt && it.id) out.add(it.id)
  }
  return out
}

export function assetOnlyFlows(transactions, debtIds) {
  const list = transactions || []
  if (!debtIds || debtIds.size === 0) return list
  const out = []
  let changed = false
  for (const tx of list) {
    if (!tx) { out.push(tx); continue }
    const type = (tx.type || '').toUpperCase()
    if (type === 'TRANSFER') {
      // Pago de deuda: el préstamo viaja en `_debtItemId` (campo propio, FASE
      // KW/LT) porque el reparto normal de un TRANSFER sería el reverso
      // semántico equivocado sobre una deuda guardada en positivo.
      if (tx._debtItemId && debtIds.has(tx._debtItemId)) {
        changed = true
        if (tx._originItemId && !debtIds.has(tx._originItemId)) {
          out.push({ ...tx, type: 'WITHDRAWAL', _linkedItemId: tx._originItemId, _assetFlowSynth: true })
        }
        continue
      }
      // Desembolso de un préstamo nuevo hacia una cuenta registrada.
      if (tx._loanItemId && debtIds.has(tx._loanItemId)) {
        changed = true
        if (tx._linkedItemId && !debtIds.has(tx._linkedItemId)) {
          out.push({ ...tx, type: 'DEPOSIT', _assetFlowSynth: true })
        }
        continue
      }
      // Un TRANSFER cuyo extremo directo es una deuda (forma vieja o ajena):
      // sin la semántica de campo propio no se puede saber qué mitad es real,
      // y el lado seguro es no inventar un flujo (igual que la Hoja).
      if ((tx._linkedItemId && debtIds.has(tx._linkedItemId)) ||
          (tx._originItemId && debtIds.has(tx._originItemId))) {
        changed = true
        continue
      }
      out.push(tx)
      continue
    }
    // Un DEPOSIT/WITHDRAWAL (o cualquier otro tipo) vinculado a la deuda no
    // movió ningún activo: fuera. Acá muere el DEPOSIT de apertura envenenado
    // de una deuda creada antes de FASE LT, sin necesidad de borrarla y
    // re-crearla.
    if (tx._linkedItemId && debtIds.has(tx._linkedItemId)) { changed = true; continue }
    out.push(tx)
  }
  return changed ? out : list
}
