// El día de HOY tal como lo vive el usuario, 'YYYY-MM-DD'.
//
// ⛔ Esto NO reemplaza a UTC en todos lados, y confundir las dos cosas es un
// bug en cualquiera de las dos direcciones. La distinción:
//
//   · Un día CALENDARIO que el usuario vivió (¿cuándo compré esto?, ¿cuándo
//     gasté esto?, ¿esta fecha es futura?) es LOCAL. Nadie que gasta a las 7pm
//     del 31 de agosto considera que gastó en septiembre.
//
//   · Una FRONTERA DEL SISTEMA (a qué año pertenece un snapshot, si el backfill
//     de hoy ya corrió, el corte de un año calendario) es UTC, y este repo lo
//     tiene fijado con guardianes desde FASE KY/LF: "UTC es la correcta y no es
//     preferencia", porque esas fronteras las evalúa también el SERVIDOR y con
//     hora local el año de un usuario lo decidiría la zona del datacenter.
//
// El defecto que obligó a nombrarlo: los formularios pre-llenaban la fecha con
// `new Date().toISOString().split('T')[0]`, que es el día UTC. En Guatemala
// (UTC-6, sin horario de verano) eso ROTA A LAS 6 DE LA TARDE, así que cada
// noche la fecha sugerida era la de mañana. Medido: un gasto tecleado a las 7pm
// del 31 de agosto se pre-llenaba con `2026-09-01`.
//
// Y en Flujo eso no es un día de diferencia: la pantalla entera está organizada
// por MES, así que el gasto sale del mes en que ocurrió y engorda el siguiente,
// moviendo el total, el desglose por categoría y la tasa de ahorro de DOS meses
// a la vez. Un usuario que registra sus gastos de noche, que es cuando la gente
// los registra, lo pega el último día de cada mes.
//
// Se construye por COMPONENTES locales y no con `toISOString()` (que convierte a
// UTC por definición); `toLocaleDateString('en-CA')` da el mismo resultado pero
// depende de que el locale exista en el runtime.
export function todayLocalISO(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
