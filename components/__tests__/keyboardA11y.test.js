/**
 * FASE SI (B10): lo que se puede hacer con el mouse se tiene que poder hacer
 * con el teclado. Tres piezas: el helper `pressable`, la "i" de ayuda (que
 * vive en ~100 pantallas) y un guardián de FUENTE para que un elemento nuevo
 * que solo responde al click no vuelva a colarse.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import { pressable } from '../../lib/pressable'
import { InfoTip } from '../ui/Tooltip'

describe('pressable', () => {
  it('Enter y Espacio activan, como en un botón', () => {
    const fn = jest.fn()
    render(<div {...pressable(fn)}>celda</div>)
    const el = screen.getByRole('button', { name: 'celda' })
    expect(el.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(el, { key: 'Enter' })
    fireEvent.keyDown(el, { key: ' ' })
    fireEvent.keyDown(el, { key: 'a' })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('una tecla DENTRO del elemento no lo activa (fila con un campo adentro)', () => {
    const fn = jest.fn()
    render(<table><tbody><tr {...pressable(fn, { role: null, expanded: true })}><td><input aria-label="campo" /></td></tr></tbody></table>)
    fireEvent.keyDown(screen.getByLabelText('campo'), { key: 'Enter' })
    expect(fn).not.toHaveBeenCalled()
    const row = screen.getByRole('row')
    expect(row.getAttribute('role')).toBeNull()
    expect(row.getAttribute('aria-expanded')).toBe('true')
  })

  it('el click sigue funcionando igual', () => {
    const fn = jest.fn()
    render(<span {...pressable(fn)}>x</span>)
    fireEvent.click(screen.getByRole('button'))
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('InfoTip con teclado y lector de pantalla', () => {
  it('es un botón enfocable que se anuncia con su texto', () => {
    render(<InfoTip text="El patrimonio neto es activos menos deudas." />)
    const btn = screen.getByRole('button', { name: 'El patrimonio neto es activos menos deudas.' })
    expect(btn.getAttribute('tabindex')).toBe('0')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('al enfocarlo se abre, Esc lo cierra, Enter lo vuelve a abrir', () => {
    render(<InfoTip text="Ayuda" />)
    const btn = screen.getByRole('button', { name: 'Ayuda' })
    fireEvent.focus(btn)
    expect(screen.getByRole('tooltip').textContent).toContain('Ayuda')
    fireEvent.keyDown(btn, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.keyDown(btn, { key: 'Enter' })
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.blur(btn)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

// ⛔ Un div/span/tr/li que responde al click y no entra al orden del teclado.
// Se exceptúan los telones que cierran un menú o modal al tocar fuera: para
// eso existe Esc (hooks/useEscClose.js), y hacerlos enfocables metería una
// parada vacía en la tabulación.
describe('guardián: nada clickeable queda fuera del teclado', () => {
  const parser = require('@babel/parser')
  const traverse = require('@babel/traverse').default
  const root = path.join(__dirname, '..', '..')
  const files = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      if (f === 'node_modules' || f === '__tests__' || f.startsWith('.')) continue
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) walk(p)
      else if (/\.jsx$/.test(f)) files.push(p)
    }
  }
  walk(path.join(root, 'app'))
  walk(path.join(root, 'components'))

  it('recorrió archivos de verdad', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('todo elemento no interactivo con onClick es enfocable o es un telón', () => {
    const offenders = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      let ast
      try { ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] }) } catch { continue }
      traverse(ast, {
        JSXOpeningElement(p) {
          const name = p.node.name.name
          if (!['div', 'span', 'li', 'tr', 'td', 'p', 'img'].includes(name)) return
          const attrs = p.node.attributes
          const named = Object.fromEntries(attrs.filter((a) => a.name).map((a) => [a.name.name, a]))
          if (!named.onClick) return
          if (named.tabIndex || named.role) return
          if (attrs.some((a) => a.type === 'JSXSpreadAttribute')) return
          const cls = named.className ? src.slice(named.className.start, named.className.end) : ''
          if (/modal-backdrop/.test(cls)) return
          const handler = src.slice(named.onClick.start, named.onClick.end)
          const closesOnly = /set\w+\(\s*false\s*\)|onClose|currentTarget|stopPropagation/.test(handler) && !/!\s*\w|=>\s*!|toggle/.test(handler)
          if (closesOnly) return
          offenders.push(`${path.relative(root, f)}:${p.node.loc.start.line} <${name}>`)
        },
      })
    }
    expect(offenders).toEqual([])
  })
})
