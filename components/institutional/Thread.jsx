'use client'

// Hilo de mensajes asesor <-> cliente. Leer, enviar, editar y exportar pasan
// por /api/org: el navegador no escribe en `threads`. No hay borrar: una
// edición conserva la versión anterior en el propio mensaje.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Send } from 'lucide-react'
import { orgApi, orgErrorText } from '@/lib/institutional/client'
import { MAX_BODY } from '@/lib/institutional/model'
import BusyLabel from '@/components/ui/BusyLabel'
import InlineNotice from '@/components/ui/InlineNotice'

function fmtWhen(iso, lang) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function isReadByOther(m, info) {
  const readers = Object.keys(m.readBy || {}).filter((u) => u !== m.authorUid)
  if (m.authorRole === 'client') return readers.some((u) => (info.advisorUids || []).includes(u))
  return readers.includes(info.clientUid)
}

function Bubble({ m, mine, info, lang, t, onEdit, canEdit }) {
  const [when, setWhen] = useState('')
  // La hora depende de la zona del navegador: se pinta después de montar.
  useEffect(() => { setWhen(fmtWhen(m.createdAt, lang)) }, [m.createdAt, lang])
  const isNote = m.kind === 'note'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm border"
        style={{
          backgroundColor: mine ? 'var(--alert-info-bg)' : 'var(--bg-tertiary)',
          borderColor: isNote ? 'var(--alert-warn-border)' : 'var(--card-border)', color: 'var(--text-primary)',
        }}>
        {isNote && (
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--alert-warn-icon)' }}>
            {t('Nota de tu asesor', 'Note from your advisor')}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
        <p className="text-xs mt-1 flex flex-wrap items-center gap-x-2" style={{ color: 'var(--text-muted)' }}>
          <span>{m.authorName || (m.authorRole === 'client' ? t('Cliente', 'Client') : t('Asesor', 'Advisor'))}</span>
          <span>{when}</span>
          {m.editedAt && <span>{t('editado', 'edited')}</span>}
          {mine && <span>{isReadByOther(m, info) ? t('Leído', 'Read') : t('Enviado', 'Sent')}</span>}
          {mine && canEdit && !isNote && (
            <button type="button" className="underline min-h-[24px]" onClick={() => onEdit(m)}>{t('Editar', 'Edit')}</button>
          )}
        </p>
      </div>
    </div>
  )
}

export default function Thread({ linkId, uid, lang = 'es', onRead }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null)
  const [sending, setSending] = useState(false)
  const [exporting, setExporting] = useState(false)
  const endRef = useRef(null)
  const onReadRef = useRef(onRead)
  onReadRef.current = onRead

  const load = useCallback(async ({ markRead = false } = {}) => {
    try {
      const data = await orgApi('message.list', { linkId })
      setInfo(data)
      setError(null)
      const unread = (data.messages || []).some((m) => m.authorUid !== uid && !m.readBy?.[uid])
      if (markRead && unread) {
        await orgApi('message.read', { linkId })
        if (onReadRef.current) onReadRef.current()
      }
    } catch (e) {
      setError(orgErrorText(e, lang))
    } finally {
      setLoading(false)
    }
  }, [linkId, uid, lang])

  useEffect(() => {
    if (!linkId || !uid) return undefined
    load({ markRead: true })
    const id = setInterval(() => { if (document.visibilityState === 'visible') load({ markRead: true }) }, 30000)
    return () => clearInterval(id)
  }, [linkId, uid, load])

  const count = info?.messages?.length || 0
  useEffect(() => { if (count && endRef.current?.scrollIntoView) endRef.current.scrollIntoView({ block: 'nearest' }) }, [count])

  const submit = async (e) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    try {
      if (editing) await orgApi('message.edit', { linkId, msgId: editing.id, body })
      else await orgApi('message.send', { linkId, body })
      setDraft('')
      setEditing(null)
      await load()
    } catch (err) {
      setError(orgErrorText(err, lang))
    } finally {
      setSending(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const { csv } = await orgApi('message.export', { linkId })
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `chispu-${t('mensajes', 'messages')}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(orgErrorText(err, lang))
    } finally {
      setExporting(false)
    }
  }

  const active = info?.status === 'active'
  return (
    <div className="card p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="card-title">{t('Mensajes', 'Messages')}</h2>
        <button type="button" onClick={exportCsv} disabled={exporting || !count}
          className="flex items-center gap-1.5 text-xs min-h-[28px] px-2.5 rounded-md border disabled:opacity-40"
          style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
          <Download size={13} />
          <BusyLabel busy={exporting} lang={lang}>{t('Exportar CSV', 'Export CSV')}</BusyLabel>
        </button>
      </div>
      {error && <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={() => load()}>{error}</InlineNotice>}
      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando mensajes...', 'Loading messages...')}</p>
      ) : (
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1" data-testid="thread-messages">
          {count === 0 && !error && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {t('Todavía no hay mensajes en este hilo.', 'There are no messages in this thread yet.')}
            </p>
          )}
          {(info?.messages || []).map((m) => (
            <Bubble key={m.id} m={m} mine={m.authorUid === uid} info={info} lang={lang} t={t}
              canEdit={active} onEdit={(msg) => { setEditing(msg); setDraft(msg.body) }} />
          ))}
          <div ref={endRef} />
        </div>
      )}
      {info && !active && (
        <InlineNotice tone="info">
          {t('El acceso fue revocado: el hilo queda como registro y ya no admite mensajes nuevos.',
             'Access was revoked: the thread stays as a record and no longer accepts new messages.')}
        </InlineNotice>
      )}
      {active && (
        <form onSubmit={submit} className="space-y-2">
          {editing && (
            <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
              {t('Editando un mensaje. La versión anterior queda guardada.', 'Editing a message. The previous version is kept.')}
              <button type="button" className="underline min-h-[24px]" onClick={() => { setEditing(null); setDraft('') }}>{t('Cancelar', 'Cancel')}</button>
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))} rows={2}
              aria-label={t('Escribe un mensaje', 'Write a message')}
              placeholder={t('Escribe un mensaje', 'Write a message')}
              className="form-input flex-1 min-w-0 resize-y" />
            <button type="submit" disabled={sending || !draft.trim()} className="btn-primary flex items-center gap-1.5 px-3 py-2 text-sm disabled:opacity-50">
              <Send size={14} />
              <BusyLabel busy={sending} lang={lang}>{editing ? t('Guardar', 'Save') : t('Enviar', 'Send')}</BusyLabel>
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
