// ¿Está disparando la captura automática? Medido, no supuesto.
//
// El estado de G&T marca APPLEPAY en cada fila que se pagó con la billetera, y
// el parser ya lo guarda (`wallet: 'applepay'`) sin que nadie lo leyera. Cruzar
// esas filas contra lo que ya estaba registrado da una medición DIRECTA de la
// cobertura de la automatización del iPhone, sobre compras reales del usuario,
// en vez de otra hipótesis.
//
// Por qué importa el desglose por transporte y no solo "sí/no": la automatización
// de Wallet y el reenvío de alertas capturan la MISMA compra por caminos
// distintos, así que una fila que trae el correo pero no el atajo dice algo muy
// concreto — la alerta del banco sí salió y la automatización no corrió. Esa es
// exactamente la diferencia que no se puede deducir mirando el resultado final,
// donde las dos se ven igual: el gasto está.
//
// Módulo puro: recibe lo que ya calculó reconcileStatement, no vuelve a
// emparejar nada.

const AUTO = /^auto_(\w+)$/

// De qué transporte vino una fila ya registrada: 'shortcut' | 'email' |
// 'android' | null (escrita a mano, o importada de un estado anterior).
function transportOf(tx) {
  const m = AUTO.exec(String(tx?._source || ''))
  return m ? m[1] : null
}

// reconciled: la salida de reconcileStatement.
//
// Solo cuenta filas que el estado marcó con billetera. Un estado que no las
// marca (BI, BAC) devuelve total 0, y entonces no hay nada que afirmar: la
// ausencia de marcadores no es evidencia de que la automatización falló.
export function walletCoverage(reconciled, { wallet = 'applepay' } = {}) {
  const confirmed = reconciled?.confirmed || []
  const review = reconciled?.review || []
  const newTxs = reconciled?.newTxs || []

  const isWallet = (row) => String(row?.wallet || '') === wallet

  const byTransport = {}
  let captured = 0
  let byHand = 0

  // Una fila del estado que ya estaba registrada. Las de `review` cuentan igual
  // (el usuario todavía no decide, pero la pareja existe); si resultara ser un
  // cobro aparte, la conclusión se mueve hacia MENOS cobertura, o sea esto no
  // puede sobreestimar en la dirección que engañaría.
  for (const { row, match } of [...confirmed, ...review]) {
    if (!isWallet(row)) continue
    const via = transportOf(match)
    if (via) {
      captured++
      byTransport[via] = (byTransport[via] || 0) + 1
    } else {
      byHand++
    }
  }

  const missingRows = newTxs.filter(isWallet)
  const total = captured + byHand + missingRows.length

  return {
    total,
    captured,
    byHand,
    missing: missingRows.length,
    missingRows,
    byTransport,
    // null en vez de 0 cuando no hay filas marcadas: "no se puede medir" y
    // "no capturó ninguna" son conclusiones opuestas.
    pct: total > 0 ? (captured / total) * 100 : null,
  }
}
