'use client'

// Ajustes > "Para asesores": crear la firma, ver el equipo e invitar asesores.
// Solo aparece con ?institucional=1 o si ya perteneces a una firma.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { orgApi, orgErrorText } from '@/lib/institutional/client'
import { useInstitutional } from '@/hooks/useInstitutional'
import BusyLabel from '@/components/ui/BusyLabel'
import ConfirmTap from '@/components/ui/ConfirmTap'
import InlineNotice from '@/components/ui/InlineNotice'

const ROLE_LABEL = {
  admin: ['Administrador', 'Administrator'], advisor: ['Asesor', 'Advisor'], assistant: ['Asistente', 'Assistant'],
}

export default function AdvisorSetup({ lang = 'es', flash = () => {} }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const inst = useInstitutional()
  const orgId = inst.memberships[0]?.orgId || null
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('advisor')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    try { setData(await orgApi('org.get', { orgId })); setError(null) } catch (e) { setError(orgErrorText(e, lang)) }
  }, [orgId, lang])
  useEffect(() => { load() }, [load])

  const run = async (fn, okMsg) => {
    setBusy(true)
    try { await fn(); if (okMsg) flash('ok', okMsg) } catch (e) { flash('err', orgErrorText(e, lang)) } finally { setBusy(false) }
  }

  const create = (e) => {
    e.preventDefault()
    run(async () => {
      await orgApi('org.create', { name, locale: lang })
      setName('')
      await inst.refresh()
    }, t('Firma creada', 'Firm created'))
  }
  const invite = (e) => {
    e.preventDefault()
    run(async () => {
      const r = await orgApi('member.invite', { orgId, email, role })
      setEmail('')
      await load()
      if (!r.emailSent) throw Object.assign(new Error('EMAIL'), { code: 'EMAIL_NOT_SENT' })
    }, t('Invitación enviada', 'Invitation sent'))
  }
  const remove = (memberId) => run(async () => { await orgApi('member.remove', { orgId, memberId }); await load(); await inst.refresh() }, t('Listo', 'Done'))

  if (inst.loading) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando...', 'Loading...')}</p>

  if (!orgId) {
    return (
      <form onSubmit={create} className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('Crea tu firma', 'Create your firm')}</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('Para asesores: invita a tus clientes y mira su portafolio en modo lectura, con su consentimiento. No puedes mover su dinero ni cambiar sus datos.',
               'For advisors: invite your clients and view their portfolio in read-only mode, with their consent. You cannot move their money or change their data.')}
          </p>
        </div>
        <div>
          <label className="form-label" htmlFor="org-name">{t('Nombre de la firma', 'Firm name')}</label>
          <input id="org-name" className="form-input w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <button type="submit" disabled={busy || name.trim().length < 2} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
          <BusyLabel busy={busy} lang={lang}>{t('Crear firma', 'Create firm')}</BusyLabel>
        </button>
      </form>
    )
  }

  const isAdmin = data?.role === 'admin'
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold break-words" style={{ color: 'var(--text-primary)' }}>{data?.org?.name || inst.memberships[0]?.orgName}</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('Tu rol', 'Your role')}: {t(...(ROLE_LABEL[data?.role || inst.memberships[0]?.role] || ROLE_LABEL.advisor))}
          </p>
        </div>
        <Link href="/asesor" className="btn-secondary px-3 py-1.5 text-xs">{t('Abrir panel de asesor', 'Open advisor panel')}</Link>
      </div>
      {error && <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={load}>{error}</InlineNotice>}
      {data && (
        <div className="space-y-1.5">
          <p className="form-label">{t('Equipo', 'Team')}</p>
          {data.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border text-xs" style={{ borderColor: 'var(--card-border)' }}>
              <div className="min-w-0">
                <p className="truncate" style={{ color: 'var(--text-primary)' }}>{m.name || m.email}</p>
                <p style={{ color: 'var(--text-muted)' }}>
                  {t(...(ROLE_LABEL[m.role] || ROLE_LABEL.advisor))}
                  {m.status === 'invited' && ` · ${t('invitación pendiente', 'invitation pending')}`}
                  {m.status === 'expired' && ` · ${t('invitación vencida', 'invitation expired')}`}
                </p>
              </div>
              {isAdmin && (
                <ConfirmTap onConfirm={() => remove(m.id)} disabled={busy}
                  className="shrink-0 min-h-[28px] px-2 rounded-md border" style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}
                  confirmStyle={{ borderColor: 'var(--alert-error-border)', color: 'var(--text-negative)' }}
                  confirmContent={t('¿Quitar?', 'Remove?')}>
                  {t('Quitar', 'Remove')}
                </ConfirmTap>
              )}
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <form onSubmit={invite} className="space-y-2">
          <p className="form-label">{t('Invitar a tu equipo', 'Invite your team')}</p>
          <div className="flex flex-wrap gap-2">
            <input type="email" className="form-input flex-1 min-w-[180px]" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t('correo@firma.com', 'email@firm.com')} aria-label={t('Correo', 'Email')} />
            <select className="form-input" value={role} onChange={(e) => setRole(e.target.value)} aria-label={t('Rol', 'Role')}>
              <option value="advisor">{t('Asesor', 'Advisor')}</option>
              <option value="assistant">{t('Asistente', 'Assistant')}</option>
              <option value="admin">{t('Administrador', 'Administrator')}</option>
            </select>
            <button type="submit" disabled={busy || !email.trim()} className="btn-primary px-3 py-2 text-sm disabled:opacity-50">
              <BusyLabel busy={busy} lang={lang}>{t('Invitar', 'Invite')}</BusyLabel>
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('El asistente ve la lista de clientes, pero no sus datos ni sus mensajes.',
               'An assistant sees the client list, but not their data or messages.')}
          </p>
        </form>
      )}
    </div>
  )
}
