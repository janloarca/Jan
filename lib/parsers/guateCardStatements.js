// Deterministic parsers for Guatemalan CREDIT CARD statements (PDF text).
//
// Three real formats, learned from real statements and verified against their
// own arithmetic:
//   'bi'  — Contecnica / Banco Industrial (Visa Clásica). Dual currency as
//           SECTIONS ("MOVIMIENTOS EN QUETZALES" / "EN DOLARES"), plus groups
//           (CUOTAS, OTROS CARGOS, PAGOS REALIZADOS). Dates dd/mm/yy, columns
//           operación THEN consumo.
//   'gyt' — Banco G&T Continental (Mastercard). Columns consumo THEN
//           transacción (INVERTED vs BI), dates dd-mm-yyyy MIXED with
//           dd-MMM-yyyy in the same column, merchant\address in one field,
//           APPLEPAY marker sometimes GLUED to the currency letter
//           ("APPLEPAYQ"), cashback credits that are not payments.
//   'bac' — BAC Credomatic (AMEX). ONE table, FOUR amount columns (Q débito,
//           Q crédito, $ débito, $ crédito): the currency is the COLUMN, not a
//           section. Dates are MONTH-FIRST "JUN/25" with NO year (inferred
//           from the cut date), credits carry a TRAILING minus ("1,185.00-"),
//           and a leading type code (11 = consumo, 31 = pago).
//
// Design rules, in order of importance:
//   1. RECONCILE OR SAY SO. Every statement prints its own totals; the parse
//      re-adds every row and compares. A parse that does not reconcile is
//      reported as such, never silently imported as if it were complete
//      (serie histórica invariant 5: degrading silently is worse than
//      failing).
//   2. Débito vs crédito is decided by COLUMN POSITION, self-calibrated per
//      page from the document's own header/total lines, so pdftotext -layout
//      and the pdf.js reconstruction (lib/parsers/pdfTextLayout.js) both work
//      without hardcoded offsets.
//   3. A payment TO the card is a transfer between the user's own accounts,
//      not income and not an expense; importing it would distort the month.
//      Those rows go to `excluded` (still counted for reconciliation), and
//      the corrección/reversal of a payment goes with them.
//   4. The transaction date is the FECHA DE CONSUMO (when the person actually
//      spent), which also lines up with the ±-day dedup window against
//      auto-captured expenses. The posting date rides along as `postedDate`.
//
// Pure module: text in, structured rows out. No Firestore, no fetch.

import { parseAmount } from '../numberParse'
import { categorizeExpense } from '../expenseCategorize'
import { amountTokens as amountTokensIn, MONTHS } from './latamNumbers'

// MONTHS y el tokenizador de montos viven en ./latamNumbers: son de la región,
// no de estos tres bancos, y el tokenizador tenía un fallo de mil veces sobre
// cualquier estado con coma decimal.

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// dd/mm/yy → ISO (Contecnica). Two-digit years are 20xx: these statements
// did not exist before 2000 and the format has no other reading.
function isoFromDMYShort(dd, mm, yy) {
  const d = Number(dd), m = Number(mm), y = 2000 + Number(yy)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return iso(y, m, d)
}

// dd-mm-yyyy or dd-MMM-yyyy (G&T mixes both IN THE SAME COLUMN; months come
// abbreviated in English (AUG) or Spanish (AGO) depending on the system that
// printed them, so both maps are accepted).
function isoFromGyT(token) {
  let m = token.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) {
    const d = Number(m[1]), mo = Number(m[2])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return iso(Number(m[3]), mo, d)
  }
  m = token.match(/^(\d{1,2})-([A-ZÁÉ]{3,4})-(\d{4})$/i)
  if (m) {
    const mo = MONTHS[m[2].toUpperCase()]
    if (!mo) return null
    return iso(Number(m[3]), mo, Number(m[1]))
  }
  return null
}

