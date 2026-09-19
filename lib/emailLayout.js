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
// FASE IE7: color SOLO en cifras con signo (variaciones), nunca en el
// patrimonio ni en un monto neutro. Tonos oscuros, no fluorescentes: tienen
// que leerse sobre blanco en un teléfono a plena luz.
const POS = '#047857'
const NEG = '#b91c1c'
const POS_BG = '#ecfdf5'
const NEG_BG = '#fef2f2'

// El signo decide el color, así que ninguna superficie tiene que declararlo:
// "+$39.49 (+0.15%)" es verde, "(3.47%)" y "-2.1%" son rojos, "$27,237.53" es
// neutro. Un monto sin signo NUNCA se colorea.
//
// ⛔ Y algo SIN NÚMERO tampoco, aunque empiece con un guión. Los cuatro correos
// usan "-" para decir "no hay dato" (`if (v == null) return '-'`), y ese guión
// caía en la rama de negativo: un dato que falta se pintaba EXACTAMENTE igual
// que una pérdida. Es la confusión que este repo trata como grave en todas sus
// superficies ("no se puede medir" y "perdiste" no pueden verse iguales), y
// acá vivía en el renderer compartido, así que afectaba al semanal, al mensual
// y al anual desde que existen. Exigir un dígito es lo que la separa: un texto
// sin cifras no es un número y no tiene signo que colorear.
function toneOf(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  if (!/\d/.test(s)) return null
  if (s.startsWith('+')) return 'pos'
  if (s.startsWith('-') || s.startsWith('(')) return 'neg'
  return null
}

function toneColor(tone) {
  return tone === 'pos' ? POS : tone === 'neg' ? NEG : null
}

// Cifras alineadas: mismo ancho por dígito en cualquier cliente que lo soporte
// (Apple Mail, Gmail web, Outlook web), y degradación silenciosa donde no.
const NUM = 'font-variant-numeric:tabular-nums;-moz-font-feature-settings:"tnum";font-feature-settings:"tnum"'
const FONT = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif'

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// FASE ON. El texto de VISTA PREVIA: lo único del correo que alguien ve ANTES
// de abrirlo, en la lista del buzón o en la pantalla de bloqueo.
//
// Reporte del usuario, con captura de su iPhone: el asunto decía "Chispudo
// Weekly · Sep 7-13, 2026" (limpio) y debajo, sin abrir nada, se leía su
// patrimonio completo. Ese dato es sensible y no puede vivir donde se ve sin
// desbloquear el teléfono.
//
// Un cliente que no encuentra preheader arma el snippet con lo primero que
// haya en el cuerpo, y lo primero del cuerpo era la cifra grande. Así que
// ahora todo correo declara su propia línea de vista previa, sin números, y va
// ANTES que cualquier otra cosa: en el HTML como bloque oculto, y en el texto
// plano como primera línea (hay clientes que arman el snippet de ahí).
//
// ⛔ Y esto NO alcanza solo, por eso existe la otra mitad (`portfolioHero`):
//   - un cliente que respeta `display:none` para extraer el snippet no ve el
//     preheader Y tampoco el relleno, así que cae al contenido visible;
//   - un resumen generado en el dispositivo (el iOS del usuario parafrasea el
//     correo entero: "Net worth $X as of ...; year to date gain +$Y") lee TODO
//     el cuerpo, y desde acá no hay cabecera que lo apague.
// Lo único que garantiza que un monto no aparezca antes de abrir el correo es
// que no esté en el cuerpo. El preheader cubre a todo cliente clásico; sacar
// el total del cuerpo cubre al resto.
const PREHEADER_PAD = '&#8203;&nbsp;'.repeat(60)

function renderPreheader(text) {
  if (!text) return ''
  // El relleno de anchos-cero empuja el contenido visible fuera de la ventana
  // del snippet: sin él, el cliente pega la cifra grande justo después de la
  // frase neutra y el preheader no sirve de nada.
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#ffffff;mso-hide:all">${esc(text)}${PREHEADER_PAD}</div>`
}

