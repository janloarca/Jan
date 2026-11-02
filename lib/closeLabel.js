// Nombre accesible del botón de cerrar de los modales. Antes iba fijo en
// inglés ("Close") aunque la app estuviera en español. Los modales se montan
// tras un clic (nunca en el render del servidor), así que leer la preferencia
// de idioma aquí no puede causar un desajuste de hidratación.
export function closeLabel() {
  try { if (typeof localStorage !== 'undefined' && localStorage.getItem('chispudo-lang') === 'en') return 'Close' } catch {}
  return 'Cerrar'
}
