/**
 * Qué le preguntamos a alguien que acaba de entrar, y en qué orden lo
 * acompañamos después.
 *
 * Esto vivía dentro de `components/dashboard/GuidedSetup.jsx`, y sacarlo NO es
 * cosmético: ese componente importa `AddAccountModal` (más de 2000 líneas) y
 * por eso está detrás de un `dynamic()` en el tablero. La pantalla de
 * bienvenida renderiza en CADA carga con cero activos, así que si importara las
 * categorías desde ahí arrastraría el formulario largo entero al chunk inicial,
 * o sea al único momento de la app donde el peso se nota de verdad.
 *
 * El otro motivo es que acá la regla de orden queda fijada por test en vez de
 * por comentario: este repo prueba módulos puros de `lib/`, no componentes.
 */

// Las nueve cosas que alguien puede tener. Ocho son tipos de activo; la novena
// es un ATAJO: si tiene cuenta en un broker, teclear posición por posición
// sería absurdo cuando la app ya sabe sincronizar.
export const FIRST_RUN_CATEGORIES = [
  { key: 'Stock', icon: '📈', es: 'Acciones', en: 'Stocks' },
  { key: 'Crypto', icon: '₿', es: 'Cripto', en: 'Crypto' },
  { key: 'Fund', icon: '💼', es: 'Fondos o ETFs', en: 'Funds or ETFs' },
  { key: 'Bank', icon: '🏦', es: 'Cuenta de banco', en: 'Bank account' },
  { key: 'Bond', icon: '🏛', es: 'Bonos o plazo fijo', en: 'Bonds or fixed term' },
  { key: 'RealEstate', icon: '🏠', es: 'Inmuebles', en: 'Real estate' },
  { key: 'Alternative', icon: '🔮', es: 'Inversiones privadas', en: 'Private investments' },
  { key: 'Debt', icon: '💳', es: 'Deudas', en: 'Debts' },
  { key: 'broker', icon: '🔗', es: 'Cuenta en un broker', en: 'A broker account', isBroker: true },
]

/**
 * De lo que marcó a la cola que se va a recorrer.
 *
 * El orden del CATÁLOGO manda, nunca el orden en que fue tocando. Dos razones:
 * el recorrido es predecible (siempre empieza por lo mismo para todo el mundo),
 * y el broker queda al final, que es donde tiene sentido un atajo que se sale
 * del formulario.
 *
 * Filtrar por el catálogo, en vez de mapear lo marcado, hace de paso que una
 * llave desconocida no pueda entrar a la cola: `AddAccountModal` la recibiría
 * como `guidedType` y no sabría qué preguntar.
 */
export function orderPicked(picked) {
  const set = new Set(Array.isArray(picked) ? picked : [])
  return FIRST_RUN_CATEGORIES.filter((c) => set.has(c.key)).map((c) => c.key)
}

export function categoryFor(key) {
  return FIRST_RUN_CATEGORIES.find((c) => c.key === key)
}

export function isBrokerStep(key) {
  return categoryFor(key)?.isBroker === true
}
