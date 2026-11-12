'use client'

// Vista de lectura de un cliente. La banda de arriba no se quita: quien mira
// tiene que saber en todo momento que NO es su portafolio y que no puede
// cambiar nada. Cada pantalla que se abre queda registrada en la auditoría
// (el servidor la anota a lo sumo una vez cada 10 minutos por pantalla).
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { Eye } from 'lucide-react'
import PageShell from '@/components/PageShell'
import { usePageSession } from '@/hooks/usePageSession'
import { useInstitutional } from '@/hooks/useInstitutional'
import { orgApi, orgErrorText } from '@/lib/institutional/client'
import { SCREEN_SCOPE, VIEW_SCREENS } from '@/lib/institutional/model'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import InlineNotice from '@/components/ui/InlineNotice'
import ClientReadView from '@/components/institutional/ClientReadView'
import Thread from '@/components/institutional/Thread'
import NotesPanel from '@/components/institutional/NotesPanel'

const SCREEN_LABEL = {
  panel: ['Panel', 'Panel'], hoja: ['Hoja', 'Sheet'], dividendos: ['Dividendos', 'Dividends'],
  metas: ['Metas', 'Goals'], flujo: ['Flujo', 'Cash flow'], mensajes: ['Mensajes', 'Messages'], notas: ['Notas', 'Notes'],
}

function ClientPageInner() {
  const params = useParams()
  const searchParams = useSearchParams()
  const clientUid = decodeURIComponent(String(params?.clientUid || ''))
  const { user, lang, toggleLang } = usePageSession(`/asesor/clientes/${encodeURIComponent(clientUid)}`)
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const inst = useInstitutional()
  const [client, setClient] = useState(null)
  const [orgId, setOrgId] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(searchParams?.get('tab') === 'mensajes' ? 'mensajes' : null)

  const orgIds = useMemo(() => inst.memberships.map((m) => m.orgId).join(','), [inst.memberships])
  useEffect(() => {
    if (!user || !clientUid || inst.loading) return undefined
    // Sin ninguna firma no hay dónde buscar: se dice en vez de quedarse cargando.
    if (!orgIds) { setError(t('No tienes acceso a este cliente.', 'You do not have access to this client.')); return undefined }
    let cancelled = false
    ;(async () => {
      let lastErr = null
      // Un asesor puede pertenecer a más de una firma: se busca en cuál vive
      // el vínculo con este cliente.
      for (const id of orgIds.split(',')) {
        try {
          const c = await orgApi('client.get', { orgId: id, clientUid })
          if (!cancelled) { setClient(c); setOrgId(id); setError(null) }
          return
        } catch (e) { lastErr = e }
      }
      if (!cancelled) setError(orgErrorText(lastErr, lang))
    })()
    return () => { cancelled = true }
  }, [user, clientUid, orgIds, lang, inst.loading, t])

  const active = client?.status === 'active'
  const screens = useMemo(
    () => (active ? VIEW_SCREENS.filter((s) => client.scopes.includes(SCREEN_SCOPE[s])) : []),
    [active, client]
  )
  const tabs = useMemo(() => [...screens, 'mensajes', 'notas'].map((k) => ({
    key: k, label: `${t(...SCREEN_LABEL[k])}${k === 'mensajes' && client?.unread > 0 ? ` (${client.unread})` : ''}`,
  })), [screens, client, t])
  const current = tab && tabs.some((x) => x.key === tab) ? tab : (screens[0] || 'mensajes')

  // Registro de la vista. Solo pantallas de datos; mensajes y notas ya dejan
  // su propio rastro al escribir.
  useEffect(() => {
    if (!active || !orgId || !VIEW_SCREENS.includes(current)) return
    orgApi('view.log', { orgId, clientUid, screen: current }).catch(() => {})
  }, [active, orgId, clientUid, current])

  const clearUnread = useCallback(() => setClient((c) => (c ? { ...c, unread: 0 } : c)), [])

  return (
    <PageShell user={user} lang={lang} setLang={toggleLang} width="wide">
      <div role="status" data-testid="read-only-band"
        className="sticky top-14 z-10 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border"
        style={{ backgroundColor: 'var(--alert-info-bg)', borderColor: 'var(--alert-info-border)', color: 'var(--text-primary)' }}>
        <Eye size={16} className="shrink-0" style={{ color: 'var(--accent-blue)' }} />
        <span className="min-w-0 flex-1">
          {client
            ? t(`Estás viendo el portafolio de ${client.name} en modo lectura`, `You are viewing ${client.name}'s portfolio in read-only mode`)
            : t('Modo lectura', 'Read-only mode')}
        </span>
        <Link href="/asesor" className="shrink-0 underline text-xs" style={{ color: 'var(--accent-blue)' }}>{t('Volver a clientes', 'Back to clients')}</Link>
      </div>

      {error && <InlineNotice tone="warn">{error}</InlineNotice>}
      {!client && !error && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando...', 'Loading...')}</p>}

      {client && (
        <>
          {!active && (
            <InlineNotice tone="info">
              {t('El acceso a este cliente fue revocado. Ya no puedes ver sus datos; el hilo y tus notas quedan como registro.',
                 'Access to this client was revoked. You can no longer see their data; the thread and your notes stay as a record.')}
            </InlineNotice>
          )}
          <SegmentedTabs tabs={tabs} value={current} onChange={setTab} deps={[lang]} ariaLabel={t('Secciones del cliente', 'Client sections')} />
          {VIEW_SCREENS.includes(current) && active && (
            <ClientReadView clientUid={clientUid} scopes={client.scopes} screen={current} lang={lang} />
          )}
          {current === 'mensajes' && user && <Thread linkId={client.linkId} uid={user.uid} lang={lang} onRead={clearUnread} />}
          {current === 'notas' && orgId && <NotesPanel orgId={orgId} clientUid={clientUid} active={active} lang={lang} />}
        </>
      )}
    </PageShell>
  )
}

export default function ClientPage() {
  return <Suspense fallback={null}><ClientPageInner /></Suspense>
}
