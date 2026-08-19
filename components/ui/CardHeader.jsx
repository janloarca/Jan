'use client'

import { InfoTip } from '@/components/ui/Tooltip'

// El encabezado de una card, para las que tienen la forma canónica.
//
// La tipografía NO vive acá: vive en `.card-title` (app/globals.css), junto a
// `.card` y `.btn-primary`. Así este componente y las ~20 cards que todavía
// escriben su `<h3 className="card-title">` a mano no pueden divergir: las dos
// rutas apuntan a la misma definición.
//
// El punto de color no lleva significado por sí solo (el título siempre está al
// lado): es una ayuda para encontrar la card, no un código que descifrar.
export default function CardHeader({
  title,
  dot,
  info,
  // Lo que va pegado a la derecha, normalmente una cifra. Acepta cualquier nodo.
  right,
  // El nivel semántico. `h3` por default, que es lo que una card es dentro de
  // una sección; se sube cuando la card ES la sección.
  as: Tag = 'h3',
  className = '',
}) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-3 ${className}`}>
      <Tag className="card-title">
        {dot && <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />}
        <span className="truncate">{title}</span>
        {info && <InfoTip text={info} />}
      </Tag>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}
