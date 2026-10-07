// FASE PR. UNICA definicion del catalogo de clasificacion de una posicion:
// industrias (22), subindustrias, y de que arquetipo de World es cada una.
//
// Puro y SIN imports: lo consumen las dos pantallas de alta/edicion, el
// buscador de subindustria, World y los hallazgos de completitud, y ninguno
// puede tener su propia copia (la enfermedad que este repo ya documenta para
// InfoTip, lib/transferTx.js y los colores).
//
// Reglas que lo gobiernan (docs/world-classification-spec.md, seccion 2):
//   1. Las 11 claves originales de `industry` se conservan CON SU SIGNIFICADO.
//      Lo nuevo se agrega, nada se renombra: lo guardado en Firestore no se
//      migra.
//   2. `Consumer` es un alias LEGADO ("Consumo (sin especificar)"). Nunca se
//      convierte solo en basico o discrecional: adivinarlo seria inventar.
//      Se ofrece refinarlo y ya.
//   3. Elegir una subindustria PRELLENA la industria padre; elegir la
//      industria NUNCA preselecciona subindustria.
//   4. Nada de esto toca ninguna formula de retorno: es metadato de
//      clasificacion y dibujo.

// [clave, es, en]
const INDUSTRY_ROWS = [
  ['Technology', 'Tecnología', 'Technology'],
  ['Communication', 'Comunicación y medios', 'Communication & Media'],
  ['Financials', 'Servicios financieros', 'Financial Services'],
  ['Healthcare', 'Salud y ciencias de la vida', 'Healthcare & Life Sciences'],
  ['ConsumerStaples', 'Consumo básico', 'Consumer Staples'],
  ['ConsumerDiscretionary', 'Consumo discrecional', 'Consumer Discretionary'],
  ['Energy', 'Energía', 'Energy'],
  ['Utilities', 'Servicios públicos', 'Utilities'],
  ['Industrials', 'Industrial y manufactura', 'Industrials & Manufacturing'],
  ['Transportation', 'Transporte y logística', 'Transportation & Logistics'],
  ['Materials', 'Materiales y minería', 'Materials & Mining'],
  ['Real Estate', 'Bienes raíces', 'Real Estate'],
  ['Infrastructure', 'Infraestructura', 'Infrastructure'],
  ['Agriculture', 'Agricultura y alimentos', 'Agriculture & Food'],
  ['Automotive', 'Automotriz y movilidad', 'Automotive & Mobility'],
  ['Aerospace', 'Aeroespacial y defensa', 'Aerospace & Defense'],
  ['Hospitality', 'Hotelería y viajes', 'Hospitality & Travel'],
  ['Education', 'Educación', 'Education'],
  ['Sovereign', 'Gobierno y soberanos', 'Government & Sovereign'],
  ['Crypto', 'Activos digitales', 'Digital Assets'],
  ['PrivateCapital', 'Capital privado y alternativos', 'Private & Alternative'],
]

// El alias legado va APARTE de las 21 claves vigentes: se muestra en el
// selector solo cuando el activo ya lo trae guardado (ver industryChoices).
export const LEGACY_INDUSTRY = { key: 'Consumer', es: 'Consumo (sin especificar)', en: 'Consumer (unspecified)', legacy: true }

export const INDUSTRIES = INDUSTRY_ROWS.map(([key, es, en]) => ({ key, es, en }))
export const INDUSTRY_KEYS = [...INDUSTRIES.map(i => i.key), LEGACY_INDUSTRY.key]

export function industryLabel(key, lang = 'es') {
  if (!key) return ''
  const hit = key === LEGACY_INDUSTRY.key ? LEGACY_INDUSTRY : INDUSTRIES.find(i => i.key === key)
  if (!hit) return key // una industria detectada en vivo (texto libre del proveedor) se muestra tal cual
  return lang === 'en' ? hit.en : hit.es
}

// Lo que ve el <select>: las 21 vigentes, mas el alias legado SOLO si es el
// valor guardado, mas (como siempre, truco de currencyOptions/industryOptions)
// cualquier valor desconocido antepuesto en vez de perderse: un <select> cuyo
// value no esta entre sus <option> renderiza la primera en silencio.
export function industryChoices(selected) {
  const base = INDUSTRIES.map(i => ({ ...i }))
  if (!selected) return base
  if (selected === LEGACY_INDUSTRY.key) return [{ ...LEGACY_INDUSTRY }, ...base]
  if (base.some(i => i.key === selected)) return base
  return [{ key: selected, es: selected, en: selected }, ...base]
}

