// World: el portafolio como una pequeña ciudad. Este módulo es la ÚNICA
// traducción de datos financieros a datos visuales, y es puro: la misma lista
// de activos dibuja siempre el mismo mundo (mismos edificios, mismos pisos,
// mismos trabajadores, en las mismas poses).
//
// ⛔ Reglas que lo gobiernan:
//   1. Nunca calcula un retorno ni escribe nada. Lee `getItemValue` (el mismo
//      valor con el que se suma el patrimonio) y nada más.
//   2. Los trabajadores son una METÁFORA visual, nunca una métrica: su número
//      sale de escalones logarítmicos sobre el dinero, con techo, así que un
//      portafolio de $1,000 y uno de $1,000,000 se ven igual de vivos.
//   3. El arquetipo de cada inversión se decide con reglas en orden fijo y se
//      DICE de dónde salió (`source`), para que una clasificación equivocada
//      se vea y se corrija con el override en vez de quedar como un misterio.
//
//   Override del usuario → subindustria → industria → notas → nombre →
//   sector heredado (texto) → tipo de activo → genérico
//   (FASE PR: lo que el usuario CLASIFICO a proposito, con el catalogo cerrado
//   de lib/classification.js, le gana a una palabra suelta en las notas.)

import { slotCapacity } from '@/lib/worldLayout'
import { archetypeForClassification } from '@/lib/classification'
import { variantOf, markFor } from '@/lib/worldMarks'
import { getItemValue, isExcludedFromNetWorth, accountKeyOfItem, getTypeCategory, itemLabel } from '@/components/dashboard/utils'

export const ARCHETYPES = [
  'BANK', 'INFRASTRUCTURE', 'CONSTRUCTION', 'TECH', 'REAL_ESTATE', 'ENERGY',
  'FINANCE', 'RETAIL', 'HEALTHCARE', 'LOGISTICS', 'AGRICULTURE', 'GENERIC_CORPORATE',
  // FASE PR: los tres casos donde el dibujo mentia mas (un ETF, un bono del
  // Tesoro y Bitcoin compartian la misma torre de "Finanzas"/"Tecnologia").
  'FUND_HALL', 'SOVEREIGN', 'DIGITAL_VAULT',
]

export const ARCHETYPE_LABELS = {
  BANK: { es: 'Banco', en: 'Bank' },
  INFRASTRUCTURE: { es: 'Infraestructura', en: 'Infrastructure' },
  CONSTRUCTION: { es: 'Construcción', en: 'Construction' },
  TECH: { es: 'Tecnología', en: 'Technology' },
  REAL_ESTATE: { es: 'Bienes raíces', en: 'Real estate' },
  ENERGY: { es: 'Energía', en: 'Energy' },
  FINANCE: { es: 'Finanzas', en: 'Finance' },
  RETAIL: { es: 'Comercio', en: 'Retail' },
  HEALTHCARE: { es: 'Salud', en: 'Healthcare' },
  LOGISTICS: { es: 'Logística', en: 'Logistics' },
  AGRICULTURE: { es: 'Agricultura', en: 'Agriculture' },
  GENERIC_CORPORATE: { es: 'Corporativo', en: 'Corporate' },
  FUND_HALL: { es: 'Fondos y capital privado', en: 'Funds & private capital' },
  SOVEREIGN: { es: 'Gobierno y soberanos', en: 'Government & sovereign' },
  DIGITAL_VAULT: { es: 'Activos digitales', en: 'Digital assets' },
}

export function archetypeLabel(key, lang = 'es') {
  const l = ARCHETYPE_LABELS[key] || ARCHETYPE_LABELS.GENERIC_CORPORATE
  return lang === 'en' ? l.en : l.es
}

