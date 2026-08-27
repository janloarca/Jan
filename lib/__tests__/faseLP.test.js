// FASE LP: los cinco del parser de alertas, el tier que se activa al encender
// el camino de correo. Cada bloque ejercita el parser REAL con el texto que lo
// dispara, y varios fijan el comportamiento viejo como regresión negativa.

import { parseBankAlert } from '../parsers/bankAlertParser'
import { expenseFromAlert } from '../alertIngest'

const RECIBIDO = '2026-08-20T18:00:00.000Z'
const leer = (text, defaultCurrency = 'GTQ') =>
  parseBankAlert({ subject: '', text, receivedAt: RECIBIDO, defaultCurrency })

// ── 1. La moneda la decide lo que está PEGADO al monto ────────────────────
//
// Un código ISO en cualquier parte del cuerpo ganaba sobre el símbolo pegado al
// monto. Con 20 códigos y match case-insensitive, una palabra del nombre del
// comercio o del pie cambiaba la moneda del cobro.
describe('un código ISO suelto no puede cambiar la moneda del cobro', () => {
  it('una palabra del comercio que coincide con un código NO gana', () => {
    // "BOB" (boliviano) dentro de "BOB ESPONJA STORE".
    expect(leer('Compra por Q75.00 en BOB ESPONJA STORE').currency).toBe('GTQ')
  })

  it.each([
    ['Compra por Q75.00 en LIBRERIA\nPen and paper promo', 'GTQ'],
    ['Compra por Q40.00 en CAD DISENO GRAFICO', 'GTQ'],
    ['Compra por Q60.00 en SET DE CUCHILLOS', 'GTQ'],
  ])('%s se queda en su moneda', (texto, esperada) => {
    expect(leer(texto).currency).toBe(esperada)
  })

  it('el equivalente en otra moneda entre paréntesis tampoco gana', () => {
    // El cobro es en quetzales; el paréntesis es la referencia del banco.
    const r = leer('Compra por Q1,540.00 (USD 200.00) en AMAZON MKTPLACE')
    expect(r.amount).toBe(1540)
    expect(r.currency).toBe('GTQ')
  })

  // Lo que SÍ tiene que seguir ganando: el código adyacente, en sus tres formas.
  it('el código PEGADO al monto sigue mandando', () => {
    expect(leer('Cargo de $ 45.00 USD en AMAZON').currency).toBe('USD')
    expect(leer('Compra en AMAZON\nUSD 49.99').currency).toBe('USD')
    expect(leer('Comercio: UBER\nMonto 88.50 GTQ').currency).toBe('GTQ')
  })
})

// ── 2. Un cobro que NO ocurrió no se guarda como gasto ────────────────────
describe('rechazos y anulaciones no son gastos', () => {
  it.each([
    'Compra RECHAZADA por Q500.00 en TIENDA X',
    'Su transaccion fue declinada por Q500.00 en TIENDA X',
    'Compra no aprobada por Q500.00 en TIENDA X',
    'Transaccion denegada por Q500.00 en TIENDA X',
  ])('%s se descarta como declined', (texto) => {
    expect(leer(texto).kind).toBe('declined')
    expect(expenseFromAlert({ text: texto, receivedAt: RECIBIDO, source: 'android' }).skip).toBe('declined')
  })

  it('una anulación es un crédito, no un cobro declinado', () => {
    // Semánticamente es un reverso: revierte un cobro que sí ocurrió.
    expect(leer('Anulacion de compra por Q500.00 en TIENDA X').kind).toBe('credit')
  })

  // ⛔ El guard que evita tragarse un cobro REAL: solo sustantivo y participio,
  // nunca el infinitivo, y solo en el encabezado. Un pie de página que explica
  // cómo anular una transacción describe un cobro que SÍ pasó, y descartarlo
  // sería el error que no se recupera.
  it('un pie de página que dice cómo ANULAR no descarta el cobro', () => {
    const texto = [
      'Compra por Q250.00 en RALLY PADEL',
      'Fecha: 20/08/2026',
      'Si desea anular esta transaccion, comuniquese al 2222-2222.',
    ].join('\n')
    expect(leer(texto).kind).toBe('debit')
  })

  it('una nota sobre transacciones rechazadas en el pie tampoco', () => {
    const texto = [
      'Compra por Q250.00 en RALLY PADEL',
      'Fecha: 20/08/2026',
      'Recuerde que una transaccion rechazada no genera cargo a su cuenta.',
    ].join('\n')
    expect(leer(texto).kind).toBe('debit')
  })

  it('un cobro normal sigue siendo un cobro', () => {
    expect(leer('Compra por Q17.00 en RALLY PADEL el 03/08/2026').kind).toBe('debit')
  })
})

