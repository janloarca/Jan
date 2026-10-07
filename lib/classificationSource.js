// FASE PT. De dónde salió la industria de un activo.
//
// Hasta hoy un valor autodetectado (el que trae la cotización del proveedor al
// buscar un símbolo) y uno que el usuario eligió se guardaban IGUAL, o sea
// desde afuera no se podía distinguir "lo puso Yahoo" de "lo decidí yo", y la
// pantalla no tenía cómo ofrecer corregir lo primero sin insinuar que lo
// segundo podía estar mal.
//
// Solo hay DOS orígenes honestos hoy, y no se agrega ninguno que no ocurra:
//   'api'  : vino de la cotización del proveedor, sin que nadie lo tocara.
//   'user' : el usuario lo eligió o lo corrigió.
// No existe 'inferred' a propósito: la app NO adivina industria desde el
// nombre ni desde las notas para ESCRIBIRLA (la cascada de World las usa para
// DIBUJAR, que es otra cosa y jamás se guarda como dato del activo).
//
// Regla dura: un valor 'user' nunca vuelve a 'api'. Cambiar el campo a mano
// siempre lo vuelve 'user', y nada automático lo pisa después.

export const INDUSTRY_SOURCES = ['api', 'user']

const isSource = (s) => INDUSTRY_SOURCES.includes(s)

// Lee el origen guardado en un item. Sin marca (todo lo guardado antes de
// esta fase) devuelve null: ahí no se afirma nada.
export function industrySourceOf(item) {
  const s = item?.classificationSource?.industry
  return isSource(s) ? s : null
}

// Lo que se guarda en el item. Sin industria no hay origen que registrar, y un
// origen suelto sobre un campo vacío afirmaría algo sobre nada.
export function classificationSourceFor({ industry, industrySource }) {
  if (!industry || !isSource(industrySource)) return null
  return { industry: industrySource }
}

// ¿Se muestra "Auto-detectado · Corregir"? Solo mientras el valor sigue siendo
// el que trajo el proveedor: en cuanto el usuario lo cambia el origen pasa a
// 'user' y la línea desaparece sola, sin que haya que apagarla aparte.
export function showAutoDetected({ industry, industrySource }) {
  return !!industry && industrySource === 'api'
}
