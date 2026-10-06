'use client'

// La ciudad entera: isla, calles, parques y un edificio por institución.
// Hacer clic en un edificio lo acerca y abre su detalle; clic en el fondo o
// Esc lo cierra. Las animaciones se pausan cuando la escena no está a la vista.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { layoutWorld, maxColsForWidth, focusTransform, CELL, PLATFORM_THICKNESS } from '@/lib/worldLayout'
import { formatCompact } from '@/components/dashboard/utils'
import { archetypeLabel } from '@/lib/worldModel'
import { accentOf } from '@/lib/worldPalette'
import { poly } from './isoDraw'
import { IsoBox, Tree } from './WorldPieces'
import WorldBuilding from './WorldBuilding'
import InstitutionPanel from './InstitutionPanel'

const PANEL_W = 360
const WIDE = 900

export default function WorldScene({ world, lang, baseCurrency }) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const wrapRef = useRef(null)
  const sceneRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [paused, setPaused] = useState(false)
  const [selected, setSelected] = useState(null)
  const [hoveredFloor, setHoveredFloor] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = sceneRef.current
    if (!el) return
    let visible = true
    const update = () => setPaused(!visible || document.hidden)
    let io = null
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; update() }, { threshold: 0.02 })
      io.observe(el)
    }
    document.addEventListener('visibilitychange', update)
    return () => { if (io) io.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])

  const maxCols = maxColsForWidth(width || 1000)
  const layout = useMemo(() => layoutWorld(world.buildings, { maxCols }), [world.buildings, maxCols])
  const vb = layout.viewBox
  const wide = width >= WIDE
  // En un teléfono los rótulos flotantes se amontonan y el de arriba se corta:
  // ahí van como una leyenda tocable debajo de la escena.
  const floatLabels = width >= 640

  // Una selección que ya no existe (borraste la cuenta) se suelta sola.
  const selectedBuilding = selected ? world.buildings.find((b) => b.key === selected) : null
  const selectedPlacement = selected ? layout.placements.find((p) => p.key === selected) : null

  const zoom = useMemo(() => {
    if (!selectedPlacement) return { tx: 0, ty: 0, s: 1 }
    const frac = wide ? Math.max(0.4, (width - PANEL_W - 24) / width) : 1
    return focusTransform(vb, selectedPlacement.bbox, { fx: frac / 2, frac, maxScale: wide ? 2.6 : 2.2 })
  }, [selectedPlacement, vb, wide, width])

  const onSelect = useCallback((key) => {
    setHoveredFloor(null)
    setSelected((cur) => (cur === key ? null : key))
  }, [])
  const close = useCallback(() => { setSelected(null); setHoveredFloor(null) }, [])

  // Atrás hacia adelante: lo de las filas/columnas más lejanas primero.
  const drawables = useMemo(() => {
    const out = []
    layout.placements.forEach((p, i) => out.push({ kind: 'b', depth: p.c + p.r, i, p }))
    layout.parks.forEach((pk) => pk.trees.forEach((tr, j) => out.push({ kind: 't', depth: pk.c + pk.r + (tr.gx + tr.gy) / 1000, tr, key: `t${pk.c}-${pk.r}-${j}` })))
    return out.sort((a, b) => a.depth - b.depth)
  }, [layout])

  const { W, D, pad, cols, rows } = layout
  const roads = []
  for (let c = 1; c < cols; c++) roads.push({ k: `c${c}`, pts: [[c * CELL - 0.25, -pad], [c * CELL + 0.25, -pad], [c * CELL + 0.25, D + pad], [c * CELL - 0.25, D + pad]], line: [[c * CELL, -pad], [c * CELL, D + pad]] })
  for (let r = 1; r < rows; r++) roads.push({ k: `r${r}`, pts: [[-pad, r * CELL - 0.25], [W + pad, r * CELL - 0.25], [W + pad, r * CELL + 0.25], [-pad, r * CELL + 0.25]], line: [[-pad, r * CELL], [W + pad, r * CELL]] })

  const focused = !!selectedBuilding
  const scene = (
    <div
      ref={sceneRef}
      className="world-scene relative rounded-2xl overflow-hidden"
      data-paused={paused ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
      style={{ border: '1px solid var(--card-border)' }}
    >
      <div className="relative w-full" style={{ aspectRatio: `${vb.w.toFixed(1)} / ${vb.h.toFixed(1)}`, maxHeight: wide ? 720 : undefined }}>
        <svg
          viewBox={`${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`}
          className="absolute inset-0 w-full h-full"
          role="img"
          aria-label={t('Tu portafolio como ciudad: un edificio por institución', 'Your portfolio as a city: one building per institution')}
          onClick={close}
        >
          <defs>
            <filter id="w-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
          </defs>
          <g className="w-zoom" style={{ transform: `translate(${zoom.tx.toFixed(2)}px, ${zoom.ty.toFixed(2)}px) scale(${zoom.s.toFixed(4)})` }}>
            <IsoBox x0={-pad} y0={-pad} z0={-PLATFORM_THICKNESS} x1={W + pad} y1={D + pad} z1={0} top="var(--w-ground)" left="var(--w-ground-l)" right="var(--w-ground-r)" />
            {roads.map((rd) => (
              <g key={rd.k}>
                <polygon points={poly(rd.pts)} style={{ fill: 'var(--w-road)' }} />
                <polyline points={poly(rd.line)} style={{ fill: 'none', stroke: 'var(--w-street-line)', strokeWidth: 0.6, strokeDasharray: '4 4' }} />
              </g>
            ))}
            {layout.parks.map((pk) => (
              <polygon key={`pk${pk.c}-${pk.r}`} points={poly([[pk.c * CELL + 0.6, pk.r * CELL + 0.6], [pk.c * CELL + CELL - 0.6, pk.r * CELL + 0.6], [pk.c * CELL + CELL - 0.6, pk.r * CELL + CELL - 0.6], [pk.c * CELL + 0.6, pk.r * CELL + CELL - 0.6]])} style={{ fill: 'var(--w-park)' }} />
            ))}
            {drawables.map((d) => {
              if (d.kind === 't') return <Tree key={d.key} gx={d.tr.gx} gy={d.tr.gy} big={d.tr.big} />
              const b = world.buildings[d.i]
              return (
                <WorldBuilding
                  key={b.key}
                  building={b}
                  placement={d.p}
                  selected={selected === b.key}
                  highlightFloor={selected === b.key ? hoveredFloor : null}
                  onSelect={onSelect}
                  ariaLabel={`${b.name || t('Sin institución', 'No institution')}, ${formatCompact(b.value, baseCurrency)}`}
                />
              )
            })}
          </g>
        </svg>

        {/* Rótulos en HTML (texto nítido en cualquier zoom), anclados por % del
            viewBox. Se esconden al enfocar: ahí manda el panel. */}
        {!focused && floatLabels && layout.placements.map((p, i) => {
          const b = world.buildings[i]
          const left = ((p.labelAnchor[0] - vb.x) / vb.w) * 100
          const top = ((p.labelAnchor[1] - vb.y) / vb.h) * 100
          return (
            <button
              key={p.key}
              onClick={(e) => { e.stopPropagation(); onSelect(b.key) }}
              tabIndex={-1}
              aria-hidden="true"
              className="absolute px-2 py-1 rounded-lg text-left whitespace-nowrap"
              style={{ left: `${left}%`, top: `${top}%`, transform: 'translate(-50%, -100%)', background: 'var(--w-label-bg)', boxShadow: '0 1px 4px var(--w-shadow)', maxWidth: 180 }}
            >
              <span className="block text-micro font-semibold truncate" style={{ color: 'var(--w-label-text)' }}>{b.name || t('Sin institución', 'No institution')}</span>
              <span className="block text-micro tabular-nums" style={{ color: 'var(--w-label-sub)' }}>{formatCompact(b.value, baseCurrency)} · {(b.share * 100).toFixed(0)}%</span>
            </button>
          )
        })}

        {focused && (
          <button onClick={close}
            className="absolute left-3 top-3 px-3 py-1.5 rounded-lg text-caption font-medium"
            style={{ background: 'var(--w-label-bg)', color: 'var(--w-label-text)', boxShadow: '0 1px 4px var(--w-shadow)' }}>
            {t('Ver toda la ciudad', 'Back to the city')}
          </button>
        )}

        {wide && selectedBuilding && (
          <div className="absolute top-3 right-3 bottom-3 overflow-y-auto" style={{ width: PANEL_W }}>
            <InstitutionPanel building={selectedBuilding} lang={lang} baseCurrency={baseCurrency}
              onClose={close} hoveredFloor={hoveredFloor} onHoverFloor={setHoveredFloor} />
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div ref={wrapRef} className="flex flex-col gap-4">
      {scene}
      {!floatLabels && !selectedBuilding && (
        <div className="grid grid-cols-2 gap-2">
          {world.buildings.map((b) => (
            <button key={b.key} onClick={() => onSelect(b.key)}
              className="card p-3 text-left flex items-start gap-2 min-w-0">
              <span className="w-2 h-2 mt-1.5 rounded-full shrink-0" style={{ background: accentOf(b.archetype) }} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-caption font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{b.name || t('Sin institución', 'No institution')}</span>
                <span className="block text-micro tabular-nums" style={{ color: 'var(--text-muted)' }}>{formatCompact(b.value, baseCurrency)} · {(b.share * 100).toFixed(0)}%</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {!wide && selectedBuilding && (
        <InstitutionPanel building={selectedBuilding} lang={lang} baseCurrency={baseCurrency}
          onClose={close} hoveredFloor={hoveredFloor} onHoverFloor={setHoveredFloor} />
      )}
      {/* Lo mismo en texto, para lector de pantalla. */}
      <ul className="sr-only">
        {world.buildings.map((b) => (
          <li key={b.key}>
            {b.name || t('Sin institución', 'No institution')}: {formatCompact(b.value, baseCurrency)}, {archetypeLabel(b.archetype, lang)}, {b.departments.length} {t('pisos', 'floors')}
          </li>
        ))}
      </ul>
    </div>
  )
}
