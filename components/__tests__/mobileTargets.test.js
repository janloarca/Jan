/**
 * FASE SH (B7): teléfono de 320 a 390 px.
 *
 * 1. La "i" de ayuda no abría en táctil: un toque dispara un mouseenter emulado
 *    (abría) y luego el click (cerraba). Se prueba el componente montado con la
 *    secuencia de eventos de cada tipo de puntero.
 * 2. Los objetivos chicos (borrar un movimiento, cambiar categoría, la "i") se
 *    fijan por fuente: el tamaño se midió en navegador a 320 px y lo que se
 *    exige acá es que la clase que lo garantiza no se pierda.
 */
const React = require('react')
const { render, screen, fireEvent, act } = require('@testing-library/react')
const fs = require('fs')
const path = require('path')
const Tooltip = require('../ui/Tooltip').default
const { InfoTip } = require('../ui/Tooltip')

const pe = (el, type, pointerType) => {
  // React sintetiza onPointerEnter desde pointerover, así que el "enter" se despacha como pointerover.
  const ev = new window.Event(type === 'pointerenter' ? 'pointerover' : type, { bubbles: true })
  Object.defineProperty(ev, 'pointerType', { value: pointerType })
  act(() => { el.dispatchEvent(ev) })
}

function mount() {
  render(React.createElement(Tooltip, { text: 'Ayuda visible' }, React.createElement('span', null, 'i')))
  return screen.getByText('i').parentElement
}

describe('Tooltip en táctil y con mouse', () => {
  test('un toque abre la ayuda (y no la cierra en el mismo instante)', () => {
    const w = mount()
    pe(w, 'pointerdown', 'touch')
    pe(w, 'pointerenter', 'touch')
    fireEvent.click(w)
    expect(screen.queryByText('Ayuda visible')).toBeTruthy()
  })

  test('un segundo toque la cierra', () => {
    const w = mount()
    pe(w, 'pointerdown', 'touch'); fireEvent.click(w)
    pe(w, 'pointerdown', 'touch'); fireEvent.click(w)
    expect(screen.queryByText('Ayuda visible')).toBeNull()
  })

  test('con mouse: el hover abre y el click no la cierra debajo del cursor', () => {
    const w = mount()
    pe(w, 'pointerenter', 'mouse')
    expect(screen.queryByText('Ayuda visible')).toBeTruthy()
    pe(w, 'pointerdown', 'mouse'); fireEvent.click(w)
    expect(screen.queryByText('Ayuda visible')).toBeTruthy()
  })

  test('InfoTip: el área tocable es de 24 px sin mover el layout', () => {
    render(React.createElement(InfoTip, { text: 'x' }))
    const dot = screen.getByText('i')
    const hit = dot.parentElement
    expect(hit.style.padding).toBe('4px')
    expect(hit.style.margin).toBe('-4px -4px -4px 0px')
    expect(dot.style.width).toBe('16px')
  })
})

describe('objetivos táctiles por fuente', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8')
  test('borrar un movimiento mide al menos 28 px', () => {
    expect(read('components/finance/FinanceTransactionList.jsx')).toMatch(/min-w-\[28px\] min-h-\[28px\]/)
  })
  test('cambiar categoría mide al menos 24 px de alto', () => {
    expect(read('components/finance/FinanceTransactionList.jsx')).toMatch(/min-h-\[24px\] -my-1 transition-colors/)
  })
  test('la composición del patrimonio no corta "Caja & Bancos"', () => {
    const src = read('components/dashboard/NetWorthCard.jsx')
    expect(src).not.toMatch(/text-xs text-slate-400 truncate">\{catLabel\(seg\)\}/)
  })
  test('el nombre de un grupo largo se corta solo a sí mismo, no a su etiqueta de alcance', () => {
    expect(read('components/friends/GroupCard.jsx')).toMatch(/<span className="truncate min-w-0">\{group\.name\}<\/span>/)
  })
})
