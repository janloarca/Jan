'use client'

// El detalle de una institución al enfocarla. Las cifras salen tal cual del
// modelo (valor en la moneda base, % del portafolio, % de la institución):
// el dibujo puede ser una metáfora, este panel no.
import { useState } from 'react'
import { X, ChevronDown } from 'lucide-react'
import { archetypeLabel } from '@/lib/worldModel'
import { accentOf } from '@/lib/worldPalette'
import { formatCurrency } from '@/components/dashboard/utils'
import { useEscClose } from '@/hooks/useEscClose'

const SOURCE_LABELS = {
  override: { es: 'Elegido por ti', en: 'Set by you' },
  notes: { es: 'Según tus notas', en: 'From your notes' },
  name: { es: 'Por el nombre', en: 'From the name' },
  sector: { es: 'Por el sector', en: 'From the sector' },
  type: { es: 'Por el tipo de activo', en: 'From the asset type' },
  default: { es: 'Sin pistas: corporativo', en: 'No clues: corporate' },
  grouped: { es: 'Agrupadas', en: 'Grouped' },
}

const pct = (v) => `${(v * 100).toFixed(v > 0 && v < 0.01 ? 2 : 1)}%`

export default function InstitutionPanel({ building, lang, baseCurrency, onClose, hoveredFloor, onHoverFloor, className = '' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [openOther, setOpenOther] = useState(false)
  useEscClose(onClose, true)

  const floors = building.departments.map((d, i) => ({ ...d, floor: i + 1 })).reverse()
  const name = building.name || t('Sin institución', 'No institution')

  return (
    <aside
      className={`card p-4 sm:p-5 flex flex-col gap-3 ${className}`}
      aria-label={t(`Detalle de ${name}`, `${name} details`)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-h2 font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{name}</h2>
          <span className="inline-flex items-center gap-1.5 mt-1 text-caption" style={{ color: 'var(--text-secondary)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: accentOf(building.archetype) }} aria-hidden="true" />
            {archetypeLabel(building.archetype, lang)}
          </span>
        </div>
        <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg border transition-colors"
          style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}>
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-3 sm:col-span-1">
          <div className="text-caption" style={{ color: 'var(--text-muted)' }}>{t('Invertido', 'Invested')}</div>
          <div className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(building.value, baseCurrency)}</div>
        </div>
        <div>
          <div className="text-caption" style={{ color: 'var(--text-muted)' }}>{t('Del portafolio', 'Of portfolio')}</div>
          <div className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{pct(building.share)}</div>
        </div>
        <div>
          <div className="text-caption" style={{ color: 'var(--text-muted)' }}>{t('Inversiones', 'Investments')}</div>
          <div className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{building.itemCount}</div>
        </div>
      </div>

      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        {t(
          `${building.workerCount} ${building.workerCount === 1 ? 'persona trabaja' : 'personas trabajan'} aquí: es una forma de dibujar el tamaño, no un dato.`,
          `${building.workerCount} ${building.workerCount === 1 ? 'person works' : 'people work'} here: a way of drawing size, not a number.`
        )}
      </p>

      <div>
        <h3 className="card-title mb-1.5">{t('Pisos', 'Floors')}</h3>
        <ul className="flex flex-col">
          {floors.map((d) => {
            const isOther = d.source === 'grouped'
            const active = hoveredFloor === d.id
            return (
              <li key={d.id}>
                <div
                  className="flex items-center gap-2 py-2 px-2 -mx-2 rounded-lg transition-colors"
                  style={{ background: active ? 'var(--bg-card-hover)' : undefined }}
                  onMouseEnter={() => onHoverFloor(d.id)}
                  onMouseLeave={() => onHoverFloor(null)}
                >
                  <span className="text-micro tabular-nums w-10 shrink-0" style={{ color: 'var(--text-muted)' }}>{t('Piso', 'Floor')} {d.floor}</span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accentOf(d.archetype) }} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-body truncate" style={{ color: 'var(--text-primary)' }}>{d.label}</div>
                    <div className="text-micro truncate" style={{ color: 'var(--text-muted)' }}>
                      {archetypeLabel(d.archetype, lang)} · {(SOURCE_LABELS[d.source] || SOURCE_LABELS.default)[lang === 'es' ? 'es' : 'en']}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-body tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(d.value, baseCurrency)}</div>
                    <div className="text-micro tabular-nums" style={{ color: 'var(--text-muted)' }}>{pct(d.share)}</div>
                  </div>
                  {isOther && (
                    <button onClick={() => setOpenOther((v) => !v)} aria-expanded={openOther}
                      aria-label={t('Ver posiciones agrupadas', 'Show grouped holdings')}
                      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md" style={{ color: 'var(--text-muted)' }}>
                      <ChevronDown size={14} style={{ transform: openOther ? 'rotate(180deg)' : undefined, transition: 'transform var(--dur-fast) var(--ease-out)' }} />
                    </button>
                  )}
                </div>
                {isOther && openOther && (
                  <ul className="ml-12 mb-1 flex flex-col gap-1">
                    {d.items.map((it) => (
                      <li key={it.id} className="flex items-center justify-between gap-2 text-micro">
                        <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{it.label}</span>
                        <span className="tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>{formatCurrency(it.value, baseCurrency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <p className="text-micro" style={{ color: 'var(--text-muted)' }}>
        {t('El tipo de cada piso sale de tus notas, el nombre o el sector. Puedes cambiarlo en Editar cuenta.',
          'Each floor type comes from your notes, the name or the sector. You can change it in Edit account.')}
      </p>
    </aside>
  )
}
