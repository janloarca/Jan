import { detectCardStatement, parseCardStatement } from '../parsers/guateCardStatements'
import { itemsToLayoutLines } from '../parsers/pdfTextLayout'

// Synthetic fixtures replicating the REAL structure of each bank's statement,
// including every trap found while verifying real ones (which are NOT
// committed: they carry the user's name, address, NIT and card digits). The
// numbers are fake but the fixtures reconcile against their own totals, same
// as the real files, so the reconciliation engine is exercised for real.

// Builds a layout line from [column, text] pairs: fixtures need EXACT column
// alignment (débito vs crédito is decided by it) and hand-counted spaces are
// how a fixture silently drifts from what it claims to encode.
const col = (...pairs) => {
  let out = ''
  for (const [at, text] of pairs) {
    if (at > out.length) out += ' '.repeat(at - out.length)
    else if (out.length > 0) out += ' '
    out += text
  }
  return out
}
// Right-aligned cell: text ENDING at the given column, the way the
// statements print their numbers.
const rightAt = (at, text) => [at - text.length, text]

// ── Contecnica / Banco Industrial ───────────────────────────────────────────
// Traps encoded: dd/mm/yy with operación FIRST and consumo SECOND; groups
// (CUOTAS / OTROS CARGOS as detail, PAGOS REALIZADOS as summary-only); a
// merchant credit that is NOT a payment (gambling payout); CORRECCION A PAGO
// as a debit that must be excluded; the bare ".00" amount form in totals; and
// the column layout SHIFTING between pages, faithful to a real statement
// where page 1 ends débitos near column 47 and page 2 near column 105:
// per-page calibration from each page's own header is what keeps both right.
//
// Page 1: débitos end ≤63, créditos end 78 (header: Débitos at 56, Créditos at 70 → boundary ~70).
// Page 2: débitos end ~105, créditos end ~119 (header: Débitos at 103, Créditos at 112 → boundary ~115).
const BI_PAGE1 = [
  '   FULANO DE TAL',
  '    XXXX XXXX XXXX 1234 CLASICA',
  '    Fecha de corte:       16      07      2026',
  '    Fecha de pago:        10      08      2026',
  '           Resumen de movimientos',
  'Saldo al corte (Pago de contado):                   238.49             496.02',
  col([2, 'Fecha de'], [14, 'Fecha de'], [30, 'Descripción'], [56, 'Débitos'], [70, 'Créditos']),
  col([2, 'operación'], [14, 'consumo']),
  col([27, 'MOVIMIENTOS EN QUETZALES']),
  col([0, '22/06/26'], [14, '20/06/26'], [28, 'Portal Facturas Tigo GT'], rightAt(63, '168.01')),
  col([0, '23/06/26'], [14, '23/06/26'], [28, 'Casa de Apuestas Gibra'], rightAt(78, '500.00')),
  col([0, '25/06/26'], [14, '25/06/26'], [28, 'CORRECCION A PAGO'], rightAt(63, '300.00')),
  col([0, '06/07/26'], [14, '04/07/26'], [28, 'SUPERMERCADOS LA TORRE GT'], rightAt(63, '689.80')),
  col([0, '08/07/26'], [14, '08/07/26'], [28, 'FIN/CT 0013 000001 27'], rightAt(63, '244.42')),
  col([28, 'TOTAL QUETZALES'], rightAt(63, '1,402.23'), rightAt(78, '500.00')),
  col([27, 'MOVIMIENTOS EN DOLARES']),
  col([0, '30/06/26'], [14, '30/06/26'], [28, 'APPLE.COM/BILL US'], rightAt(63, '2.99')),
  col([0, '30/06/26'], [14, '30/06/26'], [28, 'GRACIAS POR SU PAGO'], rightAt(78, '22.99')),
].join('\n')

