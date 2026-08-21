'use client'

// El tab Compartir de Ajustes, extraído de SettingsModal en FASE KP: el modal
// pasaba de 1100 líneas y todo lo que viene (fichas de instrumento, expiración,
// idioma por link, edición de links) vive aquí, no ahí.
//
// Extracción de comportamiento congelado, con UNA diferencia deliberada: el
// estado vive ahora en este componente, que se monta solo con el tab activo,
// así que RE-ENTRAR al tab vuelve a pedir la lista (antes persistía en el
// modal). Es una lectura del doc settings/share por visita al tab, autenticada
// y barata, y llegar con la lista fresca es correcto.
//
// Dos arreglos de paso, ninguno de comportamiento nuevo:
// - `scopeChip` no tenía rama para `portfolio` (bug de FASE KK): un link
//   escopado a portafolio se etiquetaba "Todo el portafolio".
// - Las dos filas de chips (alcance, números) pasan a SegmentedTabs, la regla
//   del repo para "elegí uno de N" desde FASE JT.

import { useState, useEffect, useCallback } from 'react'
import { Link2, FileText } from 'lucide-react'
import { authFetch, safeJson } from '@/lib/authFetch'
import { formatDate } from '@/components/dashboard/utils'
import { useInstruments } from '@/hooks/useInstruments'
import BusyLabel from '@/components/ui/BusyLabel'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import InstrumentSheetsManager from '@/components/settings/InstrumentSheetsManager'