// BAC's "JUN/25" is MONTH-FIRST with no year. The year comes from the cut
// date: a month later than the cut month can only belong to the previous
// year (DEC rows on a January statement).
function isoFromBac(token, cutYear, cutMonth) {
  const m = token.match(/^([A-ZÁÉ]{3,4})\/(\d{1,2})$/i)
  if (!m) return null
  const mo = MONTHS[m[1].toUpperCase()]
  if (!mo) return null
  const year = mo > cutMonth ? cutYear - 1 : cutYear
  return iso(year, mo, Number(m[2]))
}

// Estos tres bancos imprimen con PUNTO decimal, así que la convención se fija
// en vez de deducirla: no hay nada que adivinar y el resultado es byte a byte el
// de siempre. Un lector genérico para otro país sí tiene que deducirla.
const amountTokens = (line) => amountTokensIn(line, 'dot')

// ── Row semantics shared by the three banks ─────────────────────────────────

// Payments to the card and their corrections: transfers, never income/expense.
const PAYMENT_RE = /GRACIAS POR SU PAGO|PAGO POR INTERNET|PAGO RECIBIDO|PAGO A CAPITAL|PAGO A INTERESES|PAGO EN AGENCIA|PAGO BANCA/i
const PAYMENT_ADJUSTMENT_RE = /CORRECCION A PAGO|CORRECCIÓN A PAGO/i
// Cashback / bonified-charge credits: money in, but NOT a payment.
const CASHBACK_RE = /TE DEVUELVE|^CR\.?\s*\d+\s*%|CREDITO P\/CARGOS BONIFICABLES|CRÉDITO P\/CARGOS/i
const FEE_RE = /COMISION|COMISIÓN|IVA\b|MEMBRESIA|MEMBRESÍA|QUASI CASH|CARGO POR/i
const INSTALLMENT_RE = /^FIN\/CT\b/i

function classifyRow({ description, isCredit, group }) {
  if (PAYMENT_ADJUSTMENT_RE.test(description)) return 'payment-adjustment'
  if (PAYMENT_RE.test(description)) return 'payment'
  if (isCredit) return CASHBACK_RE.test(description) ? 'cashback' : 'refund'
  if (group === 'cuotas' || INSTALLMENT_RE.test(description)) return 'installment'
  if (group === 'otros' || FEE_RE.test(description)) return 'fee'
  return 'purchase'
}

function installmentOf(description) {
  const m = description.match(/\((\d{1,2})\/(\d{1,2})\)/)
  return m ? { num: Number(m[1]), of: Number(m[2]) } : null
}

// An instalment row that still names its merchant ("ISHOP GUATEMALA NL 01
// (22/36)") is best filed by what was bought; one that names only a contract
// number is filed as financing, which is everything the statement actually
// says about it.
function installmentCategory(description) {
  const { category, confidence } = categorizeExpense(description)
  return confidence === 'unknown' ? 'Financiamiento' : category
}

// One importable transaction. Excluded kinds return null here and are
// collected separately by each parser.
function buildTx({ date, postedDate, description, location, amount, currency, kind, wallet }) {
  const isIncome = kind === 'cashback' || kind === 'refund'
  // The row's KIND overrides the merchant text where the statement already
  // told us what the row is. A fee is a bank charge no matter what its
  // description echoes ("MEMBRESIA CLUB BI" would otherwise match the 'club'
  // merchant rule and file the card's membership fee under Entretenimiento),
  // and an instalment is a payment on something already bought — "FIN/CT 0013
  // 000001 27" names no merchant at all, so calling it 'Otros Gastos' says
  // "we could not tell" when in fact we can.
  const category = isIncome
    ? 'Otros Ingresos'
    : kind === 'fee'
      ? 'Comisiones'
      : kind === 'installment'
        ? installmentCategory(description)
        : categorizeExpense(description).category
  return {
    date,
    postedDate,
    description,
    ...(location ? { location } : {}),
    merchant: description,
    amount,
    currency,
    type: isIncome ? 'INCOME' : 'EXPENSE',
    category,
    kind,
    ...(installmentOf(description) ? { installment: installmentOf(description) } : {}),
    ...(wallet ? { wallet } : {}),
    source: 'card_import',
  }
}

