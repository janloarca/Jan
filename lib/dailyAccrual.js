// Devengo DIARIO, asentado una vez a fin de mes.
//
// El caso que lo pidió: un fondo líquido que acumula intereses todos los días
// (el saldo sube de $5,000.00 a $5,000.20 de un día para otro) a una tasa que
// VARÍA día a día, y que anualizada cae en un rango conocido (4-5%). Ese tipo
// de instrumento existe también en bonos y CDs (devengan diario, pagan cupón
// trimestral) y en cripto (staking, lending).
//
// LA DECISIÓN QUE GOBIERNA TODO ESTE MÓDULO: se devenga diario pero se ASIENTA
// UNA vez, el último día del mes. Un movimiento por día son ~365 documentos al
// año POR ACTIVO, y eso inunda el historial de movimientos, el caché mensual
// del Spreadsheet y la cuota de Firestore, que esta app ya tocó en producción
// (FASE IE9). Además sería mentira contable: un fondo que acumula diario no te
// PAGA diario, capitaliza. Un solo asiento mensual que dice "esto es lo que
// acumuló el mes" es a la vez más barato y más honesto.
//
// Y por lo mismo el valor del activo queda PLANO entre asientos y salta al
// cerrar el mes. Dibujar la curva suave del día a día exigiría que el valor
// fuera función del tiempo, y eso vive en `indexBalanceEvents` /
// `applyStaticHistory` (⛔ superficie congelada F). Este módulo no la toca.
//
// CONVENCIÓN DE TASA: la tasa que el usuario teclea es EFECTIVA ANUAL, y el
// factor de un mes es `(1 + tasa)^(días del mes / días de ESE año)`. La
// alternativa (nominal anual capitalizada diario) convertiría un 4% tecleado
// en 4.081% al año, y nadie que lee "4%" en el folleto de su fondo espera
// terminar con 4.081%.
//
// De ahí la base ACT/ACT (365 o 366 según el año real), y de ahí esta
// propiedad, que es la que sus tests fijan y que hay que enunciar con
// cuidado porque depende de qué se hace con el dinero:
//
//   - Si el interés SE REINVIERTE, el saldo crece cada mes y los doce factores
//     MULTIPLICAN a (1+tasa)^1: el año cierra en la tasa exacta. Es el caso
//     del fondo líquido que capitaliza.
//   - Si el interés SE COBRA EN EFECTIVO, el saldo se queda quieto y el año
//     cierra un poco POR DEBAJO de la tasa. Eso no es un error de redondeo,
//     es la respuesta correcta: el dinero que sacaste no compuso.
//
// Los factores se multiplican, nunca se suman. Sumar doce fracciones de un
// saldo fijo y esperar la tasa anual exacta es el error que cazaron los tests
// de este módulo antes de que existiera este párrafo.
//
// SOBRE DÍAS HÁBILES: a propósito NO se modela un calendario de feriados. Un
// fondo que cotiza 4% anual acumula ese 4% en el año, lo reparta en 252 o en
// 365 rebanadas; el fin de semana simplemente se paga el lunes. El total anual
// es idéntico y lo único que cambiaría es si el sábado muestra ganancia, que
// con un asiento MENSUAL no es observable en ninguna superficie de la app. Un
// calendario de feriados además exige saber de qué país (¿el del usuario, el
// del fondo?) y se desactualiza solo: mucho costo para una diferencia que
// ningún número que la app reporta puede mostrar.

// Marca en el ítem. Ausente = mensual, el comportamiento de siempre.
export const ACCRUAL_DAILY = 'daily'

export function isDailyAccrual(item) {
  return !!item && item.accrual === ACCRUAL_DAILY
}

// El calendario que IMPLICA el devengo diario, en un solo lugar.
//
// Un activo que devenga diario y asienta a fin de mes es, para el motor de
// pagos que ya existe, uno que paga los 12 meses con día 31: `clampPayDay`
// recorta ese 31 al último día real de cada mes (FASE HV2), incluido el 28 o
// 29 de febrero. O sea que no hace falta ninguna rama nueva en el calendario,
// solo guardar los campos correctos. Los dos modales (alta y edición) llaman
// a esto en vez de escribir los mismos tres campos a mano cada uno.
export function dailyAccrualScheduleFields() {
  return {
    incomeMonths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    incomeMonthsExplicit: true,
    incomePayDay: 31,
  }
}