const BI_PAGE2 = [
  col([3, 'Fecha de'], [20, 'Fecha de'], [59, 'Descripción'], [103, 'Débitos'], [112, 'Créditos']),
  col([3, 'operación'], [20, 'consumo']),
  col([0, '16/07/26'], [17, '15/07/26'], [35, 'BET365 GI'], rightAt(105, '100.00')),
  col([35, 'TOTAL DOLARES'], rightAt(105, '102.99'), rightAt(119, '22.99')),
  col([34, 'CUOTAS']),
  col([34, 'MOVIMIENTOS EN QUETZALES']),
  col([0, '16/07/26'], [17, '16/07/26'], [35, 'ISHOP GUATEMALA NL 01 (22/36)'], rightAt(105, '244.42')),
  col([35, 'TOTAL QUETZALES'], rightAt(105, '244.42'), rightAt(119, '.00')),
  col([34, 'OTROS CARGOS']),
  col([34, 'MOVIMIENTOS EN QUETZALES']),
  col([0, '25/06/26'], [17, '25/06/26'], [35, 'COMISION POR SERVICIOS'], rightAt(105, '64.41')),
  col([0, '25/06/26'], [17, '25/06/26'], [35, 'IVA COMISION POR SERVICIOS'], rightAt(105, '7.73')),
  col([0, '03/07/26'], [17, '03/07/26'], [35, 'MEMBRESIA CLUB BI'], rightAt(105, '15.00')),
  col([35, 'TOTAL QUETZALES'], rightAt(105, '87.14'), rightAt(119, '.00')),
  col([34, 'PAGOS REALIZADOS']),
  col([34, 'MOVIMIENTOS EN QUETZALES']),
  col([35, 'PAGO A CAPITAL Y OTROS CARGOS'], rightAt(119, '500.00')),
  col([35, 'TOTAL QUETZALES'], rightAt(105, '.00'), rightAt(119, '500.00')),
  ' CONTECNICA, S.A.',
].join('\n')

const BI_TEXT = `${BI_PAGE1}\n\f\n${BI_PAGE2}\n`