// ── 3. El monto es el de la COMPRA, no el primer número que aparece ───────
describe('el saldo disponible no puede ganarle al cobro', () => {
  it('con el saldo ARRIBA, gana el cobro', () => {
    const r = leer('Saldo disponible Q5,000.00\nCompra Q50.00 en CAFE BARISTA')
    expect(r.amount).toBe(50)
  })

  it('con el saldo ABAJO también, igual que siempre', () => {
    const r = leer('Compra Q50.00 en CAFE BARISTA\nSaldo disponible Q5,000.00')
    expect(r.amount).toBe(50)
  })

  it.each([
    ['Limite disponible Q9,000.00\nConsumo Q120.50 en PAIZ', 120.5],
    ['Autorizacion Q4859201\nCompra Q75.00 en TIENDA', 75],
    ['Cupo Q8,000.00\nCargo Q33.00 en UBER', 33],
  ])('%s lee el cobro y no la referencia', (texto, esperado) => {
    expect(leer(texto).amount).toBe(esperado)
  })

  // Regresión negativa: el orden de las líneas decidía el monto.
  it('la lectura vieja tomaba el primero, o sea 100x de más', () => {
    const texto = 'Saldo disponible Q5,000.00\nCompra Q50.00 en CAFE BARISTA'
    const primero = texto.match(/Q\s*(\d[\d.,]*\d)/)
    expect(Number(primero[1].replace(/,/g, ''))).toBe(5000)
    expect(leer(texto).amount).toBe(50)
  })

  it('una alerta de una sola línea se comporta igual que antes', () => {
    expect(leer('Se aprobó una transacción por Q1,234.56 en SUPER PAIZ el 15/07/2026').amount).toBe(1234.56)
  })
})

// ── 4. El comercio del formato de push más corto ──────────────────────────
describe('el comercio al final de la línea se lee', () => {
  it.each([
    ['Compra Q75.00 en POLLO CAMPERO ZONA 10', 'POLLO CAMPERO ZONA 10'],
    ['Compra Q50.00 en CAFE BARISTA', 'CAFE BARISTA'],
    ['Compra por Q75.00 en BOB ESPONJA STORE', 'BOB ESPONJA STORE'],
  ])('%s', (texto, esperado) => {
    expect(leer(texto).merchant).toBe(esperado)
  })

  it('el asunto ya no se cuela como comercio', () => {
    const r = parseBankAlert({
      subject: 'Compra', text: 'Compra por $12.990 en JUMBO',
      receivedAt: RECIBIDO, defaultCurrency: 'CLP',
    })
    expect(r.merchant).toBe('JUMBO')
  })

  it('las etiquetas explícitas siguen ganando sobre el respaldo', () => {
    const r = leer('Comercio: RALLY PADEL\nCompra Q17.00 en OTRA COSA')
    expect(r.merchant).toBe('RALLY PADEL')
  })

  it('la forma con palabra detrás sigue funcionando', () => {
    expect(leer('Compra por Q17.00 en RALLY PADEL el 03/08/2026').merchant).toBe('RALLY PADEL')
  })
})
