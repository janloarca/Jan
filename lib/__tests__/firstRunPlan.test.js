import fs from 'fs'
import path from 'path'
import { FIRST_RUN_CATEGORIES, orderPicked, categoryFor, isBrokerStep } from '../firstRunPlan'

describe('firstRunPlan: el catálogo', () => {
  test('son nueve, con llaves únicas y copy en los dos idiomas', () => {
    expect(FIRST_RUN_CATEGORIES).toHaveLength(9)
    const keys = FIRST_RUN_CATEGORIES.map((c) => c.key)
    expect(new Set(keys).size).toBe(9)
    for (const c of FIRST_RUN_CATEGORIES) {
      expect(typeof c.es).toBe('string')
      expect(typeof c.en).toBe('string')
      expect(c.es.length).toBeGreaterThan(0)
      expect(c.en.length).toBeGreaterThan(0)
    }
  })

  test('el broker es el único atajo y va último en el catálogo', () => {
    const brokers = FIRST_RUN_CATEGORIES.filter((c) => c.isBroker)
    expect(brokers).toHaveLength(1)
    expect(FIRST_RUN_CATEGORIES[FIRST_RUN_CATEGORIES.length - 1].key).toBe('broker')
  })
})

describe('firstRunPlan: el orden de la cola', () => {
  test('manda el orden del catálogo, NO el orden en que fue tocando', () => {
    // Marcadas al revés a propósito: si el orden de entrada mandara, saldría
    // Debt primero.
    expect(orderPicked(['Debt', 'Bank', 'Stock'])).toEqual(['Stock', 'Bank', 'Debt'])
  })

  test('el broker queda al final aunque se marque primero', () => {
    expect(orderPicked(['broker', 'Bank'])).toEqual(['Bank', 'broker'])
    expect(orderPicked(['broker', 'Stock', 'Debt'])).toEqual(['Stock', 'Debt', 'broker'])
  })

  test('una llave repetida no duplica el paso', () => {
    expect(orderPicked(['Bank', 'Bank', 'Bank'])).toEqual(['Bank'])
  })

  test('una llave desconocida se ignora en vez de entrar a la cola', () => {
    // Importa: AddAccountModal la recibiría como guidedType y no sabría qué
    // preguntar.
    expect(orderPicked(['Bank', 'Cohetes'])).toEqual(['Bank'])
    expect(orderPicked(['Cohetes'])).toEqual([])
  })

  test('sin nada marcado, y con entradas basura, devuelve una cola vacía', () => {
    expect(orderPicked([])).toEqual([])
    expect(orderPicked(null)).toEqual([])
    expect(orderPicked(undefined)).toEqual([])
    // Nunca un MouseEvent: orderPicked se alimenta de estado, pero el caller de
    // arriba sí puede recibir uno de un onClick.
    expect(orderPicked({ type: 'click' })).toEqual([])
    expect(orderPicked('Bank')).toEqual([])
  })

  test('marcar todo devuelve el catálogo entero, en su orden', () => {
    const all = FIRST_RUN_CATEGORIES.map((c) => c.key)
    expect(orderPicked([...all].reverse())).toEqual(all)
  })
})

describe('firstRunPlan: helpers', () => {
  test('categoryFor resuelve la categoría, y undefined para lo que no existe', () => {
    expect(categoryFor('Bank').es).toBe('Cuenta de banco')
    expect(categoryFor('Cohetes')).toBeUndefined()
  })

  test('isBrokerStep solo es cierto para el atajo', () => {
    expect(isBrokerStep('broker')).toBe(true)
    expect(isBrokerStep('Stock')).toBe(false)
    expect(isBrokerStep('Cohetes')).toBe(false)
  })
})

describe('firstRunPlan: el invariante que cruza archivos', () => {
  // Cada tipo de activo que entra a la cola llega a AddAccountModal como
  // `guidedType`, que lo usa para sembrar el subtipo desde GUIDED_SUBTYPE. Una
  // llave sin entrada ahí no falla ruidosamente: crea el activo con el subtipo
  // VACÍO, que es justo la clase de defecto silencioso que este repo persigue.
  //
  // Se lee el archivo en vez de importar la constante porque GUIDED_SUBTYPE no
  // se exporta (es interna del componente). Es el mismo criterio que usa
  // darkHexInLightTheme.test.js para juzgar código sin renderizarlo.
  test('todo tipo de activo tiene subtipo por defecto en AddAccountModal', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'components', 'AddAccountModal.jsx'),
      'utf8'
    )
    const block = src.match(/const GUIDED_SUBTYPE = \{([\s\S]*?)\}/)
    expect(block).toBeTruthy()
    const declared = new Set(
      [...block[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1])
    )
    const assetKeys = FIRST_RUN_CATEGORIES.filter((c) => !c.isBroker).map((c) => c.key)
    const missing = assetKeys.filter((k) => !declared.has(k))
    expect(missing).toEqual([])
  })
})