describe('Contecnica / Banco Industrial', () => {
  it('detects the format', () => {
    expect(detectCardStatement(BI_TEXT)).toBe('bi')
  })

  const r = parseCardStatement(BI_TEXT)

  it('extracts card metadata', () => {
    expect(r.cardLast4).toBe('1234')
    expect(r.cutDate).toBe('2026-07-16')
    expect(r.dueDate).toBe('2026-08-10')
    expect(r.closingBalance).toEqual({ GTQ: 238.49, USD: 496.02 })
  })

  it('uses the CONSUMO date (second column), not the posting date', () => {
    const tigo = r.transactions.find((t) => t.description.includes('Tigo'))
    expect(tigo.date).toBe('2026-06-20')
    expect(tigo.postedDate).toBe('2026-06-22')
  })

  it('keeps currency by section', () => {
    expect(r.transactions.find((t) => t.description.includes('APPLE')).currency).toBe('USD')
    expect(r.transactions.find((t) => t.description.includes('LA TORRE')).currency).toBe('GTQ')
  })

  it('a merchant credit is a NEGATIVE expense, not income and not a payment', () => {
    // Getting money back from a merchant reverses a purchase; it is not
    // earnings. Filed as a negative expense in the merchant's own category so
    // that category reports net spend, and so a money-out-money-back round
    // trip cancels itself without any rule naming the merchant.
    const win = r.transactions.find((t) => t.description.includes('Apuestas'))
    expect(win.type).toBe('EXPENSE')
    expect(win.kind).toBe('refund')
    expect(win.amount).toBe(-500)
    expect(win.category).not.toBe('Otros Ingresos')
  })

  it('cashback stays income: no purchase to net it against', () => {
    const cb = r.transactions.filter((t) => t.kind === 'cashback')
    for (const t of cb) {
      expect(t.type).toBe('INCOME')
      expect(t.amount).toBeGreaterThan(0)
      expect(t.category).toBe('Promoción de tarjeta')
    }
  })

  it('un pago a la tarjeta entra como ingreso Salario, conservando su kind', () => {
    // Decisión del usuario: para quien solo importa tarjetas, el sueldo vive en
    // el banco y el mes se leía como pura pérdida. El `kind` se conserva para
    // que un import futuro del estado bancario pueda netearlo.
    const pago = r.transactions.find((t) => t.description.includes('GRACIAS'))
    expect(pago.type).toBe('INCOME')
    expect(pago.category).toBe('Salario')
    expect(pago.kind).toBe('payment')
    expect(pago.amount).toBeGreaterThan(0)
  })

  it('la CORRECCIÓN de un pago es un ingreso NEGATIVO', () => {
    // Revierte una entrada de dinero, así que tiene que restar de esa entrada.
    // Excluida dejaría vivo el ingreso que revierte.
    const corr = r.transactions.find((t) => t.description.includes('CORRECCION'))
    expect(corr.type).toBe('INCOME')
    expect(corr.kind).toBe('payment-adjustment')
    expect(corr.amount).toBeLessThan(0)
  })

  it('parses the installment marker (n/total)', () => {
    const cuota = r.transactions.find((t) => t.description.includes('ISHOP'))
    expect(cuota.kind).toBe('installment')
    expect(cuota.installment).toEqual({ num: 22, of: 36 })
  })

  it('files card fees as fees regardless of merchant echoes', () => {
    const fee = r.transactions.find((t) => t.description.includes('COMISION POR SERVICIOS'))
    expect(fee.kind).toBe('fee')
    expect(fee.category).toBe('Comisiones')
  })

  it('a fee whose description echoes a merchant is still a fee', () => {
    // "MEMBRESIA CLUB BI" matches the 'club' merchant needle, and the card's
    // membership fee must not read as a night out.
    const membership = r.transactions.find((t) => t.description.includes('MEMBRESIA'))
    expect(membership.kind).toBe('fee')
    expect(membership.category).toBe('Comisiones')
  })

  it('files a bare financing instalment as financing, not as unknown', () => {
    // "FIN/CT 0013 000001 27" names a contract, never a merchant, so 'Otros
    // Gastos' would claim we could not tell when the statement did tell us.
    const cuota = r.transactions.find((t) => t.description.startsWith('FIN/CT'))
    expect(cuota.kind).toBe('installment')
    expect(cuota.category).toBe('Financiamiento')
  })

  it('stamps the card on every row so two cards never merge', () => {
    expect(r.cardLast4).toBe('1234')
    for (const t of r.transactions) expect(t.cardKey).toBe('bi:1234')
  })

  it('classifies the page-2 row as a débito despite the shifted columns', () => {
    const p2 = r.transactions.find((t) => t.description.includes('BET365'))
    expect(p2.type).toBe('EXPENSE')
    expect(p2.date).toBe('2026-07-15')
  })

  it('reconciles against the statement totals, counting excluded rows too', () => {
    expect(r.reconciled).toBe(true)
    const q = Object.fromEntries(r.reconciliation.filter((x) => x.currency === 'GTQ').map((x) => [x.side, x]))
    expect(q.debit.expected).toBeCloseTo(1402.23 + 244.42 + 87.14, 2)
    expect(q.credit.expected).toBeCloseTo(500.00, 2)
  })

  // Sin ninguna fila de CREDITO P/CARGOS, la marca de rebate de intereses
  // queda vacía: un estado sin ese crédito no puede disparar el aviso.
  it('no marca rebates de intereses donde no los hay', () => {
    expect(r.interestRebates).toEqual([])
  })
})

