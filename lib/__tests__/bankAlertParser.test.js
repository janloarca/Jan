import { parseBankAlert, htmlToText, splitMerchantLocation } from '../parsers/bankAlertParser'

describe('htmlToText', () => {
  it('keeps the visible words and the line structure', () => {
    const html = '<table><tr><td>Consumo</td></tr><tr><td>GTQ&nbsp;17.00</td></tr></table><script>var x=1</script>'
    const text = htmlToText(html)
    expect(text).toContain('Consumo')
    expect(text).toContain('GTQ 17.00')
    expect(text).not.toContain('var x')
  })

  it('decodes the entities banks actually emit', () => {
    expect(htmlToText('<p>Caf&amp;#233; &amp; M&#225;s</p>')).toContain('&')
  })
})

describe('splitMerchantLocation', () => {
  it('splits the merchant from its location', () => {
    expect(splitMerchantLocation('Rally Padel Guatemala, Santa Catarina Pinula, GT')).toEqual({
      merchant: 'Rally Padel Guatemala',
      location: 'Santa Catarina Pinula, GT',
    })
  })

  it('drops the ellipsis a push notification truncates with', () => {
    expect(splitMerchantLocation('Rally Padel Guatemala, Santa Catarina Pinula,…').location).toBe('Santa Catarina Pinula')
  })

  it('handles a merchant with no location', () => {
    expect(splitMerchantLocation('NETFLIX.COM')).toEqual({ merchant: 'NETFLIX.COM', location: null })
  })
})

describe('parseBankAlert', () => {
  it('parses a labeled Spanish alert', () => {
    const res = parseBankAlert({
      subject: 'Notificación de consumo',
      text: [
        'Estimado cliente,',
        'Se realizó un consumo con su tarjeta terminada en 4821.',
        'Monto: GTQ 17.00',
        'Comercio: RALLY PADEL GUATEMALA, SANTA CATARINA PINULA, GT',
        'Fecha: 03/08/2026',
      ].join('\n'),
    })
    expect(res).toMatchObject({
      amount: 17,
      currency: 'GTQ',
      merchant: 'RALLY PADEL GUATEMALA',
      location: 'SANTA CATARINA PINULA, GT',
      date: '2026-08-03',
      last4: '4821',
      kind: 'debit',
    })
  })

  it('parses the "en X el Y" phrasing', () => {
    const res = parseBankAlert({
      text: 'Se aprobó una transacción por Q1,234.56 en SUPER PAIZ ROOSEVELT el 15/07/2026.',
    })
    expect(res.amount).toBe(1234.56)
    expect(res.currency).toBe('GTQ')
    expect(res.merchant).toBe('SUPER PAIZ ROOSEVELT')
  })

  it('reads a decimal comma without inflating the amount 100x', () => {
    // The LatAm form: "150,25" is one hundred fifty and change, not 15025.
    expect(parseBankAlert({ text: 'Consumo por GTQ 150,25 en TIENDA X el 01/08/2026' }).amount).toBe(150.25)
  })

  it('prefers an explicit ISO code over the bare symbol', () => {
    expect(parseBankAlert({ text: 'Cargo de $ 45.00 USD en AMAZON' }).currency).toBe('USD')
    expect(parseBankAlert({ text: 'Cargo de Q 45.00 en PAIZ' }).currency).toBe('GTQ')
  })

  it('parses an amount written after the currency code', () => {
    expect(parseBankAlert({ text: 'Comercio: UBER\nMonto 88.50 GTQ\nFecha: 2026-08-02' })).toMatchObject({
      amount: 88.5,
      currency: 'GTQ',
    })
  })

  it('parses an HTML-only body', () => {
    const res = parseBankAlert({
      html: '<div><p>Comercio: <b>CINEPOLIS OAKLAND</b></p><p>Monto: GTQ 75.00</p><p>Fecha: 2026-08-01</p></div>',
    })
    expect(res.amount).toBe(75)
    expect(res.merchant).toBe('CINEPOLIS OAKLAND')
    expect(res.date).toBe('2026-08-01')
  })

  it('flags reversals so they never land as an expense', () => {
    const res = parseBankAlert({ text: 'Se aplicó una devolución por GTQ 17.00 de RALLY PADEL' })
    expect(res.kind).toBe('credit')
  })

  it('falls back to the received date when the body has none', () => {
    const res = parseBankAlert({
      text: 'Comercio: PANADERIA SAN MARTIN\nMonto: GTQ 32.00',
      receivedAt: '2026-08-04T18:06:00Z',
    })
    expect(res.date).toBe('2026-08-04')
  })

  it('returns null when there is no amount (not a transaction alert)', () => {
    expect(parseBankAlert({ subject: 'Tu estado de cuenta está listo', text: 'Ingresa a banca en línea.' })).toBeNull()
    expect(parseBankAlert({})).toBeNull()
  })

  it('does not pick boilerplate as the merchant', () => {
    const res = parseBankAlert({
      text: [
        'Estimado cliente, este correo es una notificación automática de su banco.',
        'GTQ 250.00',
        'PANADERIA SAN MARTIN',
        'Si no reconoce esta transacción comuníquese con servicio al cliente.',
      ].join('\n'),
    })
    expect(res.merchant).toBe('PANADERIA SAN MARTIN')
  })
})
