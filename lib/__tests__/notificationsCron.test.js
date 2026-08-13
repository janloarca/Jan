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

  test('el resto de la semana no toca nada', () => {
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15']) {
      expect(dueCadences(utc(d))).toEqual([])
    }
  })

  test('el cron corre a diario, así que exactamente un día de cada siete envía', () => {
    let sundays = 0
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 7, 1 + i, 22))
      if (dueCadences(d).length > 0) sundays++
    }
    expect(sundays).toBe(4)
  })
})