// La línea que explica la ausencia del total. Compartida por los tres correos
// de portafolio: tres redacciones distintas para la misma decisión es cómo una
// termina prometiendo un interruptor que se llama de otra forma.
export const HIDDEN_TOTAL_NOTE =
  'Your net worth is kept out of this email so it does not show up in your phone’s preview. You can turn it on in Settings.'

/**
 * FASE ON. La cifra principal de un correo de portafolio, con el total detrás
 * de una decisión explícita.
 *
 * Vive acá y no en cada correo porque los tres (semanal, mensual, anual) la
 * toman igual: dos copias de esta regla es como uno de ellos se queda
 * filtrando el patrimonio cuando los otros dos ya no.
 *
 * Con el total oculto la cifra principal pasa a ser la VARIACIÓN del período,
 * que es lo que el correo vino a contar de todos modos: un "+0.74% esta
 * semana" no dice cuánto dinero tenés, y es lo que puede aparecer en una
 * vista previa sin costo. Sin variación medible no hay cifra principal y el
 * correo simplemente no la dibuja, en vez de imprimir un "-" grande.
 *
 * @param {object}  input
 * @param {boolean} input.showTotal  Decisión del usuario (`emailShowNetWorth`).
 * @param {object}  input.total      { label, value } ya formateados.
 * @param {object}  input.change     { label, combo, abs, pct, suffix } ya formateados.
 * @param {string}  [input.asOf]
 */
