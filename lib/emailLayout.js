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
// FASE QD. FAINT era #9ca3af: 2.5:1 sobre blanco, bajo el piso de 4.5:1 de
// texto. Eran justamente las notas ("2 payments", "as of ...") y el pie, que
// son lo que se lee con sol. Ahora llega (~4.8:1); la jerarquía la llevan el
// tamaño y el peso, no un gris que no se alcanza a leer.
const FAINT = '#6b7280'
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

// FASE QD. Modo oscuro. Los estilos inline son los de modo claro (lo que
// ven todos los clientes que ignoran <style>); estas clases solo los
// sobreescriben cuando el cliente declara prefers-color-scheme: dark. Sin
// esto, Apple Mail y Gmail invierten la tarjeta por su cuenta y a veces dejan
// gris sobre gris.
export const LIGHT = { card: '#ffffff', ink: INK, muted: MUTED, faint: FAINT, pos: POS, neg: NEG, posBg: POS_BG, negBg: NEG_BG, panel: PANEL }

export const DARK = {
  bg: '#0f1115', card: '#181b21', ink: '#f3f4f6', muted: '#9ca3af',
  rule: '#2a2e36', pos: '#34d399', neg: '#f87171',
  posBg: '#12332a', negBg: '#3a1a1d', panel: '#232730',
}

const DARK_CSS = `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
  .em-bg{background:${DARK.bg} !important}
  .em-card{background:${DARK.card} !important;border-color:${DARK.rule} !important}
  .em-ink{color:${DARK.ink} !important}
  .em-muted{color:${DARK.muted} !important}
  .em-pos{color:${DARK.pos} !important}
  .em-neg{color:${DARK.neg} !important}
  .em-rule{border-color:${DARK.rule} !important}
  .em-hr{background:${DARK.rule} !important}
  .em-chip-pos{background:${DARK.posBg} !important}
  .em-chip-neg{background:${DARK.negBg} !important}
  .em-chip-flat{background:${DARK.panel} !important}
  .em-btn{background:${DARK.ink} !important}
  .em-btn a{color:#111827 !important}
}
</style>`