// [industria, clave, es, en, sinonimos...]
const SUB_ROWS = [
  ['Technology', 'Software', 'Software', 'Software', 'saas', 'apps', 'aplicaciones'],
  ['Technology', 'Semiconductors', 'Semiconductores', 'Semiconductors', 'chips', 'microchips', 'chip'],
  ['Technology', 'Hardware', 'Hardware y dispositivos', 'Hardware & devices', 'dispositivos', 'computadoras', 'electronics', 'electronica'],
  ['Technology', 'Cloud', 'Nube e infraestructura de datos', 'Cloud & data infrastructure', 'nube', 'data center', 'centros de datos', 'hosting'],
  ['Technology', 'Cybersecurity', 'Ciberseguridad', 'Cybersecurity', 'seguridad informatica', 'security'],
  ['Technology', 'AI', 'Inteligencia artificial', 'Artificial intelligence', 'ia', 'machine learning', 'ai'],
  ['Technology', 'Fintech', 'Fintech', 'Fintech', 'pagos digitales', 'neobanco', 'neobank'],
  ['Technology', 'ITServices', 'Servicios de TI', 'IT services', 'consultoria ti', 'outsourcing', 'tecnologia de la informacion'],

  ['Communication', 'Media', 'Medios y entretenimiento', 'Media & entertainment', 'television', 'cine', 'prensa', 'peliculas'],
  ['Communication', 'Streaming', 'Streaming', 'Streaming', 'video bajo demanda', 'musica', 'netflix'],
  ['Communication', 'Telecom', 'Telecomunicaciones', 'Telecommunications', 'telefonia', 'celular', 'internet', 'fibra'],
  ['Communication', 'Social', 'Plataformas sociales', 'Social platforms', 'redes sociales', 'social media'],
  ['Communication', 'Gaming', 'Videojuegos', 'Video games', 'juegos', 'games', 'esports'],
  ['Communication', 'Advertising', 'Publicidad', 'Advertising', 'marketing', 'ads', 'anuncios'],

  ['Financials', 'Banking', 'Banca', 'Banking', 'banco', 'bancos', 'bank'],
  ['Financials', 'Insurance', 'Seguros', 'Insurance', 'aseguradora', 'reaseguro', 'seguro'],
  ['Financials', 'AssetManagement', 'Gestión de activos', 'Asset management', 'administradora', 'fondos', 'wealth'],
  ['Financials', 'Brokerage', 'Corretaje y mercados', 'Brokerage & markets', 'broker', 'casa de bolsa', 'trading'],
  ['Financials', 'Payments', 'Pagos', 'Payments', 'tarjetas', 'procesador de pagos', 'cards'],
  ['Financials', 'Lending', 'Crédito y préstamos', 'Credit & lending', 'prestamos', 'microfinanzas', 'financiera', 'loans'],
  ['Financials', 'Exchanges', 'Bolsas', 'Exchanges', 'bolsa de valores', 'stock exchange'],

  ['Healthcare', 'Pharma', 'Farmacéutica', 'Pharmaceuticals', 'medicamentos', 'farmacia', 'drugs'],
  ['Healthcare', 'Biotech', 'Biotecnología', 'Biotechnology', 'genomica', 'terapias'],
  ['Healthcare', 'Devices', 'Dispositivos médicos', 'Medical devices', 'equipo medico', 'implantes'],
  ['Healthcare', 'Providers', 'Hospitales y clínicas', 'Hospitals & clinics', 'hospital', 'clinica', 'salud privada'],
  ['Healthcare', 'Insurers', 'Aseguradoras de salud', 'Health insurers', 'seguro medico', 'health insurance'],
  ['Healthcare', 'Diagnostics', 'Diagnóstico', 'Diagnostics', 'laboratorio', 'imagenes medicas', 'lab'],
  ['Healthcare', 'ObesityMetabolic', 'Metabólico y obesidad', 'Metabolic & obesity', 'diabetes', 'obesidad', 'glp-1', 'ozempic'],

  ['ConsumerStaples', 'Beverages', 'Bebidas', 'Beverages', 'refrescos', 'cerveza', 'agua', 'bebida', 'soda'],
  ['ConsumerStaples', 'Food', 'Alimentos empacados', 'Packaged food', 'comida', 'snacks', 'alimentos'],
  ['ConsumerStaples', 'Grocery', 'Supermercados', 'Grocery', 'supermercado', 'abarroteria', 'retail alimentos'],
  ['ConsumerStaples', 'HouseholdPersonal', 'Hogar y cuidado personal', 'Household & personal care', 'limpieza', 'cosmeticos', 'higiene'],
  ['ConsumerStaples', 'Tobacco', 'Tabaco', 'Tobacco', 'cigarrillos', 'tabacaleras'],

  ['ConsumerDiscretionary', 'Apparel', 'Ropa y calzado', 'Apparel & footwear', 'ropa', 'moda', 'fashion', 'clothing'],
  ['ConsumerDiscretionary', 'SportsFootwear', 'Deporte y calzado', 'Sports & footwear', 'sports', 'shoes', 'tenis', 'zapatos', 'deportes', 'nike', 'adidas'],
  ['ConsumerDiscretionary', 'Luxury', 'Lujo', 'Luxury', 'joyeria', 'marcas de lujo', 'luxury goods'],
  ['ConsumerDiscretionary', 'Ecommerce', 'Comercio electrónico', 'E-commerce', 'tienda en linea', 'marketplace', 'online retail', 'amazon'],
  ['ConsumerDiscretionary', 'Restaurants', 'Restaurantes', 'Restaurants', 'comida rapida', 'fast food', 'cafeterias', 'franquicias'],
  ['ConsumerDiscretionary', 'Leisure', 'Ocio y recreación', 'Leisure & recreation', 'entretenimiento', 'parques', 'gimnasios', 'recreacion'],
  ['ConsumerDiscretionary', 'HomeImprovement', 'Hogar y mejoras', 'Home improvement', 'ferreteria', 'muebles', 'decoracion', 'home'],

  ['Energy', 'OilGas', 'Petróleo y gas', 'Oil & gas', 'petroleo', 'crudo', 'gas natural', 'oil'],
  ['Energy', 'Renewables', 'Renovables', 'Renewables', 'energia limpia', 'verde', 'clean energy'],
  ['Energy', 'Solar', 'Solar', 'Solar', 'paneles solares', 'fotovoltaica', 'solar farm'],
  ['Energy', 'Wind', 'Eólica', 'Wind', 'viento', 'aerogeneradores', 'wind farm'],
  ['Energy', 'Hydro', 'Hidroeléctrica', 'Hydroelectric', 'hidro', 'represa', 'hidroelectrica'],
  ['Energy', 'Midstream', 'Transporte de energía', 'Midstream', 'oleoductos', 'gasoductos', 'pipelines'],
  ['Energy', 'EnergyServices', 'Servicios petroleros', 'Oilfield services', 'perforacion', 'drilling', 'servicios de campo'],

  ['Utilities', 'Electric', 'Electricidad', 'Electric utilities', 'distribuidora electrica', 'luz', 'power'],
  ['Utilities', 'Water', 'Agua y saneamiento', 'Water utilities', 'agua potable', 'acueductos'],
  ['Utilities', 'GasUtility', 'Gas distribuido', 'Gas utilities', 'gas domiciliar', 'distribucion de gas'],
  ['Utilities', 'IndependentPower', 'Generación independiente', 'Independent power', 'ipp', 'generadora'],

  ['Industrials', 'Machinery', 'Maquinaria', 'Machinery', 'equipo pesado', 'maquinas', 'industrial equipment'],
  ['Industrials', 'Construction', 'Construcción', 'Construction', 'constructora', 'obras', 'cemento', 'contratista'],
  ['Industrials', 'Manufacturing', 'Manufactura', 'Manufacturing', 'fabrica', 'maquila', 'plantas'],
  ['Industrials', 'Electrical', 'Equipo eléctrico', 'Electrical equipment', 'cables', 'transformadores', 'automatizacion'],
  ['Industrials', 'Conglomerate', 'Conglomerados', 'Conglomerates', 'holding', 'grupo diversificado'],

  ['Transportation', 'Airlines', 'Aerolíneas', 'Airlines', 'vuelos', 'aviacion comercial', 'airline'],
  ['Transportation', 'Shipping', 'Transporte marítimo', 'Shipping', 'naviera', 'buques', 'contenedores', 'freight'],
  ['Transportation', 'Rail', 'Ferrocarril', 'Rail', 'trenes', 'railway', 'ferroviario'],
  ['Transportation', 'Trucking', 'Transporte terrestre', 'Trucking', 'camiones', 'carga terrestre', 'fletes'],
  ['Transportation', 'Logistics', 'Logística y paquetería', 'Logistics & parcel', 'courier', 'bodegas', 'almacenes', 'supply chain'],

  ['Materials', 'Mining', 'Minería', 'Mining', 'minas', 'oro', 'cobre', 'litio', 'gold', 'copper'],
  ['Materials', 'Chemicals', 'Químicos', 'Chemicals', 'quimica', 'fertilizantes', 'plasticos'],
  ['Materials', 'Steel', 'Acero y metales', 'Steel & metals', 'siderurgia', 'aluminio', 'hierro'],
  ['Materials', 'Paper', 'Papel y empaques', 'Paper & packaging', 'cartonera', 'empaque', 'packaging'],
  ['Materials', 'BuildingMaterials', 'Materiales de construcción', 'Building materials', 'cemento', 'concreto', 'vidrio'],

  ['Real Estate', 'Residential', 'Residencial', 'Residential', 'apartamentos', 'casas', 'vivienda', 'housing'],
  ['Real Estate', 'Commercial', 'Oficinas y comercial', 'Offices & commercial', 'oficinas', 'locales', 'centros comerciales', 'malls'],
  ['Real Estate', 'IndustrialRE', 'Industrial y bodegas', 'Industrial & warehouses', 'naves industriales', 'bodegas', 'parque industrial'],
  ['Real Estate', 'REIT', 'REIT', 'REIT', 'fibra', 'fideicomiso inmobiliario', 'reits'],
  ['Real Estate', 'Land', 'Terrenos', 'Land', 'lotes', 'tierra', 'parcelas'],
  ['Real Estate', 'HospitalityRE', 'Hospitalidad', 'Hospitality real estate', 'hoteles inmuebles', 'airbnb'],
  ['Real Estate', 'Development', 'Desarrollo', 'Development', 'desarrolladora', 'preventa', 'proyectos inmobiliarios'],

  ['Infrastructure', 'Roads', 'Carreteras', 'Roads', 'autopistas', 'peajes', 'highways', 'toll'],
  ['Infrastructure', 'Ports', 'Puertos', 'Ports', 'terminales maritimas', 'muelles'],
  ['Infrastructure', 'Airports', 'Aeropuertos', 'Airports', 'terminales aereas'],
  ['Infrastructure', 'WaterSanitation', 'Agua y saneamiento', 'Water & sanitation', 'plantas de tratamiento', 'alcantarillado'],
  ['Infrastructure', 'TelecomInfra', 'Torres y fibra', 'Towers & fiber', 'torres de telecomunicaciones', 'fibra optica', 'towers'],

  ['Agriculture', 'Coffee', 'Café', 'Coffee', 'cafe', 'fincas de cafe', 'cafetales'],
  ['Agriculture', 'Sugar', 'Azúcar', 'Sugar', 'azucar', 'ingenio', 'cana'],
  ['Agriculture', 'PalmOil', 'Palma africana', 'Palm oil', 'palma', 'aceite de palma'],
  ['Agriculture', 'Livestock', 'Ganadería', 'Livestock', 'ganado', 'carne', 'lacteos', 'cattle'],
  ['Agriculture', 'FoodProcessing', 'Procesamiento de alimentos', 'Food processing', 'agroindustria', 'empacadoras'],
  ['Agriculture', 'Crops', 'Cultivos', 'Crops', 'granos', 'frutas', 'banano', 'aguacate', 'agro'],

  ['Automotive', 'Carmakers', 'Fabricantes de autos', 'Carmakers', 'autos', 'vehiculos', 'cars'],
  ['Automotive', 'EV', 'Eléctricos', 'Electric vehicles', 'vehiculos electricos', 'ev', 'baterias'],
  ['Automotive', 'AutoParts', 'Autopartes', 'Auto parts', 'repuestos', 'llantas', 'neumaticos'],
  ['Automotive', 'Dealers', 'Concesionarios', 'Dealers', 'agencias de autos', 'venta de autos'],
  ['Automotive', 'Mobility', 'Movilidad y transporte compartido', 'Mobility & ride-hailing', 'uber', 'ride sharing', 'scooters'],

  ['Aerospace', 'Defense', 'Defensa', 'Defense', 'armamento', 'militar', 'contratista de defensa'],
  ['Aerospace', 'Aircraft', 'Aeronaves', 'Aircraft', 'aviones', 'fabricante de aviones', 'jets'],
  ['Aerospace', 'Space', 'Espacio', 'Space', 'satelites', 'cohetes', 'spacex'],
  ['Aerospace', 'AeroComponents', 'Componentes aeronáuticos', 'Aerospace components', 'motores de avion', 'partes aeronauticas'],

  ['Hospitality', 'Hotels', 'Hoteles', 'Hotels', 'hospedaje', 'resorts', 'hotel'],
  ['Hospitality', 'Cruises', 'Cruceros', 'Cruise lines', 'barcos de pasajeros'],
  ['Hospitality', 'TravelPlatforms', 'Plataformas de viaje', 'Travel platforms', 'reservas', 'agencias de viaje', 'booking', 'airbnb'],
  ['Hospitality', 'Casinos', 'Casinos y entretenimiento', 'Casinos & entertainment', 'juegos de azar', 'apuestas', 'gambling'],

  ['Education', 'Universities', 'Universidades', 'Universities', 'educacion superior', 'universidad', 'colegio universitario'],
  ['Education', 'K12', 'Colegios y escuelas', 'K-12 schools', 'colegios', 'escuelas', 'educacion basica'],
  ['Education', 'Edtech', 'Tecnología educativa', 'Education technology', 'cursos en linea', 'e-learning', 'plataformas de aprendizaje'],
  ['Education', 'Training', 'Capacitación', 'Training', 'cursos', 'certificaciones', 'idiomas'],

  ['Sovereign', 'Treasury', 'Bonos del Tesoro', 'Treasuries', 'tesoro', 'treasury', 'tbills', 'letras del tesoro', 'bonos del gobierno'],
  ['Sovereign', 'Municipal', 'Municipales', 'Municipals', 'muni', 'alcaldia', 'bonos municipales'],
  ['Sovereign', 'Agency', 'Agencias gubernamentales', 'Agencies', 'agencias', 'fannie', 'freddie'],
  ['Sovereign', 'EmergingSovereign', 'Soberanos emergentes', 'Emerging sovereigns', 'bonos soberanos', 'deuda soberana', 'eurobonos'],

  ['Crypto', 'Layer1', 'Capa 1', 'Layer 1', 'ethereum', 'solana', 'blockchains', 'l1'],
  ['Crypto', 'StoreOfValue', 'Reserva de valor', 'Store of value', 'bitcoin', 'btc', 'oro digital'],
  ['Crypto', 'Stablecoin', 'Stablecoins', 'Stablecoins', 'usdc', 'usdt', 'dolar digital'],
  ['Crypto', 'DeFi', 'Finanzas descentralizadas', 'DeFi', 'defi', 'staking', 'liquidity', 'yield farming'],
  ['Crypto', 'CryptoInfra', 'Infraestructura cripto', 'Crypto infrastructure', 'oraculos', 'wallets', 'nodos', 'exchanges cripto'],

  ['PrivateCapital', 'VentureCapital', 'Capital de riesgo', 'Venture capital', 'vc', 'startups', 'seed', 'serie a'],
  ['PrivateCapital', 'PrivateEquity', 'Capital privado', 'Private equity', 'pe', 'buyout', 'empresa privada'],
  ['PrivateCapital', 'PrivateCredit', 'Crédito privado', 'Private credit', 'deuda privada', 'prestamos directos'],
  ['PrivateCapital', 'RealAssetsFund', 'Fondos de activos reales', 'Real assets funds', 'infraestructura privada', 'timberland', 'activos reales'],
]

