'use client'

/* El toggle de dos estados (bolita que se desliza en una píldora de 32x16)
 * estaba copiado a mano SEIS veces entre AddAccountModal, EditAccountModal
 * y MonthStatusBar, y ya habían divergido: tres sin `shrink-0` (se podían
 * aplastar en una fila con label largo), y solo MonthStatusBar llevaba
 * `role="switch"`/`aria-checked` — las otras cinco eran un <button> sin
 * ninguna semántica de accesibilidad.
 *
 * Esta es la definición única. Visualmente IDÉNTICA a como ya se veía
 * (mismo tamaño, mismo tiempo de transición, misma bolita blanca) para que
 * migrar un call site sea un cambio de cero píxeles, no un rediseño.
 *
 * `color` es el token de acento que toma el fondo cuando está en ON — cada
 * copia vieja usaba un color distinto a propósito (azul para "dinero
 * nuevo", naranja para "ilíquido", cyan para "cuenta por cobrar"), así que
 * sigue siendo un prop y no una constante.
 */
export default function Switch({
  checked,
  onChange,
  color = 'var(--accent-blue)',
  disabled = false,
  id,
  className = '',
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      style={{ backgroundColor: checked ? color : 'var(--card-border, #38383A)' }}
    >
      <span
        className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${checked ? 'left-4' : 'left-0.5'}`}
      />
    </button>
  )
}