// Palabras clave, en ORDEN DE PRIORIDAD. Lo que se FINANCIA le gana a la
// forma del instrumento: "bono que financia una carretera" tiene "bono"
// (finanzas) y "carretera" (infraestructura), y lo que el usuario quiere ver
// es la carretera. Por eso los sectores concretos van primero y BANK/FINANCE
// al final. Se comparan contra texto normalizado (sin acentos, minúsculas) y
// solo al INICIO de una palabra, para que "ia" no matchee dentro de "farmacia".
const KEYWORDS = [
  ['INFRASTRUCTURE', ['carretera', 'autopista', 'road', 'highway', 'puente', 'bridge', 'infraestructura', 'infrastructure', 'puerto', 'aeropuerto', 'airport', 'tunel', 'tunnel', 'ferrocarril', 'railway', 'agua potable', 'saneamiento']],
  ['ENERGY', ['energia', 'energy', 'solar', 'hidroelectric', 'electric', 'electricidad', 'eolic', 'wind farm', 'petrole', 'oil', 'gas natural', 'renovable', 'renewable', 'utilities', 'utility']],
  ['HEALTHCARE', ['salud', 'health', 'hospital', 'clinica', 'clinic', 'farmac', 'pharma', 'medic', 'biotech', 'laboratorio']],
  ['AGRICULTURE', ['agricol', 'agro', 'agricultur', 'cafe', 'coffee', 'azucar', 'sugar', 'finca', 'cultivo', 'farm', 'ganad', 'cattle', 'palma', 'cosecha', 'harvest']],
  ['LOGISTICS', ['logistic', 'transporte', 'transport', 'shipping', 'naviera', 'freight', 'carga', 'almacen', 'warehouse', 'bodega', 'flota', 'fleet', 'courier', 'trucking', 'airline']],
  ['CONSTRUCTION', ['construccion', 'construction', 'constructora', 'obra', 'edificacion', 'contratista', 'contractor', 'cemento', 'cement', 'engineering', 'ingenieria', 'building materials']],
  ['REAL_ESTATE', ['inmueble', 'inmobiliari', 'real estate', 'reit', 'apartamento', 'apartment', 'departamento', 'condominio', 'casa', 'house', 'terreno', 'propiedad', 'property', 'oficinas', 'alquiler', 'rental']],
  // FASE PR. Van DESPUES de los sectores concretos (un bono municipal que
  // financia una carretera sigue siendo la carretera: lo que se FINANCIA le
  // gana a la forma del instrumento) pero ANTES de TECH y de FINANCE/BANK:
  // son mas especificas que 'crypto'/'bitcoin' y que 'bono'/'treasury'/'etf',
  // que de otro modo se las comerian.
  ['SOVEREIGN', ['tesoro', 'treasury', 'treasuries', 'soberano', 'sovereign', 'gobierno', 'government', 'municipal']],
  ['DIGITAL_VAULT', ['crypto', 'cripto', 'blockchain', 'bitcoin', 'ethereum', 'stablecoin', 'defi', 'token']],
  ['FUND_HALL', ['private equity', 'venture capital', 'capital privado', 'capital de riesgo', 'hedge fund', 'etf', 'fondo de inversion', 'fondo mutuo', 'mutual fund', 'index fund']],
  ['TECH', ['tecnolog', 'technolog', 'software', 'tech', 'semiconductor', 'internet', 'cloud', 'saas', 'inteligencia artificial', 'datos', 'data center', 'fintech', 'crypto', 'cripto', 'blockchain', 'bitcoin', 'ethereum', 'communication services', 'telecom']],
  ['RETAIL', ['retail', 'tienda', 'store', 'supermercado', 'comercio', 'consumer', 'consumo', 'restaurante', 'restaurant', 'franquicia', 'franchise', 'e-commerce', 'ecommerce']],
  ['BANK', ['banco', 'bank', 'bancari', 'monetaria', 'ahorro', 'savings', 'checking', 'cuenta de deposito']],
  ['FINANCE', ['fondo', 'fund', 'financier', 'financial', 'factoraje', 'factoring', 'leasing', 'arrendamiento', 'seguro', 'insurance', 'bono', 'bond', 'credito', 'credit', 'prestamo', 'loan', 'capital', 'inversion', 'investment', 'etf', 'treasury']],
]

