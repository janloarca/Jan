/**
 * @jest-environment node
 */
// FASE KP. Las dos fronteras de la ficha de instrumento: lo que el dueño
// guarda (topes) y lo que el link publica (allowlist). La allowlist es la que
// importa de verdad: un campo agregado al doc en el futuro NO puede salir al
// público por accidente.

import {
  sanitizeInstrumentInput, publicInstrument, sanitizeUrl, sanitizeInstrumentIds,
  MAX_ATTACHED_INSTRUMENTS, LIMITS, DEFAULT_DISCLAIMER,
} from '../instrumentSheet'

describe('sanitizeUrl: solo https sobrevive', () => {
  test('https pasa tal cual; todo lo demás muere en null', () => {
    expect(sanitizeUrl('https://idcvalores.gt/prospecto.pdf')).toBe('https://idcvalores.gt/prospecto.pdf')
    // Un javascript: acá terminaría como href en la página del CLIENTE.
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeUrl('http://idcvalores.gt/prospecto.pdf')).toBeNull()
    expect(sanitizeUrl('data:text/html,<h1>x</h1>')).toBeNull()
    expect(sanitizeUrl('ftp://x.com/a')).toBeNull()
    expect(sanitizeUrl('no es una url')).toBeNull()
    expect(sanitizeUrl('')).toBeNull()
    expect(sanitizeUrl(42)).toBeNull()
  })
})

describe('sanitizeInstrumentInput: los topes del guardado', () => {
  const full = {
    name: 'Bono Conacaste 8%',
    rating: { grade: 'AA- GT', agency: 'Fitch Centroamérica' },
    heroFacts: [
      { label: 'Tasa', value: '8% anual' },
      { label: 'Plazo', value: '10 años' },
      { label: 'Monto mínimo', value: 'Q10,000' },
      { label: 'Periodicidad', value: 'Semestral' },
      { label: 'Extra que no cabe', value: 'x' },
    ],
    summary: 'Bono corporativo con garantía fiduciaria.',
    highlights: ['Emisor con 20 años de historia', 'Garantía sobre el proyecto'],
    terms: [
      { label: 'Monto mínimo', value: 'Q10,000.00' },
      { label: 'Valor nominal', value: 'Q5,000.00' },
    ],
    description: 'Qué es este producto.',
    risks: 'Riesgo de crédito del emisor.',
    disclaimer: null,
    externalUrl: 'https://idcvalores.gt/conacaste.pdf',
  }

  test('un doc completo entra con su forma exacta y sin claves extra', () => {
    const r = sanitizeInstrumentInput({ ...full, secreto: 'nope', uid: 'u1' })
    expect(r.ok).toBe(true)
    expect(Object.keys(r.data).sort()).toEqual([
      'description', 'disclaimer', 'externalUrl', 'heroFacts', 'highlights',
      'name', 'rating', 'risks', 'summary', 'terms',
    ])
    expect(r.data.secreto).toBeUndefined()
    // heroFacts se recorta al límite (el quinto no cabe).
    expect(r.data.heroFacts).toHaveLength(LIMITS.heroFacts)
  })

  test('el nombre es obligatorio; sin él no hay ficha', () => {
    expect(sanitizeInstrumentInput({ summary: 'x' })).toEqual({ ok: false, error: 'name-required' })
    expect(sanitizeInstrumentInput(null)).toEqual({ ok: false, error: 'empty' })
    expect(sanitizeInstrumentInput({ name: '   ' }).ok).toBe(false)
  })

  test('los topes recortan, nunca rechazan: un nombre largo se guarda cortado', () => {
    const r = sanitizeInstrumentInput({ name: 'x'.repeat(500), summary: 'y'.repeat(5000) })
    expect(r.ok).toBe(true)
    expect(r.data.name).toHaveLength(80)
    expect(r.data.summary).toHaveLength(600)
  })

  test('una fila de términos a medias se descarta entera', () => {
    const r = sanitizeInstrumentInput({
      name: 'X',
      terms: [
        { label: 'Tasa', value: '8%' },
        { label: 'Sin valor' },
        { value: 'sin label' },
        { label: 42, value: 'tipos raros' },
      ],
    })
    expect(r.data.terms).toEqual([{ label: 'Tasa', value: '8%' }])
  })

  test('los términos se recortan al cap de filas', () => {
    const terms = Array.from({ length: 40 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }))
    const r = sanitizeInstrumentInput({ name: 'X', terms })
    expect(r.data.terms).toHaveLength(LIMITS.terms)
  })
})

describe('publicInstrument: la allowlist que publica el link', () => {
  test('solo las claves conocidas sobreviven; lo desconocido muere en la frontera', () => {
    const pub = publicInstrument({
      id: 'inst_1', name: 'Bono Conacaste', uid: 'owner-uid', internalNotes: 'no publicar',
      clientList: ['a', 'b'], summary: 'ok',
    })
    expect(pub.name).toBe('Bono Conacaste')
    expect(pub.uid).toBeUndefined()
    expect(pub.internalNotes).toBeUndefined()
    expect(pub.clientList).toBeUndefined()
    expect(Object.keys(pub).sort()).toEqual([
      'description', 'disclaimer', 'heroFacts', 'highlights', 'id', 'name',
      'rating', 'risks', 'summary', 'terms', 'updatedAt', 'url',
    ])
  })

  test('re-sanea aunque el doc venga del guardado: la frontera no hereda confianza', () => {
    const pub = publicInstrument({
      name: 'X', externalUrl: 'javascript:alert(1)',
      heroFacts: [{ label: 42, value: 'x' }, { label: 'Tasa', value: '8%' }],
      highlights: [null, 42, 'real'],
    })
    expect(pub.url).toBeNull()
    expect(pub.heroFacts).toEqual([{ label: 'Tasa', value: '8%' }])
    expect(pub.highlights).toEqual(['real'])
  })

  test('un doc ilegible o sin nombre devuelve null y el link no lo muestra', () => {
    expect(publicInstrument(null)).toBeNull()
    expect(publicInstrument({ summary: 'sin nombre' })).toBeNull()
    expect(publicInstrument('string')).toBeNull()
  })
})

describe('sanitizeInstrumentIds: lo que un link puede llevar adjunto', () => {
  test('dedupe, cap, y solo ids con la forma propia', () => {
    const ids = sanitizeInstrumentIds([
      'inst_1', 'inst_1', 'inst_2', '../../etc/passwd', 'con espacios no',
      'x'.repeat(100), 'inst_3', 'inst_4', 'inst_5', 'inst_6', 'inst_7', 'inst_8',
    ])
    expect(ids).toHaveLength(MAX_ATTACHED_INSTRUMENTS)
    expect(ids.slice(0, 3)).toEqual(['inst_1', 'inst_2', 'inst_3'])
    expect(ids).not.toContain('../../etc/passwd')
  })

  test('cualquier cosa que no sea array devuelve []', () => {
    expect(sanitizeInstrumentIds(null)).toEqual([])
    expect(sanitizeInstrumentIds('inst_1')).toEqual([])
  })
})

describe('el disclaimer default existe en los dos idiomas', () => {
  test('ES y EN presentes, y sin guión largo (regla de copy del repo)', () => {
    expect(DEFAULT_DISCLAIMER.es.length).toBeGreaterThan(40)
    expect(DEFAULT_DISCLAIMER.en.length).toBeGreaterThan(40)
    expect(DEFAULT_DISCLAIMER.es).not.toContain('—')
    expect(DEFAULT_DISCLAIMER.en).not.toContain('—')
  })
})
