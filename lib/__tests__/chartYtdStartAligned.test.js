// FASE RU (dentro del OK de FASE RT). La gráfica del YTD arrancaba el 1 de
// enero con su propio valor ($344,827.15) cuando existía un punto ese día,
// mientras el encabezado medía desde el 2 ($345,344.80). El bloque viejo solo
// agregaba el punto del ancla cuando la serie NO tenía nada el 1. Este guardián
// lee la FUENTE (el bloque vive dentro de un memo que jest no puede montar sin
// el tablero entero): la vista "Todas" descarta lo anterior al día del ancla
// del encabezado y el primer punto toma su fecha y su VALOR.
const fs = require('fs')
const path = require('path')

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const chart = strip(fs.readFileSync(path.join(__dirname, '../../components/dashboard/PortfolioGrowthChart.jsx'), 'utf8'))
const page = strip(fs.readFileSync(path.join(__dirname, '../../app/dashboard/page.jsx'), 'utf8'))

describe('YTD: gráfica, tooltip y encabezado arrancan del mismo punto (FASE RU)', () => {
  it('el componente recibe el valor de arranque del encabezado', () => {
    expect(chart).toMatch(/ytdStartTs = null, ytdStartValue = null/)
  })

  it('descarta los puntos anteriores al día del ancla', () => {
    expect(chart).toMatch(/while \(pts\.length > 1 && Math\.floor\(pts\[0\]\.ts \/ 86400000\) < startDay\) pts\.shift\(\)/)
  })

  it('el primer punto toma la fecha y el valor del encabezado', () => {
    expect(chart).toMatch(/pts\[0\] = \{ \.\.\.pts\[0\], ts: ytdStartTs, date: new Date\(ytdStartTs\), value: v \?\? pts\[0\]\.value \}/)
    expect(chart).toMatch(/pts\.unshift\(\{ ts: ytdStartTs, date: new Date\(ytdStartTs\), value: v \}\)/)
  })

  it('el tablero le pasa el valor (y lo apaga en una vista escopada)', () => {
    expect(page).toMatch(/ytdStartValue=\{scopedView \? null : ytdStartValue\}/)
  })
})
