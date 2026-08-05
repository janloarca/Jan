'use client'

// "Completar información" — the door into enriching what the app knows.
//
// This used to be a line of small print under the YTD figure on the net worth
// card ("para un retorno más preciso, agrega tus depósitos y retiros"), which
// is the worst possible place for it: it nags from inside the headline number
// and offers exactly one narrow fix. It now lives behind the same "Nuevo"
// button as every other way of getting data in, and it asks the only question
// that matters first: do you already know which account needs work, or do you
// want Chispu to tell you.

import { useState, useMemo } from 'react'
import { Search, Sparkles, ChevronRight, ListChecks, CalendarRange, Percent } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { getItemValue, formatCurrency } from './utils'

export default function EnrichModal({
  items = [], findings = [], lang = 'es', onClose,
  onPickAccount, onGuided, contributionWarning = false,
  onQuarterlyHistory, onCalibrate, hasBroker = false,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  const [mode, setMode] = useState(null) // null = chooser, 'pick' = account list
  const [query, setQuery] = useState('')

  const gapsByItem = useMemo(() => {
    const m = new Map()
    for (const f of findings) {
      if (!f.itemId) continue
      m.set(f.itemId, (m.get(f.itemId) || 0) + 1)
    }
    return m
  }, [findings])

  // Accounts with gaps first (that is the whole point of being here), then by
  // size, so the position that moves your number most is never buried.
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...items]
      .filter((it) => {
        if (!q) return true
        return `${it.name || ''} ${it.symbol || ''} ${it.institution || ''}`.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        const ga = gapsByItem.get(a.id) || 0
        const gb = gapsByItem.get(b.id) || 0
        if (ga !== gb) return gb - ga
        return Math.abs(getItemValue(b)) - Math.abs(getItemValue(a))
      })
  }, [items, query, gapsByItem])

  const withGaps = useMemo(() => items.filter((it) => gapsByItem.get(it.id)).length, [items, gapsByItem])
  const guidedCount = withGaps + (contributionWarning ? 1 : 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div ref={trapRef} className="rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}>

        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {mode === 'pick' ? t('¿Cuál cuenta?', 'Which account?') : t('Completar información', 'Complete your data')}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {mode === 'pick'
                ? t('Las que tienen huecos van primero.', 'The ones with gaps come first.')
                : t('Mientras más completo, más real es tu rendimiento.', 'The more complete it is, the more real your return.')}
            </p>
          </div>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
            className="text-xl leading-none shrink-0" style={{ color: 'var(--text-muted)' }}>&times;</button>
        </div>

        {mode === null && (
          <div className="px-5 pb-5 space-y-2.5">
            <button type="button" onClick={() => setMode('pick')}
              className="w-full flex items-start gap-3 p-3.5 rounded-xl text-left transition-colors hover:bg-theme-elevated"
              style={{ border: '1px solid var(--card-border)' }}>
              <ListChecks size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent-blue)' }} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t('Una cuenta en específico', 'One specific account')}
                </span>
                <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {t('Tú eliges cuál y la revisas a fondo: fechas, costos, movimientos.', 'You pick it and go through it: dates, costs, movements.')}
                </span>
              </span>
              <ChevronRight size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
            </button>

            <button type="button" onClick={() => { onClose(); onGuided && onGuided() }}
              className="w-full flex items-start gap-3 p-3.5 rounded-xl text-left transition-colors hover:bg-theme-elevated"
              style={{ border: '1px solid var(--card-border)' }}>
              <Sparkles size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent-blue)' }} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium" style={{ color: 'var(--text-primary)' }}>
                  {t('Que Chispu me vaya recomendando', 'Let Chispu guide me')}
                </span>
                <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {guidedCount > 0
                    ? t(`Encontró ${guidedCount} ${guidedCount === 1 ? 'hueco' : 'huecos'}. Te lleva por ellos, del que más pesa al que menos.`,
                        `Found ${guidedCount} ${guidedCount === 1 ? 'gap' : 'gaps'}. It walks you through them, heaviest first.`)
                    : t('Revisa tus cuentas una por una y te dice qué le falta a cada una.', 'Goes account by account and tells you what each one is missing.')}
                </span>
              </span>
              {guidedCount > 0 && (
                <span className="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                  {guidedCount}
                </span>
              )}
            </button>

            {/* The two doors that only make sense once a broker is connected:
                a Flex Query stops at 365 days, so anything older is either
                transcribed by quarter or leaned on via the broker's own
                percentages. Hidden entirely when there is no broker, since
                neither has anything to attach to. */}
            {hasBroker && (onQuarterlyHistory || onCalibrate) && (
              <>
                <p className="text-micro pt-2 pb-0.5" style={{ color: 'var(--text-muted)' }}>
                  {t('Tu broker solo deja exportar los últimos 12 meses. Lo de antes:', 'Your broker only exports the last 12 months. Anything older:')}
                </p>
                {onQuarterlyHistory && (
                  <button type="button" onClick={() => { onClose(); onQuarterlyHistory() }}
                    className="w-full flex items-start gap-3 p-3.5 rounded-xl text-left transition-colors hover:bg-theme-elevated"
                    style={{ border: '1px solid var(--card-border)' }}>
                    <CalendarRange size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent-blue)' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('Transcribir el historial por trimestre', 'Transcribe the history by quarter')}
                      </span>
                      <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {t('Unos 4 números por año, leídos de Portfolio Analyst. Te decimos dónde están.', 'About 4 numbers per year, read off Portfolio Analyst. We show you where they are.')}
                      </span>
                    </span>
                    <ChevronRight size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
                {onCalibrate && (
                  <button type="button" onClick={() => { onClose(); onCalibrate() }}
                    className="w-full flex items-start gap-3 p-3.5 rounded-xl text-left transition-colors hover:bg-theme-elevated"
                    style={{ border: '1px solid var(--card-border)' }}>
                    <Percent size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent-blue)' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('Copiar los retornos que muestra tu broker', 'Copy the returns your broker shows')}
                      </span>
                      <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {t('1W, 1M, 3M, YTD, 1Y y desde el inicio. Cada uno ancla la curva en su fecha.', '1W, 1M, 3M, YTD, 1Y and since inception. Each one anchors the curve at its own date.')}
                      </span>
                    </span>
                    <ChevronRight size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                  </button>
                )}
              </>
            )}

            {contributionWarning && (
              <p className="text-micro pt-1" style={{ color: 'var(--text-muted)' }}>
                {t('Tu patrimonio creció bastante con pocos depósitos registrados. Si metiste dinero nuevo y no está anotado, tu rendimiento se ve más alto de lo que fue.',
                   'Your net worth grew a lot with few deposits logged. If you added new money that is not recorded, your return looks higher than it was.')}
              </p>
            )}
          </div>
        )}

        {mode === 'pick' && (
          <>
            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 px-3 h-9 rounded-lg"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--card-border)' }}>
                <Search size={14} style={{ color: 'var(--text-muted)' }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                  placeholder={t('Buscar cuenta', 'Search account')}
                  className="flex-1 bg-transparent outline-none text-body"
                  style={{ color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="px-3 pb-4 overflow-y-auto">
              {sorted.length === 0 && (
                <p className="px-2 py-6 text-center text-body" style={{ color: 'var(--text-muted)' }}>
                  {t('Ninguna cuenta coincide.', 'No account matches.')}
                </p>
              )}
              {sorted.map((it) => {
                const gaps = gapsByItem.get(it.id) || 0
                return (
                  <button key={it.id} type="button"
                    onClick={() => { onClose(); onPickAccount && onPickAccount(it) }}
                    className="w-full flex items-center justify-between gap-3 px-2.5 py-2.5 rounded-lg text-left transition-colors hover:bg-theme-elevated">
                    <span className="min-w-0">
                      <span className="block text-body truncate" style={{ color: 'var(--text-primary)' }}>
                        {it.name || it.symbol}
                      </span>
                      <span className="block text-micro truncate" style={{ color: 'var(--text-muted)' }}>
                        {it.institution || it.type || ''}
                      </span>
                    </span>
                    <span className="shrink-0 flex items-center gap-2">
                      {gaps > 0 && (
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                          {gaps}
                        </span>
                      )}
                      <span className="text-body font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {formatCurrency(getItemValue(it))}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="px-5 py-3" style={{ borderTop: '1px solid var(--card-border)' }}>
              <button type="button" onClick={() => setMode(null)}
                className="text-body" style={{ color: 'var(--accent-blue)' }}>
                {t('Volver', 'Back')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
