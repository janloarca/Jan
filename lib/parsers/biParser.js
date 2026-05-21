import { categorizeTransaction } from '@/lib/financeCategories'

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

function parseDate(val) {
  if (!val) return null
  const str = val.toString().trim()

  const ddmmyyyy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const yyyymmdd = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/)
  if (yyyymmdd) {
    const [, y, m, d] = yyyymmdd
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  if (typeof val === 'number') {
    const epoch = new Date((val - 25569) * 86400 * 1000)
    if (!isNaN(epoch.getTime())) return epoch.toISOString().split('T')[0]
  }

  const d = new Date(str)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  return null
}

function parseAmount(val) {
  if (val == null || val === '') return 0
  if (typeof val === 'number') return Math.abs(val)
  const cleaned = val.toString().replace(/[Q$,\s]/g, '').replace(/\((.+)\)/, '-$1')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : Math.abs(num)
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

    if (saldoIdx >= 0) {
      const saldo = parseAmount(row[saldoIdx])
      if (saldo > 0) finalBalance = saldo
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
