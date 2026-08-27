// "¿Qué es este lugar?" → categoría.
//
// El problema que resuelve, planteado por el usuario con un ejemplo concreto:
// aparece un cobro de DONALD y él sabe que Donald es su mecánico. Lo que NO
// sabe (ni tiene por qué) es en cuál de nuestras dieciséis categorías cae un
// mecánico. Pedirle que elija de una lista es pedirle que traduzca su mundo al
// nuestro; dejarlo escribir "mecánico" es al revés, y es el orden correcto.
//
// Reglas de lo que entra en esta tabla:
//   1. Solo OFICIOS, SERVICIOS y TIPOS DE GASTO genéricos. Nunca el nombre de
//      un comercio: para eso están las reglas por comercio que se aprenden solas
//      (lib/expenseCategorize.js), y llenar esto de nombres propios la
//      sobreajustaría a una sola ciudad, que es la misma trampa que ya
//      documenta la tabla de comercios.
//   2. Toda categoría devuelta tiene que existir en FINANCE_CATEGORIES, o el
//      desglose la perdería en silencio. Hay un test que lo fija.
//
// Módulo puro + tests.

import { normalizeDesc } from './statementMatcher'
import { FINANCE_CATEGORIES } from './financeCategories'

// Ordenado: la primera etiqueta que matchea gana, así que lo específico va
// antes que lo genérico ('seguro de carro' antes que 'seguro').
export const LABEL_RULES = [
  { category: 'Transporte', any: ['mecanico', 'mecanica', 'taller', 'taller mecanico', 'llantas', 'llanteria', 'repuestos', 'autopartes', 'lavado de carro', 'carwash', 'car wash', 'gasolina', 'combustible', 'gasolinera', 'parqueo', 'parking', 'estacionamiento', 'taxi', 'uber', 'pasaje', 'bus', 'vuelo', 'avion', 'aerolinea', 'peaje', 'grua', 'polarizado', 'enderezado y pintura', 'aceite'] },
  { category: 'Salud', any: ['doctor', 'doctora', 'medico', 'medica', 'dentista', 'dental', 'odontologo', 'consulta', 'clinica', 'hospital', 'farmacia', 'medicina', 'medicamento', 'laboratorio', 'examenes', 'psicologo', 'terapia', 'nutricionista', 'optica', 'lentes', 'vacuna', 'fisioterapia'] },
  { category: 'Alimentación', any: ['almuerzo', 'cena', 'desayuno', 'comida', 'restaurante', 'cafe', 'cafeteria', 'panaderia', 'supermercado', 'super', 'mercado', 'verduras', 'carniceria', 'refaccion', 'antojo', 'helado', 'postre', 'domicilio', 'delivery'] },
  { category: 'Servicios', any: ['luz', 'electricidad', 'agua', 'internet', 'telefono', 'celular', 'cable', 'gas', 'basura', 'recibo'] },
  { category: 'Vivienda', any: ['alquiler', 'renta', 'condominio', 'mantenimiento de casa', 'ferreteria', 'plomero', 'electricista', 'albañil', 'albanil', 'carpintero', 'jardinero', 'pintor', 'muebles', 'hipoteca', 'limpieza'] },
  { category: 'Educación', any: ['colegio', 'universidad', 'escuela', 'curso', 'clase', 'clases', 'libro', 'libros', 'utiles', 'matricula', 'colegiatura', 'inscripcion', 'maestro', 'tutor', 'diplomado', 'certificacion'] },
  { category: 'Entretenimiento', any: ['cine', 'pelicula', 'concierto', 'teatro', 'museo', 'gimnasio', 'gym', 'deporte', 'padel', 'futbol', 'tenis', 'golf', 'hotel', 'viaje', 'vacaciones', 'bar', 'trago', 'fiesta', 'salida', 'juego', 'videojuego', 'apuesta', 'casino'] },
  { category: 'Compras', any: ['ropa', 'zapatos', 'tienda', 'regalo', 'electronica', 'celular nuevo', 'computadora', 'accesorios', 'perfume', 'maquillaje', 'peluqueria', 'barberia', 'salon', 'uñas', 'unas'] },
  { category: 'Suscripciones', any: ['suscripcion', 'membresia', 'mensualidad', 'streaming', 'plan mensual', 'renovacion'] },
  { category: 'Seguros', any: ['seguro', 'poliza', 'aseguradora'] },
  { category: 'Impuestos', any: ['impuesto', 'impuestos', 'iusi', 'isr', 'iva', 'sat', 'declaracion', 'multa', 'tramite'] },
  { category: 'Comisiones', any: ['comision', 'cargo bancario', 'anualidad', 'sobregiro', 'cuota de manejo'] },
  { category: 'Financiamiento', any: ['cuota', 'financiamiento', 'prestamo', 'credito', 'abono a deuda'] },
  // ⛔ Sin regla para las categorías de transferencia, por la misma razón que
  // `lib/expenseCategorize.js`: la palabra sola no distingue "moví plata entre
  // mis cuentas" de "le mandé plata a Juan", y desde FASE KV equivocarse saca
  // el gasto de todos los totales sin decirlo. Una SUGERENCIA es peligrosa acá
  // aunque el usuario confirme, porque lo que confirma es la palabra que
  // tecleó, no la consecuencia. Elegirla a mano de la lista completa sigue
  // disponible para quien sabe lo que significa.
]

// Devuelve { category, matchedBy } o null. Nunca inventa: sin coincidencia la
// respuesta correcta es null y quien llama sigue mostrando la lista completa.
export function suggestCategoryForLabel(label) {
  const normalized = normalizeDesc(label)
  if (!normalized) return null
  let best = null
  for (const rule of LABEL_RULES) {
    for (const needle of rule.any) {
      const n = normalizeDesc(needle)
      if (!n || !normalized.includes(n)) continue
      // La etiqueta más larga gana: 'seguro de carro' describe mejor que 'seguro'.
      if (!best || n.length > best.matchedBy.length) best = { category: rule.category, matchedBy: n }
    }
  }
  return best
}

// Ruido que los bancos pegan al nombre del comercio y que NO forma parte de su
// identidad: el país, la zona, el número de sucursal. Se recorta para que la
// regla aprendida de "FINCA FELIZ GT" también reconozca a "FINCA FELIZ" cuando
// el otro banco lo escriba distinto — un problema real de estos estados, donde
// el mismo lugar aparece con y sin cola según quién lo imprima.
const TRAILING_NOISE = /\s+(?:gt|gtm|guatemala|s\.?a\.?|z\s?\d{1,2}|zona\s?\d{1,2}|suc(?:ursal)?\s?\d*|no\s?\d+|\d{1,4})$/i

export function merchantRuleKey(merchant) {
  let s = normalizeDesc(merchant)
  if (!s) return ''
  // Repetido: "FINCA FELIZ ZONA 10 GT" lleva dos colas.
  for (let i = 0; i < 3; i++) {
    const next = s.replace(TRAILING_NOISE, '').trim()
    if (next === s) break
    // Nunca recortar hasta dejarlo irreconocible: una llave de una o dos letras
    // matchearía media lista de comercios.
    if (next.length < 3) break
    s = next
  }
  return s
}

export function isKnownCategory(category, type = 'EXPENSE') {
  const list = type === 'INCOME' ? FINANCE_CATEGORIES.INCOME : FINANCE_CATEGORIES.EXPENSE
  return list.includes(category)
}