function pagesOf(text) {
  return String(text || '').split('\f')
}

const centsEqual = (a, b) => Math.abs(a - b) < 0.005

function buildReconciliation(expected, computed) {
  const rows = []
  for (const key of Object.keys(expected)) {
    const [currency, side] = key.split('|')
    rows.push({
      currency,
      side,
      expected: Math.round(expected[key] * 100) / 100,
      computed: Math.round((computed[key] || 0) * 100) / 100,
      ok: centsEqual(expected[key], computed[key] || 0),
    })
  }
  return rows
}

// ── Detection ───────────────────────────────────────────────────────────────

export function detectCardStatement(text) {
  const t = String(text || '')
  if (/CONTECNICA/i.test(t) && /MOVIMIENTOS EN QUETZALES/i.test(t)) return 'bi'
  if (/Banco G&T Continental/i.test(t) && /RESUMEN DE ESTADO DE CUENTA/i.test(t)) return 'gyt'
  if (/baccredomatic/i.test(t) && /Tipo de\s+(?:Fecha|transacci)/i.test(t)) return 'bac'
  if (/baccredomatic/i.test(t) && /Saldo a la fecha de corte/i.test(t)) return 'bac'
  return null
}

// Which card a row was billed to. Stamped on every row so reconciliation can
// tell two cards apart: the same person really did pay Q22 at HOSTALES CA and
// Q50 at COMO LA FLOR on both their BI and their G&T card within three days,
// and without this the second import merged them and deleted Q72.
// The bank is part of the key even when the last four digits are unreadable,
// so two statements from different banks can never collide.
export function cardKeyOf(bank, last4) {
  if (!bank) return null
  return last4 ? `${bank}:${last4}` : `${bank}:?`
}

// Las reglas que el usuario enseñó corrigiendo categorías. Se aplican DESPUÉS
// de parsear y no dentro de cada banco, para no repetir la lógica tres veces.
//
// Solo pisan cuando la que gana es una regla del USUARIO: lo que decidió el
// tipo de fila (una comisión es una comisión aunque su texto diga "CLUB") se
// respeta, y también se respeta lo que ya acertó la tabla de fábrica.
//
// Sin esto, enseñarle a Chispu quién es un comercio servía para el atajo y el
// correo pero NO para el estado de cuenta, que es de donde viene la mayoría de
// los movimientos: el mismo comercio volvía a "Otros Gastos" en cada import.
function applyUserRules(rows, rules) {
  if (!rules?.length) return rows
  return rows.map((row) => {
    if (row.type === 'INCOME') return row
    // El KIND ya dijo qué ES la fila y eso vale más que su descripción: una
    // comisión es una comisión aunque su texto matchee una regla, igual que
    // "MEMBRESIA CLUB BI" no es una salida nocturna.
    if (row.kind === 'fee') return row
    const hit = categorizeExpense(row.description, { rules })
    if (hit.confidence !== 'user' || hit.category === row.category) return row
    return { ...row, category: hit.category, _autoCategory: 'user' }
  })
}

export function parseCardStatement(text, { rules = [] } = {}) {
  const bank = detectCardStatement(text)
  const parsed = bank === 'bi' ? parseContecnica(text)
    : bank === 'gyt' ? parseGyT(text)
      : bank === 'bac' ? parseBac(text)
        : null
  if (!parsed) return null

  const cardKey = cardKeyOf(parsed.bank, parsed.cardLast4)
  if (cardKey) {
    parsed.transactions = parsed.transactions.map((t) => ({ ...t, cardKey }))
    parsed.excluded = parsed.excluded.map((t) => ({ ...t, cardKey }))
  }
  parsed.transactions = applyUserRules(parsed.transactions, rules)
  return parsed
}

