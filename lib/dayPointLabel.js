// FASE SA: cómo se rotula un punto de la vista HOY.
//
// Un punto intradía es un INSTANTE y se muestra con la hora en la zona del
// usuario (toLocaleTimeString ya lo hace). Pero el primer punto de HOY suele
// ser un snapshot DIARIO, cuyo ts es la fecha a medianoche UTC: no describe
// ninguna hora, describe un DÍA. Formatearlo como hora lo corría a "18:00" del
// día anterior en Guatemala (UTC-6) mientras el reloj local decía las 12:00,
// o sea parecía que la app mostraba la hora en UTC. Un punto así se rotula con
// su fecha, leída en UTC para no retroceder el día.
export function isDateOnlyTs(ts) {
  return Number.isFinite(ts) && ts % 86400000 === 0
}

export function dayPointLabel(ts, lang = 'es', { long = false } = {}) {
  const d = new Date(ts)
  if (!Number.isFinite(ts) || isNaN(d.getTime())) return ''
  const locale = lang === 'es' ? 'es' : 'en-US'
  if (isDateOnlyTs(ts)) {
    const date = d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(/\bsept\b/i, 'sep')
    return long ? `${date} · ${lang === 'es' ? 'registro del día' : 'daily record'}` : date
  }
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}
