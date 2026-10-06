// Piezas chicas del diorama: personas, escritorios, árboles, lo que va en la
// pared de cada piso, en la azotea y en el lote. Todas son componentes de
// módulo (nunca dentro de un render) y todas animan un <g> INTERNO sin
// atributo transform: la posición la pone el <g> de afuera.
import { iso } from '@/lib/worldLayout'
import { SKINS, HAIRS, SHIRTS, PANTS, HAT, accentOf } from '@/lib/worldPalette'
import { boxFaces, poly, planeY, planeX, planeZ } from './isoDraw'

const pick = (arr, seed, shift = 0) => arr[(seed >>> shift) % arr.length]

export function IsoBox({ x0, y0, z0, x1, y1, z1, top, left, right, stroke }) {
  const f = boxFaces(x0, y0, z0, x1, y1, z1)
  return (
    <g>
      <polygon points={f.left} style={{ fill: left }} />
      <polygon points={f.right} style={{ fill: right }} />
      <polygon points={f.top} style={stroke ? { fill: top, stroke, strokeWidth: 0.4 } : { fill: top }} />
    </g>
  )
}

// Una persona, con los pies en (gx, gy, gz). `dir` es la dirección de su
// franja de galería ('x' sigue a gx, 'y' a gy) y `sign` hacia dónde camina.
export function Worker({ gx, gy, gz, seed, pose, hat, dir = 'x', sign = 1 }) {
  const [x, y] = iso(gx, gy, gz)
  const skin = pick(SKINS, seed, 1)
  const hair = pick(HAIRS, seed, 4)
  const shirt = pick(SHIRTS, seed, 7)
  const pants = pick(PANTS, seed, 11)
  const moving = pose === 'walk' || pose === 'carry'
  const span = 0.5 * sign
  const dx = (dir === 'x' ? 18 : -18) * span
  const dy = 9 * span
  const delay = `${-((seed % 37) / 10).toFixed(1)}s`
  const innerClass = moving ? 'w-walk' : (pose === 'desk' ? 'w-bob' : undefined)
  const innerStyle = moving
    ? { '--wdx': `${dx.toFixed(1)}px`, '--wdy': `${dy.toFixed(1)}px`, animationDelay: delay }
    : (innerClass ? { animationDelay: delay } : undefined)
  return (
    <g transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
      <g className={innerClass} style={innerStyle}>
        <ellipse cx="0" cy="0" rx="3.2" ry="1.5" style={{ fill: 'var(--w-shadow)' }} />
        <rect x="-2" y="-6" width="1.7" height="6" rx="0.6" style={{ fill: pants }} />
        <rect x="0.3" y="-6" width="1.7" height="6" rx="0.6" style={{ fill: pants }} />
        <rect x="-2.7" y="-11.6" width="5.4" height="6.6" rx="1.9" style={{ fill: shirt }} />
        <circle cx="0" cy="-13.9" r="2.3" style={{ fill: skin }} />
        {hat
          ? <path d="M-2.7,-14.2 Q0,-18.4 2.7,-14.2 Z" style={{ fill: HAT }} />
          : <path d="M-2.35,-14.1 Q0,-17.6 2.35,-14.1 Q0,-15.3 -2.35,-14.1 Z" style={{ fill: hair }} />}
        {pose === 'carry' && (
          <rect x="-2.8" y="-10.4" width="5.6" height="4" rx="0.5" style={{ fill: 'var(--w-box)', stroke: 'var(--w-shadow)', strokeWidth: 0.3 }} />
        )}
        {pose === 'screen' && (
          <rect x="1.9" y="-11" width="1.3" height="4.2" rx="0.6" style={{ fill: shirt }} transform="rotate(-35 2.5 -11)" />
        )}
      </g>
    </g>
  )
}

