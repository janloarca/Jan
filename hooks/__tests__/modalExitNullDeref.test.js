// El crash que el usuario reportó desde su iPhone (28 ago 2026):
//
//   null is not an object (evaluating 'eh.id')   ·   pantalla: /spreadsheet
//
// El mecanismo, reproducido acá con el hook REAL antes de tocar nada:
// useModalExit mantiene montado el VALOR VIEJO mientras corre la animación de
// salida, así que en el render donde el estado ya es null el guard `shown`
// sigue siendo verdadero. Un cuerpo que lee el ESTADO CRUDO (`editItem.id`) en
// vez del valor retenido (`editShown.id`) hace `null.id` en ese render: crash
// garantizado en CADA cierre de modal, no intermitente.
//
// Es exactamente la lección que FASE JI2 dejó escrita para el wizard anidado
// ("dentro del guard el wizard lee `connectShown` y no el estado crudo, porque
// durante la salida ese estado ya es null"), que nunca se aplicó a los demás
// sitios.

const { renderHook, act, pinReact } = require('../../test-utils/hookHarness')

let useModalExit

beforeEach(() => {
  jest.resetModules()
  pinReact()
  useModalExit = require('../useModalExit').default
})

const ITEM = { id: 'i1', name: 'FONDO LÍQUIDO Q' }

it('durante la salida, el guard sigue ABIERTO con el estado ya en null', () => {
  const { result, rerender } = renderHook(({ v }) => useModalExit(v), {
    initialProps: { v: ITEM },
  })
  expect(result.current[0]).toBe(ITEM)

  // El usuario cierra: el estado crudo pasa a null.
  act(() => { rerender({ v: null }) })

  // El valor retenido sobrevive (para eso existe el hook)...
  expect(result.current[0]).toBe(ITEM)
  expect(result.current[1]).toBe(true) // ...y el render es el de despedida.
})

it('leer el ESTADO CRUDO dentro del guard revienta; leer el valor RETENIDO no', () => {
  // La forma exacta del bug: `{shown && <M key={raw.id} item={raw} />}`.
  const render = (raw, shown) => {
    if (!shown) return null
    return { key: raw.id, item: raw } // ⛔ raw es null durante la salida
  }
  const renderFixed = (raw, shown) => {
    if (!shown) return null
    return { key: shown.id, item: shown }
  }

  const { result, rerender } = renderHook(({ v }) => useModalExit(v), {
    initialProps: { v: ITEM },
  })
  act(() => { rerender({ v: null }) })
  const [shown] = result.current

  expect(() => render(null, shown)).toThrow(TypeError)
  expect(renderFixed(null, shown)).toEqual({ key: 'i1', item: ITEM })
})

it('con la salida terminada el guard cierra y ya nadie lee nada', () => {
  jest.useFakeTimers()
  try {
    const { result, rerender } = renderHook(({ v }) => useModalExit(v), {
      initialProps: { v: ITEM },
    })
    act(() => { rerender({ v: null }) })
    act(() => { jest.advanceTimersByTime(500) })
    expect(result.current[0]).toBeNull()
    expect(result.current[1]).toBe(false)
  } finally {
    jest.useRealTimers()
  }
})
