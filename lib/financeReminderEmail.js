// FASE HX. El contenido del recordatorio de fin de mes, extraído de la ruta de
// cron para poder testearlo: un archivo `route.js` del App Router solo admite
// exports reconocidos por Next (GET/POST/dynamic/...), así que exportar la
// función desde ahí rompe el build. Módulo puro, sin imports.
//
// Convención de correo AUTOMÁTICO (lo que pidió el usuario, "que tenga un
// no reply"): el correo se manda desde una dirección que nadie lee, así que
// tiene que DECIRLO y además marcarse como automático a nivel de protocolo
// (esas cabeceras las pone el caller, ver route.js). Un correo que invita a
// responder a un buzón sin lector es peor que uno que aclara que no se
// responde.
//
// Se devuelve también `text`: un correo solo-HTML puntúa peor en los filtros
// de spam y hay clientes que muestran el texto plano, así que las dos versiones
// dicen lo mismo.

const NO_REPLY_ES = 'Este es un correo automático. No respondas a esta dirección: nadie la lee.'
const NO_REPLY_EN = 'This is an automated message. Please do not reply to this address: nobody reads it.'

// El default es INGLÉS, no español (FASE HX2, decisión del usuario: "todos los
// correos los quiero en inglés"). Se deja el español detrás de un `lang: 'es'`
// EXPLÍCITO en vez de borrarlo: el resto de la app es bilingüe y volver a
// encenderlo es un argumento, no una reescritura. Pero un caller que se olvide
// del idioma ahora manda inglés, que es lo que el producto emite hoy.
export function buildFinanceReminderEmail(lang, monthLabel) {
  const es = lang === 'es'
  const subject = es
    ? `Chispudo: te falta llenar ${monthLabel} 📊`
    : `Chispudo: ${monthLabel} is still empty 📊`

  const html = es
    ? `<p>Hola 👋</p>
<p>El mes está por cerrar y todavía no registraste tus ingresos y gastos de <strong>${monthLabel}</strong> en Chispudo.</p>
<p>Toma 2 minutos: agrega tus movimientos o sube tu estado de cuenta y deja que Chispu haga el resto.</p>
<p><a href="https://chispu.xyz/finances" style="display:inline-block;padding:10px 18px;background:#4F46E5;color:#ffffff;border-radius:8px;text-decoration:none">Llenar mis finanzas</a></p>
<p style="color:#64748b;font-size:12px">Recibes este correo porque activaste el recordatorio de fin de mes en Chispudo. Puedes apagarlo desde la pestaña de Flujo.</p>
<p style="color:#94a3b8;font-size:12px">${NO_REPLY_ES}</p>`
    : `<p>Hi 👋</p>
<p>The month is about to close and your income &amp; expenses for <strong>${monthLabel}</strong> are still empty in Chispudo.</p>
<p>It takes 2 minutes: add your movements or upload a statement and let Chispu do the rest.</p>
<p><a href="https://chispu.xyz/finances" style="display:inline-block;padding:10px 18px;background:#4F46E5;color:#ffffff;border-radius:8px;text-decoration:none">Fill my finances</a></p>
<p style="color:#64748b;font-size:12px">You get this email because you enabled the month-end reminder in Chispudo. You can turn it off from the Finances tab.</p>
<p style="color:#94a3b8;font-size:12px">${NO_REPLY_EN}</p>`

  const text = es
    ? `Hola,

El mes está por cerrar y todavía no registraste tus ingresos y gastos de ${monthLabel} en Chispudo.

Toma 2 minutos: agrega tus movimientos o sube tu estado de cuenta y deja que Chispu haga el resto.

Llenar mis finanzas: https://chispu.xyz/finances

Recibes este correo porque activaste el recordatorio de fin de mes en Chispudo. Puedes apagarlo desde la pestaña de Flujo.
${NO_REPLY_ES}`
    : `Hi,

The month is about to close and your income & expenses for ${monthLabel} are still empty in Chispudo.

It takes 2 minutes: add your movements or upload a statement and let Chispu do the rest.

Fill my finances: https://chispu.xyz/finances

You get this email because you enabled the month-end reminder in Chispudo. You can turn it off from the Finances tab.
${NO_REPLY_EN}`

  return { subject, html, text }
}