// Escritorio con monitor. `dir` igual que Worker: a lo largo de qué eje corre
// la franja (el escritorio queda de frente a la galería).
export function Desk({ gx, gy, gz, dir = 'x' }) {
  const a = 0.24
  const b = 0.15
  const box = dir === 'x'
    ? { x0: gx - a, x1: gx + a, y0: gy - b, y1: gy + b }
    : { x0: gx - b, x1: gx + b, y0: gy - a, y1: gy + a }
  const mon = dir === 'x'
    ? <g transform={planeY(gx - 0.13, gy - b + 0.04, gz + 11)}><rect x="0" y="0" width={0.26 * 18} height="4.6" rx="0.5" style={{ fill: 'var(--w-screen)' }} /></g>
    : <g transform={planeX(gx - b + 0.04, gy - 0.13, gz + 11)}><rect x="0" y="0" width={0.26 * 18} height="4.6" rx="0.5" style={{ fill: 'var(--w-screen)' }} /></g>
  return (
    <g>
      {mon}
      <IsoBox {...box} z0={gz} z1={gz + 5} top="var(--w-desk-top)" left="var(--w-desk)" right="var(--w-desk)" />
    </g>
  )
}

export function Tree({ gx, gy, gz = 0, big }) {
  const [x, y] = iso(gx, gy, gz)
  const r = big ? 8 : 6
  return (
    <g transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
      <ellipse cx="0" cy="0" rx={r * 0.8} ry={r * 0.36} style={{ fill: 'var(--w-shadow)' }} />
      <rect x="-1" y={-r * 1.1} width="2" height={r * 1.1} style={{ fill: 'var(--w-trunk)' }} />
      <g className="w-sway">
        <circle cx="0" cy={-r * 1.7} r={r} style={{ fill: 'var(--w-tree)' }} />
        <circle cx={-r * 0.3} cy={-r * 1.95} r={r * 0.55} style={{ fill: 'var(--w-tree-2)' }} />
      </g>
    </g>
  )
}

// Relleno de una ranura vacía de galería: algo que le dé vida al piso sin
// sumar gente (la gente es la métrica; los objetos son decorado).
export function SlotProp({ gx, gy, gz, archetype, seed }) {
  const accent = accentOf(archetype)
  if (archetype === 'LOGISTICS' || archetype === 'CONSTRUCTION' || archetype === 'INFRASTRUCTURE') {
    return (
      <g>
        <IsoBox x0={gx - 0.16} y0={gy - 0.16} z0={gz} x1={gx + 0.16} y1={gy + 0.16} z1={gz + 5} top="var(--w-box)" left="var(--w-box)" right="var(--w-trunk)" />
        <IsoBox x0={gx - 0.1} y0={gy - 0.1} z0={gz + 5} x1={gx + 0.12} y1={gy + 0.12} z1={gz + 9} top="var(--w-box)" left="var(--w-box)" right="var(--w-trunk)" />
      </g>
    )
  }
  if (archetype === 'TECH') {
    return <IsoBox x0={gx - 0.14} y0={gy - 0.14} z0={gz} x1={gx + 0.14} y1={gy + 0.14} z1={gz + 14} top="var(--w-desk-top)" left="var(--w-screen)" right="var(--w-desk)" />
  }
  if (archetype === 'RETAIL') {
    return (
      <g>
        <IsoBox x0={gx - 0.22} y0={gy - 0.1} z0={gz} x1={gx + 0.22} y1={gy + 0.1} z1={gz + 10} top="var(--w-desk-top)" left="var(--w-desk)" right="var(--w-desk)" />
        <polygon points={poly([[gx - 0.18, gy + 0.1, gz + 7], [gx + 0.18, gy + 0.1, gz + 7], [gx + 0.18, gy + 0.1, gz + 9], [gx - 0.18, gy + 0.1, gz + 9]])} style={{ fill: accent }} />
      </g>
    )
  }
  // Planta en maceta: el default, y lo que más ayuda a que se vea habitado.
  const [x, y] = iso(gx, gy, gz)
  return (
    <g transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
      <path d="M-2.4,-4 L2.4,-4 L1.8,0 L-1.8,0 Z" style={{ fill: 'var(--w-desk)' }} />
      <g className="w-sway" style={{ animationDelay: `${-(seed % 29) / 10}s` }}>
        <circle cx="0" cy="-7" r="3.4" style={{ fill: 'var(--w-tree-2)' }} />
        <circle cx="-1.6" cy="-8.4" r="2" style={{ fill: 'var(--w-tree)' }} />
      </g>
    </g>
  )
}

