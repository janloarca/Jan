'use client'

// Un edificio de World: una institución. Zócalo con puerta, un piso por
// inversión (galería de vidrio alrededor de un núcleo, ver lib/worldLayout),
// techo con un remate según el tipo de negocio, y su lote con farol.
//
// El tamaño lo decide el capital (escalón en lib/worldModel), la gente es una
// metáfora acotada, y nada de lo que se dibuja acá cambia un número.
import { memo } from 'react'
import { GALLERY, PLINTH, ROOF, PLOT_MARGIN, gallerySlots } from '@/lib/worldLayout'
import { accentOf } from '@/lib/worldPalette'
import { poly, planeY, planeX } from './isoDraw'
import { IsoBox, Worker, Desk, SlotProp, WallFeature, Rooftop, RoofMark, PlotProp, Lamp } from './WorldPieces'
import { markFor } from '@/lib/worldMarks'

const SL = 3 // grosor de cada losa
const HAT_TYPES = new Set(['CONSTRUCTION', 'INFRASTRUCTURE', 'ENERGY'])

function floorScene({ floor, dept, ox, oy, fw, fd, highlighted }) {
  const D = GALLERY
  const z0 = floor.z0
  const zf = z0 + SL
  const zt = z0 + floor.h
  const accent = accentOf(dept.archetype)
  const xi = ox + fw - D // borde del núcleo en gx
  const yi = oy + fd - D // borde del núcleo en gy

  // Franja visible de la pared del fondo: por arriba la tapa la losa del piso
  // siguiente, así que lo que cuelga en la pared vive en la banda baja.
  const fh = Math.max(5, Math.min(12, floor.h - SL - 18))
  const wl = Math.min(15, (fw - D) * 18 - 5)
  const wr = Math.min(15, (fd - D) * 18 - 5)

  const slots = gallerySlots(ox, oy, fw, fd)
  const k = Math.min(dept.workers.length, slots.length)
  const used = new Set()
  for (let i = 0; i < k; i++) used.add(Math.floor(((i + 0.5) * slots.length) / k))

  const things = []
  let w = 0
  slots.forEach((s, idx) => {
    const isL = s.strip === 'L'
    const at = (off) => (isL ? { gx: s.along, gy: s.base + off } : { gx: s.base + off, gy: s.along })
    const dir = isL ? 'x' : 'y'
    if (used.has(idx)) {
      const wk = dept.workers[w++]
      const center = s.n === 1 ? 0 : (s.i / (s.n - 1)) - 0.5
      const sign = center > 0 ? -1 : 1
      if (wk.pose === 'desk') {
        const p = at(0.24)
        const q = at(0.56)
        things.push({ depth: p.gx + p.gy, el: <Worker key={wk.id} {...p} gz={zf} seed={wk.seed} pose="desk" hat={false} dir={dir} /> })
        things.push({ depth: q.gx + q.gy + 0.01, el: <Desk key={`${wk.id}-d`} {...q} gz={zf} dir={dir} /> })
      } else {
        const p = at(wk.pose === 'screen' ? 0.22 : 0.5)
        things.push({ depth: p.gx + p.gy, el: <Worker key={wk.id} {...p} gz={zf} seed={wk.seed} pose={wk.pose} hat={HAT_TYPES.has(dept.archetype)} dir={dir} sign={sign} /> })
      }
    } else if (things.length < 14 && (idx % 2 === 1 || k === 0)) {
      const p = at(0.3)
      things.push({ depth: p.gx + p.gy, el: <SlotProp key={`p${idx}`} {...p} gz={zf} archetype={dept.archetype} seed={idx * 7 + k} /> })
    }
  })
  things.sort((a, b) => a.depth - b.depth)

  const mullions = []
  for (let g = 0.6; g < fw - 0.05; g += 0.6) mullions.push(poly([[ox + g, oy + fd, zf], [ox + g, oy + fd, zt]]))
  for (let g = 0.6; g < fd - 0.05; g += 0.6) mullions.push(poly([[ox + fw, oy + g, zf], [ox + fw, oy + g, zt]]))

  const glassL = poly([[ox, oy + fd, zf], [ox + fw, oy + fd, zf], [ox + fw, oy + fd, zt], [ox, oy + fd, zt]])
  const glassR = poly([[ox + fw, oy, zf], [ox + fw, oy + fd, zf], [ox + fw, oy + fd, zt], [ox + fw, oy, zt]])
  const glassStyle = highlighted
    ? { fill: accent, fillOpacity: 0.16, stroke: accent, strokeWidth: 1.2 }
    : { fill: 'var(--w-glass)', stroke: 'var(--w-glass-edge)', strokeWidth: 0.4 }

  return (
    <g key={floor.id}>
      {/* Losa: el canto lleva el color del tipo de esa inversión. */}
      <IsoBox x0={ox} y0={oy} z0={z0} x1={ox + fw} y1={oy + fd} z1={zf} top="var(--w-floor)" left="var(--w-slab-l)" right="var(--w-slab-r)" />
      <polygon points={poly([[ox, oy + fd, z0 + 0.7], [ox + fw, oy + fd, z0 + 0.7], [ox + fw, oy + fd, z0 + 1.7], [ox, oy + fd, z0 + 1.7]])} style={{ fill: accent }} />
      <polygon points={poly([[ox + fw, oy, z0 + 0.7], [ox + fw, oy + fd, z0 + 0.7], [ox + fw, oy + fd, z0 + 1.7], [ox + fw, oy, z0 + 1.7]])} style={{ fill: accent, opacity: 0.8 }} />
      {/* Piso de la galería, con un baño tenue del color del tipo. */}
      <polygon points={poly([[ox, yi, zf], [xi, yi, zf], [xi, oy, zf], [ox + fw, oy, zf], [ox + fw, oy + fd, zf], [ox, oy + fd, zf]])} style={{ fill: accent, fillOpacity: 0.07 }} />
      <polygon points={poly([[ox, yi, zf], [xi, yi, zf], [xi, oy, zf], [ox + fw, oy, zf], [ox + fw, oy + fd, zf], [ox, oy + fd, zf]])} style={{ fill: 'var(--w-interior)' }} />
      {/* Núcleo: las dos paredes que dan a la galería. */}
      <polygon points={poly([[ox, yi, zf], [xi, yi, zf], [xi, yi, zt], [ox, yi, zt]])} style={{ fill: 'var(--w-wall-l)' }} />
      <polygon points={poly([[xi, oy, zf], [xi, yi, zf], [xi, yi, zt], [xi, oy, zt]])} style={{ fill: 'var(--w-wall-r)' }} />
      {wl > 6 && (
        <g transform={planeY(ox + ((fw - D) * 18 - wl) / 36, yi, zf + 3 + fh)}>
          <WallFeature archetype={dept.archetype} w={wl} h={fh} />
        </g>
      )}
      {wr > 6 && (
        <g transform={planeX(xi, oy + ((fd - D) * 18 - wr) / 36, zf + 3 + fh)}>
          <WallFeature archetype={dept.archetype} w={wr} h={fh} />
        </g>
      )}
      {things.map((t) => t.el)}
      {/* Vidrio, parteluces, baranda a la altura de la cintura. */}
      <polygon points={glassL} style={glassStyle} />
      <polygon points={glassR} style={glassStyle} />
      {mullions.map((m, i) => <polyline key={i} points={m} style={{ fill: 'none', stroke: 'var(--w-glass-edge)', strokeWidth: 0.35 }} />)}
      <polyline points={poly([[ox, oy + fd, zf + 7], [ox + fw, oy + fd, zf + 7], [ox + fw, oy, zf + 7]])} style={{ fill: 'none', stroke: 'var(--w-post)', strokeWidth: 0.6 }} />
      <polyline points={poly([[ox + fw, oy + fd, zf], [ox + fw, oy + fd, zt]])} style={{ fill: 'none', stroke: 'var(--w-post)', strokeWidth: 1.1 }} />
    </g>
  )
}

