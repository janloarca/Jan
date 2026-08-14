/**
 * @jest-environment node
 */
// FASE IE3. Alineación de la tabla de cifras, reportada con captura ("más
// bonitos / alineados"): las cuatro cantidades terminaban cada una en un lugar
// distinto porque la tercera columna (la nota: "as of Aug 14, 2026" contra "2
// payments" contra nada) decidía, fila por fila, dónde cabía el número.
//
// Estos tests fijan las tres piezas del arreglo. Ninguna es cosmética: sin
// ellas la columna vuelve a bailar y nadie lo nota hasta ver un correo real.

import { renderEmail } from '../emailLayout'

const doc = () => renderEmail({
  title: 'Chispudo Monthly',
  subtitle: 'August 2026',
  sections: [{
    heading: 'Your month',
    rows: [
      ['Net worth', '$27,258.34', 'as of Aug 14, 2026'],
      ['This month', '+$256.88 (+0.99%)', ''],
      ['Income collected', '$9.66', '2 payments'],
    ],
    paragraphs: ['Attached: your report.'],
    cta: { label: 'Open Chispudo', url: 'https://chispu.xyz/dashboard' },
  }],
  manageUrl: 'https://chispu.xyz/dashboard',
  reason: 'You enabled monthly notifications.',
})

describe('emailLayout: la columna de cifras no puede bailar', () => {
  test('la tabla es de ancho FIJO con las tres columnas declaradas', () => {
    const { html } = doc()
    expect(html).toContain('table-layout:fixed')
    // Los anchos van en el td además del colgroup: un cliente que descarta
    // colgroup (varios lo hacen) conserva igual la geometría.
    expect(html).toContain('width="40%"')
    expect(html).toContain('width="33%"')
    expect(html).toContain('width="27%"')
  })

  test('las cifras usan numerales tabulares (mismo ancho por dígito)', () => {
    const { html } = doc()
    const hits = html.match(/tabular-nums/g) || []
    // Valor y nota de cada fila: los dos son números en el brief de mercado.
    expect(hits.length).toBeGreaterThanOrEqual(6)
  })

  test('la versión de texto también alinea: todos los valores terminan en la misma columna', () => {
    const { text } = doc()
    const lines = text.split('\n').filter((l) => /\$/.test(l) && l.startsWith('  '))
    expect(lines.length).toBe(3)
    // El final del valor (antes de la nota, si la hay) cae en la misma posición.
    const ends = lines.map((l) => {
      const m = l.match(/^\s+\S.*?((?:\+|-)?\$[\d,]+\.\d\d(?: \([^)]+\))?)/)
      return l.indexOf(m[1]) + m[1].length
    })
    expect(new Set(ends).size).toBe(1)
  })
})

describe('emailLayout: estructura que los clientes de correo sí maquetan', () => {
  test('todo va en tablas anidadas, sin divs de layout ni flex/grid', () => {
    const { html } = doc()
    expect(html).not.toMatch(/display:\s*(flex|grid)/)
    // El único div es la línea divisoria de 1px, que no maqueta nada.
    const divs = html.match(/<div/g) || []
    expect(divs.length).toBeLessThanOrEqual(1)
  })

  test('el botón es una tabla con fondo, no un <a> suelto con padding', () => {
    // Outlook ignora el padding de un <a>: el botón quedaría como texto.
    const { html } = doc()
    expect(html).toMatch(/<table[^>]*>\s*<tr><td style="border-radius:8px;background:[^"]+"><a href/)
  })

  test('el pie legal completo viaja en las dos versiones', () => {
    const { html, text } = doc()
    for (const out of [html, text]) {
      expect(out).toContain('You enabled monthly notifications.')
      expect(out).toContain('do not reply')
      expect(out).toContain('chispu.xyz')
    }
  })

  test('el contenido se escapa: un nombre con < no puede inyectar marcado', () => {
    const { html } = renderEmail({
      title: '<script>x</script>',
      sections: [{ rows: [['a & b', '"1"', '']] }],
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b')
  })
})
