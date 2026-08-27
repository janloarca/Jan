/**
 * @jest-environment node
 */
// La única decisión del despachador que puede dejar a alguien sin correo (o
// mandarle uno de más) es QUÉ CADENCIA toca hoy. Vive en una función pura y
// exportada justamente para poder fijarla con tests, en vez de quedar
// enterrada en una expresión cron que nadie puede probar.
jest.mock('../../lib/firebase-admin', () => ({ getAdminDb: () => null }))
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: jest.fn(), close: jest.fn() }) }))

import { dueCadences } from '../../app/api/cron/notifications/route'

const utc = (iso) => new Date(`${iso}T22:00:00Z`)

describe('qué cadencia toca hoy', () => {
  test('el domingo toca la semanal', () => {
    expect(dueCadences(utc('2026-08-16'))).toContain('weekly') // domingo
  })

  test('el día 1 toca la mensual (FASE IE)', () => {
    expect(dueCadences(utc('2026-09-01'))).toContain('monthly') // martes 1
    expect(dueCadences(utc('2026-09-01'))).not.toContain('weekly')
  })

  test('un domingo que cae en día 1 manda TODAS las que tocan: contenidos distintos, cadencias independientes', () => {
    // 1 de noviembre de 2026 es domingo. El valor esperado subió de dos a tres
    // al agregarse el correo de grupos (FASE LR): describía el conjunto de
    // cadencias de entonces, no un invariante, así que actualizarlo es correcto.
    expect(dueCadences(utc('2026-11-01'))).toEqual(['weekly', 'friendsWeekly', 'monthly'])
  })

  // ⛔ El correo de grupos es una cadencia SEPARADA del resumen semanal, no una
  // sección suya: uno habla de vos y el otro de otras personas, así que querer
  // ver cómo va el grupo no implica querer el reporte del propio portafolio.
  test('el domingo toca también la de grupos, y solo el domingo', () => {
    expect(dueCadences(utc('2026-08-16'))).toContain('friendsWeekly') // domingo
    expect(dueCadences(utc('2026-09-01'))).not.toContain('friendsWeekly') // martes 1
  })

  test('la de grupos sale exactamente cada domingo, ni más ni menos', () => {
    let n = 0
    for (let i = 0; i < 28; i++) {
      if (dueCadences(new Date(Date.UTC(2026, 7, 1 + i, 22))).includes('friendsWeekly')) n++
    }
    expect(n).toBe(4)
  })

  test('un día cualquiera (ni domingo ni día 1) no toca nada', () => {
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']) {
      expect(dueCadences(utc(d))).toEqual([])
    }
  })

  test('el 1 de enero salen la mensual (diciembre) y la anual (el año), FASE IE6', () => {
    const due = dueCadences(utc('2027-01-01')) // viernes
    expect(due).toContain('monthly')
    expect(due).toContain('annual')
    expect(due).not.toContain('weekly')
  })

  test('el 1 de CUALQUIER otro mes no dispara la anual', () => {
    for (const d of ['2026-09-01', '2026-10-01', '2026-12-01']) {
      expect(dueCadences(utc(d))).not.toContain('annual')
    }
  })

  test('en un año completo la anual sale exactamente una vez', () => {
    let annual = 0
    for (let i = 0; i < 365; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i, 22))
      if (dueCadences(d).includes('annual')) annual++
    }
    expect(annual).toBe(1)
  })

  test('en un mes completo: la semanal sale exactamente cada domingo y la mensual exactamente el 1', () => {
    let weekly = 0, monthly = 0
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 7, 1 + i, 22))
      const due = dueCadences(d)
      if (due.includes('weekly')) weekly++
      if (due.includes('monthly')) monthly++
    }
    expect(weekly).toBe(4)
    expect(monthly).toBe(1)
  })
})
