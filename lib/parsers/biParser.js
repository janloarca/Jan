import { categorizeTransaction } from '@/lib/financeCategories'
import { parseAmount as parseSignedAmount } from '@/lib/numberParse'

export function detectBI(headers) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  const hasDebit = lower.some(h => h.includes('débito') || h.includes('debito'))
  const hasCredit = lower.some(h => h.includes('crédito') || h.includes('credito'))
  const hasSaldo = lower.some(h => h.includes('saldo'))
  const hasDate = lower.some(h => h.includes('fecha'))
  const hasDesc = lower.some(h => h.includes('descripci') || h.includes('concepto'))
  return hasDate && hasDesc && ((hasDebit && hasCredit) || (hasDebit && hasSaldo) || (hasCredit && hasSaldo))
}

function findColumnIndex(headers, ...patterns) {
  const lower = headers.map(h => (h || '').toString().toLowerCase().trim())
  for (const pattern of patterns) {
    const idx = lower.findIndex(h => h.includes(pattern))
    if (idx !== -1) return idx
  }
  return -1
}

function isValidDateParts(y, m, d) {
  const year = parseInt(y), month = parseInt(m), day = parseInt(d)
  if (year < 1900 || year > 2100) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function parseDate(val) {
  if (!val) return null
  const str = val.toString().trim()

  const ddmmyyyy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy
    if (!isValidDateParts(y, m, d)) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const yyyymmdd = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/)
  if (yyyymmdd) {
    const [, y, m, d] = yyyymmdd
    if (!isValidDateParts(y, m, d)) return null
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  if (typeof val === 'number') {
    const epoch = new Date((val - 25569) * 86400 * 1000)
    if (!isNaN(epoch.getTime()) && epoch.getFullYear() >= 1900 && epoch.getFullYear() <= 2100) return epoch.toISOString().split('T')[0]
  }

  const d = new Date(str)
  if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) return d.toISOString().split('T')[0]
  return null
}

// Absolute amount for the debit/credit columns (the column decides the sign).
// The previous implementation stripped commas BEFORE asking whether the comma was a
// decimal separator, so its European branch could never fire: "1.234,56" became
// 123456 (100x) on every Guatemalan statement. Now delegated to the shared parser.
function parseAmount(val) {
  const n = parseSignedAmount(val)
  return isFinite(n) ? Math.abs(n) : 0
}

export function parseBI(rows, headers) {
  const dateIdx = findColumnIndex(headers, 'fecha')
  const descIdx = findColumnIndex(headers, 'descripci', 'concepto', 'detalle')
  const debitIdx = findColumnIndex(headers, 'débito', 'debito', 'cargo')
  const creditIdx = findColumnIndex(headers, 'crédito', 'credito', 'abono')
  const saldoIdx = findColumnIndex(headers, 'saldo')
  const refIdx = findColumnIndex(headers, 'referencia', 'documento', 'no.')

  const transactions = []
  let finalBalance = 0

  for (const row of rows) {
    const date = parseDate(dateIdx >= 0 ? row[dateIdx] : null)
    if (!date) continue

    const description = descIdx >= 0 ? (row[descIdx] || '').toString().trim() : ''
    const debit = debitIdx >= 0 ? parseAmount(row[debitIdx]) : 0
    const credit = creditIdx >= 0 ? parseAmount(row[creditIdx]) : 0
    const reference = refIdx >= 0 ? (row[refIdx] || '').toString().trim() : ''

    if (saldoIdx >= 0 && row[saldoIdx] != null && row[saldoIdx] !== '') {
      // Signed (an overdrawn account is legitimately negative) and locale-aware: the
      // old bare parseFloat turned "12.345,67" into 12.34 and wrote that as the
      // user's bank balance.
      const raw = parseSignedAmount(row[saldoIdx])
      if (isFinite(raw) && row[saldoIdx] !== '') finalBalance = raw
    }

    if (debit === 0 && credit === 0) continue

    const type = credit > 0 ? 'INCOME' : 'EXPENSE'
    const amount = credit > 0 ? credit : debit

    transactions.push({
      date,
      amount,
      type,
      category: categorizeTransaction(description, type),
      description,
      currency: 'GTQ',
      reference,
      source: 'bi_import',
    })
  }

  return { transactions, finalBalance, currency: 'GTQ' }
}
