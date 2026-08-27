// De una alerta de banco YA parseada al gasto que estamos dispuestos a guardar.
//
// Existe porque hay DOS transportes que reciben el mismo tipo de texto y no
// pueden divergir sobre qué hacer con él:
//
//   correo   — la alerta llega reenviada, horas o un día después, y trae su
//              propia zona horaria escrita en la cabecera Date.
//   Android  — la MISMA alerta, leída del push del banco por una app de
//              automatización, en tiempo real.
//
// Lo único que cambia entre los dos es de dónde sale el instante del cobro; todo
// lo demás (monto, moneda, comercio, ubicación, últimos cuatro, qué se descarta)
// es idéntico. Dos copias de ese mapeo es exactamente cómo una se queda atrás,
// que es la lección que este repo ya pagó con la lista de códigos ISO y con
// lib/transferTx.js.
//
// Android es estrictamente MEJOR que el atajo de iOS para esto: el push del
// banco se dispara con todo (tarjeta física, compra en línea, Google Pay,
// transferencia), no solo con lo que pasa por la billetera. iOS no puede leer
// notificaciones y por eso allá hace falta el camino de correo; en Android ese
// hueco no existe.

import { parseBankAlert } from './parsers/bankAlertParser'
import { normalizeExpenseInput } from './expenseIngest'
import { instantFromLocalTime } from './sameCharge'

/**
 * Texto de una alerta → { input } | { skip }
 *
 * `skip` NO es un error: una alerta que resulta ser un reverso, o un correo que
 * no era una alerta, son resultados legítimos que el caller reporta distinto de
 * un fallo.
 *
 * `offsetMinutes` es la zona con la que interpretar una hora de PARED impresa en
 * el texto ("Hora: 14:32"). El correo la saca de su propia cabecera Date. Un
 * push de Android no tiene de dónde sacarla, y no la necesita: llega en
 * segundos, así que la hora de LLEGADA es mejor dato que la impresa. Sin offset
 * la hora del texto simplemente no se usa.
 */
export function expenseFromAlert({
  subject = '',
  text = '',
  html = '',
  receivedAt = null,
  defaultCurrency = 'GTQ',
  source,
  offsetMinutes = null,
} = {}) {
  const alert = parseBankAlert({ subject, text, html, receivedAt, defaultCurrency })
  if (!alert) return { skip: 'not-an-alert' }
  // Reversos y devoluciones comparten el formato de la alerta pero no son
  // gastos. Registrarlos como gasto infla el mes; quedan para el estado de
  // cuenta, que sí distingue el lado del movimiento.
  if (alert.kind === 'credit') return { skip: 'credit' }
  // Un cobro RECHAZADO, DECLINADO o DENEGADO no movió dinero: guardarlo como
  // gasto infla el mes con algo que nunca salió, y a diferencia de un reverso
  // no hay un movimiento posterior que lo netee. Se descarta con su propia
  // razón (no 'credit'): son cosas distintas y el usuario ve el motivo.
  if (alert.kind === 'declined') return { skip: 'declined' }

  const input = normalizeExpenseInput({
    amount: alert.amount,
    currency: alert.currency,
    merchant: alert.merchant,
    location: alert.location,
    date: alert.date,
    occurredAt: offsetMinutes == null ? null : instantFromLocalTime({
      date: alert.date,
      time: alert.time,
      offsetMinutes,
      near: receivedAt,
    }),
    receivedAt,
    last4: alert.last4,
    source,
  })
  return { input, alert }
}
