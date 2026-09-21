/**
 * @jest-environment node
 */
// FASE OO. Lo que se ve ANTES de abrir el correo.
//
// El reporte del usuario, con captura de su iPhone: el asunto ("Chispudo
// Weekly · Sep 7-13, 2026") estaba limpio y debajo, en la lista del buzón y
// sin desbloquear el teléfono, se leía su patrimonio completo. Es dato
// sensible y no puede vivir donde se ve sin abrir nada.
//
// Estos tests fijan las DOS mitades, porque ninguna alcanza sola:
//
//   1. El PREHEADER. Un cliente que no encuentra uno arma el snippet con lo
//      primero del cuerpo, y lo primero era la cifra grande. Cubre a todo
//      cliente clásico (Gmail, Outlook, Android, iOS sin resumen).
//   2. El TOTAL FUERA DEL CUERPO por default. Es lo único que garantiza la
//      ausencia contra un cliente que respeta `display:none` al extraer el
//      snippet, y contra un resumen generado en el dispositivo, que lee el
//      correo ENTERO y no hay cabecera nuestra que lo apague.
//
// El modo "mostrar el total" NO se borró: es un interruptor (emailShowNetWorth)
// y sus tests de acá son la regresión que prueba que encenderlo devuelve el
// correo de siempre.

import { renderEmail, portfolioHero } from '../emailLayout'
import { buildWeeklyBriefEmail } from '../weeklyBriefEmail'
import { buildMonthlyBriefEmail, buildAnnualBriefEmail } from '../periodBriefEmail'
import { buildFriendsWeeklyEmail } from '../friendsWeeklyEmail'

const PORTFOLIO = {
  netWorth: 28547.41,
  weekAbs: 61.9, weekPct: 0.22,
  monthAbs: 120.5, monthPct: 0.42,
  yearAbs: 211.14, yearPct: 0.74,
  ytdAbs: 211.14, ytdPct: 0.74,
  incomeAbs: 45.2, incomeCount: 2,
  movers: [{ symbol: 'NVO', pct: 2.1 }, { symbol: 'META', pct: -1.8 }],
  currency: 'USD', asOf: 'Sep 13, 2026',
}

// El patrimonio de la captura, tal como lo imprime Intl. Es la cadena exacta
// que NO puede aparecer en ningún lado del correo por default.
const TOTAL = '$28,547.41'

const CASES = [
  ['semanal', (extra) => buildWeeklyBriefEmail({ weekLabel: 'Sep 7-13, 2026', portfolio: PORTFOLIO, ...extra })],
  ['mensual', (extra) => buildMonthlyBriefEmail({ monthLabel: 'August 2026', portfolio: PORTFOLIO, ...extra })],
  ['anual', (extra) => buildAnnualBriefEmail({ yearLabel: '2026', portfolio: PORTFOLIO, ...extra })],
]

describe('preheader: la línea que se lee sin abrir el correo', () => {
  test.each(CASES)('%s: abre con una frase SIN números, en HTML y en texto', (_name, build) => {
    const { html, text } = build()

    // En el HTML va antes que nada: si fuera después de la tarjeta, el cliente
    // ya habría tomado su snippet del contenido visible.
    expect(html.indexOf('<div style="display:none')).toBe(0)
    const preheader = html.slice(0, html.indexOf('</div>'))
    expect(preheader).toContain('Open to see the numbers')
    expect(preheader).toMatch(/mso-hide:all/)
    // Relleno de anchos-cero: empuja el contenido visible fuera de la ventana
    // del snippet en los clientes que cuentan esos caracteres.
    expect(preheader).toContain('&#8203;')

    // Y es la PRIMERA línea del texto plano, que es de donde varios clientes
    // arman el snippet cuando existe.
    const firstLine = text.split('\n')[0]
    expect(firstLine).toMatch(/Open to see the numbers/)

    // ⛔ El LARGO importa, y esto se midió en navegador antes de fijarlo: con
    // una frase corta ("Your week in Chispudo.", 47 caracteres) la ventana del
    // snippet seguía teniendo lugar para lo que viene detrás, y ahí aparecía
    // el monto de la variación. La frase tiene que llenar la ventana ella
    // sola, sin depender de que el cliente cuente el relleno invisible.
    expect(firstLine.length).toBeGreaterThanOrEqual(100)
    expect(firstLine).not.toMatch(/\d/)
  })

  test('el correo de grupos también lo trae: nombres y puestos ajenos tampoco van en una pantalla bloqueada', () => {
    const { html, text } = buildFriendsWeeklyEmail({
      groups: [{
        id: 'g1', name: 'Los del cafe', scope: 'all',
        rows: [
          { uid: 'u1', displayName: 'Ana', ytd: 12.5, mtd: 1.2, rank: 1 },
          { uid: 'me', displayName: 'Jan', ytd: 8.1, mtd: 0.4, rank: 2, isYou: true },
        ],
      }],
    })
    expect(html.indexOf('<div style="display:none')).toBe(0)
    const firstLine = text.split('\n')[0]
    expect(firstLine).toMatch(/Open to see the standings/)
    expect(firstLine.length).toBeGreaterThanOrEqual(100)
  })

  // Lo que de verdad se lee en la lista del buzón: el cuerpo sin etiquetas.
  // Se mide de las DOS formas posibles, porque no sabemos cuál usa el cliente
  // de cada quien: contando el relleno invisible (lo que hace que la técnica
  // funcione) y descartándolo (el peor caso).
  test.each(CASES)('%s: los primeros 160 caracteres del snippet no traen ni un monto', (_name, build) => {
    const { html } = build()
    const strip = (keepPad) => html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#8203;|&nbsp;/g, keepPad ? '_' : ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)
    for (const keepPad of [true, false]) {
      expect(strip(keepPad)).not.toMatch(/\$[\d,]+\.\d\d/)
    }
  })
})

