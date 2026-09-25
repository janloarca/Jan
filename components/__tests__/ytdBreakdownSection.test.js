/**
 * FASE OZ. El desglose del YTD como sección de ancho completo, hermana de las
 * dos cards superiores. Componente REAL vía @testing-library: el CTA de la card
 * (YtdBreakdownToggle) y la región (YtdBreakdownSection) nacen del mismo
 * archivo y se prueban montados juntos como en el tablero.
 */
import React, { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import YtdBreakdownSection, { YtdBreakdownToggle, YTD_BREAKDOWN_ID, CLOSE_MS } from '@/components/dashboard/YtdBreakdownSection'

afterEach(cleanup)

const groups = [
  { key: 'idc', name: 'IDC', gain: 379.66, ret: 5.29, internal: -223.97 },
  { key: 'ibkr', name: 'Interactive Brokers', gain: 581.06, ret: 7.39, internal: 0 },
  { key: 'aixen', name: 'AIXEN', gain: 0, ret: 0, internal: 223.97 },
  { key: 'osmo', name: 'OSMO', gain: -26.65, ret: -18.1, internal: 0 },
]
const ytdChange = 934.07

function Harness({ initialOpen = false, ...over }) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <div>
      <YtdBreakdownToggle open={open} onToggle={() => setOpen((v) => !v)} lang="es" />
      <YtdBreakdownSection open={open} onClose={() => setOpen(false)} lang="es"
        ytdChange={ytdChange} ytdBreakdown={{ groups }} ytdBreakdownReason={null}
        ytdStartValue={11756.88} ytdStartTs={Date.UTC(2026, 0, 1)} ytdStartSrc="backfill" {...over} />
    </div>
  )
}

describe('YtdBreakdownSection', () => {
  it('cerrado por default: el CTA dice "Ver desglose del YTD" y la región no existe', () => {
    render(<Harness />)
    const cta = screen.getByRole('button', { name: /Ver desglose del YTD/ })
    expect(cta.getAttribute('aria-expanded')).toBe('false')
    expect(cta.getAttribute('aria-controls')).toBe(YTD_BREAKDOWN_ID)
    expect(document.getElementById(YTD_BREAKDOWN_ID)).toBeNull()
  })

  it('abrir monta la región con su título, cambia el CTA a "Ocultar desglose" y no pasa por position absolute', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Ver desglose del YTD/ }))
    const region = await screen.findByRole('region', { name: /Desglose del rendimiento YTD/ })
    expect(region.id).toBe(YTD_BREAKDOWN_ID)
    expect(screen.getByRole('button', { name: /Ocultar desglose/ }).getAttribute('aria-expanded')).toBe('true')
    const wrapper = screen.getByTestId('ytd-disclosure')
    expect(wrapper.className).toMatch(/\bcol-span-full\b/)
    expect(wrapper.className).not.toMatch(/absolute/)
    expect(region.className).toMatch(/\bcard\b/)
  })

  it('las filas van por impacto absoluto, con signo y flecha, y suman el total mostrado', () => {
    render(<Harness initialOpen />)
    const rows = Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.textContent)
    expect(rows[0]).toMatch(/^Interactive Brokers/)
    expect(rows[1]).toMatch(/^IDC/)
    expect(rows[2]).toMatch(/^OSMO/)
    expect(rows[3]).toMatch(/^AIXEN/)
    // Dirección con signo Y flecha, nunca solo color.
    expect(rows[0]).toMatch(/▲ \+7\.39%/)
    expect(rows[0]).toMatch(/\+\$581\.06/)
    expect(rows[2]).toMatch(/▼ −18\.10%/)
    expect(rows[2]).toMatch(/−\$26\.65/)
    // La cuenta en cero se ve, no se esconde, y va sin flecha.
    expect(rows[3]).toMatch(/AIXEN0\.00%\$0\.00/)
    expect(document.querySelector('tfoot').textContent).toMatch(/Total YTD\+\$934\.07/)
    // Cuadra: sin etiqueta de "Estimado" ni de "Datos incompletos".
    expect(document.body.textContent).not.toMatch(/Estimado|Datos incompletos/)
  })

  it('nombra las transferencias internas neteadas y el valor inicial del año', () => {
    render(<Harness initialOpen />)
    const txt = document.body.textContent
    expect(txt).toMatch(/Las transferencias entre cuentas propias se netean y no se contabilizan como rendimiento\./)
    expect(txt).toMatch(/Transferencias internas neteadas: IDC −\$223\.97 · AIXEN \+\$223\.97\./)
    expect(txt).toMatch(/Valor inicial del año: \$11,756\.88 · /)
    expect(txt).toMatch(/cálculo derivado\./)
  })

  it('si las filas NO suman el YTD, lo dice con las dos cifras en vez de esconderlo', () => {
    render(<Harness initialOpen ytdChange={1200} />)
    expect(document.body.textContent).toMatch(/Datos incompletos/)
    expect(document.body.textContent).toMatch(/Las filas suman \$934\.07 y el YTD de la tarjeta es \$1,200\.00/)
  })

  it('con una fila "Sin atribuir" o un arranque estimado la etiqueta es "Estimado"', () => {
    render(<Harness initialOpen ytdBreakdown={{ groups: [...groups, { key: '__unexplained__', name: null, isUnexplained: true, gain: 59.11, ret: null }] }} ytdChange={993.18} />)
    expect(document.body.textContent).toMatch(/Estimado/)
    const rows = Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.textContent)
    expect(rows[rows.length - 1]).toMatch(/^Sin atribuir/)
  })

  it('cuando el motor rehusó, la región explica por qué en vez de quedar vacía', () => {
    render(<Harness initialOpen ytdBreakdown={null} ytdBreakdownReason="unexplained-too-large"
      ytdBreakdownDetail={{ unexplained: 1107.47, cap: 237.12, accounts: [{ name: 'IDC', start: 3539.27, end: 9843.64, flow: 5934.48, src: 'api' }], anchor: 11856.08 }} />)
    expect(screen.getByRole('region', { name: /Desglose del rendimiento YTD/ })).toBeTruthy()
    expect(document.body.textContent).toMatch(/Tu YTD sigue siendo correcto/)
    expect(document.body.textContent).toMatch(/Diferencia\$1,107\.47/)
    expect(document.querySelector('tbody')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Ver detalle por cuenta/ }))
    expect(document.body.textContent).toMatch(/Arranque del portafolio/)
  })

  it('cerrar espera la transición y después desmonta la región (sin fila vacía en el grid)', async () => {
    jest.useFakeTimers()
    try {
      render(<Harness initialOpen />)
      await act(async () => { jest.advanceTimersByTime(20) })
      fireEvent.click(screen.getByRole('button', { name: /Ocultar desglose/ }))
      // Justo después del clic la región sigue montada, ya marcada como cerrándose.
      expect(document.getElementById(YTD_BREAKDOWN_ID)).not.toBeNull()
      expect(screen.getByTestId('ytd-disclosure').getAttribute('data-open')).toBe('false')
      await act(async () => { jest.advanceTimersByTime(CLOSE_MS + 5) })
      expect(document.getElementById(YTD_BREAKDOWN_ID)).toBeNull()
      expect(screen.queryByTestId('ytd-disclosure')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('el botón "Ocultar" dentro de la región también cierra', async () => {
    render(<Harness initialOpen />)
    fireEvent.click(screen.getByRole('button', { name: /^Ocultar$/ }))
    expect(screen.getByRole('button', { name: /Ver desglose del YTD/ }).getAttribute('aria-expanded')).toBe('false')
  })
})