export const SUB_INDUSTRIES = SUB_ROWS.map(([industry, key, es, en, ...synonyms]) => ({ industry, key, es, en, synonyms }))

const SUB_BY_KEY = new Map()
for (const s of SUB_INDUSTRIES) {
  // La clave de subindustria es UNICA dentro de su industria; entre
  // industrias pueden repetirse en el futuro, asi que el indice es por par.
  SUB_BY_KEY.set(`${s.industry}::${s.key}`, s)
}

export function findSubIndustry(industry, key) {
  if (!key) return null
  if (industry && SUB_BY_KEY.has(`${industry}::${key}`)) return SUB_BY_KEY.get(`${industry}::${key}`)
  // Sin industria (o industria distinta): busca por clave sola, solo si es inequivoca.
  const matches = SUB_INDUSTRIES.filter(s => s.key === key)
  return matches.length === 1 ? matches[0] : null
}

export function subIndustriesOf(industry) {
  return SUB_INDUSTRIES.filter(s => s.industry === industry)
}

export function subIndustryLabel(industry, key, lang = 'es', custom = '') {
  if (!key) return ''
  if (key === 'custom') return custom || ''
  const hit = findSubIndustry(industry, key)
  if (!hit) return key
  return lang === 'en' ? hit.en : hit.es
}

