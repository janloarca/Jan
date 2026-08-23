// Prueba de humo del arnés de hooks. No prueba nada del producto: prueba que
// la infraestructura de FASE JB2 existe y que hace lo que hace falta que haga.
//
// Si este archivo falla, ningún otro test de hook significa nada.
import { renderHook, act } from '@testing-library/react'
import { useState, useEffect, useRef, useMemo } from 'react'

describe('el arnes de hooks funciona', () => {
  it('renderiza un hook y expone su valor', () => {
    const { result } = renderHook(() => useState(1))
    expect(result.current[0]).toBe(1)
  })

  it('re-renderiza con props nuevas: asi se prueba una deps array', () => {
    const { result, rerender } = renderHook(({ n }) => useMemo(() => n * 2, [n]), {
      initialProps: { n: 2 },
    })
    expect(result.current).toBe(4)
    rerender({ n: 5 })
    expect(result.current).toBe(10)
  })

  it('corre efectos y su limpieza: asi se cazan los intervalos que se matan solos', () => {
    const log = []
    const { rerender, unmount } = renderHook(({ id }) => {
      useEffect(() => {
        log.push(`start:${id}`)
        return () => log.push(`stop:${id}`)
      }, [id])
    }, { initialProps: { id: 'a' } })

    rerender({ id: 'b' })
    unmount()
    expect(log).toEqual(['start:a', 'stop:a', 'start:b', 'stop:b'])
  })

  it('un ref sobrevive al re-render: asi se prueba un guard de una-vez-por-sesion', () => {
    let runs = 0
    const { rerender } = renderHook(({ tick }) => {
      const done = useRef(false)
      useEffect(() => {
        if (done.current) return
        done.current = true
        runs += 1
      }, [tick])
    }, { initialProps: { tick: 0 } })

    rerender({ tick: 1 })
    rerender({ tick: 2 })
    expect(runs).toBe(1)
  })

  it('act() deja asentar una actualizacion asincrona', async () => {
    const { result } = renderHook(() => {
      const [v, setV] = useState('cargando')
      useEffect(() => { Promise.resolve().then(() => setV('listo')) }, [])
      return v
    })
    await act(async () => {})
    expect(result.current).toBe('listo')
  })

  // Lo que NINGUN test podia ver hasta hoy: un ReferenceError de TDZ en una
  // deps array revienta EN RENDER, no en build ni al importar el modulo.
  it('un error en render se puede capturar, que es como se prueba un crash', () => {
    // React loguea el error ademas de propagarlo; se silencia para que la
    // salida de la suite no parezca un fallo.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const boom = () => renderHook(() => { throw new ReferenceError("Cannot access 'x'") })
      expect(boom).toThrow(ReferenceError)
    } finally {
      spy.mockRestore()
    }
  })
})