// ── Banco G&T Continental ───────────────────────────────────────────────────
// Traps: consumo FIRST (inverted vs Contecnica); dd-mm-yyyy MIXED with
// dd-MMM-yyyy in the same column; merchant\address in one field; APPLEPAY
// marker GLUED to the currency letter; cashback credits that are not
// payments; the dollar section starting after the quetzales sub-total; and a
// "CONTINUACIÓN" page with no column header at all.
const GYT_TEXT = `            ESTADO DE CUENTA - TARJETA MASTER CARD INTERNACIONAL
            Banco G&T Continental, S.A.
                            RESUMEN DE ESTADO DE CUENTA
                  SALDO ANTERIOR                             510.35            0.00
                  SALDO TOTAL                             3,953.98              0.00
                                                                     FECHA DE CORTE                             09-AUG-2026
                                                                     FECHA MÁXIMA DE PAGO                       04-SEP-2026
                       FECHA                      FECHA                              DESCRIPCIÓN                  DÉBITO                            CRÉDITO
                      CONSUMO                DE TRANSACCIÓN                                                      COMPRAS                             PAGOS
              5183-22XX-XXXX-9876        FULANO DE TAL
                    08-07-2026                     10-07-2026            PARQUEO CENTRAL\\4AV 12-59 GTM OF APPLEPAYQ           80.00
                    13-07-2026                     15-07-2026            CAFE EJEMPLO CB124\\2C.20-83 VISTA H APPLEPAY Q       19.00
\f
                                                      CONTINUACIÓN...
      30-07-2026             01-AUG-2026     MERCADITO LOCAL\\10 AVENIDA 8 APPLEPAY Q     112.05
      16-07-2026             16-07-2026     PAGO POR INTERNET                                                Q    1,250.00
      29-07-2026              29-07-2026     GYTC TE DEVUELVE EN RESTAURANTES                                 Q       93.56
      27-07-2026              27-07-2026     DECLARAGUATE - TESORERIA                     Q    420.00
      09-08-2026            09-AUG-2026      CREDITO P/CARGOS BONIFICABLES                                   Q    44.55
                                            Sub - total Quetzales                        Q      631.05      Q 1,388.11
 5183-22XX-XXXX-9876   FULANO DE TAL
         19-07-2026            20-07-2026   BET365\\UNIT 1.1 FIRST FLOOR..\\GIBRAL GIB    $     200.00
        20-07-2026             20-07-2026   COMISION X QUASI CASH                       $       10.00
        24-07-2026             24-07-2026   PAGO POR INTERNET                                               $      210.00
                                            Sub - total Dólares                         $      210.00       $      210.00
www.gtc.com.gt      1718
`

