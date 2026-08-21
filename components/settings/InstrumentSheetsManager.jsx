'use client'

// FASE KP. El editor de fichas de instrumento del asesor: donde se captura el
// teaser de un producto (nombre, rating, características, riesgos, link al
// prospecto) para adjuntarlo a los links de cliente. Compuesto de patrones que
// ya existen: el envoltorio de modal de PriceAlertsModal (fondo, Esc, foco
// atrapado), lista CRUD estilo EntityManager, y filas repetibles label/valor
// para las características. TODO lo que se guarda pasa por
// sanitizeInstrumentInput (lib/instrumentSheet.js), la misma frontera de topes
// que valida el resto del sistema.

import { useState, useEffect } from 'react'
import { X, Plus, Pencil, Trash2, FileText } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { sanitizeInstrumentInput, sanitizeUrl, LIMITS } from '@/lib/instrumentSheet'
import BusyLabel from '@/components/ui/BusyLabel'

const EMPTY_FORM = {
  name: '', ratingGrade: '', ratingAgency: '', summary: '',
  heroFacts: [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }],
  highlightsText: '',
  // El monto mínimo va de PRIMERA fila a propósito: es lo primero que un
  // cliente busca en un teaser (así lo imprimen los teasers reales de IDC).
  terms: [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }],
  description: '', risks: '', disclaimer: '', externalUrl: '',
}

const TERM_PLACEHOLDERS = [
  ['Monto mínimo', 'Q10,000.00'],
  ['Tasa', '8% anual'],
  ['Plazo', '10 años'],
]

