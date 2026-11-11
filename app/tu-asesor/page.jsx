'use client'

// "Tu asesor": el hilo del cliente con su firma. Solo tiene contenido cuando
// existe un vínculo (activo, o revocado con su hilo como registro).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import PageShell, { PageTitle } from '@/components/PageShell'
import { usePageSession } from '@/hooks/usePageSession'
import { orgApi, orgErrorText } from '@/lib/institutional/client'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import InlineNotice from '@/components/ui/InlineNotice'
import Thread from '@/components/institutional/Thread'

export default function TuAsesorPage() {
  const { user, lang, toggleLang } = usePageSession('/tu-asesor')
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const [links, setLinks] = useState(null)
  const [error, setError] = useState(null)
  const [sel, setSel] = useState(null)

  const load = useCallback(async () => {
    try {
      const list = (await orgApi('client.links')).links || []
      // Los activos primero.
      list.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1))
      setLinks(list)
      setError(null)
    } catch (e) { setError(orgErrorText(e, lang)) }
  }, [lang])
  useEffect(() => { if (user) load() }, [user, load])

  const current = (links || []).find((l) => l.linkId === sel) || (links || [])[0] || null

  return (
    <PageShell user={user} lang={lang} setLang={toggleLang} width="narrow">
      <PageTitle icon={MessageSquare} title={t('Tu asesor', 'Your advisor')}
        subtitle={current ? `${current.orgName}${current.advisorName ? ` · ${current.advisorName}` : ''}` : undefined} />
      {error && <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={load}>{error}</InlineNotice>}
      {links === null && !error && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando...', 'Loading...')}</p>}
      {links && links.length === 0 && (
        <div className="card p-5 text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <p>{t('No tienes un asesor vinculado.', 'You have no linked advisor.')}</p>
          <Link href="/dashboard" className="underline" style={{ color: 'var(--accent-blue)' }}>{t('Volver a tu patrimonio', 'Back to your net worth')}</Link>
        </div>
      )}
      {links && links.length > 1 && (
        <SegmentedTabs value={current?.linkId} onChange={setSel} deps={[lang]} ariaLabel={t('Firmas', 'Firms')}
          tabs={links.map((l) => ({ key: l.linkId, label: l.orgName }))} />
      )}
      {current && user && (
        <>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {current.status === 'active'
              ? t('Tu asesor ve tu portafolio en modo lectura. Lo que ve y su actividad están en Ajustes, Compartir, Asesores; ahí también puedes revocar el acceso.',
                  'Your advisor sees your portfolio in read-only mode. What they see and their activity are in Settings, Share, Advisors; you can also revoke access there.')
              : t('Revocaste el acceso de esta firma. El hilo queda como registro.', 'You revoked this firm\'s access. The thread stays as a record.')}
          </p>
          <Thread key={current.linkId} linkId={current.linkId} uid={user.uid} lang={lang} />
        </>
      )}
    </PageShell>
  )
}