function toneClass(tone) {
  return tone === 'pos' ? 'em-pos' : tone === 'neg' ? 'em-neg' : null
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// FASE OO. El texto de VISTA PREVIA: lo único del correo que alguien ve ANTES
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

/**
 * FASE QD. Arma la línea de vista previa a partir de lo que ESTE correo trae.
 *
 * Antes todos decían la misma frase de relleno cada semana, y es el único
 * texto que se lee en la lista del buzón. Ahora nombra el contenido real
 * ("the income you collected", "the biggest movers") sin un solo dígito ni
 * ticker: la presencia de una sección no es un dato sensible, un monto sí, y
 * un ticker dice qué tenés. Tiene que llenar la ventana del snippet sola
 * (>= 100 caracteres, medido en FASE OO), así que si el contenido es poco se
 * completa con la aclaración de que las cifras están adentro.
 *
 * @param {string}   lead    p.ej. "Your week in Chispudo:"
 * @param {string[]} parts   frases nominales, p.ej. ["how the portfolio moved"]
 * @param {string}   closing p.ej. "Open to see the numbers."
 */
export function composePreheader(lead, parts, closing) {
  const list = parts.filter(Boolean)
  const body = list.length <= 1
    ? list.join('')
    : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
  let out = `${lead} ${body}. ${closing}`
  if (out.length < 110) out += ' The figures stay inside the email, not on your lock screen.'
  return out.replace(/\d/g, '')
}

// La línea que explica la ausencia del total. Compartida por los tres correos
// de portafolio: tres redacciones distintas para la misma decisión es cómo una
// termina prometiendo un interruptor que se llama de otra forma.
export const HIDDEN_TOTAL_NOTE =
  'Your net worth is kept out of this email so it does not show up in your phone’s preview. You can turn it on in Settings.'

/**
 * FASE OO. La cifra principal de un correo de portafolio, con el total detrás
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

// Una lista de filas (symbol + valor) dentro de una fila ancha. Cada valor
// lleva su color por signo, como en cualquier otra cifra con signo del correo.
function renderItemsHtml(items) {
  const trs = items.map((it) => {
    const tone = toneOf(it.value)
    const cl = toneClass(tone)
    return `<tr><td style="padding:3px 8px 3px 0;color:${INK};font-size:14px;line-height:1.4" class="em-ink">${esc(it.label)}</td><td align="right" style="padding:3px 0;font-size:14px;font-weight:600;line-height:1.4;color:${toneColor(tone) || INK};${NUM}" class="${cl || 'em-ink'}">${esc(it.value)}</td></tr>`
  }).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-top:2px">${trs}</table>`
}

function renderRowsHtml(rows) {
  const lastIdx = rows.length - 1
  const cells = rows.map((raw, i) => {
    const { label, value, note, wide, items } = normalizeRow(raw)
    const border = i === lastIdx ? 'none' : `1px solid ${RULE}`
    if (wide) {
      const body = items?.length
        ? renderItemsHtml(items)
        : `<div style="color:${INK};font-size:14px;line-height:1.5;${NUM}" class="em-ink">${esc(value)}</div>`
      return `
        <tr>
          <td colspan="3" class="em-rule" style="padding:11px 0;border-bottom:${border}">
            <div class="em-muted" style="color:${MUTED};font-size:12px;line-height:1.35;margin-bottom:3px">${esc(label)}</div>
            ${body}
          </td>
        </tr>`
    }
    const vTone = toneOf(value)
    const nTone = toneOf(note)
    const vColor = toneColor(vTone) || INK
    const nColor = toneColor(nTone) || FAINT
    return `
        <tr>
          <td width="40%" class="em-rule em-muted" style="width:40%;padding:11px 8px 11px 0;border-bottom:${border};color:${MUTED};font-size:14px;line-height:1.35">${esc(label)}</td>
          <td width="33%" class="em-rule ${toneClass(vTone) || 'em-ink'}" style="width:33%;padding:11px 0;border-bottom:${border};text-align:right;color:${vColor};font-size:15px;font-weight:600;white-space:nowrap;${NUM}">${esc(value)}</td>
          <td width="27%" class="em-rule ${toneClass(nTone) || 'em-muted'}" style="width:27%;padding:11px 0 11px 10px;border-bottom:${border};text-align:right;color:${nColor};font-size:12px;line-height:1.35;${NUM}">${esc(note || '')}</td>
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
    ? `<div style="margin-top:8px"><span class="${tone === 'neg' ? 'em-chip-neg em-neg' : tone === 'pos' ? 'em-chip-pos em-pos' : 'em-chip-flat em-muted'}" style="display:inline-block;padding:5px 10px;border-radius:999px;background:${tone === 'neg' ? NEG_BG : tone === 'pos' ? POS_BG : PANEL};color:${toneColor(tone) || MUTED};font-size:13px;font-weight:600;${NUM}">${esc(delta)}</span></div>`
    : ''
  return `<div style="padding-bottom:4px">
          <div class="em-muted" style="color:${MUTED};font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700">${esc(label)}</div>
          <div class="em-ink" style="color:${INK};font-size:30px;line-height:1.15;font-weight:700;margin-top:4px;${NUM}">${esc(value)}</div>
          ${chip}
          ${asOf ? `<div class="em-muted" style="color:${FAINT};font-size:11px;margin-top:8px">${esc(asOf)}</div>` : ''}
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
    ? (r.items?.length
      ? `  ${r.label}:\n${r.items.map((it) => `    ${padRight(it.label, 10)}${padLeft(it.value, 9)}`).join('\n')}`
      : `  ${r.label}:\n    ${r.value}`)
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
      parts.push(`<h2 class="em-muted" style="margin:${s.hero ? '22px' : '0'} 0 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};font-weight:700">${esc(s.heading)}</h2>`)
    }
    if (s.rows?.length) parts.push(renderRowsHtml(s.rows))
    for (const p of s.paragraphs || []) {
      parts.push(`<p class="em-ink" style="margin:14px 0 0;font-size:14px;line-height:1.55;color:${INK}">${esc(p)}</p>`)
    }
    if (s.cta) {
      parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0"><tr><td class="em-btn" style="border-radius:8px;background:${INK}"><a href="${esc(s.cta.url)}" style="display:inline-block;padding:11px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;font-family:${FONT}">${esc(s.cta.label)}</a></td></tr></table>`)
    }
    // FASE QD. Las notas administrativas (qué va adjunto, por qué falta el
    // total) NO son contenido: van DESPUÉS del botón, chicas y grises. Antes
    // eran párrafos de tinta principal justo encima del botón y competían con
    // lo que el correo vino a decir.
    for (const n of s.notes || []) {
      parts.push(`<p class="em-muted" style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${MUTED}">${esc(n)}</p>`)
    }
    return `<tr><td style="padding:${idx === 0 ? '22px' : '30px'} 28px 0">${parts.join('\n        ')}</td></tr>`
  }).join('\n      ')

  // Estructura de tablas anidadas, no divs: es lo único que Outlook maqueta
  // igual que el resto. La tarjeta blanca sobre fondo gris es lo que hace que
  // el correo se lea como un documento y no como texto suelto en la bandeja.
  const html = `${renderPreheader(preheader)}${DARK_CSS}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-bg" style="width:100%;background:${PANEL};margin:0;padding:0">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="em-card" style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${RULE};border-radius:12px;font-family:${FONT};color:${INK}">
        <tr><td style="height:3px;background:${ACCENT};border-radius:12px 12px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
        <tr>
          <td style="padding:26px 28px 0">
            <h1 class="em-ink" style="margin:0;font-size:21px;line-height:1.25;font-weight:700;color:${INK}">${esc(title)}</h1>
            ${subtitle ? `<p class="em-muted" style="margin:5px 0 0;font-size:13px;color:${MUTED}">${esc(subtitle)}</p>` : ''}
          </td>
        </tr>
      ${htmlSections}
        <tr><td style="padding:28px 28px 0"><div class="em-hr" style="height:1px;background:${RULE};font-size:0;line-height:0">&nbsp;</div></td></tr>
        <tr>
          <td class="em-muted" style="padding:14px 28px 24px;font-size:11px;line-height:1.7;color:${FAINT}">
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
    for (const n of s.notes || []) parts.push(n)
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