// ── Contecnica / Banco Industrial ───────────────────────────────────────────

function parseContecnica(text) {
  const warnings = []
  const pages = pagesOf(text)

  const cutM = text.match(/Fecha de corte:\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})/)
  const dueM = text.match(/Fecha de pago:\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})/)
  const cardM = text.match(/X{4}\s+X{4}\s+X{4}\s+(\d{4})/)

  const transactions = []
  const excluded = []
  // expected[currency|side] accumulates the statement's own TOTAL lines for
  // the DETAIL groups only. "PAGOS REALIZADOS" and "BALANCE DE INTERESES" are
  // summaries of credits already listed row by row in the movements section
  // (verified on a real statement: the Bet365 credits sum to the PAGOS total
  // exactly), so counting their totals would double the expectation.
  const expected = {}
  const computed = {}

  let currency = null
  let group = 'consumos'
  let inTable = false
  let boundary = null // column that splits débitos from créditos, per page

  for (const page of pages) {
    const lines = page.split('\n')
    // Per-page calibration from the repeated column header. Pages of the same
    // statement print the table at DIFFERENT offsets (seen on a real one:
    // page 1 ends débitos ~col 47, page 2 ~col 105). The optional inner space
    // is not paranoia: pdf.js kerns the accent and can emit "Cré ditos" as two
    // fragments, seen with a real statement under pdfjs-dist v4.
    for (const line of lines) {
      const dm = /D[ée]\s?bitos/.exec(line)
      const cm = /Cr[ée]\s?ditos/.exec(line)
      if (dm && cm) {
        boundary = (dm.index + dm[0].length + cm.index + cm[0].length) / 2
        break
      }
    }

    for (const line of lines) {
      if (/MOVIMIENTOS EN QUETZALES/i.test(line)) { currency = 'GTQ'; inTable = true; continue }
      if (/MOVIMIENTOS EN DOLARES/i.test(line)) { currency = 'USD'; inTable = true; continue }
      if (!inTable) continue

      const g = line.trim()
      if (/^CUOTAS$/i.test(g)) { group = 'cuotas'; continue }
      if (/^OTROS CARGOS$/i.test(g)) { group = 'otros'; continue }
      if (/^PAGOS REALIZADOS$/i.test(g)) { group = 'pagos'; continue }
      if (/^BALANCE DE INTERESES$/i.test(g)) { group = 'intereses'; continue }

      const totalM = line.match(/TOTAL (QUETZALES|DOLARES)/i)
      if (totalM) {
        if (group !== 'pagos' && group !== 'intereses') {
          const cur = /QUETZALES/i.test(totalM[1]) ? 'GTQ' : 'USD'
          const amounts = amountTokens(line)
          if (amounts.length === 2) {
            expected[`${cur}|debit`] = (expected[`${cur}|debit`] || 0) + amounts[0].value
            expected[`${cur}|credit`] = (expected[`${cur}|credit`] || 0) + amounts[1].value
          } else {
            warnings.push(`Línea de total con ${amounts.length} montos: "${g}"`)
          }
        }
        continue
      }

      // Column order: fecha de OPERACIÓN first, fecha de CONSUMO second.
      const row = line.match(/^\s*(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2})\/(\d{2})\/(\d{2})\s+(.+)$/)
      if (!row || !currency || group === 'pagos' || group === 'intereses') continue

      const postedDate = isoFromDMYShort(row[1], row[2], row[3])
      const date = isoFromDMYShort(row[4], row[5], row[6])
      const rest = row[7]
      const amounts = amountTokens(line)
      if (!date || !postedDate || amounts.length !== 1) {
        if (amounts.length > 1) warnings.push(`Fila con varios montos, omitida: "${g}"`)
        continue
      }

      const amt = amounts[0]
      const isCredit = boundary != null ? amt.end > boundary : false
      if (boundary == null) warnings.push('Página sin encabezado de columnas: débito asumido')
      const description = rest.replace(/\s*(\d[\d,]*\.\d{2}|\.\d{2})\s*$/, '').trim()

      const side = isCredit ? 'credit' : 'debit'
      computed[`${currency}|${side}`] = (computed[`${currency}|${side}`] || 0) + amt.value

      const kind = classifyRow({ description, isCredit, group })
      if (kind === 'payment' || kind === 'payment-adjustment') {
        excluded.push({ date, description, amount: amt.value, currency, kind })
        continue
      }
      transactions.push(buildTx({ date, postedDate, description, amount: amt.value, currency, kind }))
    }
  }

  const saldoM = text.match(/Saldo al corte[^:]*:\s+([\d.,]+)\s+([\d.,]+)/)
  const reconciliation = buildReconciliation(expected, computed)

  return {
    bank: 'bi',
    bankLabel: 'Bi (Contecnica)',
    cardLast4: cardM ? cardM[1] : null,
    cutDate: cutM ? iso(cutM[3], cutM[2], cutM[1]) : null,
    dueDate: dueM ? iso(dueM[3], dueM[2], dueM[1]) : null,
    closingBalance: saldoM ? { GTQ: parseAmount(saldoM[1]), USD: parseAmount(saldoM[2]) } : null,
    transactions,
    excluded,
    reconciliation,
    reconciled: reconciliation.length > 0 && reconciliation.every((r) => r.ok) && (transactions.length + excluded.length) > 0,
    warnings,
  }
}

