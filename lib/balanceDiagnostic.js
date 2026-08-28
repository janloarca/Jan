// Qué hay ESCRITO de verdad en una cuenta de saldo, y si eso puede producir el
// número que la pantalla muestra.
//
// Por qué existe: el saldo de una cuenta de saldo vive repartido en varios
// campos (`quantity`, `currentPrice`, `purchasePrice`, más los respaldos
// `price`/`cost`/`averagePrice` a los que `getItemPrice` cae en cascada), y
// `getItemValue` es el PRODUCTO de dos de ellos. Cuando el valor mostrado no es
// el que el usuario espera, desde afuera "la app no guardó", "guardó y no lo
// lee", "un residuo lo resucitó" y "el navegador tiene el build viejo" se ven
// EXACTAMENTE IGUAL: un número que no es el que debería.
//
// Este repo ya pagó esa ambigüedad tres veces sobre la MISMA cuenta, deduciendo
// los campos desde capturas de pantalla. Es la lección de "Reparar ahora" (FASE
// HP) en la superficie que la necesitaba: dejar de adivinar y poder LEER.
//
// No decide ni escribe nada: describe. Y `expected` no es una corrección, es la
// pregunta "¿los campos guardados pueden producir el valor que se ve?".

import { isBankLike, getItemPrice, getItemValue } from '@/components/dashboard/utils'

// Los campos de respaldo de getItemPrice, en su orden de cascada. Un valor vivo
// acá con los dos precios en cero es lo que resucita un saldo vaciado.
const FALLBACK_FIELDS = ['price', 'cost', 'averagePrice']

function fieldsOf(item) {
  const out = {}
  for (const k of ['quantity', 'currentPrice', 'purchasePrice', ...FALLBACK_FIELDS]) {
    const v = Number(item?.[k])
    if (item?.[k] != null && Number.isFinite(v)) out[k] = v
  }
  return out
}

// Qué le pasa a esta cuenta, en una frase, o null si está sana.
function verdictOf(item, fields) {
  const qty = Number(item?.quantity)
  const price = getItemPrice(item)
  const value = getItemValue(item)
  const cur = Number(item?.currentPrice)
  const pur = Number(item?.purchasePrice)

  if (!(Number.isFinite(qty) && qty > 0) && Number.isFinite(price) && price > 0) {
    return { code: 'qty-cero', es: `cantidad ${fields.quantity ?? 'ausente'} con precio ${price}: el saldo escrito se lee como 0.00`, en: 'zero quantity with a live price: the written balance reads as 0.00' }
  }
  if (cur === 0 && pur === 0 && value !== 0) {
    return { code: 'resucitado', es: `los dos precios en cero pero vale ${value}: un residuo lo está resucitando`, en: 'both prices zero yet it is worth something: a leftover field is resurrecting it' }
  }
  if (Number.isFinite(qty) && qty > 0 && qty !== 1) {
    return { code: 'qty-no-1', es: `cantidad ${qty}: los campos de precio NO son el saldo, se multiplican por ${qty}`, en: `quantity ${qty}: the price fields are not the balance, they get multiplied by ${qty}` }
  }
  return null
}

// Una fila por cuenta de saldo. Solo `isBankLike`: en un activo por cantidad los
// mismos campos significan otra cosa (precio por unidad) y describirlos con este
// vocabulario confundiría en vez de aclarar.
export function balanceDiagnostic(items) {
  const rows = []
  for (const it of items || []) {
    if (!it || !it.id || !isBankLike(it)) continue
    const fields = fieldsOf(it)
    rows.push({
      id: it.id,
      label: it.name || it.symbol || it.id,
      institution: it.institution || '',
      currency: it._originalCurrency || it.currency || '',
      fields,
      price: getItemPrice(it),
      value: getItemValue(it),
      verdict: verdictOf(it, fields),
    })
  }
  return rows
}

// El texto copiable. En un teléfono no hay consola, así que el reporte tiene que
// poder viajar en un mensaje (misma razón que el bloque de la pantalla de
// error). `build` va adentro porque separa "el arreglo no sirve" de "el arreglo
// no llegó", que es la ambigüedad que más rondas costó en este repo.
export function balanceDiagnosticText(rows, { build = null, lang = 'es' } = {}) {
  const es = lang !== 'en'
  const head = es ? 'Chispudo · diagnóstico de cuentas de saldo' : 'Chispudo · balance account diagnostic'
  const lines = [head]
  if (build) lines.push(`build: ${build}`)
  lines.push('')
  for (const r of rows || []) {
    lines.push(`${r.label}${r.institution ? ` (${r.institution})` : ''}${r.currency ? ` ${r.currency}` : ''}`)
    const f = Object.entries(r.fields).map(([k, v]) => `${k}=${v}`).join(' · ')
    lines.push(`  ${f || (es ? 'sin campos numéricos' : 'no numeric fields')}`)
    lines.push(`  ${es ? 'precio leído' : 'read price'}=${r.price} · ${es ? 'VALOR' : 'VALUE'}=${r.value}`)
    if (r.verdict) lines.push(`  ⚠ ${es ? r.verdict.es : r.verdict.en}`)
    lines.push('')
  }
  return lines.join('\n')
}