// Lo que cuelga en la pared del fondo de un piso. Coordenadas locales del
// plano de la pared: (0,0) arriba a la izquierda, w × h unidades.
export function WallFeature({ archetype, w, h }) {
  const accent = accentOf(archetype)
  const frame = <rect x="0" y="0" width={w} height={h} rx="1" style={{ fill: 'var(--w-window)', stroke: 'var(--w-floor-edge)', strokeWidth: 0.5 }} />
  switch (archetype) {
    case 'BANK': {
      const r = Math.min(w, h) / 2 - 0.6
      return (
        <g>
          <circle cx={w / 2} cy={h / 2} r={r} style={{ fill: 'var(--w-metal)', stroke: accent, strokeWidth: 1.1 }} />
          <circle cx={w / 2} cy={h / 2} r={r * 0.45} style={{ fill: 'var(--w-desk)' }} />
          <path d={`M${w / 2 - r * 0.7},${h / 2} L${w / 2 + r * 0.7},${h / 2} M${w / 2},${h / 2 - r * 0.7} L${w / 2},${h / 2 + r * 0.7}`} style={{ stroke: 'var(--w-desk-top)', strokeWidth: 0.6 }} />
        </g>
      )
    }
    case 'FINANCE':
    case 'GENERIC_CORPORATE': {
      const pts = [0.1, 0.25, 0.4, 0.55, 0.7, 0.9].map((t, i) => `${(t * w).toFixed(1)},${(h * (0.8 - [0, 0.15, 0.1, 0.3, 0.38, 0.6][i])).toFixed(1)}`).join(' ')
      return <g>{frame}<polyline points={pts} style={{ fill: 'none', stroke: accent, strokeWidth: 0.9, strokeLinejoin: 'round' }} /></g>
    }
    case 'TECH':
      return (
        <g>
          {frame}
          {[0.25, 0.45, 0.65].map((t, i) => (
            <rect key={i} x={w * 0.14 + i * 1.5} y={h * t} width={w * (0.5 - i * 0.08)} height="0.9" rx="0.45" style={{ fill: i === 1 ? accent : 'var(--w-screen)' }} />
          ))}
          <circle cx={w * 0.84} cy={h * 0.24} r="0.9" className="w-blink" style={{ fill: accent }} />
        </g>
      )
    case 'CONSTRUCTION':
    case 'INFRASTRUCTURE':
      return (
        <g>
          <rect x="0" y="0" width={w} height={h} rx="1" style={{ fill: accent, opacity: 0.22 }} />
          <path d={`M${w * 0.1},${h * 0.8} L${w * 0.45},${h * 0.35} L${w * 0.9},${h * 0.55} M${w * 0.3},${h * 0.2} L${w * 0.3},${h * 0.85}`} style={{ fill: 'none', stroke: accent, strokeWidth: 0.8 }} />
        </g>
      )
    case 'ENERGY':
      return (
        <g>
          {frame}
          <path d={`M${w * 0.2},${h * 0.75} A${w * 0.3},${w * 0.3} 0 0 1 ${w * 0.8},${h * 0.75}`} style={{ fill: 'none', stroke: accent, strokeWidth: 1 }} />
          <path d={`M${w / 2},${h * 0.75} L${w * 0.68},${h * 0.42}`} style={{ stroke: 'var(--w-metal)', strokeWidth: 0.7 }} />
        </g>
      )
    case 'REAL_ESTATE':
      return (
        <g>
          {frame}
          <path d={`M${w * 0.25},${h * 0.8} L${w * 0.25},${h * 0.48} L${w / 2},${h * 0.25} L${w * 0.75},${h * 0.48} L${w * 0.75},${h * 0.8} Z`} style={{ fill: accent, opacity: 0.85 }} />
        </g>
      )
    case 'RETAIL':
      return (
        <g>
          <rect x="0" y={h * 0.45} width={w} height="0.7" style={{ fill: 'var(--w-desk)' }} />
          <rect x="0" y={h * 0.9} width={w} height="0.7" style={{ fill: 'var(--w-desk)' }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={w * 0.06 + i * w * 0.19} y={h * (i % 2 ? 0.18 : 0.22)} width={w * 0.13} height={h * (i % 2 ? 0.27 : 0.23)} rx="0.4" style={{ fill: i % 2 ? accent : SHIRTS[(i + 2) % SHIRTS.length] }} />
          ))}
        </g>
      )
    case 'HEALTHCARE':
      return (
        <g>
          <rect x="0" y="0" width={w} height={h} rx="1" style={{ fill: 'var(--w-slab-l)', stroke: 'var(--w-floor-edge)', strokeWidth: 0.5 }} />
          <path d={`M${w / 2 - 1},${h * 0.2} h2 v${h * 0.2} h${h * 0.2} v2 h-${h * 0.2} v${h * 0.2} h-2 v-${h * 0.2} h-${h * 0.2} v-2 h${h * 0.2} Z`} style={{ fill: accent }} />
        </g>
      )
    case 'LOGISTICS':
      return (
        <g>
          {frame}
          <path d={`M${w * 0.15},${h * 0.7} Q${w * 0.4},${h * 0.2} ${w * 0.6},${h * 0.55} T${w * 0.88},${h * 0.3}`} style={{ fill: 'none', stroke: accent, strokeWidth: 0.8, strokeDasharray: '1.4 1' }} />
          <circle cx={w * 0.15} cy={h * 0.7} r="1" style={{ fill: accent }} />
          <circle cx={w * 0.88} cy={h * 0.3} r="1" style={{ fill: accent }} />
        </g>
      )
    case 'AGRICULTURE':
      return (
        <g>
          <rect x="0" y={h * 0.78} width={w} height="0.8" style={{ fill: 'var(--w-trunk)' }} />
          {[0.18, 0.42, 0.66, 0.88].map((t, i) => (
            <circle key={i} cx={w * t} cy={h * 0.6} r={h * 0.18} style={{ fill: i % 2 ? 'var(--w-tree)' : 'var(--w-tree-2)' }} />
          ))}
        </g>
      )
    default:
      return frame
  }
}