// ── Banco G&T Continental ───────────────────────────────────────────────────

const GYT_DATE = /(\d{2}-\d{2}-\d{4}|\d{2}-[A-ZÁÉ]{3,4}-\d{4})/

// Clean "PARQUEO FONTABELLA\4AV 12-59 GTM OF APPLEPAYQ" into merchant,
// address, and the Apple Pay marker. The currency letter can be GLUED to
// APPLEPAY ("APPLEPAYQ") or stand alone before the amount.
function gytDescription(raw) {
  let s = raw.trim()
  let wallet = null
  let currencyHint = null
  s = s.replace(/APPLEPAY\s*(Q|\$)?\s*$/i, (_, cur) => {
    wallet = 'applepay'
    if (cur) currencyHint = cur === '$' ? 'USD' : 'GTQ'
    return ''
  }).trim()
  const tail = s.match(/\s(Q|\$)$/)
  if (tail) {
    currencyHint = tail[1] === '$' ? 'USD' : 'GTQ'
    s = s.slice(0, -2).trim()
  }
  let location = null
  const slash = s.indexOf('\\')
  if (slash !== -1) {
    location = s.slice(slash + 1).replace(/\s+/g, ' ').trim() || null
    s = s.slice(0, slash).trim()
  }
  return { merchant: s, location, wallet, currencyHint }
}

