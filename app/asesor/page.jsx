'use client'

// Book del asesor: sus clientes vinculados, con las cifras que cada cliente
// tiene archivadas (nunca recalculadas aquí) y cuánto lleva sin contacto.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Briefcase } from 'lucide-react'
import PageShell, { PageTitle } from '@/components/PageShell'
import { usePageSession } from '@/hooks/usePageSession'
import { useInstitutional } from '@/hooks/useInstitutional'
import { orgApi, orgErrorText } from '@/lib/institutional/client'
import { sortByNoContact, NO_CONTACT_DAYS, canSeeClients } from '@/lib/institutional/model'
import BusyLabel from '@/components/ui/BusyLabel'
import ConfirmTap from '@/components/ui/ConfirmTap'
import InlineNotice from '@/components/ui/InlineNotice'
import SegmentedTabs from '@/components/ui/SegmentedTabs'

function money(v, cur, lang) {
  if (!Number.isFinite(v)) return '-'
  try {
    return new Intl.NumberFormat(lang === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(v)
  } catch { return `${cur || ''} ${Math.round(v)}` }
}
function pct(v) {
  if (!Number.isFinite(v)) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function day(iso, lang) {
  if (!iso) return '-'
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return '-'
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(lang === 'es' ? 'es-GT' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function Stat({ label, value, note }) {
  return (
    <div className="card p-4 min-w-0">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl font-semibold tabular-nums break-words" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {note && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{note}</p>}
    </div>
  )
}

function ClientRow({ r, lang, t, clickable }) {
  const late = r.daysNoContact != null && r.daysNoContact > NO_CONTACT_DAYS
  const body = (
    <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_auto] gap-x-3 gap-y-1 items-center px-3 py-3 text-sm">
      <div className="col-span-2 md:col-span-1 min-w-0">
        <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.name || r.email}</p>
        <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
          {t('Activo', 'Active')}{r.snapshotAt ? ` · ${t('snapshot', 'snapshot')} ${day(r.snapshotAt, lang)}` : ` · ${t('sin snapshot todavía', 'no snapshot yet')}`}
        </p>
      </div>
      <p className="tabular-nums md:text-right" style={{ color: 'var(--text-primary)' }}>
        <span className="md:hidden text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Patrimonio', 'Net worth')}</span>{money(r.netWorth, r.currency, lang)}
      </p>
      <p className="tabular-nums md:text-right" style={{ color: 'var(--text-secondary)' }}>
        <span className="md:hidden text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Invertible', 'Investable')}</span>{money(r.investable, r.currency, lang)}
      </p>
      <p className="tabular-nums md:text-right" style={{ color: !Number.isFinite(r.ytdPct) ? 'var(--text-muted)' : r.ytdPct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
        <span className="md:hidden text-xs block" style={{ color: 'var(--text-muted)' }}>YTD</span>{pct(r.ytdPct)}
      </p>
      <p className="tabular-nums md:text-right" style={{ color: late ? 'var(--alert-warn-icon)' : 'var(--text-secondary)' }}>
        <span className="md:hidden text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Días sin contacto', 'Days without contact')}</span>
        {r.daysNoContact == null ? '-' : r.daysNoContact}{!r.hasContact && r.daysNoContact != null ? ` (${t('sin mensajes', 'no messages')})` : ''}
      </p>
      <p className="md:text-right">
        <span className="md:hidden text-xs block" style={{ color: 'var(--text-muted)' }}>{t('Sin leer', 'Unread')}</span>
        {r.unread > 0
          ? <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--alert-info-bg)', color: 'var(--accent-blue)' }}>{r.unread}</span>
          : <span style={{ color: 'var(--text-muted)' }}>0</span>}
      </p>
      <span className="hidden md:block text-xs" style={{ color: 'var(--accent-blue)' }}>{clickable ? t('Abrir', 'Open') : ''}</span>
    </div>
  )
  if (!clickable) return <div className="border-t" style={{ borderColor: 'var(--card-border)' }}>{body}</div>
  return (
    <Link href={`/asesor/clientes/${encodeURIComponent(r.clientUid)}`} className="block border-t hover:bg-theme-elevated transition-colors" style={{ borderColor: 'var(--card-border)' }}>
      {body}
    </Link>
  )
}

export default function AsesorPage() {
  const { user, authLoading, lang, toggleLang } = usePageSession('/asesor')
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const inst = useInstitutional()
  const [orgId, setOrgId] = useState(null)
  const [book, setBook] = useState(null)
  const [error, setError] = useState(null)
  const [sort, setSort] = useState('contact')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => { if (!orgId && inst.memberships[0]) setOrgId(inst.memberships[0].orgId) }, [orgId, inst.memberships])

  const load = useCallback(async () => {
    if (!orgId) return
    try { setBook(await orgApi('book', { orgId })); setError(null) } catch (e) { setError(orgErrorText(e, lang)) }
  }, [orgId, lang])
  useEffect(() => { if (user) load() }, [user, load])

  const rows = useMemo(() => {
    const list = book?.rows || []
    if (sort === 'name') return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)))
    return sortByNoContact(list)
  }, [book, sort])

  const invite = async (e) => {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const r = await orgApi('link.invite', { orgId, email })
      setEmail('')
      setNotice({ tone: r.emailSent ? 'success' : 'warn', text: r.emailSent
        ? t('Invitación enviada. Vence en 14 días.', 'Invitation sent. It expires in 14 days.')
        : t('La invitación se creó, pero el correo no salió. Cancélala e intenta de nuevo.', 'The invitation was created, but the email was not sent. Cancel it and try again.') })
      await load()
    } catch (err) { setNotice({ tone: 'warn', text: orgErrorText(err, lang) }) } finally { setBusy(false) }
  }
  const cancelInvite = async (inviteId) => {
    try { await orgApi('link.cancelInvite', { orgId, inviteId }); await load() } catch (err) { setNotice({ tone: 'warn', text: orgErrorText(err, lang) }) }
  }

  const canOpen = canSeeClients(book?.role)
  const totals = book?.totals
  const ready = !authLoading && !inst.loading

  return (
    <PageShell user={user} lang={lang} setLang={toggleLang} width="wide">
      <PageTitle icon={Briefcase} title={book?.org?.name || t('Panel de asesor', 'Advisor panel')}
        subtitle={t('Tus clientes vinculados. Todo es de solo lectura.', 'Your linked clients. Everything is read-only.')} />

      {ready && !inst.isAdvisor && (
        <div className="card p-5 text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <p>{t('Esta pantalla es para asesores que pertenecen a una firma.', 'This screen is for advisors who belong to a firm.')}</p>
          <Link href="/dashboard" className="underline" style={{ color: 'var(--accent-blue)' }}>{t('Volver a tu patrimonio', 'Back to your net worth')}</Link>
        </div>
      )}
      {error && <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={load}>{error}</InlineNotice>}
      {inst.isAdvisor && !book && !error && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando clientes...', 'Loading clients...')}</p>}

      {book && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Stat label={t('Clientes activos', 'Active clients')} value={totals.activeClients} />
            <Stat label={t('Patrimonio declarado total', 'Total declared net worth')} value={money(totals.declaredUSD, 'USD', lang)}
              note={`${t('Declarado por el cliente', 'Declared by the client')}${totals.withoutSnapshot ? ` · ${totals.withoutSnapshot} ${t('sin snapshot', 'without snapshot')}` : ''}`} />
            <Stat label={t('Sin contacto hace más de 90 días', 'No contact for over 90 days')} value={totals.noContact90} />
          </div>

          {canOpen && (
            <form onSubmit={invite} className="card p-4 sm:p-5 space-y-2">
              <h2 className="card-title">{t('Invitar cliente', 'Invite client')}</h2>
              <div className="flex flex-wrap gap-2">
                <input type="email" className="form-input flex-1 min-w-[200px]" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('correo del cliente', 'client email')} aria-label={t('Correo del cliente', 'Client email')} />
                <button type="submit" disabled={busy || !email.trim()} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                  <BusyLabel busy={busy} lang={lang}>{t('Invitar cliente', 'Invite client')}</BusyLabel>
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('El cliente decide qué puedes ver y puede revocar el acceso cuando quiera. Si ya usa Chispu, vincula su cuenta existente.',
                   'The client decides what you can see and can revoke access at any time. If they already use Chispu, they link their existing account.')}
              </p>
              {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
            </form>
          )}

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 flex-wrap p-4 sm:p-5">
              <div>
                <h2 className="card-title">{t('Clientes', 'Clients')}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {t('Declarado por el cliente: cifras del último snapshot que su panel archivó, sin recalcular.',
                     'Declared by the client: figures from the last snapshot their panel archived, not recalculated.')}
                </p>
              </div>
              <SegmentedTabs value={sort} onChange={setSort} ariaLabel={t('Ordenar', 'Sort')} deps={[lang]} tabs={[
                { key: 'contact', label: t('Días sin contacto', 'Days without contact') },
                { key: 'name', label: t('Nombre', 'Name') },
              ]} />
            </div>
            <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_auto] gap-x-3 px-3 pb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{t('Cliente', 'Client')}</span>
              <span className="text-right">{t('Patrimonio', 'Net worth')}</span>
              <span className="text-right">{t('Invertible (sin vivienda)', 'Investable (no home)')}</span>
              <span className="text-right">YTD</span>
              <span className="text-right">{t('Días sin contacto', 'Days without contact')}</span>
              <span className="text-right">{t('Sin leer', 'Unread')}</span>
              <span className="w-8" />
            </div>
            {rows.length === 0 && (
              <p className="px-4 pb-5 text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('Todavía no tienes clientes vinculados. Invita al primero arriba.', 'You have no linked clients yet. Invite the first one above.')}
              </p>
            )}
            {rows.map((r) => <ClientRow key={r.linkId} r={r} lang={lang} t={t} clickable={canOpen} />)}
          </div>

          {(book.pending.length > 0 || book.revoked.length > 0) && (
            <div className="card p-4 sm:p-5 space-y-2">
              <h2 className="card-title">{t('Invitaciones y accesos revocados', 'Invitations and revoked access')}</h2>
              {book.pending.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-sm flex-wrap">
                  <span className="min-w-0 break-all" style={{ color: 'var(--text-primary)' }}>{p.email}</span>
                  <span className="flex items-center gap-3 text-xs" style={{ color: p.expired ? 'var(--alert-warn-icon)' : 'var(--text-muted)' }}>
                    {p.expired ? t('Invitación vencida', 'Invitation expired') : `${t('Pendiente, vence', 'Pending, expires')} ${day(p.expiresAt, lang)}`}
                    {canOpen && (
                      <ConfirmTap onConfirm={() => cancelInvite(p.id)} className="underline min-h-[24px]" confirmContent={t('¿Cancelar?', 'Cancel it?')}>
                        {t('Cancelar', 'Cancel')}
                      </ConfirmTap>
                    )}
                  </span>
                </div>
              ))}
              {book.revoked.map((r) => (
                <div key={r.linkId} className="flex items-center justify-between gap-2 text-sm flex-wrap">
                  <span className="min-w-0 break-words" style={{ color: 'var(--text-secondary)' }}>{r.name}</span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t('Acceso revocado', 'Access revoked')} {day(r.revokedAt, lang)}{r.revokedBy === 'client' ? ` · ${t('por el cliente', 'by the client')}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