// Lo que va arriba del techo. (cx, cy) es el centro de la azotea y z su altura.
export function Rooftop({ archetype, ox, oy, fw, fd, z }) {
  const accent = accentOf(archetype)
  const cx = ox + fw / 2
  const cy = oy + fd / 2
  switch (archetype) {
    case 'BANK': {
      const [px, py] = iso(cx + fw * 0.2, cy - fd * 0.2, z)
      return (
        <g>
          <IsoBox x0={cx - fw * 0.22} y0={cy - fd * 0.22} z0={z} x1={cx + fw * 0.12} y1={cy + fd * 0.12} z1={z + 7} top="var(--w-roof)" left="var(--w-side-l)" right="var(--w-side-r)" />
          <polygon points={poly([[cx - fw * 0.22, cy + fd * 0.12, z + 7], [cx + fw * 0.12, cy + fd * 0.12, z + 7], [cx - fw * 0.05, cy + fd * 0.12, z + 11]])} style={{ fill: 'var(--w-slab-l)' }} />
          <g transform={`translate(${px.toFixed(2)},${py.toFixed(2)})`}>
            <rect x="-0.4" y="-22" width="0.8" height="22" style={{ fill: 'var(--w-metal)' }} />
            <g className="w-sway"><path d="M0.4,-22 L8,-19.5 L0.4,-17 Z" style={{ fill: accent }} /></g>
          </g>
        </g>
      )
    }
    case 'TECH':
    case 'FINANCE': {
      const [ax, ay] = iso(cx + fw * 0.15, cy - fd * 0.15, z)
      const [dx, dy] = iso(cx - fw * 0.15, cy + fd * 0.1, z)
      return (
        <g>
          <IsoBox x0={cx - 0.35} y0={cy - 0.25} z0={z} x1={cx + 0.05} y1={cy + 0.15} z1={z + 6} top="var(--w-roof)" left="var(--w-side-l)" right="var(--w-side-r)" />
          {archetype === 'TECH' && (
            <g transform={`translate(${dx.toFixed(2)},${dy.toFixed(2)})`}>
              <rect x="-0.5" y="-6" width="1" height="6" style={{ fill: 'var(--w-metal)' }} />
              <ellipse cx="0" cy="-8" rx="5" ry="2.6" transform="rotate(-25 0 -8)" style={{ fill: 'var(--w-slab-l)', stroke: 'var(--w-metal)', strokeWidth: 0.6 }} />
            </g>
          )}
          <g transform={`translate(${ax.toFixed(2)},${ay.toFixed(2)})`}>
            <path d="M-2.5,0 L0,-26 L2.5,0" style={{ fill: 'none', stroke: 'var(--w-metal)', strokeWidth: 0.7 }} />
            <circle cx="0" cy="-26.5" r="1.4" className="w-blink" style={{ fill: accent }} />
          </g>
        </g>
      )
    }
    case 'ENERGY': {
      const [tx, ty] = iso(cx + fw * 0.2, cy - fd * 0.25, z)
      const panels = [-0.3, 0.15].map((o, i) => (
        <polygon key={i} points={poly([[cx - fw * 0.3 + o, cy + 0.05, z + 1], [cx - fw * 0.3 + o + 0.38, cy + 0.05, z + 1], [cx - fw * 0.3 + o + 0.38, cy + 0.45, z + 4], [cx - fw * 0.3 + o, cy + 0.45, z + 4]])} style={{ fill: accent, opacity: 0.85, stroke: 'var(--w-slab-l)', strokeWidth: 0.4 }} />
      ))
      return (
        <g>
          {panels}
          <g transform={`translate(${tx.toFixed(2)},${ty.toFixed(2)})`}>
            <path d="M-0.8,0 L-0.4,-24 L0.4,-24 L0.8,0 Z" style={{ fill: 'var(--w-slab-l)' }} />
            <g transform="translate(0,-24)">
              <g className="w-spin">
                <path d="M0,0 L1,-10 L0,-11 Z M0,0 L8.7,4.6 L9.4,5.6 Z M0,0 L-9.4,4.4 L-9.9,5.5 Z" style={{ fill: 'var(--w-slab-l)', stroke: 'var(--w-metal)', strokeWidth: 0.3 }} />
              </g>
              <circle cx="0" cy="0" r="1" style={{ fill: accent }} />
            </g>
          </g>
        </g>
      )
    }
    case 'CONSTRUCTION':
    case 'INFRASTRUCTURE': {
      const [mx, my] = iso(cx - fw * 0.15, cy - fd * 0.15, z)
      return (
        <g transform={`translate(${mx.toFixed(2)},${my.toFixed(2)})`}>
          <path d="M-1.4,0 L-1.4,-30 L1.4,-30 L1.4,0" style={{ fill: 'none', stroke: accent, strokeWidth: 0.9 }} />
          <path d="M-1.4,-4 L1.4,-8 M-1.4,-12 L1.4,-16 M-1.4,-20 L1.4,-24" style={{ stroke: accent, strokeWidth: 0.6 }} />
          <g transform="translate(0,-30)">
            <g className="w-swing">
              <path d="M-7,0 L28,0 M-7,0 L0,-5 L28,0" style={{ fill: 'none', stroke: accent, strokeWidth: 0.9 }} />
              <rect x="-8" y="-1" width="5" height="3" style={{ fill: 'var(--w-metal)' }} />
              <path d="M22,0 L22,9" style={{ stroke: 'var(--w-metal)', strokeWidth: 0.5 }} />
              <rect x="20" y="9" width="4" height="3" style={{ fill: 'var(--w-box)' }} />
            </g>
          </g>
        </g>
      )
    }
    case 'REAL_ESTATE':
    case 'AGRICULTURE': {
      const items = [[-0.3, -0.25], [0.25, -0.1], [-0.1, 0.3]]
      return (
        <g>
          {archetype === 'AGRICULTURE' && (
            <g>
              <IsoBox x0={cx - fw * 0.3} y0={cy - fd * 0.3} z0={z} x1={cx + fw * 0.05} y1={cy + fd * 0.05} z1={z + 9} top="var(--w-glass)" left="var(--w-glass)" right="var(--w-glass)" stroke="var(--w-glass-edge)" />
              <polygon points={poly([[cx - fw * 0.3, cy + fd * 0.05, z], [cx + fw * 0.05, cy + fd * 0.05, z], [cx + fw * 0.05, cy + fd * 0.05, z + 4], [cx - fw * 0.3, cy + fd * 0.05, z + 4]])} style={{ fill: 'var(--w-tree-2)', opacity: 0.8 }} />
            </g>
          )}
          {items.map(([dx, dy], i) => (
            <g key={i}>
              <IsoBox x0={cx + dx * fw * 0.6 + 0.2} y0={cy + dy * fd * 0.6 + 0.15} z0={z} x1={cx + dx * fw * 0.6 + 0.6} y1={cy + dy * fd * 0.6 + 0.45} z1={z + 2.5} top="var(--w-trunk)" left="var(--w-side-l)" right="var(--w-side-r)" />
              <Tree gx={cx + dx * fw * 0.6 + 0.4} gy={cy + dy * fd * 0.6 + 0.3} gz={z + 2.5} big={false} />
            </g>
          ))}
        </g>
      )
    }
    case 'RETAIL': {
      return (
        <g>
          <g transform={planeY(cx - fw * 0.35, cy + fd * 0.1, z + 16)}>
            <rect x="0" y="0" width={fw * 0.7 * 18} height="12" rx="1.4" style={{ fill: accent }} />
            <rect x="3" y="4" width={fw * 0.7 * 18 - 6} height="1.4" rx="0.7" style={{ fill: 'var(--w-slab-l)' }} />
            <rect x="3" y="7" width={fw * 0.4 * 18} height="1.4" rx="0.7" style={{ fill: 'var(--w-slab-l)', opacity: 0.7 }} />
          </g>
          <path d={`M${iso(cx - fw * 0.25, cy + fd * 0.1, z).join(',')} L${iso(cx - fw * 0.25, cy + fd * 0.1, z + 4).join(',')} M${iso(cx + fw * 0.25, cy + fd * 0.1, z).join(',')} L${iso(cx + fw * 0.25, cy + fd * 0.1, z + 4).join(',')}`} style={{ stroke: 'var(--w-metal)', strokeWidth: 0.8 }} />
        </g>
      )
    }
    case 'HEALTHCARE':
      return (
        <g transform={planeZ(cx - 0.6, cy - 0.6, z + 0.2)}>
          <circle cx="10.8" cy="10.8" r="9.5" style={{ fill: 'var(--w-slab-r)', stroke: accent, strokeWidth: 0.9 }} />
          <path d="M7,6 L7,15.6 M14.6,6 L14.6,15.6 M7,10.8 L14.6,10.8" style={{ stroke: accent, strokeWidth: 1.4 }} />
        </g>
      )
    case 'LOGISTICS':
      return (
        <g>
          <IsoBox x0={cx - fw * 0.3} y0={cy - fd * 0.2} z0={z} x1={cx + fw * 0.1} y1={cy + fd * 0.05} z1={z + 6} top={accent} left={accent} right="var(--w-trunk)" />
          <IsoBox x0={cx - fw * 0.3} y0={cy + fd * 0.08} z0={z} x1={cx + fw * 0.1} y1={cy + fd * 0.3} z1={z + 6} top="var(--w-box)" left="var(--w-box)" right="var(--w-trunk)" />
        </g>
      )
    default: {
      return (
        <g>
          <IsoBox x0={cx - 0.45} y0={cy - 0.35} z0={z} x1={cx - 0.05} y1={cy + 0.05} z1={z + 5} top="var(--w-desk-top)" left="var(--w-side-l)" right="var(--w-side-r)" />
          <IsoBox x0={cx + 0.1} y0={cy - 0.4} z0={z} x1={cx + 0.45} y1={cy - 0.1} z1={z + 4} top="var(--w-desk-top)" left="var(--w-side-l)" right="var(--w-side-r)" />
          <IsoBox x0={cx - 0.2} y0={cy + 0.2} z0={z} x1={cx + 0.2} y1={cy + 0.55} z1={z + 9} top="var(--w-metal)" left="var(--w-side-l)" right="var(--w-side-r)" />
        </g>
      )
    }
  }
}

