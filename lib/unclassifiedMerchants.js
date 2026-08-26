// Triage de "Otros Gastos": los COMERCIOS sin clasificar, ordenados por dinero.
//
// El caso real (FASE JW): Q3,909 varados en "Otros Gastos", casi todo
// restaurantes con nombre propio. Eso es por diseño (la tabla de fábrica solo
// lleva patrones genéricos; llenarla de nombres propios la sobreajustaría a una
// ciudad) y se resuelve enseñando UNA vez por comercio... pero hasta ahora el
// usuario tenía que encontrar esas filas una por una en una lista de 167
// movimientos. Esto las agrupa por comercio y las ordena por monto acumulado,
// así cinco clics cubren el grueso.
//
// Qué entra y qué no, con la misma disciplina de lib/recategorize.js:
//   - SOLO filas que clasificó una MÁQUINA (estado de cuenta, atajo, correo):
//     una fila tecleada a mano es la redacción del usuario y su decisión.
//   - SOLO el bucket de "no supe" ('Otros Gastos').
//   - NUNCA una fila que el usuario ya decidió (`_categorySetByUser`), incluso
//     si eligió el fallback a propósito.
//   - NUNCA una fila cuyo texto no nombra un comercio (pago, cuota, comisión,
//     promoción): `isTeachableRow` ya sabe cuáles son.
//
// Módulo puro + tests. El caller aplica los cambios y enseña la regla.

import { merchantRuleKey } from './merchantLabels'
import { isMachineDescribed } from './recategorize'
import { isTeachableRow } from './importLearning'
import { FINANCE_CURRENCY } from './financeMonth'

const FALLBACK = 'Otros Gastos'

function toGtq(amount, currency, convert) {
  const amt = Number(amount) || 0
  const cur = currency || FINANCE_CURRENCY
  if (cur === FINANCE_CURRENCY || typeof convert !== 'function') return amt
  const out = convert(amt, cur, FINANCE_CURRENCY)
  return isFinite(out) ? out : amt
}

// [{ key, merchant, total, count, txIds }] ordenado por |total| descendente,
// más el resumen honesto para el encabezado: cuánto cubren los primeros N de
// todo lo sin clasificar.
export function unclassifiedMerchants(transactions, { convert = null, top = 6 } = {}) {
  const byKey = new Map()
  let totalAll = 0
  for (const tx of transactions || []) {
    if (!tx?.id || tx.type !== 'EXPENSE') continue
    if (tx.category !== FALLBACK) continue
    if (tx._categorySetByUser) continue
    if (!isMachineDescribed(tx)) continue
    if (!isTeachableRow(tx)) continue
    const merchant = tx.merchant || tx.description || ''
    const key = merchantRuleKey(merchant)
    if (!key) continue
    const amt = toGtq(tx.amount, tx.currency, convert)
    totalAll += amt
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { key, merchant, total: amt, count: 1, txIds: [tx.id] })
    } else {
      prev.total += amt
      prev.count += 1
      prev.txIds.push(tx.id)
      // El texto más corto suele ser el nombre sin la cola de sucursal: mejor
      // etiqueta para enseñar y para mostrar.
      if (merchant.length < prev.merchant.length) prev.merchant = merchant
    }
  }
  const rows = [...byKey.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
  const shown = rows.slice(0, top)
  return {
    rows: shown,
    moreCount: Math.max(0, rows.length - shown.length),
    coveredTotal: shown.reduce((s, r) => s + r.total, 0),
    totalAll,
  }
}
