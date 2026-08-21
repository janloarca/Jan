// FASE KP. La ficha de instrumento: lo que un asesor captura en Chispu para
// presentarle un producto de inversión a su cliente, y que se adjunta a un
// link compartido (decisión del usuario: SOLO adjunta al link, sin página
// suelta ni tokens nuevos). La anatomía viene de los teasers REALES de la
// región (Conacaste y FLQ de IDC): nombre + insignia de rating → resumen
// ejecutivo → highlights → CARACTERÍSTICAS como tabla label/valor con el
// monto mínimo de primera fila → descripción ("¿qué es este producto?") →
// riesgos → contacto del asesor → disclaimer de confidencialidad → link al
// prospecto completo (dos niveles, teaser → documento).
//
// Los docs viven en `users/{uid}/instruments/{id}`: CRUD del dueño ya cubierto
// por las rules (deny global + owner bajo users/{uid}/**), cero cambios ahí.
//
// DOS fronteras, una por dirección, y las dos viven acá para que no diverjan:
//  - `sanitizeInstrumentInput`: lo que el DUEÑO guarda. Topes por campo para
//    que un doc no crezca sin límite ni lleve tipos raros.
//  - `publicInstrument`: lo que el LINK publica. Proyección ALLOWLIST: solo
//    las claves conocidas sobreviven, así que un campo que alguien agregue al
//    doc en el futuro NO sale al público por accidente. Es la frontera de
//    confianza del servidor y NO hereda la del guardado.
//
// La ficha viaja en los TRES modos del link (both/amounts/percent) a
// propósito: describe el producto del EMISOR (tasa, plazo, monto mínimo),
// nunca el portafolio del cliente, así que no hay monto del cliente que
// esconder. El barrido de fugas del payload lo re-verifica igual.

export const MAX_ATTACHED_INSTRUMENTS = 6

const CAPS = {
  name: 80,
  ratingGrade: 10,
  ratingAgency: 40,
  heroLabel: 40,
  heroValue: 60,
  summary: 600,
  highlight: 200,
  termLabel: 60,
  termValue: 160,
  description: 2000,
  risks: 1500,
  disclaimer: 1000,
  url: 300,
}

export const LIMITS = { heroFacts: 4, highlights: 8, terms: 24 }

// El disclaimer que se muestra cuando el asesor no escribió uno propio: el
// fraseo de confidencialidad estándar de un teaser. La página elige el idioma
// con su propio toggle, por eso las dos versiones viven juntas.
export const DEFAULT_DISCLAIMER = {
  es: 'Documento informativo preparado para el destinatario; no constituye una oferta pública ni asesoría de inversión. Condiciones sujetas al prospecto oficial del emisor.',
  en: 'Informational document prepared for the recipient; it is not a public offering or investment advice. Terms are subject to the issuer\'s official prospectus.',
}

const str = (v, max) => {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s || null
}

// Solo https sobrevive: un `javascript:` acá terminaría como href en la página
// del CLIENTE, y un `http:` degradaría a un documento financiero sin TLS.
export function sanitizeUrl(raw) {
  const s = str(raw, CAPS.url)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

function sanitizeRating(raw) {
  if (!raw || typeof raw !== 'object') return null
  const grade = str(raw.grade, CAPS.ratingGrade)
  const agency = str(raw.agency, CAPS.ratingAgency)
  return grade ? { grade, agency } : null
}

function sanitizePairs(raw, { max, labelCap, valueCap }) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const label = str(row.label, labelCap)
    const value = str(row.value, valueCap)
    // Una fila a medias no informa nada: se descarta entera.
    if (!label || !value) continue
    out.push({ label, value })
    if (out.length >= max) break
  }
  return out
}

function sanitizeHighlights(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((h) => str(h, CAPS.highlight))
    .filter(Boolean)
    .slice(0, LIMITS.highlights)
}

/**
 * Valida lo que el dueño guarda. Devuelve { ok: true, data } con el cuerpo
 * listo para Firestore, o { ok: false, error } con la razón. `data` NUNCA
 * lleva claves fuera de este contrato.
 */
export function sanitizeInstrumentInput(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'empty' }
  const name = str(raw.name, CAPS.name)
  if (!name) return { ok: false, error: 'name-required' }
  return {
    ok: true,
    data: {
      name,
      rating: sanitizeRating(raw.rating),
      heroFacts: sanitizePairs(raw.heroFacts, { max: LIMITS.heroFacts, labelCap: CAPS.heroLabel, valueCap: CAPS.heroValue }),
      summary: str(raw.summary, CAPS.summary),
      highlights: sanitizeHighlights(raw.highlights),
      terms: sanitizePairs(raw.terms, { max: LIMITS.terms, labelCap: CAPS.termLabel, valueCap: CAPS.termValue }),
      description: str(raw.description, CAPS.description),
      risks: str(raw.risks, CAPS.risks),
      disclaimer: str(raw.disclaimer, CAPS.disclaimer),
      externalUrl: sanitizeUrl(raw.externalUrl),
    },
  }
}

/**
 * La proyección que se PUBLICA en el payload del link. Allowlist estricta:
 * re-sanea cada campo (la frontera no hereda confianza del guardado) y solo
 * emite claves conocidas. Un doc ilegible devuelve null y el link simplemente
 * no muestra esa ficha.
 */
export function publicInstrument(doc) {
  if (!doc || typeof doc !== 'object') return null
  const name = str(doc.name, CAPS.name)
  if (!name) return null
  return {
    id: typeof doc.id === 'string' ? doc.id.slice(0, 64) : null,
    name,
    rating: sanitizeRating(doc.rating),
    heroFacts: sanitizePairs(doc.heroFacts, { max: LIMITS.heroFacts, labelCap: CAPS.heroLabel, valueCap: CAPS.heroValue }),
    summary: str(doc.summary, CAPS.summary),
    highlights: sanitizeHighlights(doc.highlights),
    terms: sanitizePairs(doc.terms, { max: LIMITS.terms, labelCap: CAPS.termLabel, valueCap: CAPS.termValue }),
    description: str(doc.description, CAPS.description),
    risks: str(doc.risks, CAPS.risks),
    disclaimer: str(doc.disclaimer, CAPS.disclaimer),
    url: sanitizeUrl(doc.externalUrl),
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt.slice(0, 40) : null,
  }
}

// Los ids de ficha que un link lleva adjuntos: forma de id propia (los genera
// el hook con [a-z0-9_-]), dedupe, y el cap que acota las lecturas del GET.
export function sanitizeInstrumentIds(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const id of raw) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue
    if (out.includes(id)) continue
    out.push(id)
    if (out.length >= MAX_ATTACHED_INSTRUMENTS) break
  }
  return out
}