function normalizeText(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const KEYWORD_RES = KEYWORDS.map(([arch, words]) => [
  arch,
  new RegExp(`(?:^|[^a-z0-9])(?:${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`),
])

export function archetypeFromText(text) {
  const t = normalizeText(text)
  if (!t.trim()) return null
  for (const [arch, re] of KEYWORD_RES) if (re.test(t)) return arch
  return null
}

const CATEGORY_ARCHETYPE = {
  banks: 'BANK',
  realestate: 'REAL_ESTATE',
  bonds: 'FINANCE',
  funds: 'FUND_HALL',
  alternatives: 'FUND_HALL',
  receivables: 'FINANCE',
  crypto: 'DIGITAL_VAULT',
}

export function classifyItem(item) {
  if (!item) return { archetype: 'GENERIC_CORPORATE', source: 'default' }
  if (item.worldArchetype && ARCHETYPES.includes(item.worldArchetype)) {
    return { archetype: item.worldArchetype, source: 'override' }
  }
  // FASE PR: la clasificacion EXPLICITA (subindustria, luego industria, del
  // catalogo cerrado) va antes que el texto libre. Una industria que no es del
  // catalogo (texto libre de un proveedor, 'Banks - Regional') no matchea aca
  // y sigue por la cascada de siempre.
  const fromClass = archetypeForClassification(item.industry, item.subIndustry)
  if (fromClass) return fromClass
  const fromNotes = archetypeFromText(item.notes)
  if (fromNotes) return { archetype: fromNotes, source: 'notes' }
  const fromName = archetypeFromText(item.name)
  if (fromName) return { archetype: fromName, source: 'name' }
  const fromSector = archetypeFromText(`${item.industry || ''} ${item.sector || ''}`)
  if (fromSector) return { archetype: fromSector, source: 'sector' }
  const fromType = CATEGORY_ARCHETYPE[getTypeCategory(item)]
  if (fromType) return { archetype: fromType, source: 'type' }
  return { archetype: 'GENERIC_CORPORATE', source: 'default' }
}

// Hash determinístico (FNV-1a de 32 bits): decide poses y retrasos de
// animación sin Math.random, así el mundo no "baila" entre renders.
export function hashString(s) {
  let h = 0x811c9dc5
  const str = String(s)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const MAX_FLOORS = 6
// Trabajadores por edificio según su escalón. El techo absoluto (20) es lo que
// mantiene el DOM chico: el mundo entero no pasa de unos cientos de nodos.
export const TIER_WORKERS = [0, 2, 4, 7, 11, 16]
export const MAX_WORKERS_PER_BUILDING = 20

// Escalón 1..5 por el valor RELATIVO al edificio más grande, en escala
// logarítmica: con escala lineal una cuenta de $500 al lado de una de $50,000
// sería un punto invisible.
export function tierFor(value, maxValue) {
  if (!(value > 0) || !(maxValue > 0)) return 1
  const ratio = Math.min(1, value / maxValue)
  if (ratio >= 0.6) return 5
  if (ratio >= 0.3) return 4
  if (ratio >= 0.12) return 3
  if (ratio >= 0.04) return 2
  return 1
}

const POSES = ['desk', 'walk', 'screen', 'desk', 'walk', 'carry']

function institutionDisplayName(key, items) {
  if (key === 'ibkr') return 'Interactive Brokers'
  if (key === '__none__') return null
  const counts = new Map()
  for (const it of items) {
    const n = (it.institution || '').trim().replace(/\s+/g, ' ')
    if (n) counts.set(n, (counts.get(n) || 0) + 1)
  }
  let best = null
  let bestN = 0
  for (const [n, c] of counts) if (c > bestN || (c === bestN && n < best)) { best = n; bestN = c }
  return best
}

// Reparto por restos mayores: `total` unidades entre pesos, mínimo 1 cada uno
// (todo piso tiene al menos un trabajador: un piso vacío se lee como una
// inversión que no hace nada).
function distribute(total, weights, cap = Infinity) {
  const n = weights.length
  if (n === 0) return []
  const out0 = distributeRaw(total, weights)
  // Un piso no puede tener más gente de la que cabe en su galería: lo que
  // sobra pasa al piso con más dinero que todavía tenga lugar.
  let spill = 0
  const out = out0.map(v => { if (v > cap) { spill += v - cap; return cap } return v })
  const order = weights.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (const [, i] of order) {
    while (spill > 0 && out[i] < cap) { out[i] += 1; spill -= 1 }
  }
  return out
}

function distributeRaw(total, weights) {
  const n = weights.length
  const out = new Array(n).fill(1)
  let left = Math.max(0, total - n)
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const raw = weights.map(w => (w / sum) * left)
  const floors = raw.map(Math.floor)
  floors.forEach((f, i) => { out[i] += f; left -= f })
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; k < left && k < order.length; k++) out[order[k][1]] += 1
  return out
}

export function buildWorld(items, { lang = 'es' } = {}) {
  const live = []
  for (const it of items || []) {
    if (!it || it.isDebt || isExcludedFromNetWorth(it)) continue
    const value = getItemValue(it)
    if (!(value > 0.005)) continue
    live.push({ it, value })
  }

  const groups = new Map()
  for (const row of live) {
    const key = accountKeyOfItem(row.it) || '__none__'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const total = live.reduce((a, r) => a + r.value, 0)
  const raw = [...groups.entries()].map(([key, rows]) => ({
    key, rows, value: rows.reduce((a, r) => a + r.value, 0),
  }))
  raw.sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1))
  const maxValue = raw.length ? raw[0].value : 0

  const buildings = raw.map(({ key, rows, value }) => {
    const sorted = [...rows].sort((a, b) => b.value - a.value || String(a.it.id).localeCompare(String(b.it.id)))
    const classified = sorted.map(r => ({ ...r, ...classifyItem(r.it) }))

    // Arquetipo del edificio: el que más dinero tiene adentro.
    const byArch = new Map()
    for (const c of classified) byArch.set(c.archetype, (byArch.get(c.archetype) || 0) + c.value)
    let archetype = 'GENERIC_CORPORATE'
    let best = -1
    for (const a of ARCHETYPES) {
      const v = byArch.get(a)
      if (v != null && v > best) { best = v; archetype = a }
    }

    // Industria dominante dentro del arquetipo ganador (la que mas dinero tiene).
    const byVariant = new Map()
    for (const c of classified) {
      if (c.archetype !== archetype) continue
      const v = variantOf(c.it)
      if (v && markFor(archetype, v)) byVariant.set(v, (byVariant.get(v) || 0) + c.value)
    }
    let variant = null
    let bestV = -1
    for (const [v, val] of byVariant) if (val > bestV || (val === bestV && v < variant)) { bestV = val; variant = v }

    let floorsSrc = classified
    let other = null
    if (classified.length > MAX_FLOORS) {
      floorsSrc = classified.slice(0, MAX_FLOORS - 1)
      const rest = classified.slice(MAX_FLOORS - 1)
      other = {
        id: `${key}::other`,
        label: lang === 'en' ? `Other holdings (${rest.length})` : `Otras posiciones (${rest.length})`,
        value: rest.reduce((a, r) => a + r.value, 0),
        archetype,
        variant: null,
        source: 'grouped',
        itemIds: rest.map(r => r.it.id),
        items: rest.map(r => ({ id: r.it.id, label: itemLabel(r.it), value: r.value, archetype: r.archetype, source: r.source })),
      }
    }
    const departments = floorsSrc.map(c => ({
      id: c.it.id,
      label: itemLabel(c.it) || (lang === 'en' ? 'Investment' : 'Inversión'),
      value: c.value,
      archetype: c.archetype,
      source: c.source,
      variant: markFor(c.archetype, variantOf(c.it)) ? variantOf(c.it) : null,
      itemIds: [c.it.id],
      items: [{ id: c.it.id, label: itemLabel(c.it), value: c.value, archetype: c.archetype, source: c.source }],
    }))
    if (other) departments.push(other)

    const tier = tierFor(value, maxValue)
    const cap = slotCapacity(tier)
    const budget = Math.min(MAX_WORKERS_PER_BUILDING, departments.length * cap, Math.max(TIER_WORKERS[tier], departments.length))
    const perFloor = distribute(budget, departments.map(d => d.value), cap)
    departments.forEach((d, i) => {
      d.share = value > 0 ? d.value / value : 0
      d.workers = Array.from({ length: perFloor[i] }, (_, w) => {
        const h = hashString(`${d.id}#${w}`)
        return { id: `${d.id}#${w}`, pose: POSES[h % POSES.length], seed: h }
      })
    })

    return {
      key,
      name: institutionDisplayName(key, rows.map(r => r.it)),
      value,
      share: total > 0 ? value / total : 0,
      tier,
      archetype,
      variant,
      departments,
      itemCount: rows.length,
      workerCount: departments.reduce((a, d) => a + d.workers.length, 0),
    }
  })

  return {
    total,
    buildings,
    institutionCount: buildings.length,
    investmentCount: live.length,
    workerCount: buildings.reduce((a, b) => a + b.workerCount, 0),
  }
}
