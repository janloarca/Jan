// Año y mes (0-11) de una fecha calendario, leídos del TEXTO.
// `new Date('2026-10-01')` es medianoche UTC y los getters locales la corren
// un día (o un mes/año) al oeste de UTC: un pago del día 1 caería en el mes
// anterior. Un día calendario es una cadena, nunca un instante.
export function ymOfDate(value) {
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})/.exec(value)
    if (m) return { y: Number(m[1]), m: Number(m[2]) - 1 }
  }
  if (value == null || value === '') return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return { y: d.getFullYear(), m: d.getMonth() }
}
