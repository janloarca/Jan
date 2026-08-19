'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDashboardData } from '@/hooks/useDashboardData'
import { computeCosts } from '@/lib/costsSummary'
import PageShell, { PageTitle } from '@/components/PageShell'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { SkeletonCard } from '@/components/dashboard/Skeleton'
import { Receipt, TrendingDown, Landmark, Percent, ArrowDownRight, Wallet } from 'lucide-react'

export default function CostsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [lang, setLang] = useState('es')
  const [year, setYear] = useState('all')

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

  const { transactions, portfolioItems, convert, baseCurrency, settings, dataLoading } =
    useDashboardData({ user, lang, activePortfolio: '__all__' })

  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])

  const years = useMemo(() => {
    const set = new Set()
    for (const tx of transactions || []) {
      if (tx.date && tx.date.length >= 4) set.add(tx.date.slice(0, 4))
    }
    // Item-level costs (entryFee) are dated at acquisitionDate, not a
    // transaction — without this an account whose only cost is a manually
    // entered entry fee never gets a year button to filter by.
    for (const it of portfolioItems || []) {
      if (it.acquisitionDate && it.acquisitionDate.length >= 4) set.add(it.acquisitionDate.slice(0, 4))
    }
    return [...set].sort().reverse()
  }, [transactions, portfolioItems])

  const costs = useMemo(
    () => computeCosts({ transactions, items: portfolioItems, convert, baseCurrency, year: year === 'all' ? null : year }),
    [transactions, portfolioItems, convert, baseCurrency, year]
  )

  const fmt = useCallback((n) => {
    const v = Number(n) || 0
    try {
      return new Intl.NumberFormat(lang === 'es' ? 'es-GT' : 'en-US', {
        style: 'currency', currency: baseCurrency || 'USD', maximumFractionDigits: 2,
      }).format(v)
    } catch {
      return `${(baseCurrency || 'USD')} ${v.toFixed(2)}`
    }
  }, [lang, baseCurrency])

  const monthLabel = useCallback((mk) => {
    const [y, m] = mk.split('-')
    const d = new Date(Number(y), Number(m) - 1, 1)
    return d.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short', year: '2-digit' }).replace('.', '')
  }, [lang])

  // ---- render gates below every hook --------------------------------------
  if (authLoading || (user && dataLoading)) {
    return (
      <div className="min-h-screen bg-theme-base">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-5">
          <SkeletonCard /><SkeletonCard />
        </div>
      </div>
    )
  }
  if (!user) return null

  const breakdown = [
    { key: 'commissions', label: t('Comisiones', 'Commissions'), value: costs.commissions, Icon: TrendingDown, hint: t('De compras y ventas', 'From buys and sells') },
    { key: 'fees', label: t('Cargos', 'Fees'), value: costs.fees, Icon: Receipt, hint: t('Cargos del broker', 'Broker fees') },
    { key: 'taxes', label: t('Impuestos', 'Taxes'), value: costs.taxes, Icon: Landmark, hint: t('Retención de impuestos', 'Withholding tax') },
    { key: 'interestPaid', label: t('Intereses', 'Interest'), value: costs.interestPaid, Icon: Percent, hint: t('Interés de margen', 'Margin interest') },
    { key: 'assetCosts', label: t('Costos de cuenta', 'Account costs'), value: costs.assetCosts, Icon: Wallet, hint: t('Entrada, manejo y gastos que registraste a mano', 'Entry, management and expenses you entered by hand') },
  ].filter((b) => b.value > 0)

  const maxMonth = Math.max(1, ...costs.months.map((m) => costs.byMonth[m].total))

  return (
    <PageShell user={user} lang={lang} setLang={handleSetLang} settings={settings} width="narrow">
        {/* El selector de año era la firma exacta de SegmentedTabs (pastillas
            sobre un riel `--bg-tertiary`) escrita a mano: sin `role="tablist"`,
            sin el difuminado que avisa que la fila sigue, y con `py-1`, o sea un
            objetivo de ~24px donde el primitivo exige 28. */}
        <PageTitle icon={Receipt}
          title={t('Costos', 'Costs')}
          subtitle={t('Lo que pagas por invertir: comisiones, cargos, impuestos e intereses.',
                      'What you pay to invest: commissions, fees, taxes and interest.')}
          actions={years.length > 0 && (
            <SegmentedTabs
              variant="range"
              tabs={['all', ...years].map((y) => ({ key: y, label: y === 'all' ? t('Todo', 'All') : y }))}
              value={year}
              onChange={setYear}
              deps={[lang, years.length]}
              ariaLabel={t('Filtrar por año', 'Filter by year')}
            />
          )} />

        {!costs.hasData ? (
          <div className="card p-8 text-center">
            <Receipt size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm font-medium text-white mb-1">{t('Aún no hay costos registrados', 'No costs recorded yet')}</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              {t('Los costos aparecen cuando tus operaciones traen comisiones, cuando importas cargos/impuestos/intereses de tu broker, o cuando le agregas "Costos y comisiones" a una cuenta manual (bono, banco) al crearla o editarla.',
                 'Costs appear when your trades carry commissions, when you import fees/taxes/interest from your broker, or when you add "Costs & fees" to a manual account (bond, bank) when creating or editing it.')}
            </p>
          </div>
        ) : (
          <>
            {/* Total cost hero */}
            <div className="card p-4 sm:p-5">
              <h2 className="card-title mb-1">
                {t('Costo total', 'Total cost')} {year !== 'all' && `· ${year}`}
              </h2>
              <p className="text-3xl font-bold text-white tracking-tight">{fmt(costs.totalCost)}</p>
              <p className="text-xs text-slate-500 mt-1">
                {costs.count} {t('movimientos de costo', 'cost entries')}
              </p>
              {costs.interestReceived > 0 && (
                <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                  style={{ backgroundColor: 'var(--alert-success-bg)', color: 'var(--accent-green)' }}>
                  <ArrowDownRight size={13} />
                  {t('Interés recibido', 'Interest received')}: {fmt(costs.interestReceived)}
                </div>
              )}
            </div>

            {/* Breakdown cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {breakdown.map(({ key, label, value, Icon, hint }) => (
                <div key={key} className="card p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon size={14} style={{ color: 'var(--accent-blue)' }} />
                    <span className="text-xs text-slate-400">{label}</span>
                  </div>
                  <p className="text-lg font-bold text-white">{fmt(value)}</p>
                  <p className="text-micro mt-0.5" style={{ color: 'var(--text-muted)' }}>{hint}</p>
                </div>
              ))}
            </div>

            {/* By month */}
            {costs.months.length > 0 && (
              <div className="card p-4 sm:p-5">
                <h2 className="card-title mb-3">{t('Por mes', 'By month')}</h2>
                <div className="space-y-2">
                  {costs.months.slice(0, 12).map((mk) => {
                    const b = costs.byMonth[mk]
                    return (
                      <div key={mk} className="flex items-center gap-3">
                        <span className="text-xs text-slate-400 w-16 shrink-0">{monthLabel(mk)}</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.max(2, (b.total / maxMonth) * 100)}%`, backgroundColor: 'var(--accent-blue)' }} />
                        </div>
                        <span className="text-xs font-medium text-white w-24 text-right shrink-0">{fmt(b.total)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* By symbol */}
            {costs.bySymbol.length > 0 && (
              <div className="card p-4 sm:p-5">
                <h2 className="card-title mb-3">{t('Por activo', 'By asset')}</h2>
                <div className="space-y-1.5">
                  {costs.bySymbol.slice(0, 15).map((s) => (
                    <div key={s.symbol} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300 font-medium">{s.symbol}</span>
                      <span className="text-white">{fmt(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
    </PageShell>
  )
}