describe('Banco G&T Continental', () => {
  it('detects the format', () => {
    expect(detectCardStatement(GYT_TEXT)).toBe('gyt')
  })

  const r = parseCardStatement(GYT_TEXT)

  it('extracts card metadata, including the dd-MMM-yyyy cut date', () => {
    expect(r.cardLast4).toBe('9876')
    expect(r.cutDate).toBe('2026-08-09')
    expect(r.dueDate).toBe('2026-09-04')
  })

  // ⛔ Este campo se extrae desde siempre y NUNCA tuvo consumidor NI asercion:
  // el bloque de resumen de la cabecera trae "SALDO TOTAL 3,953.98 0.00" y el
  // regex lo lee, pero nadie verifico nunca que el numero fuera el correcto ni
  // que saliera de la linea correcta. Sin esta asercion, cualquier cambio al
  // regex o al layout pasaba en verde.
  //
  // Las dos monedas van SEPARADAS y jamas sumadas: sumarlas necesita una tasa,
  // y una tasa faltante devuelve el monto crudo en silencio.
  it('lee el saldo al corte del bloque de resumen', () => {
    expect(r.closingBalance).toEqual({ GTQ: 3953.98, USD: 0 })
  })

  // La linea de arriba en el estado real dice "SALDO ANTERIOR 510.35": tomar esa
  // mostraria el saldo del mes PASADO como si fuera lo que se debe hoy. El guard
  // no es un caso hipotetico, esa linea ya esta en el fixture.
  it('no confunde el saldo ANTERIOR con el del corte', () => {
    expect(r.closingBalance.GTQ).not.toBe(510.35)
  })

  it('uses the CONSUMO date (FIRST column here, inverted vs Contecnica)', () => {
    const p = r.transactions.find((t) => t.description.includes('PARQUEO'))
    expect(p.date).toBe('2026-07-08')
    expect(p.postedDate).toBe('2026-07-10')
  })

  it('parses dd-MMM-yyyy rows mixed into the same column', () => {
    const m = r.transactions.find((t) => t.description.includes('MERCADITO'))
    expect(m.date).toBe('2026-07-30')
    expect(m.postedDate).toBe('2026-08-01')
  })

  it('splits merchant from address and strips the glued APPLEPAY marker', () => {
    const p = r.transactions.find((t) => t.description === 'PARQUEO CENTRAL')
    expect(p.location).toBe('4AV 12-59 GTM OF')
    expect(p.wallet).toBe('applepay')
  })

  it('an address like "2C.20-83" never reads as a second amount', () => {
    const cafe = r.transactions.find((t) => t.description.includes('CAFE EJEMPLO'))
    expect(cafe).toBeTruthy()
    expect(cafe.amount).toBe(19.00)
  })

  it('las promociones van a su propia categoría, no al ingreso genérico', () => {
    for (const needle of ['TE DEVUELVE', 'BONIFICABLES']) {
      const row = r.transactions.find((t) => t.description.includes(needle))
      expect(row.kind).toBe('cashback')
      expect(row.type).toBe('INCOME')
      expect(row.category).toBe('Promoción de tarjeta')
    }
  })

  it('los pagos entran como ingreso en vez de excluirse', () => {
    const pagos = r.transactions.filter((t) => t.kind === 'payment')
    expect(pagos).toHaveLength(2)
    expect(pagos.every((p) => p.type === 'INCOME' && p.category === 'Salario')).toBe(true)
  })

  // El rebate de intereses bonifica un CARGO que este parser no importa (vive
  // en el resumen del estado, no en la tabla de movimientos: caso real de
  // FASE JW, rebate Q92.25 contra cargo Q125.97 solo en el resumen). No se
  // puede leer ese cargo sin inventar el formato de una línea nunca vista,
  // así que la fila se MARCA y la vista previa lo declara. El cashback
  // genérico (TE DEVUELVE) NO se marca: no promete ningún cargo escondido.
  it('marca el rebate de intereses como ingreso sin su cargo enfrente', () => {
    expect(r.interestRebates).toHaveLength(1)
    expect(r.interestRebates[0]).toEqual({
      amount: 44.55,
      currency: 'GTQ',
      description: expect.stringContaining('BONIFICABLES'),
    })
    // Sigue importándose como ingreso normal: la marca declara, no excluye.
    const row = r.transactions.find((t) => t.description.includes('BONIFICABLES'))
    expect(row.type).toBe('INCOME')
  })

  it('the dollar section starts after the quetzales sub-total', () => {
    const bet = r.transactions.find((t) => t.description.includes('BET365'))
    expect(bet.currency).toBe('USD')
    expect(bet.category).toBe('Entretenimiento')
    expect(r.transactions.find((t) => t.description.includes('QUASI')).currency).toBe('USD')
  })

  it('reconciles both currencies against the sub-total lines', () => {
    expect(r.reconciled).toBe(true)
  })
})