export default function ShareTab({
  lang = 'es',
  entities = [],
  portfolios = [],
  portfolioItems = [],
  activePortfolio = '__all__',
  flash = () => {},
}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const [shareLinks, setShareLinks] = useState(null) // null = not loaded yet
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(null) // token just copied
  const [shareCreating, setShareCreating] = useState(false)
  // FASE KK. `portfolioId` arranca en el portafolio ACTIVO: compartir por
  // default lo que uno tiene en pantalla es menos sorprendente que compartir
  // toda la cuenta, que es lo que 'all' significa.
  const defaultSharePortfolio = activePortfolio && activePortfolio !== '__all__' ? activePortfolio : ''
  const EMPTY_FORM = { label: '', scopeType: 'all', entityId: '', portfolioId: defaultSharePortfolio, institutions: [], display: 'both', expiry: 'never', lang: 'es', instrumentIds: [] }
  const [shareForm, setShareForm] = useState(EMPTY_FORM)
  // Edición por fila (FASE KP): corregir la etiqueta o las fichas adjuntas de
  // un link que el cliente YA tiene, sin re-crearlo. Solo eso: alcance,
  // números, idioma y vigencia son inmutables después de crear (el servidor
  // también lo exige).
  const [editingToken, setEditingToken] = useState(null)
  const [editLabel, setEditLabel] = useState('')
  const [editIds, setEditIds] = useState([])
  // Las fichas de instrumento del asesor (el teaser de un producto), para
  // adjuntarlas a un link. El manager las edita; acá solo se eligen.
  const { instruments, saveInstrument, deleteInstrument } = useInstruments()
  const [managerOpen, setManagerOpen] = useState(false)

  const shareApi = useCallback(async (payload) => {
    const res = await authFetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await safeJson(res)
    if (!res.ok) throw new Error(data?.error || 'Error')
    return data
  }, [])

  useEffect(() => {
    if (shareLinks !== null) return
    setShareLoading(true)
    shareApi({ action: 'list' })
      .then((d) => setShareLinks(d.links || []))
      .catch(() => setShareLinks([]))
      .finally(() => setShareLoading(false))
  }, [shareLinks, shareApi])

  const shareUrlFor = (token) => `${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${token}`

  const copyShareLink = (token) => {
    navigator.clipboard.writeText(shareUrlFor(token))
    setShareCopied(token)
    setTimeout(() => setShareCopied(null), 2000)
  }

  const handleCreateShare = async () => {
    setShareLoading(true)
    try {
      const scope = shareForm.scopeType === 'entity'
        ? { type: 'entity', entityId: shareForm.entityId, entityName: (entities || []).find((e) => e.id === shareForm.entityId)?.name || '' }
        : shareForm.scopeType === 'portfolio'
          ? { type: 'portfolio', portfolioId: shareForm.portfolioId, portfolioName: (portfolios || []).find((p) => p.id === shareForm.portfolioId)?.name || '' }
        : shareForm.scopeType === 'institutions'
          ? { type: 'institutions', institutions: shareForm.institutions }
          : { type: 'all' }
      const { link } = await shareApi({
        action: 'create', label: shareForm.label, scope, display: shareForm.display,
        lang: shareForm.lang, expiry: shareForm.expiry, instrumentIds: shareForm.instrumentIds,
      })
      setShareLinks((prev) => [...(prev || []), link])
      setShareCreating(false)
      setShareForm(EMPTY_FORM)
      copyShareLink(link.token)
      flash('ok', t('Link creado y copiado', 'Link created and copied'))
    } catch (e) { flash('err', e.message) }
    setShareLoading(false)
  }

  const handleRevokeShare = async (token) => {
    setShareLoading(true)
    try {
      await shareApi({ action: 'revoke', token })
      setShareLinks((prev) => (prev || []).filter((l) => l.token !== token))
      flash('ok', t('Link revocado', 'Link revoked'))
    } catch (e) { flash('err', e.message) }
    setShareLoading(false)
  }

  const handleUpdateShare = async (token) => {
    const label = editLabel.trim()
    setShareLoading(true)
    try {
      const { link } = await shareApi({ action: 'update', token, ...(label ? { label } : {}), instrumentIds: editIds })
      setShareLinks((prev) => (prev || []).map((l) => (l.token === token ? link : l)))
      setEditingToken(null)
      flash('ok', t('Link actualizado', 'Link updated'))
    } catch (e) { flash('err', e.message) }
    setShareLoading(false)
  }

  const toggleId = (id, list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const institutionOptions = [...new Set(portfolioItems.map((it) => (it.institution || '').trim()).filter(Boolean))].sort()
  const scopeChip = (scope) => {
    if (scope?.type === 'entity') return `👥 ${scope.entityName || t('Entidad', 'Entity')}`
    if (scope?.type === 'portfolio') return `📈 ${scope.portfolioName || t('Un portafolio', 'One portfolio')}`
    if (scope?.type === 'institutions') return `🏦 ${(scope.institutions || []).join(', ')}`
    return `📊 ${t('Todo el portafolio', 'Whole portfolio')}`
  }
  const displayChip = (display) => {
    if (display === 'percent') return ` · 👁 ${t('solo %', '% only')}`
    if (display === 'amounts') return ` · 👁 ${t('solo montos', 'amounts only')}`
    return ''
  }
  // El idioma solo se anota cuando NO es el default: una fila sin anotación es
  // un link en español, que es lo que casi todos son.
  const langChip = (l) => (l === 'en' ? ' · EN' : '')
  const sheetsChip = (link) => (link.instrumentIds?.length
    ? ` · 📄 ${link.instrumentIds.length} ${link.instrumentIds.length === 1 ? t('ficha', 'sheet') : t('fichas', 'sheets')}`
    : '')

  // Helper de render (función, no componente: un componente definido inline se
  // re-crea en cada render y REMONTA su subárbol). Elige qué fichas lleva un
  // link; el tope de 6 es el mismo que el servidor exige.
  const renderSheetPicker = (selected, onToggle) => instruments.length === 0 ? null : (
    <div>
      <label className="text-xs text-slate-500 mb-1 block">{t('Fichas de instrumento adjuntas (opcional)', 'Attached instrument sheets (optional)')}</label>
      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
        {instruments.map((ins) => (
          <label key={ins.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-theme-elevated cursor-pointer">
            <input type="checkbox" checked={selected.includes(ins.id)} onChange={() => onToggle(ins.id)}
              disabled={!selected.includes(ins.id) && selected.length >= 6} />
            <span className="text-xs text-white truncate">{ins.name}</span>
            {ins.rating?.grade && <span className="text-micro shrink-0" style={{ color: 'var(--accent-blue)' }}>{ins.rating.grade}</span>}
          </label>
        ))}
      </div>
    </div>
  )
  const expiryLine = (link) => {
    if (!link?.expiresAt) return null
    const ts = Date.parse(link.expiresAt)
    if (!isFinite(ts)) return null
    const when = formatDate(link.expiresAt)
    return ts < Date.now()
      ? { text: t(`Venció el ${when}`, `Expired ${when}`), expired: true }
      : { text: t(`Vence el ${when}`, `Expires ${when}`), expired: false }
  }
  const toggleInst = (inst) => setShareForm((p) => ({
    ...p,
    institutions: p.institutions.includes(inst) ? p.institutions.filter((i) => i !== inst) : [...p.institutions, inst],
  }))
  const canCreate = shareForm.scopeType === 'all'
    || (shareForm.scopeType === 'entity' && shareForm.entityId)
    || (shareForm.scopeType === 'portfolio' && shareForm.portfolioId)
    || (shareForm.scopeType === 'institutions' && shareForm.institutions.length > 0)

  const scopeTabs = [
    { key: 'all', label: t('Todo', 'Everything') },
    ...(entities && entities.length > 1 ? [{ key: 'entity', label: t('Una entidad', 'One entity') }] : []),
    ...(portfolios && portfolios.length > 1 ? [{ key: 'portfolio', label: t('Un portafolio', 'One portfolio') }] : []),
    ...(institutionOptions.length > 0 ? [{ key: 'institutions', label: t('Cuentas específicas', 'Specific accounts') }] : []),
  ]
  const displayTabs = [
    { key: 'both', label: t('Montos y %', 'Amounts & %') },
    { key: 'amounts', label: t('Solo montos', 'Amounts only') },
    { key: 'percent', label: t('Solo % (oculta montos)', '% only (hides amounts)') },
  ]
  const expiryTabs = [
    { key: 'never', label: t('Indefinido', 'No expiry') },
    { key: '30d', label: t('30 días', '30 days') },
    { key: '90d', label: t('90 días', '90 days') },
    { key: '1y', label: t('1 año', '1 year') },
  ]
  const langTabs = [
    { key: 'es', label: 'Español' },
    { key: 'en', label: 'English' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}>
          <Link2 size={15} style={{ color: 'var(--accent-blue)' }} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{t('Links de solo lectura', 'Read-only links')}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{t(
            'Comparte tu portafolio completo con un asesor, o solo una parte: una entidad o cuentas específicas (ej. solo tu IBKR). Cada link es independiente y se puede revocar sin tocar los demás. Nunca revelan la institución de tus activos.',
            'Share your whole portfolio with an advisor, or just a slice: one entity or specific accounts (e.g. only your IBKR). Each link is independent and can be revoked without touching the others. They never reveal the institution behind your assets.'
          )}</p>
        </div>
      </div>

      {/* Existing links */}
      {shareLinks === null || (shareLoading && !shareLinks?.length && !shareCreating) ? (
        <p className="text-xs text-slate-500">…</p>
      ) : shareLinks.length === 0 && !shareCreating ? (
        <p className="text-xs text-slate-600">{t('Aún no has creado ningún link.', 'You haven\'t created any links yet.')}</p>
      ) : (
        <div className="space-y-1.5">
          {shareLinks.map((link) => {
            const exp = expiryLine(link)
            return (
              <div key={link.token} className="p-3 bg-theme-base border border-glass-border rounded-xl">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    {editingToken === link.token ? (
                      <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} maxLength={40} autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateShare(link.token)
                          if (e.key === 'Escape') setEditingToken(null)
                        }}
                        className="w-full px-2 py-1 bg-theme-surface border border-glass-border/60 rounded-md text-sm text-white focus:outline-none focus:border-blue-500/50" />
                    ) : (
                      <p className="text-sm text-white font-medium truncate">{link.label || t('Sin nombre', 'Untitled')}</p>
                    )}
                    <p className="text-xs text-slate-500 truncate">{scopeChip(link.scope)}{displayChip(link.display)}{langChip(link.lang)}{sheetsChip(link)}</p>
                    {exp && (
                      <p className="text-xs truncate" style={{ color: exp.expired ? 'var(--alert-warn-icon)' : 'var(--text-muted)' }}>{exp.text}</p>
                    )}
                    {editingToken === link.token && (
                      <div className="mt-2">{renderSheetPicker(editIds, (id) => setEditIds((p) => toggleId(id, p)))}</div>
                    )}
                  </div>
                  {editingToken === link.token ? (
                    <>
                      <button onClick={() => handleUpdateShare(link.token)} disabled={shareLoading}
                        className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                        <BusyLabel busy={shareLoading} lang={lang}>{t('Guardar', 'Save')}</BusyLabel>
                      </button>
                      <button onClick={() => setEditingToken(null)}
                        className="shrink-0 px-2 py-1 text-xs transition-colors" style={{ color: 'var(--text-secondary)' }}>
                        {t('Cancelar', 'Cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingToken(link.token); setEditLabel(link.label || ''); setEditIds(link.instrumentIds || []) }}
                        aria-label={t('Editar', 'Edit')} title={t('Editar', 'Edit')}
                        className="shrink-0 px-2 py-1 text-xs hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
                        ✎
                      </button>
                      <button onClick={() => copyShareLink(link.token)}
                        className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                        {shareCopied === link.token ? t('¡Copiado!', 'Copied!') : t('Copiar', 'Copy')}
                      </button>
                      <button onClick={() => handleRevokeShare(link.token)} disabled={shareLoading} aria-label={t('Revocar', 'Revoke')}
                        className="shrink-0 px-2 py-1 text-xs hover:opacity-100 transition-opacity" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create flow */}
      {shareCreating ? (
        <div className="space-y-3 p-3 bg-theme-base border border-glass-border rounded-xl">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('Nombre del link (para ti)', 'Link name (for you)')}</label>
            <input value={shareForm.label} onChange={(e) => setShareForm((p) => ({ ...p, label: e.target.value }))}
              placeholder={t('Ej: Para mi contador', 'E.g. For my accountant')} maxLength={40}
              className="w-full px-3 py-1.5 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('¿Qué compartes?', 'What are you sharing?')}</label>
            <SegmentedTabs tabs={scopeTabs} value={shareForm.scopeType}
              onChange={(key) => setShareForm((p) => ({ ...p, scopeType: key }))}
              deps={[lang]} ariaLabel={t('Alcance del link', 'Link scope')} />
            {shareForm.scopeType !== 'all' && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('La gráfica de crecimiento no se incluye: el historial guardado es del patrimonio completo, no de una parte.', 'The growth chart is left out: the saved history is of the whole net worth, not of one slice.')}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('¿Qué números verán?', 'Which numbers will they see?')}</label>
            <SegmentedTabs tabs={displayTabs} value={shareForm.display}
              onChange={(key) => setShareForm((p) => ({ ...p, display: key }))}
              deps={[lang]} ariaLabel={t('Números visibles', 'Visible numbers')} />
            {shareForm.display === 'percent' && (
              <p className="text-xs text-slate-600 mt-1">{t('Verán el desempeño y la asignación en %, sin ningún monto de dinero.', 'They\'ll see performance and allocation in %, without any money amounts.')}</p>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('Vigencia', 'Expiry')}</label>
            <SegmentedTabs tabs={expiryTabs} value={shareForm.expiry}
              onChange={(key) => setShareForm((p) => ({ ...p, expiry: key }))}
              deps={[lang]} ariaLabel={t('Vigencia del link', 'Link expiry')} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('Indefinido es lo normal: la página siempre muestra su fecha de corte, y puedes revocar cuando quieras.', 'No expiry is the norm: the page always shows its as-of date, and you can revoke anytime.')}
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t('Idioma de la página', 'Page language')}</label>
            <SegmentedTabs tabs={langTabs} value={shareForm.lang}
              onChange={(key) => setShareForm((p) => ({ ...p, lang: key }))}
              deps={[lang]} ariaLabel={t('Idioma del link', 'Link language')} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('Quien lo abra puede cambiarlo desde la propia página.', 'Whoever opens it can switch it from the page itself.')}
            </p>
          </div>

          {renderSheetPicker(shareForm.instrumentIds, (id) => setShareForm((p) => ({ ...p, instrumentIds: toggleId(id, p.instrumentIds) })))}

          {shareForm.scopeType === 'portfolio' && (
            <select value={shareForm.portfolioId} onChange={(e) => setShareForm((p) => ({ ...p, portfolioId: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white focus:outline-none">
              <option value="">{t('- Elige el portafolio -', '- Pick the portfolio -')}</option>
              {(portfolios || []).map((pf) => (
                <option key={pf.id} value={pf.id}>{pf.icon || '\u{1F4C8}'} {pf.name}</option>
              ))}
            </select>
          )}

          {shareForm.scopeType === 'entity' && (
            <select value={shareForm.entityId} onChange={(e) => setShareForm((p) => ({ ...p, entityId: e.target.value }))}
              className="w-full px-3 py-2 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white focus:outline-none">
              <option value="">{t('- Elige la entidad -', '- Pick the entity -')}</option>
              {(entities || []).map((en) => (
                <option key={en.id} value={en.id}>{en.icon || '📁'} {en.name}</option>
              ))}
            </select>
          )}

          {shareForm.scopeType === 'institutions' && (
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              <p className="text-xs text-slate-600">{t('Solo se compartirán las posiciones de lo que marques:', 'Only positions from what you check will be shared:')}</p>
              {institutionOptions.map((inst) => (
                <label key={inst} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-theme-elevated cursor-pointer">
                  <input type="checkbox" checked={shareForm.institutions.includes(inst)} onChange={() => toggleInst(inst)} />
                  <span className="text-xs text-white">{inst}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleCreateShare} disabled={shareLoading || !canCreate}
              className="flex-1 py-2 rounded-lg hover:bg-emerald-500 disabled:opacity-50 text-xs font-medium" style={{ color: '#ffffff', backgroundColor: 'var(--accent-green)' }}>
              {<BusyLabel busy={shareLoading} lang={lang}>{t('Crear y copiar link', 'Create & copy link')}</BusyLabel>}
            </button>
            <button onClick={() => setShareCreating(false)}
              className="px-3 py-2 border border-glass-border text-xs rounded-lg hover:bg-theme-elevated transition-colors" style={{ color: 'var(--text-secondary)' }}>
              {t('Cancelar', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShareCreating(true)}
          className="w-full px-3 py-2.5 text-xs font-medium text-slate-400 border border-dashed border-glass-border rounded-xl hover:text-blue-400 hover:border-blue-500/30 transition-colors">
          + {t('Crear link para compartir', 'Create share link')}
        </button>
      )}

      {/* Las fichas de instrumento: el teaser de un producto que el asesor
          adjunta al link de su cliente. El manager vive acá porque este tab es
          la superficie del asesor. */}
      <button onClick={() => setManagerOpen(true)}
        className="w-full px-3 py-2.5 text-xs font-medium text-slate-400 border border-glass-border rounded-xl hover:text-blue-400 hover:border-blue-500/30 transition-colors inline-flex items-center justify-center gap-1.5">
        <FileText size={13} strokeWidth={2} />
        {t('Fichas de instrumento', 'Instrument sheets')}{instruments.length > 0 ? ` (${instruments.length})` : ''}
      </button>

      <p className="text-xs text-slate-600">{t(
        'Los links no vencen salvo que elijas una vigencia al crearlos; puedes revocarlos cuando quieras.',
        "Links don't expire unless you pick a duration when creating them; you can revoke them anytime."
      )}</p>

      {managerOpen && (
        <InstrumentSheetsManager lang={lang} instruments={instruments}
          onSave={saveInstrument} onDelete={deleteInstrument}
          onClose={() => setManagerOpen(false)} flash={flash} />
      )}
    </div>
  )
}
