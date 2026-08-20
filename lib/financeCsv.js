// El CSV de Flujo, en dos sabores que NO son el mismo archivo.
//
// La distinción es la razón por la que este módulo existe:
//
//   'report'  — lo que exporta la pantalla de Flujo. Sus filas ya vienen
//               normalizadas a GTQ, así que la columna Amount es GTQ y el
//               monto original viaja al lado. Sirve para analizar un mes.
//
//   'backup'  — lo que se descarga ANTES de borrar. Tiene que salir del monto
//               TAL COMO SE GUARDÓ, en su propia moneda: un respaldo con el
//               monto convertido no permite restaurar lo que había, que es su
//               único propósito. Lleva además los campos que identifican la
//               fila (id, source, kind) porque sin ellos no se puede saber de
//               dónde vino ni volver a emparejarla.
//
// Escribir un respaldo con la columna convertida sería la clase de error que
// solo se descubre el día que hace falta restaurar.

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

const REPORT_HEADER = 'Date,Type,Category,Description,Amount,Currency,OriginalAmount,OriginalCurrency'
const BACKUP_HEADER = 'Id,Date,Type,Category,Description,Amount,Currency,Method,Source,Kind,Account,OccurredAt'

// Las filas de Flujo como CSV de reporte. `currency` es la moneda a la que el
// caller ya normalizó los montos.
export function financeReportCsv(transactions, { currency = 'GTQ' } = {}) {
  const rows = (transactions || []).map((tx) => [
    esc(tx.date || ''), esc(tx.type || ''), esc(tx.category || ''), esc(tx.description || ''),
    tx.amount || 0, esc(currency),
    tx._originalCurrency ? (tx._originalAmount || 0) : '', esc(tx._originalCurrency || ''),
  ].join(','))
  return [REPORT_HEADER, ...rows].join('\n')
}

// Las filas CRUDAS como respaldo. `methodOf` se inyecta para no importar
// lib/financeWipe acá y que las dos definiciones de "método" puedan derivar:
// el caller ya la tiene.
export function financeBackupCsv(transactions, { methodOf = () => '' } = {}) {
  const rows = (transactions || []).map((tx) => [
    esc(tx.id || ''), esc(tx.date || ''), esc(tx.type || ''), esc(tx.category || ''),
    esc(tx.description || ''),
    // Crudo. Sin convertir, sin redondear: es lo que dice el documento.
    Number(tx.amount) || 0, esc(tx.currency || 'GTQ'),
    esc(methodOf(tx)), esc(tx._source || tx.source || ''), esc(tx.kind || ''),
    esc(tx.account || ''), esc(tx.occurredAt || ''),
  ].join(','))
  return [BACKUP_HEADER, ...rows].join('\n')
}

// Dispara la descarga en el navegador. Aparte de los constructores para que
// esos se puedan probar sin un DOM.
export function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
