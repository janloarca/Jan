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
  col([35, 'TOTAL QUETZALES'], rightAt(105, '72.14'), rightAt(119, '.00')),
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

  it('a merchant credit is income, not a payment', () => {
    const win = r.transactions.find((t) => t.description.includes('Apuestas'))
    expect(win.type).toBe('INCOME')
    expect(win.kind).toBe('refund')
    expect(win.category).toBe('Otros Ingresos')
  })

  it('excludes payments AND the correction of a payment', () => {
    const kinds = r.excluded.map((e) => e.kind).sort()
    expect(kinds).toEqual(['payment', 'payment-adjustment'])
    expect(r.transactions.some((t) => /GRACIAS|CORRECCION/.test(t.description))).toBe(false)
  })

  it('parses the installment marker (n/total)', () => {
    const cuota = r.transactions.find((t) => t.description.includes('ISHOP'))
    expect(cuota.kind).toBe('installment')
    expect(cuota.installment).toEqual({ num: 22, of: 36 })
  })

  it('files card fees under Otros Gastos regardless of merchant echoes', () => {
    const fee = r.transactions.find((t) => t.description.includes('COMISION POR SERVICIOS'))
    expect(fee.kind).toBe('fee')
    expect(fee.category).toBe('Otros Gastos')
  })

  it('classifies the page-2 row as a débito despite the shifted columns', () => {
    const p2 = r.transactions.find((t) => t.description.includes('BET365'))
    expect(p2.type).toBe('EXPENSE')
    expect(p2.date).toBe('2026-07-15')
  })

  it('reconciles against the statement totals, counting excluded rows too', () => {
    expect(r.reconciled).toBe(true)
    const q = Object.fromEntries(r.reconciliation.filter((x) => x.currency === 'GTQ').map((x) => [x.side, x]))
    expect(q.debit.expected).toBeCloseTo(1402.23 + 244.42 + 72.14, 2)
    expect(q.credit.expected).toBeCloseTo(500.00, 2)
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

  it('cashback credits import as income; payments are excluded', () => {
    expect(r.transactions.find((t) => t.description.includes('TE DEVUELVE')).kind).toBe('cashback')
    expect(r.transactions.find((t) => t.description.includes('BONIFICABLES')).kind).toBe('cashback')
    expect(r.excluded.filter((e) => e.kind === 'payment')).toHaveLength(2)
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

  it('"PAGO RECIBIDO...406" is an excluded payment, and ".406" is not an amount', () => {
    expect(r.excluded).toHaveLength(2)
    expect(r.excluded.every((e) => e.kind === 'payment')).toBe(true)
    expect(r.excluded.find((e) => e.currency === 'GTQ').amount).toBe(1185.00)
    expect(r.excluded.find((e) => e.currency === 'USD').amount).toBe(5166.46)
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
