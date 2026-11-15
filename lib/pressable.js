// FASE SI (B10): un elemento que reacciona a un click pero no es un <button>
// (una celda editable, una fila que se pliega, una zona de soltar archivos) no
// existe para quien usa teclado: no entra al orden de tabulación y Enter no
// hace nada. `pressable` le da lo que un botón trae gratis, en UN solo lugar
// para que las pantallas no escriban cada una su propia copia.
//
// - Enter y Espacio activan, igual que en un <button>.
// - Solo cuando la tecla ocurre sobre el PROPIO elemento: una fila que se
//   pliega puede contener botones o campos, y un Enter dentro de ellos no
//   puede plegar la fila además de hacer lo suyo.
// - `role` es opcional porque en un <tr> no corresponde ponerle role="button"
//   (rompe la tabla para un lector de pantalla); ahí se usa `expanded`, que
//   sí anuncia si la fila está abierta.
export function pressable(onActivate, { role = 'button', label, expanded } = {}) {
  const props = {
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate(e)
      }
    },
  }
  if (role) props.role = role
  if (label) props['aria-label'] = label
  if (expanded !== undefined) props['aria-expanded'] = !!expanded
  return props
}