// ── BAC Credomatic ──────────────────────────────────────────────────────────
// Traps: MONTH-FIRST dates ("JUN/25") with NO year, inferred from the cut
// date; ONE table with four amount columns where the COLUMN is the currency;
// credits with a TRAILING minus; type codes (11 consumo / 31 pago); a
// reference like "PAGO RECIBIDO...406" whose ".406" must not read as an
// amount; and a description wrapped across neighbor lines.
const BAC_TEXT = `                                                                         Número de tarjeta                 Tipo de tarjeta
FULANO DE TAL                                                            3XXX-XXXX-XXXX-4321                  AMEX AA GOLD
      Fecha de corte                       Fecha de pago
      21-JUL-2026                          14-AGO-2026
 Saldo a la fecha de corte             =      Q. 6,033.28       US$. 59.66
 Infórmate sobre Educación Financiera en www.baccredomatic.gt
\f
  Detalle de movimientos del mes                                                                ****-******-*4321 FULANO
   Tipo de      Fecha de      Fecha de                                                    Quetzales                        Dólares
                                                      Descripción
 transacción    consumo       operación                                            Débitos        Créditos          Débitos        Créditos
  11             JUN/25         JUN/25    TIENDA EJEMPLO 5                             80.00
  11             JUN/26         JUN/26    PRICESMART ZONA 10                          312.85
  31             JUN/30         JUN/30    PAGO RECIBIDO...406                                       1,185.00-
  11              JUL/15         JUL/16   EEGSA PAGO FACTURA -PA- 972627            5,074.02
                                          Crucero Ejemplo OC Woodland HillU
  11             JUN/26         JUN/27                                                                                 50.00
                                          S
  31             JUL/01         JUL/01    PAGO RECIBIDO...406                                                                       5,166.46-
  11             JUL/02         JUL/02    UNIVERSIDAD DEMO -M-                                                    2,615.69
                                                                   DÉBITO           5,466.87                         2,665.69
                                                                  CRÉDITO                           1,185.00-                       5,166.46-
`

describe('BAC Credomatic', () => {
  it('detects the format', () => {
    expect(detectCardStatement(BAC_TEXT)).toBe('bac')
  })

  const r = parseCardStatement(BAC_TEXT)

  it('extracts metadata, with the Spanish AGO month in the due date', () => {
    expect(r.cardLast4).toBe('4321')
    expect(r.cutDate).toBe('2026-07-21')
    expect(r.dueDate).toBe('2026-08-14')
    expect(r.closingBalance).toEqual({ GTQ: 6033.28, USD: 59.66 })
  })

  it('reads month-first dates and infers the year from the cut date', () => {
    const t = r.transactions.find((x) => x.description.includes('TIENDA'))
    expect(t.date).toBe('2026-06-25')
  })

  it('a month later than the cut month belongs to the previous year', () => {
    const dec = parseCardStatement(BAC_TEXT.replace('JUN/25         JUN/25    TIENDA EJEMPLO 5', 'DIC/28         DIC/28    TIENDA EJEMPLO 5'))
    expect(dec.transactions.find((x) => x.description.includes('TIENDA')).date).toBe('2025-12-28')
  })

  it('currency comes from the COLUMN: same table, Q and $ rows', () => {
    expect(r.transactions.find((x) => x.description.includes('PRICESMART')).currency).toBe('GTQ')
    expect(r.transactions.find((x) => x.description.includes('UNIVERSIDAD')).currency).toBe('USD')
  })

  it('"PAGO RECIBIDO...406" entra como ingreso, y ".406" no es un monto', () => {
    const pagos = r.transactions.filter((t) => t.kind === 'payment')
    expect(pagos).toHaveLength(2)
    expect(pagos.every((p) => p.type === 'INCOME' && p.category === 'Salario')).toBe(true)
    // El ".406" del final de la descripción no se lee como monto: eso es lo que
    // esta prueba cuidaba desde el principio y sigue cuidando.
    expect(pagos.find((p) => p.currency === 'GTQ').amount).toBe(1185.00)
    expect(pagos.find((p) => p.currency === 'USD').amount).toBe(5166.46)
  })

  it('adopts a description wrapped across neighbor lines', () => {
    const cruise = r.transactions.find((x) => x.amount === 50.00)
    expect(cruise.description).toBe('Crucero Ejemplo OC Woodland HillUS')
    expect(cruise.currency).toBe('USD')
  })

  it('paying a utility bill WITH the card is an expense, not a payment', () => {
    const eegsa = r.transactions.find((x) => x.description.includes('EEGSA'))
    expect(eegsa.kind).toBe('purchase')
    expect(eegsa.category).toBe('Servicios')
  })

  it('reconciles all four column totals', () => {
    expect(r.reconciled).toBe(true)
  })
})

