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
import { Search, Sparkles, ChevronRight, ListChecks, ListOrdered, Building2 } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { getItemValue, formatCurrency } from './utils'

export default function EnrichModal({
  items = [], findings = [], lang = 'es', onClose,
  onPickAccount, onPickInstitution, onGuided, contributionWarning = false,
  onBrokerChecklist, hasBroker = false,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  const [mode, setMode] = useState(null) // null = chooser, 'pick' = institution/account list
  const [query, setQuery] = useState('')

  const gapsByItem = useMemo(() => {
    const m = new Map()
    for (const f of findings) {
      if (!f.itemId) continue
      m.set(f.itemId, (m.get(f.itemId) || 0) + 1)
    }
    return m
  }, [findings])

  // Grouped by institution, not by account: a broker/bank is usually where the
  // gap actually lives (one missing statement affects every position under
  // it), so fixing "IDC" as a unit beats clicking into VITALI, then Fondo
  // Líquido, then whatever else IDC holds, one at a time. Institutions with
  // gaps first, then by total value, so the one that moves your number most
  // is never buried.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byInst = new Map()
    for (const it of items) {
      if (q && !`${it.name || ''} ${it.symbol || ''} ${it.institution || ''}`.toLowerCase().includes(q)) continue
      const key = it.institution || t('Sin institución', 'No institution')
      if (!byInst.has(key)) byInst.set(key, [])
      byInst.get(key).push(it)
    }
    return [...byInst.entries()]
      .map(([name, its]) => ({
        name, items: its,
        gaps: its.reduce((s, it) => s + (gapsByItem.get(it.id) || 0), 0),
        total: its.reduce((s, it) => s + Math.abs(getItemValue(it)), 0),
      }))
      .sort((a, b) => (b.gaps - a.gaps) || (b.total - a.total))
  }, [items, query, gapsByItem, lang])

  const [openGroup, setOpenGroup] = useState(null)

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
                  {t('Una institución en específico', 'One specific institution')}
                </span>
                <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {t('Elige un banco o broker y revisa TODO lo que tiene ahí: fechas, costos, movimientos.', 'Pick a bank or broker and go through everything it holds: dates, costs, movements.')}
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
            {/* One door, not two: "transcribir por trimestre" and "copiar
                retornos" are steps 3 and 4 of the SAME numbered checklist
                (lib/brokerCompletion.js), which also shows what is already
                done. Splitting them here just meant re-explaining the same
                365-day limit twice. */}
            {hasBroker && onBrokerChecklist && (
              <button type="button" onClick={() => { onClose(); onBrokerChecklist() }}
                className="w-full flex items-start gap-3 p-3.5 rounded-xl text-left transition-colors hover:bg-theme-elevated"
                style={{ border: '1px solid var(--card-border)' }}>
                <ListOrdered size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent-blue)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('Llevar tu broker al 100%', 'Get your broker to 100%')}
                  </span>
                  <span className="block text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {t('Tu broker solo exporta ~12 meses: los pasos para completar lo de antes.', 'Your broker only exports ~12 months: the steps to fill in what came before.')}
                  </span>
                </span>
                <ChevronRight size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
              </button>
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
                  placeholder={t('Buscar institución o cuenta', 'Search institution or account')}
                  className="flex-1 bg-transparent outline-none text-body"
                  style={{ color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="px-3 pb-4 overflow-y-auto">
              {groups.length === 0 && (
                <p className="px-2 py-6 text-center text-body" style={{ color: 'var(--text-muted)' }}>
                  {t('Ninguna institución coincide.', 'No institution matches.')}
                </p>
              )}
              {groups.map((g) => {
                const isOpen = openGroup === g.name
                return (
                  <div key={g.name} className="mb-1">
                    <button type="button" onClick={() => setOpenGroup(isOpen ? null : g.name)}
                      className="w-full flex items-center justify-between gap-3 px-2.5 py-2.5 rounded-lg text-left transition-colors hover:bg-theme-elevated">
                      <span className="min-w-0 flex items-center gap-2">
                        <Building2 size={15} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
                        <span className="min-w-0">
                          <span className="block text-body font-medium truncate" style={{ color: 'var(--text-primary)' }}>{g.name}</span>
                          <span className="block text-micro truncate" style={{ color: 'var(--text-muted)' }}>
                            {g.items.length} {g.items.length === 1 ? t('activo', 'asset') : t('activos', 'assets')}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 flex items-center gap-2">
                        {g.gaps > 0 && (
                          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                            {g.gaps}
                          </span>
                        )}
                        <span className="text-body font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {formatCurrency(g.total)}
                        </span>
                        <ChevronRight size={14} className={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} style={{ color: 'var(--text-muted)' }} />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="pl-6 pb-1.5 space-y-0.5">
                        {onPickInstitution && g.items.length > 1 && (
                          <button type="button" onClick={() => { onClose(); onPickInstitution(g.name, g.items) }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-theme-elevated"
                            style={{ color: 'var(--accent-blue)' }}>
                            <ListChecks size={14} className="shrink-0" />
                            <span className="text-micro font-medium">
                              {t(`Revisar las ${g.items.length} de una vez`, `Review all ${g.items.length} at once`)}
                            </span>
                          </button>
                        )}
                        {g.items.map((it) => {
                          const gaps = gapsByItem.get(it.id) || 0
                          return (
                            <button key={it.id} type="button"
                              onClick={() => { onClose(); onPickAccount && onPickAccount(it) }}
                              className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-theme-elevated">
                              <span className="min-w-0 text-body truncate" style={{ color: 'var(--text-secondary)' }}>
                                {it.name || it.symbol}
                              </span>
                              <span className="shrink-0 flex items-center gap-2">
                                {gaps > 0 && (
                                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                                    style={{ backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
                                    {gaps}
                                  </span>
                                )}
                                <span className="text-micro font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                                  {formatCurrency(getItemValue(it))}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
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
