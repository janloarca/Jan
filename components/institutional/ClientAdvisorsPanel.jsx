'use client'

// Ajustes > Compartir > "Asesores": lo que el CLIENTE ve de su vínculo. Qué
// puede ver su asesor, qué hizo, y revocar en dos toques. Solo se dibuja si
// existe (o existió) un vínculo.
import { useCallback, useEffect, useState } from 'react'
import { orgApi, orgErrorText } from '@/lib/institutional/client'
import { SCOPES, SCOPE_LABELS } from '@/lib/institutional/model'
import { refreshInstitutional } from '@/hooks/useInstitutional'
import ConfirmTap from '@/components/ui/ConfirmTap'
import InlineNotice from '@/components/ui/InlineNotice'

const ACTION_LABEL = {
  'view.panel': ['Vio tu panel', 'Viewed your panel'],
  'view.hoja': ['Vio tu Hoja', 'Viewed your Sheet'],
  'view.dividendos': ['Vio tus dividendos', 'Viewed your dividends'],
  'view.metas': ['Vio tus metas', 'Viewed your goals'],
  'view.flujo': ['Vio tu Flujo', 'Viewed your cash flow'],
  'message.send': ['Te envió un mensaje', 'Sent you a message'],
  'message.edit': ['Editó un mensaje', 'Edited a message'],
  'note.create': ['Te compartió una nota', 'Shared a note with you'],
  'export.messages': ['Exportó los mensajes', 'Exported the messages'],
}

function When({ iso, lang }) {
  const [txt, setTxt] = useState('')
  useEffect(() => {
    const d = new Date(iso)
    setTxt(Number.isNaN(d.getTime()) ? '' : d.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))
  }, [iso, lang])
  return <span>{txt}</span>
}

function LinkCard({ link, lang, t, onRevoked, flash }) {
  const [events, setEvents] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const active = link.status === 'active'

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && events === null) {
      try { setEvents((await orgApi('client.activity', { orgId: link.orgId })).events || []) } catch { setEvents([]) }
    }
  }
  const revoke = async () => {
    setBusy(true)
    try {
      await orgApi('link.revoke', { orgId: link.orgId })
      flash('ok', t('Acceso revocado', 'Access revoked'))
      await onRevoked()
    } catch (e) { flash('err', orgErrorText(e, lang)) } finally { setBusy(false) }
  }

  return (
    <div className="p-3.5 rounded-xl border space-y-3" style={{ borderColor: 'var(--card-border)' }} data-testid="advisor-link">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold break-words" style={{ color: 'var(--text-primary)' }}>{link.orgName}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {link.advisorName ? `${link.advisorName} · ` : ''}
            {active ? t('Acceso activo, solo lectura', 'Active access, read-only') : t('Acceso revocado', 'Access revoked')}
          </p>
        </div>
        {active && (
          <ConfirmTap onConfirm={revoke} disabled={busy}
            className="shrink-0 min-h-[32px] px-3 rounded-lg border text-xs font-medium"
            style={{ borderColor: 'var(--alert-error-border)', color: 'var(--text-negative)' }}
            confirmStyle={{ borderColor: 'var(--alert-error-border)', backgroundColor: 'var(--alert-error-bg)', color: 'var(--text-negative)' }}
            confirmContent={t('Confirmar: revocar', 'Confirm: revoke')}>
            {t('Revocar acceso', 'Revoke access')}
          </ConfirmTap>
        )}
      </div>
      {active && (
        <div>
          <p className="form-label">{t('Qué ve tu asesor', 'What your advisor sees')}</p>
          <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
            {SCOPES.map((s) => {
              const on = link.scopes.includes(s)
              return (
                <li key={s} className="flex items-start gap-2">
                  <span aria-hidden="true" style={{ color: on ? 'var(--accent-green)' : 'var(--text-muted)' }}>{on ? '✓' : '✕'}</span>
                  <span style={on ? undefined : { color: 'var(--text-muted)' }}>
                    {t(SCOPE_LABELS[s].es, SCOPE_LABELS[s].en)}{on ? '' : `: ${t('no compartido', 'not shared')}`}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            {t('No puede mover tu dinero ni cambiar tus datos.', 'They cannot move your money or change your data.')}
          </p>
        </div>
      )}
      <div>
        <button type="button" onClick={toggle} aria-expanded={open} className="text-xs underline min-h-[24px]" style={{ color: 'var(--accent-blue)' }}>
          {t('Actividad de tu asesor', "Your advisor's activity")}
        </button>
        {open && (
          <div className="mt-2 space-y-1 max-h-56 overflow-y-auto text-xs" style={{ color: 'var(--text-secondary)' }}>
            {events === null && <p style={{ color: 'var(--text-muted)' }}>{t('Cargando...', 'Loading...')}</p>}
            {events && events.length === 0 && <p style={{ color: 'var(--text-muted)' }}>{t('Todavía no hay actividad.', 'No activity yet.')}</p>}
            {(events || []).map((ev, i) => (
              <p key={`${ev.at}-${i}`} className="flex justify-between gap-3">
                <span>{t(...(ACTION_LABEL[ev.action] || [ev.action, ev.action]))}</span>
                <span className="shrink-0" style={{ color: 'var(--text-muted)' }}><When iso={ev.at} lang={lang} /></span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ClientAdvisorsPanel({ lang = 'es', flash = () => {} }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [links, setLinks] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    try { setLinks((await orgApi('client.links')).links || []); setError(null) } catch (e) { setError(orgErrorText(e, lang)) }
  }, [lang])
  useEffect(() => { load() }, [load])
  const onRevoked = useCallback(async () => { await load(); await refreshInstitutional() }, [load])

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('Asesores', 'Advisors')}</h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('Firmas con acceso de lectura a tu portafolio. Puedes revocar el acceso cuando quieras.',
             'Firms with read-only access to your portfolio. You can revoke access at any time.')}
        </p>
      </div>
      {error && <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={load}>{error}</InlineNotice>}
      {links === null && !error && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('Cargando...', 'Loading...')}</p>}
      {(links || []).map((l) => <LinkCard key={l.linkId} link={l} lang={lang} t={t} onRevoked={onRevoked} flash={flash} />)}
    </div>
  )
}