// Misma normalizacion que lib/worldModel.js (sin acentos, minusculas): una
// busqueda que distingue "cafe" de "café" no encuentra nada en un teclado
// que no pone tildes.
export function normalizeSearch(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Type-ahead. Indexa clave, etiqueta ES, etiqueta EN y sinonimos. Si hay
// industria elegida, busca SOLO dentro de ella (vacio = catalogo completo,
// que es lo que permite elegir una subindustria primero y dejar que ella
// prellene la industria padre). Orden: prefijo de etiqueta > prefijo de
// sinonimo > contiene; desempate por orden del catalogo (estable).
export function searchSubIndustries(query, { industry = '', lang = 'es', limit = 12 } = {}) {
  const q = normalizeSearch(query)
  const pool = industry ? subIndustriesOf(industry) : SUB_INDUSTRIES
  if (!q) return pool.slice(0, limit)
  const scored = []
  pool.forEach((s, idx) => {
    const labels = [s.es, s.en, s.key].map(normalizeSearch)
    const syns = s.synonyms.map(normalizeSearch)
    let score = 0
    if (labels.some(l => l.startsWith(q))) score = 4
    else if (syns.some(x => x.startsWith(q))) score = 3
    else if (labels.some(l => l.includes(q))) score = 2
    else if (syns.some(x => x.includes(q))) score = 1
    if (score > 0) scored.push({ s, score, idx })
  })
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  return scored.slice(0, limit).map(x => x.s)
}

// ---------------------------------------------------------------- World --
// Arquetipo de World por industria. Es la capa nueva de la cascada
// (subindustria > industria > notas > nombre > ...): lo que el usuario CLASIFICO
// explicitamente le gana a una palabra suelta en las notas. `null` = esa
// industria no tiene un arquetipo propio todavia y la cascada sigue.
export const INDUSTRY_ARCHETYPE = {
  Technology: 'TECH',
  Communication: 'TECH',
  Financials: 'FINANCE',
  Healthcare: 'HEALTHCARE',
  ConsumerStaples: 'RETAIL',
  ConsumerDiscretionary: 'RETAIL',
  Energy: 'ENERGY',
  Utilities: 'ENERGY',
  Industrials: 'CONSTRUCTION',
  Transportation: 'LOGISTICS',
  Materials: 'CONSTRUCTION',
  'Real Estate': 'REAL_ESTATE',
  Infrastructure: 'INFRASTRUCTURE',
  Agriculture: 'AGRICULTURE',
  Automotive: 'LOGISTICS',
  Aerospace: 'TECH',
  Hospitality: 'RETAIL',
  Education: 'GENERIC_CORPORATE',
  Sovereign: 'SOVEREIGN',
  Crypto: 'DIGITAL_VAULT',
  PrivateCapital: 'FUND_HALL',
}

// Subindustrias que se dibujan distinto a lo que dice su industria madre.
export const SUB_INDUSTRY_ARCHETYPE = {
  'Financials::Banking': 'BANK',
  'Financials::Lending': 'BANK',
  'Financials::AssetManagement': 'FUND_HALL',
  'Technology::Fintech': 'FINANCE',
  'Real Estate::Development': 'CONSTRUCTION',
  'Industrials::Construction': 'CONSTRUCTION',
  'Materials::BuildingMaterials': 'CONSTRUCTION',
  'Utilities::Water': 'INFRASTRUCTURE',
  'Hospitality::Casinos': 'RETAIL',
}

export function archetypeForClassification(industry, subIndustry) {
  if (subIndustry) {
    const sub = findSubIndustry(industry, subIndustry)
    if (sub) {
      const special = SUB_INDUSTRY_ARCHETYPE[`${sub.industry}::${sub.key}`]
      if (special) return { archetype: special, source: 'subindustry' }
      const parent = INDUSTRY_ARCHETYPE[sub.industry]
      if (parent) return { archetype: parent, source: 'subindustry' }
    }
  }
  if (industry && INDUSTRY_ARCHETYPE[industry]) return { archetype: INDUSTRY_ARCHETYPE[industry], source: 'industry' }
  return null
}