function parseGyT(text) {
  const warnings = []
  const pages = pagesOf(text)

  const cutM = text.match(/FECHA DE CORTE\s+(\d{2})-([A-ZÁÉ]{3,4})-(\d{4})/i)
  const dueM = text.match(/FECHA M[ÁA]XIMA DE PAGO\s+(\d{2})-([A-ZÁÉ]{3,4})-(\d{4})/i)
  const cardM = text.match(/(\d{4})-\d{2}X{2}-X{4}-(\d{4})/)
  const saldoM = text.match(/SALDO TOTAL\s+([\d.,]+)\s+([\d.,]+)/)

  // The statement's own arithmetic: sub-total lines per currency.
  const expected = {}
  const subQ = text.match(/Sub\s*-\s*total Quetzales\s+Q?\s*([\d.,]+)\s+Q?\s*([\d.,]+)/i)
  const subD = text.match(/Sub\s*-\s*total D[óo]lares\s+\$?\s*([\d.,]+)\s+\$?\s*([\d.,]+)/i)
  if (subQ) { expected['GTQ|debit'] = parseAmount(subQ[1]); expected['GTQ|credit'] = parseAmount(subQ[2]) }
  if (subD) { expected['USD|debit'] = parseAmount(subD[1]); expected['USD|credit'] = parseAmount(subD[2]) }

  const transactions = []
  const excluded = []
  const computed = {}
  let currency = 'GTQ' // quetzales section comes first; flips at its sub-total

  for (const page of pages) {
    const lines = page.split('\n')

    // Calibrate the débito/crédito boundary for THIS page. Anchors, in order
    // of trust: a sub-total line (one amount per side by construction), then
    // the largest gap between the end-columns of this page's single-amount
    // rows (débitos cluster left, créditos right). "CONTINUACIÓN" pages have
    // no column header, so the header is deliberately not relied on.
    let boundary = null
    const sub = lines.find((l) => /Sub\s*-\s*total/i.test(l))
    if (sub) {
      const a = amountTokens(sub)
      if (a.length === 2) boundary = (a[0].end + a[1].end) / 2
    }
    if (boundary == null) {
      const ends = []
      for (const l of lines) {
        if (!GYT_DATE.test(l)) continue
        const a = amountTokens(l.replace(GYT_DATE, '').replace(GYT_DATE, ''))
        if (a.length === 1) {
          const full = amountTokens(l)
          ends.push(full[full.length - 1].end)
        }
      }
      ends.sort((x, y) => x - y)
      let bestGap = 0, bestAt = null
      for (let i = 1; i < ends.length; i++) {
        const gap = ends[i] - ends[i - 1]
        if (gap > bestGap) { bestGap = gap; bestAt = (ends[i] + ends[i - 1]) / 2 }
      }
      // A narrow spread means every row sits in one column: no boundary, the
      // description heuristic below decides.
      if (bestGap >= 6) boundary = bestAt
    }

    for (const line of lines) {
      if (/Sub\s*-\s*total Quetzales/i.test(line)) { currency = 'USD'; continue }

      const row = line.match(new RegExp(`^\\s*${GYT_DATE.source}\\s+${GYT_DATE.source}\\s+(.+)$`))
      if (!row) continue
      // Column order: fecha de CONSUMO first, fecha de transacción second —
      // the OPPOSITE of Contecnica, and exactly the kind of swap that reads
      // fine at a glance and shifts every date by two days.
      const date = isoFromGyT(row[1])
      const postedDate = isoFromGyT(row[2])
      const amounts = amountTokens(row[3])
      if (!date || !postedDate || amounts.length !== 1) continue

      const lineAmounts = amountTokens(line)
      const amtEnd = lineAmounts[lineAmounts.length - 1].end
      const rawDesc = row[3].replace(/(Q|\$)?\s*(\d[\d,]*\.\d{2}|\.\d{2})\s*$/, '').trim()
      const { merchant, location, wallet, currencyHint } = gytDescription(rawDesc)

      let isCredit = boundary != null ? amtEnd > boundary : false
      // The description is authoritative for the credit kinds this format
      // prints (payments, cashback): if position and text disagree, the text
      // wins and the mismatch is logged.
      const looksCredit = PAYMENT_RE.test(merchant) || CASHBACK_RE.test(merchant)
      if (looksCredit && !isCredit) {
        warnings.push(`Posición decía débito pero el texto es de crédito: "${merchant}"`)
        isCredit = true
      }

      const rowCurrency = currencyHint || currency
      const side = isCredit ? 'credit' : 'debit'
      computed[`${rowCurrency}|${side}`] = (computed[`${rowCurrency}|${side}`] || 0) + amounts[0].value

      const kind = classifyRow({ description: merchant, isCredit, group: 'consumos' })
      if (kind === 'payment' || kind === 'payment-adjustment') {
        excluded.push({ date, description: merchant, amount: amounts[0].value, currency: rowCurrency, kind })
        continue
      }
      transactions.push(buildTx({ date, postedDate, description: merchant, location, amount: amounts[0].value, currency: rowCurrency, kind, wallet }))
    }
  }

  const reconciliation = buildReconciliation(expected, computed)
  return {
    bank: 'gyt',
    bankLabel: 'G&T Continental',
    cardLast4: cardM ? cardM[2] : null,
    cutDate: cutM ? isoFromGyT(`${cutM[1]}-${cutM[2]}-${cutM[3]}`) : null,
    dueDate: dueM ? isoFromGyT(`${dueM[1]}-${dueM[2]}-${dueM[3]}`) : null,
    closingBalance: saldoM ? { GTQ: parseAmount(saldoM[1]), USD: parseAmount(saldoM[2]) } : null,
    transactions,
    excluded,
    reconciliation,
    reconciled: reconciliation.length > 0 && reconciliation.every((r) => r.ok) && (transactions.length + excluded.length) > 0,
    warnings,
  }
}

