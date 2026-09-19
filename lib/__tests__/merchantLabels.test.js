import { suggestCategoryForLabel, merchantRuleKey, LABEL_RULES, isKnownCategory, buildMerchantLabelIndex, merchantDisplay } from '../merchantLabels'
import { FINANCE_CATEGORIES } from '../financeCategories'

describe('suggestCategoryForLabel', () => {
  it('resuelve el caso que originó esto: Donald es mecánico', () => {
    expect(suggestCategoryForLabel('mecanico').category).toBe('Transporte')
    expect(suggestCategoryForLabel('mecánico').category).toBe('Transporte')
    expect(suggestCategoryForLabel('Mi mecánico').category).toBe('Transporte')
  })

  it('entiende oficios y servicios en las palabras que usa la gente', () => {
    const cases = [
      ['dentista', 'Salud'],
      ['almuerzo', 'Alimentación'],
      ['recibo de luz', 'Servicios'],
      ['plomero', 'Vivienda'],
      ['colegiatura', 'Educación'],
      ['gimnasio', 'Entretenimiento'],
      ['barberia', 'Compras'],
      ['poliza', 'Seguros'],
      ['iusi', 'Impuestos'],
      ['cuota del carro', 'Financiamiento'],
    ]
    for (const [label, expected] of cases) {
      expect([label, suggestCategoryForLabel(label)?.category]).toEqual([label, expected])
    }
  })

  it('la etiqueta más específica gana a la más corta', () => {
    // 'lavado de carro' es transporte aunque 'limpieza' sea vivienda.
    expect(suggestCategoryForLabel('lavado de carro').category).toBe('Transporte')
    expect(suggestCategoryForLabel('mantenimiento de casa').category).toBe('Vivienda')
  })

  it('devuelve null cuando no reconoce nada, en vez de adivinar', () => {
    // Sin esto, quien llama mostraría una categoría inventada con cara de
    // sugerencia. Null es lo que hace que caiga a la lista completa.
    expect(suggestCategoryForLabel('zzqx')).toBeNull()
    expect(suggestCategoryForLabel('')).toBeNull()
    expect(suggestCategoryForLabel(null)).toBeNull()
  })

  it('toda categoría de la tabla existe de verdad', () => {
    // Una categoría fuera del esquema se perdería en silencio en el desglose.
    for (const rule of LABEL_RULES) {
      expect(FINANCE_CATEGORIES.EXPENSE).toContain(rule.category)
    }
  })

  it('isKnownCategory distingue ingreso de gasto', () => {
    expect(isKnownCategory('Transporte')).toBe(true)
    expect(isKnownCategory('Salario')).toBe(false)
    expect(isKnownCategory('Salario', 'INCOME')).toBe(true)
  })
})

describe('merchantRuleKey', () => {
  it('recorta la cola que pega el banco', () => {
    // El mismo lugar aparece con y sin cola según qué banco lo imprima, y una
    // regla aprendida de la versión larga no reconocía la corta.
    expect(merchantRuleKey('FINCA FELIZ GT')).toBe('finca feliz')
    expect(merchantRuleKey('FARMA VALUE Z15')).toBe('farma value')
    expect(merchantRuleKey('PLAZA SAN MIGUEL PETAPA ZONA 12')).toBe('plaza san miguel petapa')
  })

  it('recorta más de una cola', () => {
    expect(merchantRuleKey('COMO LA FLOR ZONA 10 GT')).toBe('como la flor')
  })

  it('deja en paz lo que no es cola', () => {
    expect(merchantRuleKey('DONALD')).toBe('donald')
    expect(merchantRuleKey('CAFE SAUL E MENDEZ BUS')).toBe('cafe saul e mendez bus')
  })

  it('nunca recorta hasta dejar una llave irreconocible', () => {
    // Una llave de una o dos letras matchearía media lista de comercios, así
    // que el recorte se detiene antes de llegar ahí.
    expect(merchantRuleKey('EPA 10').length).toBeGreaterThanOrEqual(3)
    expect(merchantRuleKey('XY GT').length).toBeGreaterThanOrEqual(2)
  })

  it('devuelve cadena vacía sin comercio, no revienta', () => {
    expect(merchantRuleKey('')).toBe('')
    expect(merchantRuleKey(null)).toBe('')
  })
})

// FASE OR. El rótulo que el usuario escribió, indexado por la MISMA llave con
// la que se aprenden las reglas.
describe('buildMerchantLabelIndex / merchantDisplay', () => {
  it('la regla enseñada da el rótulo, y la llave normaliza la cola del banco', () => {
    const index = buildMerchantLabelIndex([], [{ match: merchantRuleKey('FINCA FELIZ GT'), category: 'Alimentación', label: 'el comedor' }])
    // La misma regla alcanza a las dos formas en que los bancos lo imprimen.
    expect(merchantDisplay('FINCA FELIZ GT', index)).toBe('el comedor')
    expect(merchantDisplay('FINCA FELIZ ZONA 10', index)).toBe('el comedor')
  })

  it('lo que el usuario escribió en la FILA gana sobre la regla', () => {
    const index = buildMerchantLabelIndex(
      [{ description: 'DONALD EXPRESS GT', userLabel: 'taller de Donald' }],
      [{ match: 'donald express', category: 'Transporte', label: 'mecánico' }]
    )
    expect(merchantDisplay('DONALD EXPRESS GT', index)).toBe('taller de Donald')
  })

  it('sin rótulo devuelve la cadena del banco TAL CUAL', () => {
    // ⛔ El invariante: ninguna letra se transforma. Un title-case rompería
    // "BAC CREDOMATIC" y un capitalize de CSS convierte "iShares" en "IShares".
    const index = buildMerchantLabelIndex([], [])
    expect(merchantDisplay('BAC CREDOMATIC', index)).toBe('BAC CREDOMATIC')
    expect(merchantDisplay('UBER*EATS GT', index)).toBe('UBER*EATS GT')
    expect(merchantDisplay('iShares Core', index)).toBe('iShares Core')
    // Y con un índice que no conoce ese comercio, tampoco.
    const other = buildMerchantLabelIndex([], [{ match: 'otra cosa', category: 'Salud', label: 'doctor' }])
    expect(merchantDisplay('BAC CREDOMATIC', other)).toBe('BAC CREDOMATIC')
  })

  it('una regla sin rótulo no inventa uno', () => {
    const index = buildMerchantLabelIndex([], [{ match: 'donald express', category: 'Transporte' }])
    expect(merchantDisplay('DONALD EXPRESS GT', index)).toBe('DONALD EXPRESS GT')
  })

  it('entradas basura no rompen el índice', () => {
    const index = buildMerchantLabelIndex([null, {}, { userLabel: 'x' }], [null, {}, { label: 'y' }])
    expect(index.size).toBe(0)
    expect(merchantDisplay('ALGO', index)).toBe('ALGO')
    expect(merchantDisplay('', index)).toBe('')
  })
})