export function portfolioHero({ showTotal, total, change, asOf = null }) {
  const delta = change?.combo
    ? `${change.combo}${change.suffix ? ` ${change.suffix}` : ''}`
    : null
  if (showTotal && total?.value) {
    return { label: total.label, value: total.value, delta, asOf }
  }
  const value = change?.pct || change?.abs || null
  if (!value) return null
  return {
    label: change.label,
    value,
    // El monto de la variación baja a la pastilla, que es la que lleva color
    // por signo; el porcentaje queda de cifra grande. Con solo uno de los dos,
    // ese uno es la cifra y la pastilla no existe.
    delta: (change.pct && change.abs) ? change.abs : null,
    asOf,
  }
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

// Una fila puede venir como array [label, value, note] (lo de siempre) o como
// objeto { label, value, note, wide }. `wide` existe por un bug real: los
// "movers" de la semana son una LISTA, no una cifra, y metidos en la columna
// de números con `white-space:nowrap` se salían de la tarjeta en el teléfono
// (captura del usuario). Una lista va a lo ancho, debajo de su etiqueta.
function normalizeRow(r) {
  if (Array.isArray(r)) return { label: r[0], value: r[1], note: r[2] }
  return r || {}
}

function renderRowsHtml(rows) {
  const lastIdx = rows.length - 1
  const cells = rows.map((raw, i) => {
    const { label, value, note, wide } = normalizeRow(raw)
    const border = i === lastIdx ? 'none' : `1px solid ${RULE}`
    if (wide) {
      return `
        <tr>
          <td colspan="3" style="padding:11px 0;border-bottom:${border}">
            <div style="color:${MUTED};font-size:12px;line-height:1.35;margin-bottom:3px">${esc(label)}</div>
            <div style="color:${INK};font-size:14px;line-height:1.5;${NUM}">${esc(value)}</div>
          </td>
        </tr>`
    }
    const vColor = toneColor(toneOf(value)) || INK
    const nColor = toneColor(toneOf(note)) || FAINT
    return `
        <tr>
          <td width="40%" style="width:40%;padding:11px 8px 11px 0;border-bottom:${border};color:${MUTED};font-size:14px;line-height:1.35">${esc(label)}</td>
          <td width="33%" style="width:33%;padding:11px 0;border-bottom:${border};text-align:right;color:${vColor};font-size:15px;font-weight:600;white-space:nowrap;${NUM}">${esc(value)}</td>
          <td width="27%" style="width:27%;padding:11px 0 11px 10px;border-bottom:${border};text-align:right;color:${nColor};font-size:12px;line-height:1.35;${NUM}">${esc(note || '')}</td>
        </tr>`
  }).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup><col style="width:40%" /><col style="width:33%" /><col style="width:27%" /></colgroup>${cells}
      </table>`
}

// La cifra principal del correo: el patrimonio grande, con su variación del
// período como pastilla de color debajo. Es lo primero que alguien quiere ver
// al abrir el correo, y antes vivía como una fila más de la tabla.
function renderHeroHtml({ label, value, delta, asOf }) {
  const tone = toneOf(delta)
  const chip = delta
    ? `<div style="margin-top:8px"><span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${tone === 'neg' ? NEG_BG : tone === 'pos' ? POS_BG : PANEL};color:${toneColor(tone) || MUTED};font-size:13px;font-weight:600;${NUM}">${esc(delta)}</span></div>`
    : ''
  return `<div style="padding-bottom:4px">
          <div style="color:${MUTED};font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">${esc(label)}</div>
          <div style="color:${INK};font-size:30px;line-height:1.15;font-weight:700;margin-top:4px;${NUM}">${esc(value)}</div>
          ${chip}
          ${asOf ? `<div style="color:${FAINT};font-size:11px;margin-top:8px">${esc(asOf)}</div>` : ''}
        </div>`
}

// En texto plano la alineación se logra con relleno: la columna de valores
// termina toda en la misma posición, igual que en el HTML.
function renderRowsText(rows) {
  const norm = rows.map(normalizeRow)
  const narrow = norm.filter((r) => !r.wide)
  const labelW = narrow.length
    ? Math.min(24, Math.max(...narrow.map((r) => String(r.label).length)) + 2)
    : 2
  const valueW = narrow.length
    ? Math.max(...narrow.map((r) => String(r.value ?? '').length))
    : 0
  return norm.map((r) => (r.wide
    ? `  ${r.label}:\n    ${r.value}`
    : `  ${padRight(r.label, labelW)}${padLeft(r.value, valueW)}${r.note ? `   ${r.note}` : ''}`)).join('\n')
}

/**
 * @param {object} doc
 * @param {string} doc.title      Encabezado grande (también sirve de asunto).
 * @param {string} [doc.subtitle] Período cubierto, fecha de generación.
 * @param {Array}  doc.sections   [{ heading, hero?, rows?, paragraphs?, cta? }]
 * @param {string} [doc.manageUrl] Enlace para apagar o cambiar la suscripción.
 * @param {string} [doc.reason]    Por qué recibe este correo (una línea).
 * @param {string} [doc.preheader] Texto de vista previa. SIN números: es lo
 *                                 único que se ve antes de abrir el correo.
 */
export function renderEmail({ title, subtitle, sections = [], manageUrl, reason, preheader }) {
  const NO_REPLY = 'This is an automated message. Please do not reply to this address.'

  const htmlSections = sections.map((s, idx) => {
    const parts = []
    if (s.hero) parts.push(renderHeroHtml(s.hero))
    // El espacio entre secciones lo pone el padding de la fila, NUNCA además
    // un margen del encabezado: sumados daban un hueco de casi cien píxeles
    // entre el botón de una sección y el título de la siguiente.
    if (s.heading) {
      parts.push(`<h2 style="margin:${s.hero ? '22px' : '0'} 0 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};font-weight:700">${esc(s.heading)}</h2>`)
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
  const html = `${renderPreheader(preheader)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PANEL};margin:0;padding:0">
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
    if (s.hero) {
      parts.push([
        `${s.hero.label}: ${s.hero.value}`,
        s.hero.delta ? `  ${s.hero.delta}` : null,
        s.hero.asOf || null,
      ].filter(Boolean).join('\n'))
    }
    if (s.heading) parts.push(s.heading.toUpperCase())
    if (s.rows?.length) parts.push(renderRowsText(s.rows))
    for (const p of s.paragraphs || []) parts.push(p)
    if (s.cta) parts.push(`${s.cta.label}: ${s.cta.url}`)
    return parts.join('\n')
  }).join('\n\n')

  const text = [
    // El preheader va PRIMERO también acá: hay clientes que arman el snippet
    // con el text/plain, y si el título abriera la versión de texto el número
    // que sigue volvería a quedar a la vista.
    preheader || null,
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