export default function InstrumentSheetsManager({ lang = 'es', onClose, instruments = [], onSave, onDelete, flash = () => {} }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const trapRef = useFocusTrap()
  const [editing, setEditing] = useState(null) // null = lista; '' = nueva; id = editar
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const startNew = () => { setForm(EMPTY_FORM); setEditing('') }
  const startEdit = (ins) => {
    const pad = (rows, n) => {
      const out = (rows || []).map((r) => ({ label: r.label || '', value: r.value || '' }))
      while (out.length < n) out.push({ label: '', value: '' })
      return out
    }
    setForm({
      name: ins.name || '',
      ratingGrade: ins.rating?.grade || '',
      ratingAgency: ins.rating?.agency || '',
      summary: ins.summary || '',
      heroFacts: pad(ins.heroFacts, LIMITS.heroFacts).slice(0, LIMITS.heroFacts),
      highlightsText: (ins.highlights || []).join('\n'),
      terms: pad(ins.terms, Math.max(3, (ins.terms || []).length)),
      description: ins.description || '',
      risks: ins.risks || '',
      disclaimer: ins.disclaimer || '',
      externalUrl: ins.externalUrl || '',
    })
    setEditing(ins.id)
  }

  const set = (patch) => setForm((p) => ({ ...p, ...patch }))
  const setPair = (key, i, field, value) => setForm((p) => {
    const rows = p[key].map((r, j) => (j === i ? { ...r, [field]: value } : r))
    return { ...p, [key]: rows }
  })

  const handleSave = async () => {
    if (saving) return
    // La URL se valida ANTES de guardar y con aviso: sanitize la anularía en
    // silencio y el asesor creería que el link al prospecto quedó guardado.
    if (form.externalUrl.trim() && !sanitizeUrl(form.externalUrl)) {
      flash('err', t('El link al documento debe empezar con https://', 'The document link must start with https://'))
      return
    }
    const raw = {
      name: form.name,
      rating: { grade: form.ratingGrade, agency: form.ratingAgency },
      heroFacts: form.heroFacts,
      summary: form.summary,
      highlights: form.highlightsText.split('\n'),
      terms: form.terms,
      description: form.description,
      risks: form.risks,
      disclaimer: form.disclaimer,
      externalUrl: form.externalUrl,
    }
    const check = sanitizeInstrumentInput(raw)
    if (!check.ok) {
      flash('err', check.error === 'name-required'
        ? t('La ficha necesita un nombre.', 'The sheet needs a name.')
        : t('No se pudo validar la ficha.', 'Could not validate the sheet.'))
      return
    }
    setSaving(true)
    try {
      await onSave(editing || null, raw)
      flash('ok', t('Ficha guardada', 'Sheet saved'))
      setEditing(null)
    } catch (e) {
      flash('err', e?.message || t('Error al guardar', 'Error saving'))
    }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return }
    setConfirmDelete(null)
    try {
      await onDelete(id)
      flash('ok', t('Ficha eliminada', 'Sheet deleted'))
    } catch (e) {
      flash('err', e?.message || t('Error al eliminar', 'Error deleting'))
    }
  }

  const inputCls = 'w-full px-3 py-2 bg-theme-surface border border-glass-border/60 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-slate-500 mb-1 block'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} onClick={(e) => e.stopPropagation()}
        className="card max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="card-title">
            <FileText size={14} strokeWidth={2} className="mr-1.5" style={{ color: 'var(--accent-blue)' }} />
            {t('Fichas de instrumento', 'Instrument sheets')}
          </h2>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')}
            className="h-8 w-8 grid place-items-center rounded-lg border transition-colors shrink-0"
            style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {editing === null ? (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t(
                'El teaser de un producto de inversión: características, riesgos y el link al prospecto. Se adjunta a los links que compartes con clientes.',
                'The teaser of an investment product: terms, risks and the prospectus link. You attach it to the links you share with clients.',
              )}
            </p>
            {instruments.length === 0 ? (
              <p className="text-xs text-slate-600">{t('Aún no has creado ninguna ficha.', 'You haven\'t created any sheets yet.')}</p>
            ) : (
              <div className="space-y-1.5">
                {instruments.map((ins) => (
                  <div key={ins.id} className="p-3 bg-theme-base border border-glass-border rounded-xl flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">
                        {ins.name}
                        {ins.rating?.grade && <span className="text-micro ml-2" style={{ color: 'var(--accent-blue)' }}>{ins.rating.grade}</span>}
                      </p>
                      {ins.summary && <p className="text-xs text-slate-500 truncate">{ins.summary}</p>}
                    </div>
                    <button onClick={() => startEdit(ins)} aria-label={t('Editar', 'Edit')}
                      className="shrink-0 h-7 w-7 grid place-items-center rounded-md transition-opacity"
                      style={{ color: 'var(--text-secondary)' }}>
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                    <button onClick={() => handleDelete(ins.id)} aria-label={t('Eliminar', 'Delete')}
                      className="shrink-0 h-7 px-1.5 grid place-items-center rounded-md text-xs transition-colors"
                      style={{ color: 'var(--text-negative)' }}>
                      {confirmDelete === ins.id ? t('¿Seguro?', 'Sure?') : <Trash2 size={13} strokeWidth={2} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={startNew}
              className="w-full px-3 py-2.5 text-xs font-medium text-slate-400 border border-dashed border-glass-border rounded-xl hover:text-blue-400 hover:border-blue-500/30 transition-colors inline-flex items-center justify-center gap-1.5">
              <Plus size={13} strokeWidth={2} /> {t('Nueva ficha', 'New sheet')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t('Nombre del instrumento', 'Instrument name')}</label>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={80}
                placeholder={t('Ej. Bono Conacaste 8%', 'E.g. Conacaste Bond 8%')} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>{t('Rating (opcional)', 'Rating (optional)')}</label>
                <input value={form.ratingGrade} onChange={(e) => set({ ratingGrade: e.target.value })} maxLength={10}
                  placeholder="AA- GT" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t('Calificadora', 'Agency')}</label>
                <input value={form.ratingAgency} onChange={(e) => set({ ratingAgency: e.target.value })} maxLength={40}
                  placeholder={t('Ej. Fitch', 'E.g. Fitch')} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('Resumen ejecutivo', 'Executive summary')}</label>
              <textarea value={form.summary} onChange={(e) => set({ summary: e.target.value })} maxLength={600} rows={2}
                placeholder={t('Qué es y por qué puede interesar, en dos líneas.', 'What it is and why it may matter, in two lines.')}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('Datos clave (hasta 4, salen junto al nombre)', 'Key facts (up to 4, shown next to the name)')}</label>
              <div className="space-y-1.5">
                {form.heroFacts.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.4fr] gap-2">
                    <input value={row.label} onChange={(e) => setPair('heroFacts', i, 'label', e.target.value)} maxLength={40}
                      placeholder={['Tasa', 'Plazo', 'Monto mínimo', 'Periodicidad'][i] || ''} className={inputCls} />
                    <input value={row.value} onChange={(e) => setPair('heroFacts', i, 'value', e.target.value)} maxLength={60}
                      placeholder={['8% anual', '10 años', 'Q10,000', 'Semestral'][i] || ''} className={inputCls} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>{t('Highlights (uno por línea, hasta 8)', 'Highlights (one per line, up to 8)')}</label>
              <textarea value={form.highlightsText} onChange={(e) => set({ highlightsText: e.target.value })} rows={3}
                placeholder={t('Emisor con 20 años de historia\nGarantía fiduciaria sobre el proyecto', 'Issuer with a 20-year track record\nFiduciary guarantee over the project')}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('Características (tabla del teaser)', 'Terms (the teaser table)')}</label>
              <div className="space-y-1.5">
                {form.terms.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2 items-center">
                    <input value={row.label} onChange={(e) => setPair('terms', i, 'label', e.target.value)} maxLength={60}
                      placeholder={TERM_PLACEHOLDERS[i]?.[0] || t('Campo', 'Field')} className={inputCls} />
                    <input value={row.value} onChange={(e) => setPair('terms', i, 'value', e.target.value)} maxLength={160}
                      placeholder={TERM_PLACEHOLDERS[i]?.[1] || t('Valor', 'Value')} className={inputCls} />
                    <button onClick={() => set({ terms: form.terms.filter((_, j) => j !== i) })}
                      aria-label={t('Quitar fila', 'Remove row')}
                      className="h-7 w-7 grid place-items-center rounded-md" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              {form.terms.length < LIMITS.terms && (
                <button onClick={() => set({ terms: [...form.terms, { label: '', value: '' }] })}
                  className="mt-1.5 text-xs" style={{ color: 'var(--accent-blue)' }}>
                  + {t('Agregar fila', 'Add row')}
                </button>
              )}
            </div>
            <div>
              <label className={labelCls}>{t('¿Qué es este producto? (opcional)', 'What is this product? (optional)')}</label>
              <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} rows={3}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('Riesgos (opcional)', 'Risks (optional)')}</label>
              <textarea value={form.risks} onChange={(e) => set({ risks: e.target.value })} maxLength={1500} rows={2}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('Link al documento completo (https, opcional)', 'Full document link (https, optional)')}</label>
              <input value={form.externalUrl} onChange={(e) => set({ externalUrl: e.target.value })} maxLength={300}
                placeholder="https://" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('Disclaimer (opcional: si queda vacío se usa el estándar)', 'Disclaimer (optional: the standard one applies if empty)')}</label>
              <textarea value={form.disclaimer} onChange={(e) => set({ disclaimer: e.target.value })} maxLength={1000} rows={2}
                className={inputCls} />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="flex-1 py-2 rounded-lg disabled:opacity-50 text-xs font-medium"
                style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                <BusyLabel busy={saving} lang={lang}>{t('Guardar ficha', 'Save sheet')}</BusyLabel>
              </button>
              <button onClick={() => setEditing(null)}
                className="px-3 py-2 border border-glass-border text-xs rounded-lg hover:bg-theme-elevated transition-colors"
                style={{ color: 'var(--text-secondary)' }}>
                {t('Cancelar', 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
