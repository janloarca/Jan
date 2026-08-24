// Un inmueble y la deuda que lo financia, puestos uno al lado del otro.
//
// ⛔ EL INVARIANTE QUE GOBIERNA ESTE MÓDULO: el vínculo es de SOLO LECTURA.
// Ninguna cifra del patrimonio cambia por vincular una propiedad con su
// hipoteca. La deuda YA resta por su cuenta como ítem propio (getItemValue la
// niega: `if (item.isDebt) return -Math.abs(val)`) y la propiedad YA suma, así
// que el "capital propio" que se calcula acá es una cifra DERIVADA para MOSTRAR
// y jamás un valor nuevo. Si alguien la sumara al patrimonio, la deuda quedaría
// contada dos veces. Hay un test que fija exactamente eso.
//
// Por qué existe: hoy una propiedad son DOS campos (lo que pagaste, lo que vale
// hoy) y una Deuda ya trae tasa, pago mensual y cuotas, pero NADA las conecta.
// El usuario lo pidió así: "payments, cuánto ya pagado, cuánto falta, cuánto de
// enganche, costos de admin, impuesto, costos de reparaciones". Todo eso sale
// de datos que ya existen más un enganche declarado, sin teclear nada dos veces
// y sin tabla de amortización (que el usuario dejó fuera a propósito).

// Cuánto se debe HOY, en positivo. La deuda se guarda en positivo y se niega al
// leer, así que acá se toma el valor absoluto y no se depende del signo.
function debtBalance(debt) {
  if (!debt) return 0
  const qty = Number(debt.quantity)
  const price = Number(debt.currentPrice ?? debt.purchasePrice) || 0
  const q = Number.isFinite(qty) && qty !== 0 ? qty : 1
  const v = Math.abs(q * price)
  return Number.isFinite(v) ? v : 0
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Las cifras de una propiedad, cada una derivada de un dato que ya existe.
 *
 * @param property  el ítem inmueble
 * @param debt      el ítem de deuda vinculado (o null / no encontrado)
 * @param convert   (amount, from, to) opcional. Sin él, montos en moneda distinta
 *                  NO se suman crudos: se reporta el desacuerdo (lección FASE FS,
 *                  un monto en una moneda vestido con el símbolo de otra).
 *
 * Devuelve siempre el mismo shape. Los campos que no se pueden saber vienen en
 * `null`, nunca en 0: "no sé" y "es cero" son respuestas distintas y la UI las
 * pinta distinto.
 */
export function computePropertyEquity(property, debt, convert) {
  const cur = property?.currency || property?._originalCurrency || 'USD'
  const paid = num(property?.purchasePrice)
  const today = num(property?.currentPrice) || paid
  const down = num(property?.downPayment)

  const adminMonthly = num(property?.adminFeeMonthly)
  const taxAnnual = num(property?.propertyTaxAnnual)
  const carryingAnnual = adminMonthly > 0 || taxAnnual > 0
    ? adminMonthly * 12 + taxAnnual
    : null

  const out = {
    currency: cur,
    purchasePrice: paid,
    currentValue: today,
    downPayment: down > 0 ? down : null,
    carryingAnnual,
    adminMonthly: adminMonthly > 0 ? adminMonthly : null,
    taxAnnual: taxAnnual > 0 ? taxAnnual : null,
    // Lo que depende de la deuda:
    hasDebt: false,
    debtCurrencyMismatch: false,
    originalLoan: null,
    paidOnLoan: null,
    remaining: null,
    totalPaid: null,
    equity: null,
    monthlyPayment: null,
    installmentsTotal: null,
    installmentsRemaining: null,
    // Por qué falta lo que falta, para que la UI no tenga que adivinarlo.
    refusal: null,
  }

  if (!debt) return out
  out.hasDebt = true

  // Las dos monedas o coinciden, o se convierten. Sumar crudo es cómo un monto
  // en quetzales termina impreso con signo de dólar.
  const debtCur = debt.currency || debt._originalCurrency || 'USD'
  let remaining = debtBalance(debt)
  let monthly = num(debt.monthlyPayment) || num(debt.minimumPayment)
  if (debtCur !== cur) {
    if (!convert) {
      out.debtCurrencyMismatch = true
      out.refusal = 'currency'
      return out
    }
    const r = convert(remaining, debtCur, cur)
    const m = convert(monthly, debtCur, cur)
    if (!Number.isFinite(r)) {
      out.debtCurrencyMismatch = true
      out.refusal = 'currency'
      return out
    }
    remaining = r
    monthly = Number.isFinite(m) ? m : 0
  }

  out.remaining = remaining
  out.monthlyPayment = monthly > 0 ? monthly : null
  out.equity = today - remaining

  const tot = num(debt.installmentsTotal)
  const rem = num(debt.installmentsRemaining)
  if (tot > 0) {
    out.installmentsTotal = tot
    out.installmentsRemaining = rem > 0 ? rem : 0
  }

  // El préstamo original se deduce de lo que costó menos el enganche. Con un
  // enganche declarado mayor al precio los datos se contradicen entre sí, y ahí
  // rehusar es más honesto que imprimir un "ya pagado" negativo que nadie puede
  // interpretar. Lo mismo si el saldo pendiente supera al préstamo original:
  // significa que el enganche o el precio están mal.
  if (down > 0 || paid > 0) {
    const original = paid - down
    if (original < 0) {
      out.refusal = 'down-exceeds-price'
      return out
    }
    if (original > 0 && remaining > original * 1.01) {
      out.refusal = 'debt-exceeds-loan'
      return out
    }
    out.originalLoan = original
    out.paidOnLoan = Math.max(0, original - remaining)
    out.totalPaid = down + out.paidOnLoan
  }

  return out
}

/**
 * La deuda vinculada a una propiedad, o null.
 *
 * Se resuelve por id y se comprueba que siga siendo una deuda: un vínculo a un
 * ítem borrado, o a uno que dejó de ser deuda, tiene que leerse como "no hay
 * deuda" y no reventar. El hallazgo `broken-link` de dataCompleteness es el que
 * se encarga de decírselo al usuario.
 */
export function linkedDebtOf(property, items) {
  const id = property?.linkedDebtId
  if (!id) return null
  const found = (items || []).find((it) => it?.id === id)
  return found && found.isDebt ? found : null
}

/** ¿Este ítem es un inmueble? La misma prueba que usa el resto de la app. */
export function isProperty(item) {
  return /realestate|inmueble/i.test(item?.type || '')
}

/**
 * Las deudas que se le pueden ofrecer a una propiedad para vincular, con las
 * hipotecas primero: es de lejos el caso común, y ordenarlas evita que alguien
 * con seis tarjetas de crédito tenga que buscar la suya en la lista.
 */
export function debtOptions(items) {
  return (items || [])
    .filter((it) => it?.id && it.isDebt && !it.isReceivable)
    .sort((a, b) => {
      const am = a.subtype === 'mortgage' ? 0 : 1
      const bm = b.subtype === 'mortgage' ? 0 : 1
      if (am !== bm) return am - bm
      return String(a.name || a.symbol || '').localeCompare(String(b.name || b.symbol || ''))
    })
}