// ── Guards shared across formats ────────────────────────────────────────────

describe('detectCardStatement', () => {
  it('rejects unrelated documents', () => {
    expect(detectCardStatement('IBKR Flex Query Statement')).toBeNull()
    expect(detectCardStatement('')).toBeNull()
    expect(detectCardStatement(null)).toBeNull()
  })

  it('parseCardStatement returns null for unknown text', () => {
    expect(parseCardStatement('hello world')).toBeNull()
  })

  // Caso real: un estado de la MISMA tarjeta llegó sin la palabra CONTECNICA en
  // el texto extraído (el logo del emisor es una imagen en ese PDF). El
  // detector la exigía, así que el estado caía al camino de IA y el usuario veía
  // "La IA no encontró posiciones" sobre un estado de tarjeta legible.
  const SIN_EMISOR = BI_TEXT.replace(' CONTECNICA, S.A.', '')

  it('reconoce el formato aunque el nombre del emisor no aparezca', () => {
    expect(SIN_EMISOR).not.toMatch(/CONTECNICA/i)
    expect(detectCardStatement(SIN_EMISOR)).toBe('bi')
  })

  it('y lo lee igual de bien: cuadra contra los totales impresos', () => {
    const conEmisor = parseCardStatement(BI_TEXT)
    const sinEmisor = parseCardStatement(SIN_EMISOR)
    expect(sinEmisor.reconciled).toBe(true)
    expect(sinEmisor.transactions).toHaveLength(conEmisor.transactions.length)
    expect(sinEmisor.cardLast4).toBe(conEmisor.cardLast4)
  })

  it('las tres marcas tienen que aparecer JUNTAS', () => {
    // Cada una por separado es demasiado común para reconocer un formato.
    expect(detectCardStatement('MOVIMIENTOS EN QUETZALES')).toBeNull()
    expect(detectCardStatement('TOTAL QUETZALES')).toBeNull()
    expect(detectCardStatement('Fecha de corte:  16  08  2026')).toBeNull()
    expect(detectCardStatement('MOVIMIENTOS EN QUETZALES\nTOTAL QUETZALES')).toBeNull()
  })

  it('un estado de otro banco se sigue reconociendo por su propio nombre', () => {
    // La regla por forma va al final justamente para esto: si se adelantara,
    // reclamaría cualquier estado que hable de quetzales.
    expect(detectCardStatement(GYT_TEXT)).toBe('gyt')
    expect(detectCardStatement(BAC_TEXT)).toBe('bac')
  })
})

describe('reconciliation as a tamper alarm', () => {
  it('a lost row flips reconciled to false instead of importing silently short', () => {
    // Drop one débito row but keep the statement's own totals: the parse must
    // notice it no longer adds up.
    const broken = BI_TEXT.replace(/^.*SUPERMERCADOS LA TORRE GT.*\n/m, '')
    const r = parseCardStatement(broken)
    expect(r.reconciled).toBe(false)
    const q = r.reconciliation.find((x) => x.currency === 'GTQ' && x.side === 'debit')
    expect(q.expected - q.computed).toBeCloseTo(689.80, 2)
  })
})

// ── pdf.js layout reconstruction ────────────────────────────────────────────