// ── BAC Credomatic ──────────────────────────────────────────────────────────

function parseBac(text) {
  const warnings = []

  // Cut and due dates are the first dd-MMM-yyyy pair in the document (their
  // labels sit on a separate layout row). AGO/DIC come in Spanish here.
  const dates = [...text.matchAll(/(\d{2})-([A-ZÁÉ]{3,4})-(\d{4})/g)]
  const cutDate = dates[0] ? isoFromGyT(dates[0].slice(1).join('-')) : null
  const dueDate = dates[1] ? isoFromGyT(dates[1].slice(1).join('-')) : null
  const cutYear = cutDate ? Number(cutDate.slice(0, 4)) : new Date().getFullYear()
  const cutMonth = cutDate ? Number(cutDate.slice(5, 7)) : new Date().getMonth() + 1

  const cardM = text.match(/X{3,4}-X{4}-X{4}-(\d{4})/) || text.match(/\*+-\*+-\*(\d{4})/)

  // The table's own totals: DÉBITO row (Q then $) and CRÉDITO row (trailing
  // minus). These are the reconciliation targets AND the currency anchors.
  const lines = text.split('\n')
  const expected = {}
  let debitAnchors = null
  let creditAnchors = null
  for (const line of lines) {
    if (/^\s*DÉBITO\b/i.test(line.trim()) || /^\s*DEBITO\b/i.test(line.trim())) {
      const a = amountTokens(line)
      if (a.length === 2) {
        expected['GTQ|debit'] = a[0].value
        expected['USD|debit'] = a[1].value
        debitAnchors = [a[0].end, a[1].end]
      }
    }
    if (/^\s*CRÉDITO\b/i.test(line.trim()) || /^\s*CREDITO\b/i.test(line.trim())) {
      const a = amountTokens(line)
      if (a.length === 2) {
        expected['GTQ|credit'] = a[0].value
        expected['USD|credit'] = a[1].value
        creditAnchors = [a[0].end, a[1].end]
      }
    }
  }

  const transactions = []
  const excluded = []
  const computed = {}

  // Rows: type code + two MONTH-FIRST dates + description + ONE amount whose
  // column decides the currency. Wrapped descriptions (a merchant name too
  // long for its cell) print on NEIGHBOR lines with the row itself left
  // blank, so orphan text lines adjacent to a description-less row belong to
  // it.
  const rowRe = /^\s*(\d{2})\s+([A-ZÁÉ]{3,4}\/\d{1,2})\s+([A-ZÁÉ]{3,4}\/\d{1,2})\s+(.*)$/
  const parsedRows = []
  const orphans = new Map() // line index → text, for wrapped descriptions

  lines.forEach((line, idx) => {
    const m = line.match(rowRe)
    if (m) {
      parsedRows.push({ idx, code: m[1], consumo: m[2], operacion: m[3], rest: m[4] })
      return
    }
    // Candidate wrapped-description fragment: text-only, inside the table
    // region, no amounts, no dates, not a header/total.
    const t = line.trim()
    if (!t || amountTokens(line).length > 0) return
    if (/DÉBITO|DEBITO|CRÉDITO|CREDITO|Detalle|Descripción|transacci|Quetzales|Dólares|Infórmate|baccredomatic|Página/i.test(t)) return
    if (/^[A-Za-z0-9''.,()/&\- ]{1,60}$/.test(t)) orphans.set(idx, t)
  })

  for (const row of parsedRows) {
    const date = isoFromBac(row.consumo, cutYear, cutMonth)
    const postedDate = isoFromBac(row.operacion, cutYear, cutMonth)
    if (!date || !postedDate) continue

    const amounts = amountTokens(row.rest)
    if (amounts.length !== 1) continue
    const lineAmounts = amountTokens(lines[row.idx])
    const amt = { ...amounts[0], end: lineAmounts[lineAmounts.length - 1].end }

    let description = row.rest.replace(/(\d[\d,]*\.\d{2}|\.\d{2})-?\s*$/, '').trim()
    if (!description) {
      // Adopt the closest orphan line(s): the fragment printed before the row
      // plus a short continuation after it ("...Woodland HillU" + "S").
      const before = orphans.get(row.idx - 1)
      const after = orphans.get(row.idx + 1)
      if (before) { description = before; orphans.delete(row.idx - 1) }
      if (after && (!before || after.length <= 3)) {
        description = (description + after).trim()
        orphans.delete(row.idx + 1)
      }
      description = description.trim()
    }
    if (!description) { warnings.push(`Fila del ${date} sin descripción`); description = 'Movimiento' }

    // Sign: the trailing minus and the type code (31 = pago) must agree.
    const minusCredit = amt.negative
    const codeCredit = row.code === '31'
    if (minusCredit !== codeCredit) warnings.push(`Signo y código no coinciden en "${description}"`)
    const isCredit = minusCredit || codeCredit

    // Currency = nearest anchor column from the statement's own total lines.
    const anchors = isCredit ? creditAnchors : debitAnchors
    let currency = 'GTQ'
    if (anchors) {
      currency = Math.abs(amt.end - anchors[0]) <= Math.abs(amt.end - anchors[1]) ? 'GTQ' : 'USD'
    } else {
      warnings.push('Sin línea de totales para anclar columnas: moneda asumida GTQ')
    }

    const side = isCredit ? 'credit' : 'debit'
    computed[`${currency}|${side}`] = (computed[`${currency}|${side}`] || 0) + amt.value

    const kind = classifyRow({ description, isCredit, group: 'consumos' })
    if (kind === 'payment' || kind === 'payment-adjustment') {
      excluded.push({ date, description, amount: amt.value, currency, kind })
      continue
    }
    transactions.push(buildTx({ date, postedDate, description, amount: amt.value, currency, kind }))
  }

  const saldoM = text.match(/Saldo a la fecha de corte\s*=?\s*Q\.?\s*([\d.,]+)\s+US\$\.?\s*([\d.,]+)/i)
  const reconciliation = buildReconciliation(expected, computed)
  return {
    bank: 'bac',
    bankLabel: 'BAC Credomatic',
    cardLast4: cardM ? cardM[1] : null,
    cutDate,
    dueDate,
    closingBalance: saldoM ? { GTQ: parseAmount(saldoM[1]), USD: parseAmount(saldoM[2]) } : null,
    transactions,
    excluded,
    reconciliation,
    reconciled: reconciliation.length > 0 && reconciliation.every((r) => r.ok) && (transactions.length + excluded.length) > 0,
    warnings,
  }
}
