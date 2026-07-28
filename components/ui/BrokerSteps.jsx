'use client'

// Numbered step-by-step "how do I get this" panel, shared by the CSV import flow
// (FileImportModal) and the API connect flow (ConnectionsModal) so both read
// from the same researched data (lib/brokerHowTo.js) instead of a one-line
// summary each. variant picks the accent + heading; steps/note are pre-resolved
// bilingual pairs.

import { FileSpreadsheet, KeyRound, Info } from 'lucide-react'

export default function BrokerSteps({ steps, note, variant = 'csv', lang = 'es', title = null }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  if (!steps || steps.length === 0) return null

  const accent = variant === 'api' ? 'var(--accent-blue)' : 'var(--accent-green)'
  const Icon = variant === 'api' ? KeyRound : FileSpreadsheet
  const heading = title || (variant === 'api'
    ? t('Cómo conseguir tu clave de API', 'How to get your API key')
    : t('Cómo obtener el archivo', 'How to get the file'))

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${accent}33`, backgroundColor: `${accent}0d` }}>
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <Icon size={14} style={{ color: accent }} />
        <span className="text-xs font-semibold" style={{ color: accent }}>{heading}</span>
      </div>
      <ol className="px-3 pb-3">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5 py-1">
            <span
              className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
              style={{ backgroundColor: accent, color: 'var(--bg-card)' }}
            >
              {i + 1}
            </span>
            <span className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {lang === 'es' ? step.es : step.en}
            </span>
          </li>
        ))}
      </ol>
      {note && (
        <div className="flex items-start gap-2 mx-3 mb-3 px-2.5 py-2 rounded-lg text-[11px] leading-relaxed"
          style={{ backgroundColor: 'var(--alert-info-bg)', color: 'var(--text-muted)' }}>
          <Info size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--alert-info-icon)' }} />
          <span>{lang === 'es' ? note.es : note.en}</span>
        </div>
      )}
    </div>
  )
}