// Un objeto en el lote, del lado izquierdo-frontal del edificio.
export function PlotProp({ archetype, gx, gy }) {
  const accent = accentOf(archetype)
  if (archetype === 'CONSTRUCTION' || archetype === 'INFRASTRUCTURE') {
    return (
      <g>
        {[0, 0.35].map((o, i) => {
          const [x, y] = iso(gx + o, gy, 0)
          return <path key={i} d={`M${(x - 2).toFixed(2)},${y.toFixed(2)} L${x.toFixed(2)},${(y - 6).toFixed(2)} L${(x + 2).toFixed(2)},${y.toFixed(2)} Z`} style={{ fill: accent }} />
        })}
      </g>
    )
  }
  if (archetype === 'LOGISTICS') {
    return (
      <g>
        <IsoBox x0={gx - 0.2} y0={gy - 0.15} z0={0} x1={gx + 0.45} y1={gy + 0.15} z1={8} top="var(--w-slab-l)" left="var(--w-slab-l)" right="var(--w-slab-r)" />
        <IsoBox x0={gx + 0.45} y0={gy - 0.15} z0={0} x1={gx + 0.7} y1={gy + 0.15} z1={6} top={accent} left={accent} right="var(--w-side-r)" />
      </g>
    )
  }
  if (archetype === 'AGRICULTURE' || archetype === 'ENERGY') {
    return (
      <g transform={planeZ(gx - 0.3, gy - 0.3, 0.3)}>
        {[0, 4, 8].map((v) => (
          <rect key={v} x="0" y={v} width="13" height="2.4" rx="1" style={{ fill: archetype === 'ENERGY' ? accent : 'var(--w-tree-2)', opacity: 0.85 }} />
        ))}
      </g>
    )
  }
  // Banca de parque: lo genérico que no miente sobre el negocio.
  return (
    <g>
      <IsoBox x0={gx - 0.25} y0={gy - 0.06} z0={2.5} x1={gx + 0.25} y1={gy + 0.08} z1={3.5} top="var(--w-trunk)" left="var(--w-trunk)" right="var(--w-trunk)" />
      <Tree gx={gx + 0.55} gy={gy - 0.1} big={false} />
    </g>
  )
}

export function Lamp({ gx, gy }) {
  const [x, y] = iso(gx, gy, 0)
  return (
    <g transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
      <ellipse cx="0" cy="0" rx="5" ry="2.2" style={{ fill: 'var(--w-lamp-glow)' }} />
      <rect x="-0.45" y="-15" width="0.9" height="15" style={{ fill: 'var(--w-metal)' }} />
      <circle cx="0" cy="-15.5" r="1.5" style={{ fill: 'var(--w-window-lit)' }} />
    </g>
  )
}