function WorldBuildingImpl({ building, placement, selected, highlightFloor, onSelect, ariaLabel }) {
  const { ox, oy, fw, fd, floors, top } = placement
  const accent = accentOf(building.archetype)
  const M = PLOT_MARGIN
  const deptById = new Map(building.departments.map((d) => [d.id, d]))

  const plot = poly([[ox - M, oy - M, 0], [ox + fw + M, oy - M, 0], [ox + fw + M, oy + fd + M, 0], [ox - M, oy + fd + M, 0]])
  const shadow = poly([[ox + 0.05, oy - 0.25, 0], [ox + fw + 0.55, oy - 0.25, 0], [ox + fw + 0.55, oy + fd + 0.2, 0], [ox + 0.05, oy + fd + 0.2, 0]])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(building.key) }
  }

  return (
    <g
      className="w-building"
      data-selected={selected ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={(e) => { e.stopPropagation(); onSelect(building.key) }}
      onKeyDown={onKeyDown}
    >
      <polygon className="w-plot" points={plot} style={{ fill: 'var(--w-plot)', stroke: 'var(--w-plot-edge)', strokeWidth: 0.6 }} />
      <polygon points={shadow} style={{ fill: 'var(--w-shadow)', filter: 'url(#w-soft)' }} />
      <PlotProp archetype={building.archetype} gx={ox - 0.45} gy={oy + fd + 0.45} />

      {/* Zócalo: el lobby, con puerta y vitrina. */}
      <IsoBox x0={ox} y0={oy} z0={0} x1={ox + fw} y1={oy + fd} z1={PLINTH} top="var(--w-roof)" left="var(--w-side-l)" right="var(--w-side-r)" />
      <g transform={planeY(ox, oy + fd, PLINTH - 0.6)}>
        <rect x={fw * 9 - 4} y="0" width="8" height={PLINTH - 0.6} rx="0.6" style={{ fill: 'var(--w-window)' }} />
        <rect x={fw * 9 - 0.25} y="0.6" width="0.5" height={PLINTH - 1.4} style={{ fill: 'var(--w-glass-edge)' }} />
      </g>
      <g transform={planeX(ox + fw, oy, PLINTH - 1.4)}>
        <rect x="2.5" y="0" width={fd * 18 - 5} height={PLINTH - 2.8} rx="0.6" style={{ fill: 'var(--w-window)' }} />
      </g>

      {floors.map((f) => {
        const dept = deptById.get(f.id)
        if (!dept) return null
        return floorScene({ floor: f, dept, ox, oy, fw, fd, highlighted: highlightFloor === f.id })
      })}

      {/* Techo con banda de color y su remate. */}
      <IsoBox x0={ox} y0={oy} z0={top} x1={ox + fw} y1={oy + fd} z1={top + ROOF} top="var(--w-roof)" left="var(--w-side-l)" right="var(--w-side-r)" />
      <polygon points={poly([[ox, oy + fd, top + ROOF - 2.2], [ox + fw, oy + fd, top + ROOF - 2.2], [ox + fw, oy + fd, top + ROOF - 0.9], [ox, oy + fd, top + ROOF - 0.9]])} style={{ fill: accent }} />
      <polygon points={poly([[ox + fw, oy, top + ROOF - 2.2], [ox + fw, oy + fd, top + ROOF - 2.2], [ox + fw, oy + fd, top + ROOF - 0.9], [ox + fw, oy, top + ROOF - 0.9]])} style={{ fill: accent, opacity: 0.8 }} />
      <polygon points={poly([[ox + 0.12, oy + 0.12, top + ROOF], [ox + fw - 0.12, oy + 0.12, top + ROOF], [ox + fw - 0.12, oy + fd - 0.12, top + ROOF], [ox + 0.12, oy + fd - 0.12, top + ROOF]])} style={{ fill: 'none', stroke: 'var(--w-floor-edge)', strokeWidth: 0.5 }} />
      <Rooftop archetype={building.archetype} ox={ox} oy={oy} fw={fw} fd={fd} z={top + ROOF} />
      <RoofMark mark={markFor(building.archetype, building.variant)} archetype={building.archetype} ox={ox} oy={oy} fw={fw} fd={fd} z={top + ROOF} />

      <Lamp gx={ox + fw + M * 0.6} gy={oy + fd + M * 0.6} />
    </g>
  )
}

const WorldBuilding = memo(WorldBuildingImpl)
export default WorldBuilding
