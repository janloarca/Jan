// FASE HZ. La cáscara compartida de TODO correo de Chispudo.
//
// Existe porque a partir del segundo correo el HTML inline por archivo duele:
// el pie legal, el aviso de no-responder y el enlace para apagar la
// suscripción tienen que decir lo mismo en todos, y tres copias es como una
// se queda atrás (la lección que este repo ya documenta para componentes).
//
// Cada correo aporta solo su CONTENIDO como datos; este módulo lo convierte a
// HTML y a texto plano a la vez, de modo que las dos versiones no puedan
// divergir: un correo solo-HTML puntúa peor en filtros de spam y hay clientes
// que muestran el texto.
//
// Estilo: tabla monoespaciada sobre fondo blanco, sin colores de marca en los
// números. Es la misma decisión del reporte impreso (FASE FK): un correo
// financiero que alguien archiva se lee mejor como estado de cuenta que como
// pieza de marketing.

const INK = '#111827'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
const RULE = '#e5e7eb'

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Pad para la versión de texto: alinea las etiquetas en una columna para que
// el correo se lea como una tabla también sin HTML.
function padRight(s, width) {
  const str = String(s ?? '')
  return str.length >= width ? str : str + ' '.repeat(width - str.length)
}

function renderRowsHtml(rows) {
  const cells = rows.map(([label, value, note]) => `
      <tr>
        <td style="padding:4px 0;color:${MUTED};font-size:14px">${esc(label)}</td>
        <td style="padding:4px 0;text-align:right;color:${INK};font-size:14px;font-weight:600;white-space:nowrap">${esc(value)}</td>
        <td style="padding:4px 0 4px 12px;text-align:right;color:${FAINT};font-size:12px;white-space:nowrap">${esc(note || '')}</td>
      </tr>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${cells}
    </table>`
}

function renderRowsText(rows) {
  const width = Math.min(24, Math.max(...rows.map(([label]) => String(label).length)) + 2)
  return rows.map(([label, value, note]) =>
    `  ${padRight(label, width)}${value}${note ? `   ${note}` : ''}`).join('\n')
}

/**
 * @param {object} doc
 * @param {string} doc.title      Encabezado grande (también sirve de asunto).
 * @param {string} [doc.subtitle] Período cubierto, fecha de generación.
 * @param {Array}  doc.sections   [{ heading, rows?, paragraphs?, cta? }]
 * @param {string} [doc.manageUrl] Enlace para apagar o cambiar la suscripción.
 * @param {string} [doc.reason]    Por qué recibe este correo (una línea).
 */
export function renderEmail({ title, subtitle, sections = [], manageUrl, reason }) {
  const NO_REPLY = 'This is an automated message. Please do not reply to this address.'

  const htmlSections = sections.map((s) => {
    const parts = []
    if (s.heading) {
      parts.push(`<h2 style="margin:26px 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:700">${esc(s.heading)}</h2>`)
    }
    if (s.rows?.length) parts.push(renderRowsHtml(s.rows))
    for (const p of s.paragraphs || []) {
      parts.push(`<p style="margin:10px 0;font-size:14px;line-height:1.5;color:${INK}">${esc(p)}</p>`)
    }
    if (s.cta) {
      parts.push(`<p style="margin:16px 0"><a href="${esc(s.cta.url)}" style="display:inline-block;padding:10px 18px;background:${INK};color:#ffffff;border-radius:8px;text-decoration:none;font-size:14px">${esc(s.cta.label)}</a></p>`)
    }
    return parts.join('\n')
  }).join('\n')

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:${INK};background:#ffffff">
  <h1 style="margin:0;font-size:20px;font-weight:700;color:${INK}">${esc(title)}</h1>
  ${subtitle ? `<p style="margin:4px 0 0;font-size:13px;color:${MUTED}">${esc(subtitle)}</p>` : ''}
  <hr style="border:none;border-top:1px solid ${RULE};margin:18px 0 0" />
  ${htmlSections}
  <hr style="border:none;border-top:1px solid ${RULE};margin:28px 0 12px" />
  <p style="margin:0;font-size:11px;line-height:1.6;color:${FAINT}">
    ${reason ? `${esc(reason)}<br />` : ''}
    ${manageUrl ? `Manage or turn this off: <a href="${esc(manageUrl)}" style="color:${MUTED}">${esc(manageUrl)}</a><br />` : ''}
    ${NO_REPLY}<br />
    Chispudo · chispu.xyz
  </p>
</div>`

  const textSections = sections.map((s) => {
    const parts = []
    if (s.heading) parts.push(s.heading.toUpperCase())
    if (s.rows?.length) parts.push(renderRowsText(s.rows))
    for (const p of s.paragraphs || []) parts.push(p)
    if (s.cta) parts.push(`${s.cta.label}: ${s.cta.url}`)
    return parts.join('\n')
  }).join('\n\n')

  const text = [
    title,
    subtitle || null,
    '',
    textSections,
    '',
    '---',
    reason || null,
    manageUrl ? `Manage or turn this off: ${manageUrl}` : null,
    NO_REPLY,
    'Chispudo · chispu.xyz',
  ].filter((l) => l != null).join('\n')

  return { html, text }
}
