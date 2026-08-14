// Los cuatro tonos del toast del dashboard.
//
// Vive fuera de app/dashboard/page.jsx porque un archivo de página en el App
// Router solo admite exports reconocidos por Next, así que dejarlo ahí lo hacía
// imposible de verificar sin reconstruirlo a mano en una ruta de prueba, que es
// justo el atajo que ya dejó pasar un crash antes (FASE GQ3).
//
// El fondo se compone con color-mix para que quede OPACO: los tokens
// --alert-*-bg son translúcidos al 10% y un aviso flotante sobre contenido tiene
// que taparlo. Antes eran rgba fijos de tema oscuro, así que en tema claro el
// toast salía oscuro sobre fondo claro.
//
// Se mezcla contra --bg-primary y NO contra --bg-card: en tema oscuro la tarjeta
// es rgba(...,0.6), o sea el resultado heredaría esa transparencia y el toast se
// vería a través (medido: alpha 0.656). --bg-primary es opaco en los dos temas.
//
// ⚠ REGLA DE PRODUCTO: el ROJO queda RESERVADO para algo grave o irreversible.
// En una app de dinero el rojo se lee como "perdiste algo" o "algo se rompió", y
// una sincronización que hay que reintentar no es ninguna de las dos: eso va en
// ámbar ('warn'). Antes de usar 'error', preguntarse si de verdad amerita esa
// lectura.
const toneStyle = (name) => ({
  backgroundColor: `color-mix(in srgb, var(--alert-${name}-icon) 16%, var(--bg-primary))`,
  borderColor: `var(--alert-${name}-border)`,
  color: `var(--alert-${name}-icon)`,
})

export const TOAST_STYLE = {
  error: toneStyle('error'),
  warn: toneStyle('warn'),
  info: toneStyle('info'),
  success: toneStyle('success'),
}

export const TOAST_ICON = { error: '✕', warn: '⚠', info: 'ℹ', success: '✓' }

export function toastStyleFor(type) { return TOAST_STYLE[type] || TOAST_STYLE.success }
export function toastIconFor(type) { return TOAST_ICON[type] || TOAST_ICON.success }
