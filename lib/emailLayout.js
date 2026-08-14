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
// Estilo: tabla sobre una tarjeta blanca, sin colores de marca en los números.
// Es la misma decisión del reporte impreso (FASE FK): un correo financiero que
// alguien archiva se lee mejor como estado de cuenta que como pieza de
// marketing.
//
// FASE IE3, alineación (reporte del usuario con captura: "más bonitos /
// alineados"). Las tres reglas que hacen que una columna de dinero se lea como
// columna de dinero, y por qué la versión anterior fallaba:
//
//   1. ANCHOS FIJOS. La tabla era de layout automático, así que el ancho de la
//      nota ("as of Aug 14, 2026" contra "2 payments" contra nada) decidía
//      dónde terminaba el número de ESA fila: cuatro cifras, cuatro bordes
//      derechos distintos. Con `table-layout:fixed` + anchos declarados, la
//      columna del valor tiene el mismo borde derecho en todas las filas.
//   2. CIFRAS TABULARES. `font-variant-numeric:tabular-nums` fuerza a que todo
//      dígito ocupe lo mismo, así los millares caen unos debajo de otros en
//      vez de bailar según los dígitos que toquen.
//   3. MISMOS DECIMALES. Un "26,752.5" al lado de un "7,794.93" rompe la
//      columna aunque el borde derecho esté perfecto; eso se arregla en quien
//      formatea (los dos correos usan 2 decimales fijos), no aquí.

const INK = '#111827'
const MUTED = '#6b7280'
const FAINT = '#9ca3af'
const RULE = '#eceef1'
const PANEL = '#f7f8fa'
const ACCENT = '#2563eb'

// Cifras alineadas: mismo ancho por dígito en cualquier cliente que lo soporte
// (Apple Mail, Gmail web, Outlook web), y degradación silenciosa donde no.
const NUM = 'font-variant-numeric:tabular-nums;-moz-font-feature-settings:"tnum";font-feature-settings:"tnum"'
const FONT = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif'

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

function padLeft(s, width) {
  const str = String(s ?? '')
  return str.length >= width ? str : ' '.repeat(width - str.length) + str
}

function renderRowsHtml(rows) {
  const lastIdx = rows.length - 1
  const cells = rows.map(([label, value, note], i) => {
    const border = i === lastIdx ? 'none' : `1px solid ${RULE}`
    return `
        <tr>
          <td width="40%" style="width:40%;padding:11px 8px 11px 0;border-bottom:${border};color:${MUTED};font-size:14px;line-height:1.35">${esc(label)}</td>
          <td width="33%" style="width:33%;padding:11px 0;border-bottom:${border};text-align:right;color:${INK};font-size:15px;font-weight:600;white-space:nowrap;${NUM}">${esc(value)}</td>
          <td width="27%" style="width:27%;padding:11px 0 11px 10px;border-bottom:${border};text-align:right;color:${FAINT};font-size:12px;line-height:1.35;${NUM}">${esc(note || '')}</td>
        </tr>`
  }).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup><col style="width:40%" /><col style="width:33%" /><col style="width:27%" /></colgroup>${cells}
      </table>`
}

// En texto plano la alineación se logra con relleno: la columna de valores
// termina toda en la misma posición, igual que en el HTML.
function renderRowsText(rows) {
  const labelW = Math.min(24, Math.max(...rows.map(([label]) => String(label).length)) + 2)
  const valueW = Math.max(...rows.map(([, value]) => String(value ?? '').length))
  return rows.map(([label, value, note]) =>
    `  ${padRight(label, labelW)}${padLeft(value, valueW)}${note ? `   ${note}` : ''}`).join('\n')
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

  const htmlSections = sections.map((s, idx) => {
    const parts = []
    // El espacio entre secciones lo pone el padding de la fila, NUNCA además
    // un margen del encabezado: sumados daban un hueco de casi cien píxeles
    // entre el botón de una sección y el título de la siguiente.
    if (s.heading) {
      parts.push(`<h2 style="margin:0 0 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};font-weight:700">${esc(s.heading)}</h2>`)
    }
    if (s.rows?.length) parts.push(renderRowsHtml(s.rows))
    for (const p of s.paragraphs || []) {
      parts.push(`<p style="margin:14px 0 0;font-size:14px;line-height:1.55;color:${INK}">${esc(p)}</p>`)
    }
    if (s.cta) {
      parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0"><tr><td style="border-radius:8px;background:${INK}"><a href="${esc(s.cta.url)}" style="display:inline-block;padding:11px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;font-family:${FONT}">${esc(s.cta.label)}</a></td></tr></table>`)
    }
    return `<tr><td style="padding:${idx === 0 ? '22px' : '30px'} 28px 0">${parts.join('\n        ')}</td></tr>`
  }).join('\n      ')

  // Estructura de tablas anidadas, no divs: es lo único que Outlook maqueta
  // igual que el resto. La tarjeta blanca sobre fondo gris es lo que hace que
  // el correo se lea como un documento y no como texto suelto en la bandeja.
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PANEL};margin:0;padding:0">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${RULE};border-radius:12px;font-family:${FONT};color:${INK}">
        <tr><td style="height:3px;background:${ACCENT};border-radius:12px 12px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr>
          <td style="padding:26px 28px 0">
            <h1 style="margin:0;font-size:21px;line-height:1.25;font-weight:700;color:${INK}">${esc(title)}</h1>
            ${subtitle ? `<p style="margin:5px 0 0;font-size:13px;color:${MUTED}">${esc(subtitle)}</p>` : ''}
          </td>
        </tr>
      ${htmlSections}
        <tr><td style="padding:28px 28px 0"><div style="height:1px;background:${RULE};font-size:0;line-height:0">&nbsp;</div></td></tr>
        <tr>
          <td style="padding:14px 28px 24px;font-size:11px;line-height:1.7;color:${FAINT}">
            ${reason ? `${esc(reason)}<br />` : ''}
            ${manageUrl ? `Manage or turn this off: <a href="${esc(manageUrl)}" style="color:${MUTED}">${esc(manageUrl)}</a><br />` : ''}
            ${NO_REPLY}<br />
            <span style="color:${MUTED};font-weight:600">Chispudo</span> · <a href="https://chispu.xyz" style="color:${FAINT};text-decoration:none">chispu.xyz</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`

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
