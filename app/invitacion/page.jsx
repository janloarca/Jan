'use client'

// Pantalla de la invitación. Para un CLIENTE es el consentimiento: qué podrá
// ver la firma, con Flujo desmarcado, y nada se activa hasta que acepta. Para
// un miembro del equipo es la confirmación de entrada a la firma.
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import PageShell, { PageTitle } from '@/components/PageShell'
import { usePageSession } from '@/hooks/usePageSession'
import { refreshInstitutional } from '@/hooks/useInstitutional'
import { orgApi, orgErrorText } from '@/lib/institutional/client'
import { SCOPES, DEFAULT_SCOPES, SCOPE_LABELS, CONSENT_VERSION } from '@/lib/institutional/model'
import BusyLabel from '@/components/ui/BusyLabel'
import InlineNotice from '@/components/ui/InlineNotice'

const STATE_TEXT = {
  'not-found': ['No encontramos esta invitación. Revisa el enlace del correo.', 'We could not find this invitation. Check the link in the email.'],
  used: ['Esta invitación ya se usó.', 'This invitation was already used.'],
  expired: ['Esta invitación venció. Pide a tu asesor que te envíe una nueva.', 'This invitation expired. Ask your advisor to send a new one.'],
  revoked: ['Esta invitación fue cancelada.', 'This invitation was cancelled.'],
}
const ROLE_LABEL = { admin: ['administrador', 'administrator'], advisor: ['asesor', 'advisor'], assistant: ['asistente', 'assistant'] }

function InvitePageInner() {
  const searchParams = useSearchParams()
  const token = searchParams?.get('t') || ''
  const { user, lang, toggleLang } = usePageSession(`/invitacion?t=${encodeURIComponent(token)}`)
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const [invite, setInvite] = useState(null)
  const [error, setError] = useState(null)
  const [scopes, setScopes] = useState(DEFAULT_SCOPES)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    if (!user) return
    orgApi('invite.get', { token }).then(setInvite).catch((e) => setError(orgErrorText(e, lang)))
  }, [user, token, lang])

  const toggle = (s) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))

  const accept = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await orgApi('invite.accept', { token, scopes, consentVersion: CONSENT_VERSION })
      await refreshInstitutional()
      setDone(r)
    } catch (e) { setError(orgErrorText(e, lang)) } finally { setBusy(false) }
  }

  const isClient = invite?.kind === 'client'
  return (
    <PageShell user={user} lang={lang} setLang={toggleLang} width="narrow">
      <PageTitle icon={ShieldCheck} title={t('Invitación', 'Invitation')} />
      {!invite && !error && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando...', 'Loading...')}</p>}
      {error && <InlineNotice tone="warn">{error}</InlineNotice>}

      {done && (
        <div className="card p-5 space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {done.kind === 'client' ? t('Listo: el acceso de lectura está activo.', 'Done: read-only access is active.') : t('Listo: ya eres parte de la firma.', 'Done: you are now part of the firm.')}
          </p>
          {done.kind === 'client' ? (
            <>
              <p>{t('Puedes revocarlo cuando quieras en Ajustes, Compartir, Asesores.', 'You can revoke it at any time in Settings, Share, Advisors.')}</p>
              <div className="flex flex-wrap gap-3">
                <Link href="/tu-asesor" className="btn-primary px-4 py-2 text-sm">{t('Ir a Tu asesor', 'Go to Your advisor')}</Link>
                <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">{t('Ir a mi patrimonio', 'Go to my net worth')}</Link>
              </div>
            </>
          ) : (
            <Link href="/asesor" className="btn-primary inline-block px-4 py-2 text-sm">{t('Abrir panel de asesor', 'Open advisor panel')}</Link>
          )}
        </div>
      )}

      {invite && !done && invite.state !== 'ok' && (
        <div className="card p-5 text-sm space-y-3" style={{ color: 'var(--text-secondary)' }}>
          <p>{t(...(STATE_TEXT[invite.state] || STATE_TEXT['not-found']))}</p>
          <Link href="/dashboard" className="underline" style={{ color: 'var(--accent-blue)' }}>{t('Ir a mi patrimonio', 'Go to my net worth')}</Link>
        </div>
      )}

      {invite && !done && invite.state === 'ok' && isClient && (
        <div className="card p-5 space-y-4">
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {t(`${invite.orgName} quiere ver tu portafolio en modo lectura. No puede mover tu dinero ni cambiar tus datos. Puedes revocar el acceso cuando quieras.`,
               `${invite.orgName} wants to view your portfolio in read-only mode. They cannot move your money or change your data. You can revoke access at any time.`)}
          </p>
          <fieldset className="space-y-2">
            <legend className="form-label">{t('Elige qué puede ver', 'Choose what they can see')}</legend>
            {SCOPES.map((s) => (
              <label key={s} className="flex items-start gap-2.5 text-sm min-h-[28px] cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" className="mt-1" checked={scopes.includes(s)} onChange={() => toggle(s)} />
                <span>{t(SCOPE_LABELS[s].es, SCOPE_LABELS[s].en)}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('Se vincula tu cuenta actual: no se copia ni se mueve ningún dato. Verás en Ajustes cada vez que tu asesor abra tu portafolio.',
               'Your current account is linked: no data is copied or moved. In Settings you will see every time your advisor opens your portfolio.')}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={accept} disabled={busy || scopes.length === 0} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
              <BusyLabel busy={busy} lang={lang}>{t('Aceptar y dar acceso de lectura', 'Accept and grant read-only access')}</BusyLabel>
            </button>
            <Link href="/dashboard" className="btn-secondary px-4 py-2 text-sm">{t('Ahora no', 'Not now')}</Link>
          </div>
        </div>
      )}

      {invite && !done && invite.state === 'ok' && !isClient && (
        <div className="card p-5 space-y-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <p style={{ color: 'var(--text-primary)' }}>
            {t(`Te invitaron a ${invite.orgName} como ${(ROLE_LABEL[invite.role] || ROLE_LABEL.advisor)[0]}.`,
               `You were invited to ${invite.orgName} as ${(ROLE_LABEL[invite.role] || ROLE_LABEL.advisor)[1]}.`)}
          </p>
          {!invite.emailMatches && (
            <InlineNotice tone="warn">
              {t(`Esta invitación es para ${invite.email}. Entra con esa cuenta para aceptarla.`, `This invitation is for ${invite.email}. Sign in with that account to accept it.`)}
            </InlineNotice>
          )}
          <button type="button" onClick={accept} disabled={busy || !invite.emailMatches} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            <BusyLabel busy={busy} lang={lang}>{t('Unirme a la firma', 'Join the firm')}</BusyLabel>
          </button>
        </div>
      )}
    </PageShell>
  )
}

export default function InvitePage() {
  return <Suspense fallback={null}><InvitePageInner /></Suspense>
}
