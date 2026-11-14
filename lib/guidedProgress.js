// FASE SC (B2). Progreso del repaso guiado de "datos por completar".
//
// El repaso camina CUENTAS, pero lo que el usuario quiere ver bajar es la
// cantidad de DATOS pendientes (el mismo contador del encabezado). Se fija el
// total al abrir (`baseline`) y se mide lo resuelto contra el pendiente de
// ahora: resolver o descartar una sugerencia sube el progreso sin que este
// modulo sepa nada de hallazgos.
//
// Un hallazgo NUEVO que aparece con el repaso abierto (p. ej. al editar una
// cuenta) no puede volver negativo el avance ni pasarlo de 100%: se acota.
export function guidedProgress(baseline, pendingNow) {
  const total = Number(baseline)
  if (!Number.isFinite(total) || total <= 0) return null
  const now = Number(pendingNow)
  const left = Number.isFinite(now) ? Math.max(0, now) : total
  const done = Math.min(total, Math.max(0, total - left))
  return { done, total, pct: Math.round((done / total) * 100), complete: left === 0 }
}
