'use client'

// World: tu portafolio como una ciudad. Un edificio por institución, un piso
// por inversión. Es solo una forma de dibujar los datos: no calcula nada nuevo
// y ninguna cifra que muestra sale de otro lado que del portafolio.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { useDashboardData } from '@/hooks/useDashboardData'
import { hasDemoData } from '@/lib/demoData'
import { buildWorld } from '@/lib/worldModel'
import PageShell, { PageTitle } from '@/components/PageShell'
import { SkeletonCard } from '@/components/dashboard/Skeleton'
import WorldSummary from '@/components/world/WorldSummary'
import WorldScene from '@/components/world/WorldScene'

export default function WorldPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [lang, setLang] = useState('es')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
    }
  }, [])
  const handleSetLang = useCallback(() => {
    const next = lang === 'en' ? 'es' : 'en'
    setLang(next)
    if (typeof window !== 'undefined') localStorage.setItem('chispudo-lang', next)
  }, [lang])

  useEffect(() => {
    let unsubscribe = () => {}
    async function initAuth() {
      const { auth } = await import('@/lib/firebase')
      const { onIdTokenChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push('/login'); return }
      unsubscribe = onIdTokenChanged(auth, (currentUser) => {
        if (!currentUser) router.push('/login')
        else setUser(currentUser)
        setAuthLoading(false)
      })
    }
    initAuth()
    return () => unsubscribe()
  }, [router])

  // ratesLoading gatea igual que en Costos: sin tasas, convert es 1:1 y el
  // tamaño de cada edificio saldría de montos sin convertir.
  const { portfolioItems, baseCurrency, settings, dataLoading, ratesLoading } =
    useDashboardData({ user, lang, activePortfolio: '__all__' })

  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  const world = useMemo(() => buildWorld(portfolioItems || [], { lang }), [portfolioItems, lang])

  if (authLoading || (user && (dataLoading || ratesLoading))) {
    return (
      <div className="min-h-screen bg-theme-base">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
          <SkeletonCard /><SkeletonCard />
        </div>
      </div>
    )
  }
  if (!user) return null

  return (
    <PageShell user={user} lang={lang} setLang={handleSetLang} settings={settings} width="wide"
      demoActive={hasDemoData(portfolioItems)}>
      <PageTitle icon={Building2}
        title={t('Mundo', 'World')}
        subtitle={t('Tu dinero trabajando: un edificio por institución, un piso por inversión.',
                    'Your money is working: one building per institution, one floor per investment.')} />

      {world.buildings.length === 0 ? (
        <div className="card p-8 text-center">
          <Building2 size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            {t('Tu ciudad todavía está vacía', 'Your city is still empty')}
          </p>
          <p className="text-xs max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {t('Agrega tu primera cuenta en el tablero y aquí aparece su edificio.',
               'Add your first account on the dashboard and its building appears here.')}
          </p>
        </div>
      ) : (
        <>
          <WorldSummary world={world} lang={lang} baseCurrency={baseCurrency} />
          <WorldScene world={world} lang={lang} baseCurrency={baseCurrency} />
          <p className="text-micro" style={{ color: 'var(--text-muted)' }}>
            {t('El tamaño de cada edificio sigue al capital invertido; la gente y las animaciones son una forma de dibujarlo, no un dato.',
               'Each building grows with the capital invested; the people and animations are a way of drawing it, not data.')}
          </p>
        </>
      )}
    </PageShell>
  )
}