// La tasa anual con la que devenga, o 0 si el activo no tiene una.
//
// Con tasa VARIABLE se usa el punto medio del rango, exactamente igual que
// hace el motor de pagos mensual: dos reglas distintas para la misma pregunta
// harían que el mismo activo devengara distinto según la frecuencia elegida.
// El monto fijo mensual (`incomeMode: 'fixed'`) devuelve 0 a propósito: un
// monto fijo no devenga, se paga, y ahí el devengo diario no significa nada.
export function accrualAnnualRate(item) {
  if (!item) return 0
  if (item.rateType === 'variable' && item.rateMin > 0 && item.rateMax > 0) {
    return (Number(item.rateMin) + Number(item.rateMax)) / 2
  }
  const r = Number(item.incomeRate)
  return Number.isFinite(r) && r > 0 ? r : 0
}

// 365 o 366, según el año calendario real.
export function daysInYear(year) {
  const y = Number(year)
  if (!Number.isFinite(y)) return 365
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
}

export function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

// La fecha de asiento: el ÚLTIMO día del mes, como texto ISO.
//
// No hace falta un campo de "día de pago" propio: `clampPayDay` ya recorta un
// 31 configurado al último día real de cada mes (FASE HV2), así que un activo
// de devengo diario es simplemente uno que paga los 12 meses con día 31. Esa
// es toda la integración con el calendario que ya existe.
export function accrualPayDate(year, monthIndex) {
  const d = daysInMonth(year, monthIndex)
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Cuántos días de ESE mes el activo estuvo de verdad en cartera.
//
// Recorta por la fecha de compra, y eso arregla de paso el primer mes: comprar
// el 20 de agosto devenga 12 días de agosto, no un mes entero. Con el reparto
// mensual plano (saldo × tasa / 12) el primer mes acreditaba un mes COMPLETO
// por unos días de tenencia.
//
// `acquisitionDay` es 'YYYY-MM-DD' (lib/incomeSchedule.js → acquisitionDayISO).
// Sin fecha de compra se devenga el mes entero, que es el comportamiento
// conservador de siempre.
export function accrualDaysInMonth({ year, monthIndex, acquisitionDay } = {}) {
  const total = daysInMonth(year, monthIndex)
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!acquisitionDay) return total
  const acqY = Number(acquisitionDay.slice(0, 4))
  const acqM = Number(acquisitionDay.slice(5, 7)) - 1
  const acqD = Number(acquisitionDay.slice(8, 10))
  if (!Number.isFinite(acqY) || !Number.isFinite(acqM) || !Number.isFinite(acqD)) return total
  // Mes anterior a la compra: cero. El motor ya lo filtra antes de llegar acá
  // (FASE KS), pero devolver 0 lo hace cierto por construcción y no por que
  // alguien recuerde llamar al filtro.
  if (acqY > year || (acqY === year && acqM > monthIndex)) return 0
  // Mes posterior: entero.
  if (acqY < year || acqM < monthIndex) return total
  // El MES de la compra: desde el día siguiente a la compra hasta fin de mes.
  // El día de la compra en sí no devenga: el dinero entró ese día y la primera
  // acreditación es la del día siguiente, que es como liquida un fondo real.
  return Math.max(0, total - acqD)
}

// Lo devengado por un mes concreto, en la moneda del saldo.
//
//   monto = saldo × ((1 + tasa)^(días devengados / días del año) − 1)
//
// Compuesto, no lineal: el interés de hoy genera interés mañana, que es lo que
// significa "capitaliza". La diferencia contra el reparto lineal es de
// centavos en un mes, pero es la forma correcta y es la que hace que doce
// meses sumen la tasa anual exacta.
export function monthlyAccrual({ balance, annualRatePct, year, monthIndex, acquisitionDay } = {}) {
  const bal = Number(balance)
  const rate = Number(annualRatePct)
  if (!Number.isFinite(bal) || bal <= 0) return 0
  if (!Number.isFinite(rate) || rate === 0) return 0
  const days = accrualDaysInMonth({ year, monthIndex, acquisitionDay })
  if (days <= 0) return 0
  const frac = days / daysInYear(year)
  const growth = Math.pow(1 + rate / 100, frac) - 1
  const amount = bal * growth
  return Number.isFinite(amount) ? amount : 0
}
