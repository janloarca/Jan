import { buildFinanceReminderEmail } from '../financeReminderEmail'

describe('recordatorio de fin de mes: contenido', () => {
  test('español: asunto con el mes, enlace a finanzas y aviso de no responder', () => {
    const { subject, html, text } = buildFinanceReminderEmail('es', 'agosto 2026')
    expect(subject).toContain('agosto 2026')
    expect(html).toContain('https://chispu.xyz/finances')
    expect(html).toContain('No respondas a esta dirección')
    expect(text).toContain('No respondas a esta dirección')
    // El texto plano no puede traer etiquetas HTML: hay clientes que lo
    // muestran tal cual.
    expect(text).not.toMatch(/<[a-z/][^>]*>/i)
  })

  test('inglés: mismo contrato', () => {
    const { subject, html, text } = buildFinanceReminderEmail('en', 'August 2026')
    expect(subject).toContain('August 2026')
    expect(html).toContain('do not reply')
    expect(text).toContain('do not reply')
    expect(text).not.toMatch(/<[a-z/][^>]*>/i)
  })

  // FASE HX2: el default es INGLÉS. Un caller que se olvide del idioma manda
  // lo que el producto emite hoy, no español.
  test('sin idioma (o uno desconocido) sale en inglés', () => {
    expect(buildFinanceReminderEmail(undefined, 'August 2026').html).toContain('Fill my finances')
    expect(buildFinanceReminderEmail('pt', 'August 2026').html).toContain('Fill my finances')
  })

  test("el español sigue disponible, pero solo con 'es' explícito", () => {
    expect(buildFinanceReminderEmail('es', 'agosto 2026').html).toContain('Llenar mis finanzas')
  })

  test('siempre trae las tres piezas y ninguna vacía', () => {
    for (const lang of ['es', 'en']) {
      const mail = buildFinanceReminderEmail(lang, 'agosto 2026')
      expect(mail.subject.length).toBeGreaterThan(10)
      expect(mail.html.length).toBeGreaterThan(100)
      expect(mail.text.length).toBeGreaterThan(100)
    }
  })
})
