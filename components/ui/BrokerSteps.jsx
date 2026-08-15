'use client'

// Numbered step-by-step "how do I get this" panel, shared by the CSV import flow
// (FileImportModal) and the API connect flow (ConnectionsModal) so both read
// from the same researched data (lib/brokerHowTo.js) instead of a one-line
// summary each. Renders as a connected journey (StepJourney) so every broker's
// instructions read the same way as the post-connect completion checklist
// (BrokerCompletionModal) instead of looking like two unrelated UIs (FASE DT).

import { FileSpreadsheet, KeyRound } from 'lucide-react'
import StepJourney from './StepJourney'

export default function BrokerSteps({ steps, note, variant = 'csv', lang = 'es', title = null, collapsible = false, defaultOpen = false }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const accent = variant === 'api' ? 'var(--accent-blue)' : 'var(--accent-green)'
  const Icon = variant === 'api' ? KeyRound : FileSpreadsheet
  // title={false} suppresses the header entirely (a caller that already draws
  // its own heading around this list, e.g. a collapsible "De dónde salen
  // estos números" wrapper); omitting `title` still falls back to the default.
  const heading = title === false ? null : (title || (variant === 'api'
    ? t('Cómo conseguir tu clave de API', 'How to get your API key')
    : t('Cómo obtener el archivo', 'How to get the file')))

  return (
    <StepJourney steps={steps} note={note} variant={variant} lang={lang} title={heading} accent={accent} headerIcon={Icon}
      collapsible={collapsible} defaultOpen={defaultOpen} />
  )
}