describe('el total fuera del cuerpo por default', () => {
  test.each(CASES)('%s: el patrimonio NO aparece ni en el HTML ni en el texto', (_name, build) => {
    const { html, text } = build()
    expect(html).not.toContain(TOTAL)
    expect(text).not.toContain(TOTAL)
    // La ausencia se DICE: un correo que deja de traer una cifra sin explicar
    // por qué se lee como un correo roto.
    expect(text).toMatch(/kept out of this email/)
  })

  test.each(CASES)('%s: la cifra principal pasa a ser la variación del período', (_name, build) => {
    const { text } = build()
    // El porcentaje queda de cifra grande (no dice cuánto dinero tenés) y el
    // monto baja a la pastilla, que es la que lleva color por signo.
    expect(text).toMatch(/(This week|This month|This year): \+0\.\d\d%/)
  })

  test.each(CASES)('%s: con el interruptor encendido vuelve el correo de siempre', (_name, build) => {
    const { html, text } = build({ showNetWorth: true })
    expect(html).toContain(TOTAL)
    expect(text).toContain(`Net worth: ${TOTAL}`)
    // Y entonces no se explica ninguna ausencia, porque no hay ninguna.
    expect(text).not.toMatch(/kept out of this email/)
  })

  test('el asunto nunca llevó cifras y sigue sin llevarlas', () => {
    for (const [, build] of CASES) {
      expect(build().subject).not.toMatch(/\d[\d,]*\.\d\d/)
    }
  })
})

describe('portfolioHero', () => {
  const change = { label: 'This week', combo: '+$61.90 (+0.22%)', abs: '+$61.90', pct: '+0.22%', suffix: 'this week' }

  test('con el total: la cifra grande es el total y la variación va en la pastilla', () => {
    expect(portfolioHero({ showTotal: true, total: { label: 'Net worth', value: TOTAL }, change }))
      .toEqual({ label: 'Net worth', value: TOTAL, delta: '+$61.90 (+0.22%) this week', asOf: null })
  })

  test('sin el total: la cifra grande es el porcentaje y el monto va en la pastilla', () => {
    expect(portfolioHero({ showTotal: false, total: { label: 'Net worth', value: TOTAL }, change }))
      .toEqual({ label: 'This week', value: '+0.22%', delta: '+$61.90', asOf: null })
  })

  test('con un solo dato medible, ese es la cifra y no hay pastilla', () => {
    const only = { label: 'This week', combo: '+$61.90', abs: '+$61.90', pct: null, suffix: 'this week' }
    expect(portfolioHero({ showTotal: false, total: { label: 'Net worth', value: TOTAL }, change: only }))
      .toEqual({ label: 'This week', value: '+$61.90', delta: null, asOf: null })
  })

  test('sin variación medible NO hay cifra principal: un "-" grande no es un dato', () => {
    const none = { label: 'This week', combo: null, abs: null, pct: null, suffix: 'this week' }
    expect(portfolioHero({ showTotal: false, total: { label: 'Net worth', value: TOTAL }, change: none })).toBeNull()
  })
})

describe('renderEmail sin preheader', () => {
  test('no inventa uno: un correo que no lo declara sale como siempre', () => {
    const { html, text } = renderEmail({ title: 'Algo', sections: [{ rows: [['a', 'b', '']] }] })
    expect(html.startsWith('<table')).toBe(true)
    expect(text.split('\n')[0]).toBe('Algo')
  })
})
