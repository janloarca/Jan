'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/dashboard/Header'
import MobileNav from '@/components/dashboard/MobileNav'

// One page skeleton for every route outside the dashboard.
//
// Before this, each page invented its own: three container widths (max-w-7xl with
// lg:px-8, max-w-3xl without it, and none at all on /spreadsheet), three vertical
// rhythms, five different page-title treatments, and loading skeletons that used a
// different width than the page they preceded — so switching tabs made the content
// edge jump and stop lining up with the header logo.
//
// `width` exists because reading-width pages (friends, costs) genuinely want a
// narrower column than data-dense ones (finances) — but they now share the same
// gutters and rhythm, so the outer frame stays put either way.

const WIDTHS = {
  wide: 'max-w-7xl',
  narrow: 'max-w-3xl',
}

export function PageTitle({ icon: Icon, title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-h1 font-bold text-white flex items-center gap-2">
          {Icon && <Icon size={18} style={{ color: 'var(--accent-blue)' }} />}
          {title}
        </h1>
        {subtitle && <p className="text-caption mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export default function PageShell({
  children, user, lang, setLang, settings,
  width = 'narrow', mainClassName = '',
  // Mobile nav handlers default to sending the user home, which is what the
  // secondary pages did individually before.
  onAdd, onImport, onExport, onShare, onSettings, onSearch,
  headerProps = {},
}) {
  const router = useRouter()
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const go = useCallback(() => router.push('/dashboard'), [router])

  const handleSignOut = useCallback(async () => {
    const { auth } = await import('@/lib/firebase')
    const { signOut } = await import('firebase/auth')
    document.cookie = '__session=; path=/; max-age=0'
    if (auth) await signOut(auth)
    router.push('/login')
  }, [router])

  const friendsEnabled = settings?.friendsEnabled !== false

  return (
    <div className="min-h-screen bg-theme-base">
      <a href="#main-content" className="skip-link">{t('Ir al contenido', 'Skip to content')}</a>
      <Header
        user={user} lang={lang} setLang={setLang}
        friendsEnabled={friendsEnabled}
        onImport={onImport || go}
        onSettings={onSettings || go}
        onSignOut={handleSignOut}
        onRefresh={() => {}}
        pricesLoading={false}
        {...headerProps}
      />
      <main id="main-content"
        className={`${WIDTHS[width] || WIDTHS.narrow} mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 ${mainClassName}`}>
        {children}
      </main>
      {/* MobileNav already renders its own bottom spacer, so pages must NOT add
          their own pb-24 on top of it (that used to leave ~96px of dead space on
          some tabs and none on others). */}
      <MobileNav
        onAdd={onAdd || go} onImport={onImport || go} onExport={onExport || go}
        onShare={onShare || go} onSettings={onSettings || go} onSearch={onSearch}
        lang={lang} friendsEnabled={friendsEnabled}
      />
    </div>
  )
}
