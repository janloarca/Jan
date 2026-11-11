'use client'

// Notas del asesor sobre un cliente. Interna: solo la firma. Compartida:
// aparece en el hilo del cliente como "Nota de tu asesor". Sin editar ni borrar.
import { useCallback, useEffect, useState } from 'react'
import { orgApi, orgErrorText } from '@/lib/institutional/client'
import { MAX_BODY } from '@/lib/institutional/model'
import BusyLabel from '@/components/ui/BusyLabel'
import InlineNotice from '@/components/ui/InlineNotice'
import SegmentedTabs from '@/components/ui/SegmentedTabs'

export default function NotesPanel({ orgId, clientUid, active, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [notes, setNotes] = useState(null)
  const [error, setError] = useState(null)
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState('internal')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setNotes((await orgApi('note.list', { orgId, clientUid })).notes || []); setError(null) } catch (e) { setError(orgErrorText(e, lang)) }
  }, [orgId, clientUid, lang])
  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    try {
      await orgApi('note.create', { orgId, clientUid, body, visibility })
      setBody('')
      await load()
    } catch (err) { setError(orgErrorText(err, lang)) } finally { setBusy(false) }
  }

  return (
    <div className="card p-4 sm:p-5 space-y-3">
      <h2 className="card-title">{t('Notas', 'Notes')}</h2>
      <form onSubmit={submit} className="space-y-2">
        <textarea className="form-input w-full resize-y" rows={3} value={body} onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
          aria-label={t('Nueva nota', 'New note')} placeholder={t('Escribe una nota sobre este cliente', 'Write a note about this client')} />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <SegmentedTabs value={visibility} onChange={setVisibility} ariaLabel={t('Visibilidad', 'Visibility')} deps={[lang]} tabs={[
            { key: 'internal', label: t('Interna (solo la firma)', 'Internal (firm only)') },
            ...(active ? [{ key: 'shared', label: t('Compartida con el cliente', 'Shared with the client') }] : []),
          ]} />
          <button type="submit" disabled={busy || !body.trim()} className="btn-primary px-3 py-2 text-sm disabled:opacity-50">
            <BusyLabel busy={busy} lang={lang}>{t('Guardar nota', 'Save note')}</BusyLabel>
          </button>
        </div>
        {visibility === 'shared' && (
          <p className="text-xs" style={{ color: 'var(--alert-warn-icon)' }}>
            {t('El cliente la verá en su hilo como "Nota de tu asesor".', 'The client will see it in their thread as "Note from your advisor".')}
          </p>
        )}
      </form>
      {error && <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={load}>{error}</InlineNotice>}
      {notes === null && !error && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando...', 'Loading...')}</p>}
      {notes && notes.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Todavía no hay notas.', 'No notes yet.')}</p>}
      {(notes || []).map((n) => (
        <div key={n.id} className="p-3 rounded-lg border text-sm" style={{ borderColor: n.visibility === 'shared' ? 'var(--alert-warn-border)' : 'var(--card-border)' }}>
          <p className="whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>{n.body}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {n.visibility === 'shared' ? t('Compartida con el cliente', 'Shared with the client') : t('Interna', 'Internal')}
            {n.authorName ? ` · ${n.authorName}` : ''} · {String(n.createdAt || '').slice(0, 10)}
          </p>
        </div>
      ))}
    </div>
  )
}