describe('itemsToLayoutLines', () => {
  it('orders fragments top-to-bottom, left-to-right, preserving columns', () => {
    const lines = itemsToLayoutLines([
      { str: '100.00', x: 300, y: 500 },
      { str: '20/06/26', x: 20, y: 500 },
      { str: 'MOVIMIENTOS EN QUETZALES', x: 100, y: 520 },
      { str: 'COMERCIO X', x: 120, y: 500 },
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('MOVIMIENTOS')
    expect(lines[1].indexOf('20/06/26')).toBeLessThan(lines[1].indexOf('COMERCIO X'))
    expect(lines[1].indexOf('COMERCIO X')).toBeLessThan(lines[1].indexOf('100.00'))
  })

  it('keeps kerned fragments of one word joined (the HillU + S case)', () => {
    const lines = itemsToLayoutLines([
      { str: 'Woodland Hill', x: 100, y: 400, w: 62.4 },
      { str: 'US', x: 162.4, y: 400, w: 9.6 },
    ])
    expect(lines[0]).toContain('Woodland HillUS')
  })

  it('fragments on nearly equal baselines cluster into one line', () => {
    const lines = itemsToLayoutLines([
      { str: 'A', x: 10, y: 400 },
      { str: 'B', x: 50, y: 401.5 },
    ])
    expect(lines).toHaveLength(1)
  })
})

describe('el import aplica lo que el usuario ya enseñó', () => {
  it('una regla del usuario pisa lo que dedujo la tabla de fábrica', () => {
    // Sin esto, enseñarle a Chispu quién es un comercio servía para el atajo y
    // el correo pero NO para el estado de cuenta, que es de donde viene la
    // mayoría de los movimientos: el mismo comercio volvía a su categoría
    // deducida en cada import por más veces que se lo hubiera corregido.
    const rules = [{ match: 'la torre', category: 'Compras' }]
    const r = parseCardStatement(BI_TEXT, { rules })
    const row = r.transactions.find((t) => t.description.includes('LA TORRE'))
    expect(row.category).toBe('Compras')
    expect(row._autoCategory).toBe('user')
  })

  it('sin reglas, todo queda exactamente igual que antes', () => {
    const withRules = parseCardStatement(BI_TEXT, { rules: [] })
    const plain = parseCardStatement(BI_TEXT)
    expect(withRules.transactions.map((t) => t.category)).toEqual(plain.transactions.map((t) => t.category))
  })

  it('una regla del usuario NO pisa lo que el tipo de fila ya decidió', () => {
    // Una comisión es una comisión aunque su texto matchee una regla: el estado
    // ya dijo qué ES la fila, y eso vale más que su descripción.
    const rules = [{ match: 'comision', category: 'Compras' }]
    const r = parseCardStatement(BI_TEXT, { rules })
    const fee = r.transactions.find((t) => t.kind === 'fee')
    expect(fee.category).toBe('Comisiones')
  })

  it('no toca ninguna fila de ingreso: su categoría la decidió el KIND', () => {
    // Una regla del usuario describe un comercio. Un pago a la tarjeta o un
    // reintegro del banco no son comercios: el estado ya dijo qué son, y eso
    // manda sobre cualquier coincidencia de texto.
    const rules = [
      { match: 'devuelve', category: 'Compras' },
      { match: 'gracias por su pago', category: 'Compras' },
    ]
    const r = parseCardStatement(BI_TEXT, { rules })
    const income = r.transactions.filter((x) => x.type === 'INCOME')
    expect(income.length).toBeGreaterThan(0)
    for (const t of income) expect(t.category).not.toBe('Compras')
  })

  it('mueve las DOS patas de un ida y vuelta, para que sigan cancelándose', () => {
    // Una regla del usuario tiene que aplicar también al reembolso: si moviera
    // solo la salida, las dos patas quedarían en categorías distintas y el
    // neteo que hace que la cifra diga la verdad dejaría de ocurrir.
    const rules = [{ match: 'apuestas', category: 'Compras' }]
    const r = parseCardStatement(BI_TEXT, { rules })
    const refund = r.transactions.find((t) => t.kind === 'refund')
    expect(refund.category).toBe('Compras')
    expect(refund.amount).toBeLessThan(0)
  })
})
