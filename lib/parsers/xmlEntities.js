// ⛔ FASE KD. Decodificar las entidades XML de un valor de atributo.
//
// El defecto que arregla: los cinco lectores de atributos de los parsers Flex
// devolvían el texto CRUDO, así que una posición de AT&T llegaba con
// `name: "AT&amp;T INC"` y se mostraba así, literal, en el portafolio del
// usuario. Verificado ejecutando los parsers reales sobre una fila con
// `description="AT&amp;T INC"`. Toca a cualquiera con un `&` en el nombre
// (AT&T, Procter & Gamble, Johnson & Johnson) y a las descripciones de
// transacciones ("WIRE FROM J&J TRUST").
//
// `&amp;` se decodifica AL FINAL a propósito: al revés, `&amp;lt;` se
// convertiría en `<` en vez de en el texto literal `&lt;`.
//
// Sobre un número o una fecha es un no-op, así que se aplica a TODO atributo en
// un solo lugar (la lección de FASE II: se arregla en el parser, no en cada
// caller) en vez de tener que acertar cuáles son texto.

const NAMED = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
]

export function decodeXmlEntities(value) {
  if (!value || typeof value !== 'string' || !value.includes('&')) return value
  let out = value
  for (const [re, ch] of NAMED) out = out.replace(re, ch)
  // Referencias numéricas: &#38; y &#x26;. Se acotan a lo representable para no
  // producir basura a partir de un valor fuera de rango.
  out = out.replace(/&#(\d+);/g, (m, d) => {
    const code = Number(d)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
  })
  out = out.replace(/&#x([0-9a-f]+);/gi, (m, h) => {
    const code = parseInt(h, 16)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
  })
  return out.replace(/&amp;/g, '&')
}
