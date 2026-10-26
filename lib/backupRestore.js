// Restaurar un respaldo JSON (el que genera "Exportar Backup" en Ajustes).
// Alcance elegido por el usuario: posiciones, lotes y transacciones. NO toca
// snapshots, metas ni configuración. Y es no destructivo: un documento que ya
// existe (mismo id) se deja como está, así restaurar jamás pisa datos de hoy.
const COLLECTIONS = ['items', 'lots', 'transactions']

export function parseBackup(text) {
  let data
  try { data = JSON.parse(text) } catch { return { error: 'invalid-json' } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'not-a-backup' }
  if (!COLLECTIONS.some((k) => Array.isArray(data[k]))) return { error: 'not-a-backup' }
  return { data }
}

// Devuelve, por colección, los docs a escribir ({id, data}) y cuántos se omiten
// por existir ya o por no traer id.
export function planRestore(data, existing = {}) {
  const plan = {}
  let skipped = 0
  let total = 0
  for (const key of COLLECTIONS) {
    const have = new Set((existing[key] || []).map((d) => d && d.id).filter(Boolean))
    plan[key] = []
    for (const doc of Array.isArray(data?.[key]) ? data[key] : []) {
      total++
      if (!doc || typeof doc !== 'object' || !doc.id || have.has(doc.id)) { skipped++; continue }
      const { id, ...rest } = doc
      const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
      plan[key].push({ id: String(id), data: clean })
    }
  }
  return { plan, skipped, total, toWrite: COLLECTIONS.reduce((s, k) => s + plan[k].length, 0) }
}
