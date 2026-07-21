'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Plus, Wallet, Calendar, Globe, BarChart3 } from 'lucide-react'

const ICON_MAP = { Zap, Plus, Wallet, Calendar, Globe, BarChart3 }

// Classic informational steps (modal route — no demo data on screen).
const STEPS_ES = [
  {
    title: 'Bienvenido a Chispudo',
    body: 'Tu plataforma de control financiero personal. Aquí puedes trackear tu portafolio completo: stocks, crypto, bonos, fondos, inmuebles y más.',
    icon: 'Zap',
    tip: 'Tip: Funciona offline como app instalable.',
  },
  {
    title: 'Agrega tus activos',
    body: 'Usa el botón "+" para agregar posiciones una por una, o importa tu portafolio desde un archivo Excel/CSV con detección automática de broker.',
    icon: 'Plus',
    tip: 'Soportamos IBKR, Fidelity, Schwab, Binance y formato libre.',
    action: 'add',
  },
  {
    title: 'Tu patrimonio neto',
    body: 'El panel principal muestra tu patrimonio, retorno YTD calculado con Modified Dietz, y comparación contra el S&P 500.',
    icon: 'Wallet',
    tip: 'Registramos snapshots automáticos para ver tu progreso en el tiempo.',
  },
  {
    title: 'Ingresos pasivos',
    body: 'Configura dividendos, intereses y rentas. Chispudo proyecta tu ingreso anual y muestra un calendario de pagos mes a mes.',
    icon: 'Calendar',
    tip: 'Soportamos tasa fija, variable y rendimiento continuo (DeFi).',
  },
  {
    title: 'Multi-moneda',
    body: 'Cambia tu moneda base en ajustes. Soportamos 14 monedas con tipo de cambio en tiempo real: perfecto para portafolios LatAm.',
    icon: 'Globe',
    tip: 'GTQ, MXN, COP, CLP, BRL, PEN, USD, EUR y más.',
  },
  {
    title: 'Reportes y análisis',
    body: 'Genera reportes PDF, imprime resúmenes, y comparte tu portafolio por WhatsApp. Usa Ctrl+K para acceso rápido a todo.',
    icon: 'BarChart3',
    tip: 'También puedes instalar la app en tu teléfono.',
    action: 'settings',
  },
]

const STEPS_EN = [
  {
    title: 'Welcome to Chispudo',
    body: 'Your personal financial control platform. Track your complete portfolio: stocks, crypto, bonds, funds, real estate and more.',
    icon: 'Zap',
    tip: 'Tip: Works offline as an installable app.',
  },
  {
    title: 'Add your assets',
    body: 'Use the "+" button to add positions one by one, or import your portfolio from an Excel/CSV file with automatic broker detection.',
    icon: 'Plus',
    tip: 'We support IBKR, Fidelity, Schwab, Binance, and custom formats.',
    action: 'add',
  },
  {
    title: 'Your net worth',
    body: 'The main panel shows your net worth, YTD return calculated with Modified Dietz, and comparison against the S&P 500.',
    icon: 'Wallet',
    tip: 'We record automatic snapshots to track your progress over time.',
  },
  {
    title: 'Passive income',
    body: 'Configure dividends, interest, and rental income. Chispudo projects your annual income and shows a month-by-month payment calendar.',
    icon: 'Calendar',
    tip: 'We support fixed, variable, and continuous yield (DeFi).',
  },
  {
    title: 'Multi-currency',
    body: 'Change your base currency in settings. We support 14 currencies with real-time exchange rates: perfect for LatAm portfolios.',
    icon: 'Globe',
    tip: 'GTQ, MXN, COP, CLP, BRL, PEN, USD, EUR and more.',
  },
  {
    title: 'Reports & analysis',
    body: 'Generate PDF reports, print summaries, and share your portfolio via WhatsApp. Use Ctrl+K for quick access to everything.',
    icon: 'BarChart3',
    tip: 'You can also install the app on your phone.',
    action: 'settings',
  },
]

// Anchored walkthrough over the REAL dashboard (requires demo data on screen).
// Steps whose anchor doesn't resolve are skipped automatically.
const DEMO_STEPS = (t) => [
  {
    anchor: '[data-card-id="OL-01"]',
    title: t('Tu patrimonio neto', 'Your net worth'),
    body: t('Todo lo que tienes menos tus deudas, en tu moneda. Aquí también ves tu retorno del año y el cambio del día.',
            'Everything you own minus your debts, in your currency. Your yearly return and daily change live here too.'),
  },
  {
    anchor: '[data-card-id="OR-01"]',
    title: t('Tu historia', 'Your history'),
    body: t('El valor de tu portafolio en el tiempo. Cambia el período, mira el rendimiento o compárate contra el S&P 500.',
            'Your portfolio value over time. Switch periods, view performance, or compare against the S&P 500.'),
  },
  {
    anchor: '[data-card-id="OR-02"]',
    title: t('En qué está tu dinero', 'Where your money is'),
    body: t('La distribución por tipo de activo: bancos, bolsa, cripto, inmuebles, bonos…',
            'The breakdown by asset type: banks, stocks, crypto, real estate, bonds…'),
  },
  {
    anchor: '[data-tour="actions"]',
    title: t('Todo se hace desde aquí', 'Everything happens here'),
    body: t('Agregar activos, importar de tu broker, registrar depósitos y retiros, exportar y compartir.',
            'Add assets, import from your broker, log deposits and withdrawals, export and share.'),
  },
  {
    anchor: '[data-card-id="SUGG-01"]',
    title: t('Chispu te cuida los datos', 'Chispu watches your data'),
    body: t('Si a una cuenta le falta historia, fecha o moneda, aquí aparece la sugerencia con un botón para arreglarlo.',
            'If an account is missing history, a date, or a currency, the suggestion shows up here with a one-tap fix.'),
  },
  {
    anchor: '[data-card-id="INST-01"]',
    title: t('Rendimiento por institución', 'Performance by institution'),
    body: t('Compara cómo le va a cada banco o broker donde tienes dinero: quién te está generando más.',
            'Compare how each bank or broker you hold money with is doing: who is earning you more.'),
  },
  {
    anchor: '[data-tour="header-new"]',
    title: t('Agrega en segundos', 'Add in seconds'),
    body: t('El botón "Nuevo" abre el formulario rápido: stocks, cuentas de banco, bonos, inmuebles, deudas: todo cabe.',
            'The "New" button opens the quick form: stocks, bank accounts, bonds, real estate, debts: everything fits.'),
  },
  {
    anchor: '[data-tour="header-import"]',
    title: t('¿Ya tienes broker?', 'Already have a broker?'),
    body: t('Importa el archivo de tu broker (detectamos IBKR, Binance, Schwab, Fidelity) o conéctalo para sync automático.',
            'Import your broker’s file (we detect IBKR, Binance, Schwab, Fidelity) or connect it for automatic sync.'),
  },
  {
    anchor: '[data-tour="nav"]',
    title: t('Hay más páginas', 'There’s more'),
    body: t('Finanzas: tus gastos e ingresos del mes. Hoja de Cálculo: la matriz mensual de todo tu patrimonio. Amigos: compara tu % de retorno sin revelar montos.',
            'Finances: your monthly spending and income. Spreadsheet: the month-by-month matrix of your net worth. Friends: compare return % without revealing amounts.'),
  },
  {
    anchor: '[data-tour="header-settings"]',
    title: t('Hazlo tuyo', 'Make it yours'),
    body: t('En ajustes cambias tu moneda base (14 disponibles), el tema, compartes tu portafolio y manejas tus conexiones.',
            'In settings you change your base currency (14 available), the theme, share your portfolio, and manage connections.'),
  },
]

export default function OnboardingTour({ lang, onAction, onComplete, onSeedDemo, onClearDemo, demoActive = false }) {
  const t = (es, en) => lang === 'es' ? es : en
  const router = useRouter()
  // mode: 'intro' (welcome + choice) | 'classic' (modal steps) | 'demo' (anchored)
  const [mode, setMode] = useState(demoActive ? 'demo' : 'intro')
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [seeding, setSeeding] = useState(false)
  // Returning from the per-page tour chain (PageTour set 'chispudo-tour-final'):
  // reopen straight on the closing card instead of restarting the walkthrough.
  const [finalStep, setFinalStep] = useState(() => {
    try {
      if (sessionStorage.getItem('chispudo-tour-final') === '1') {
        sessionStorage.removeItem('chispudo-tour-final')
        return true
      }
    } catch {}
    return false
  })
  const [rect, setRect] = useState(null)
  const retryRef = useRef(0)

  const classicSteps = lang === 'es' ? STEPS_ES : STEPS_EN
  const demoSteps = DEMO_STEPS(t)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  // After seeding, the items listener flips demoActive → enter the anchored route.
  useEffect(() => {
    if (seeding && demoActive) {
      setSeeding(false)
      setMode('demo')
      setStep(0)
    }
  }, [seeding, demoActive])

  const handleFinish = useCallback(() => {
    setVisible(false)
    setTimeout(() => {
      try { localStorage.setItem('chispudo-onboarding-done', '1') } catch {}
      onComplete()
    }, 200)
  }, [onComplete])

  // ── Anchored-step measurement: scroll target into view, then track its rect.
  const currentDemo = mode === 'demo' && !finalStep ? demoSteps[step] : null
  useEffect(() => {
    if (!currentDemo?.anchor) { setRect(null); return }
    let cancelled = false
    let raf = 0
    retryRef.current = 0

    const measure = () => {
      const el = document.querySelector(currentDemo.anchor)
      if (!el) return null
      return el.getBoundingClientRect()
    }

    const locate = () => {
      if (cancelled) return
      const el = document.querySelector(currentDemo.anchor)
      if (!el) {
        // Cards mount lazily right after the demo seed — retry briefly, then skip.
        // 6×300ms: enough for a lazy mount, short enough that a permanently-absent
        // anchor (e.g. the sm-only header nav on mobile) skips without a long stall.
        if (retryRef.current < 6) {
          retryRef.current += 1
          setTimeout(locate, 300)
        } else if (step < demoSteps.length - 1) {
          setStep((s) => s + 1)
        } else {
          setFinalStep(true)
        }
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => { if (!cancelled) setRect(measure()) }, 400)
    }

    const onReflow = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { if (!cancelled) setRect(measure()) })
    }

    locate()
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, { passive: true })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow)
    }
  }, [currentDemo?.anchor, step, demoSteps.length])

  const handleDemoNext = () => {
    if (step < demoSteps.length - 1) { setStep(step + 1); return }
    // Dashboard leg done: hand off to the per-page chain (Finanzas → Hoja de
    // Cálculo → Amigos, each explained by its own PageTour), which routes back
    // here with 'chispudo-tour-final' for the closing card.
    try {
      sessionStorage.setItem('chispudo-tour-page', 'finances')
      setRect(null)
      router.push('/finances')
    } catch {
      setRect(null)
      setFinalStep(true)
    }
  }

  const handleStartDemo = async () => {
    if (!onSeedDemo || seeding) return
    setSeeding(true)
    try {
      await onSeedDemo()
      // mode flips via the demoActive effect once items arrive
    } catch (e) {
      console.error('[onboarding] demo seed failed:', e)
      setSeeding(false)
    }
  }

  const handleClearAndAdd = async () => {
    try { await onClearDemo?.() } catch (e) { console.error('[onboarding] demo cleanup failed:', e) }
    handleFinish()
    setTimeout(() => onAction?.('add'), 300)
  }

  // ────────────────────────────── RENDER ──────────────────────────────

  // Anchored spotlight step (demo route)
  if (mode === 'demo' && !finalStep) {
    const current = demoSteps[step]
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
    const vh = typeof window !== 'undefined' ? window.innerHeight : 768
    const cardW = Math.min(vw - 24, 340)
    const below = rect ? rect.bottom + 200 < vh || rect.top < 200 : true
    const cardLeft = rect ? Math.min(Math.max(rect.left, 12), Math.max(vw - cardW - 12, 12)) : 12
    const cardTop = rect ? (below ? Math.min(rect.bottom + 12, vh - 190) : undefined) : undefined
    const cardBottom = rect && !below ? Math.max(vh - rect.top + 12, 12) : undefined

    return (
      <div className={`fixed inset-0 z-[60] transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Spotlight cutout: the box-shadow dims everything around the target */}
        {rect ? (
          <div className="fixed pointer-events-none transition-all duration-300"
            style={{
              top: rect.top - 6, left: rect.left - 6,
              width: rect.width + 12, height: rect.height + 12,
              borderRadius: 16,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              border: '2px solid var(--accent-blue)',
            }} />
        ) : (
          <div className="fixed inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} />
        )}
        {/* Click shield so the page underneath stays inert during the tour */}
        <div className="fixed inset-0" aria-hidden="true" />

        <div className="fixed modal-glass overflow-hidden"
          style={{ width: cardW, left: cardLeft, ...(cardTop != null ? { top: cardTop } : {}), ...(cardBottom != null ? { bottom: cardBottom } : {}) }}>
          <div className="p-4">
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
              {step + 1} / {demoSteps.length} · {t('Datos de ejemplo', 'Sample data')}
            </p>
            <h2 className="text-base font-bold text-white mb-1.5">{current.title}</h2>
            <p className="text-slate-400 text-sm leading-relaxed">{current.body}</p>
          </div>
          <div className="flex border-t border-glass-border">
            <button onClick={() => { setRect(null); setFinalStep(true) }}
              className="flex-1 px-3 py-2.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
              {t('Terminar', 'Finish')}
            </button>
            <button onClick={handleDemoNext}
              className="flex-1 px-3 py-2.5 text-xs font-medium transition-colors border-l border-glass-border hover:opacity-80"
              style={{ color: 'var(--accent-blue)' }}>
              {step < demoSteps.length - 1 ? t('Siguiente', 'Next') : t('Terminar', 'Finish')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Final step of the demo route (centered modal)
  if (mode === 'demo' && finalStep) {
    return (
      <div className={`fixed inset-0 z-[60] flex items-center justify-center p-4 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
        <div className="modal-glass max-w-md w-full overflow-hidden">
          <div className="p-8 text-center">
            <div className="flex justify-center mb-4"><Zap size={40} style={{ color: 'var(--accent-blue)' }} /></div>
            <h2 className="text-xl font-bold text-white mb-3">{t('¿Listo para lo tuyo?', 'Ready for your own?')}</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              {t('Puedes borrar los datos de ejemplo y agregar tu primer activo, o seguir explorando un rato: el banner de arriba siempre te deja salir del modo demo.',
                 'You can delete the sample data and add your first asset, or keep exploring: the banner up top always lets you exit demo mode.')}
            </p>
          </div>
          <div className="flex flex-col gap-2 px-6 pb-6">
            <button onClick={handleClearAndAdd}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium"
              style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
              {t('Borrar demo y agregar lo mío', 'Delete demo and add my own')}
            </button>
            <button onClick={handleFinish}
              className="w-full px-4 py-2 text-xs underline underline-offset-2" style={{ color: 'var(--text-muted)' }}>
              {t('Seguir explorando el ejemplo', 'Keep exploring the sample')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Intro (welcome + choice) and classic modal steps
  const isIntro = mode === 'intro'
  const current = isIntro ? classicSteps[0] : classicSteps[step]

  return (
    <div className={`fixed inset-0 z-[60] flex items-center justify-center p-4 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div className="modal-glass max-w-md w-full overflow-hidden">
        <div className="p-8 text-center">
          <div className="flex justify-center mb-4">
            {(() => { const IconComp = ICON_MAP[current.icon]; return IconComp ? <IconComp size={40} style={{ color: 'var(--accent-blue)' }} /> : null })()}
          </div>
          <h2 className="text-xl font-bold text-white mb-3">{current.title}</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">{current.body}</p>
          {current.tip && (
            <div className="inline-block px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.1)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(37,99,235,0.2)' }}>
              <p className="text-xs" style={{ color: 'var(--accent-blue)' }}>{current.tip}</p>
            </div>
          )}
        </div>

        {isIntro ? (
          <div className="flex flex-col gap-2 px-6 pb-6">
            {onSeedDemo && (
              <button onClick={handleStartDemo} disabled={seeding}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-60"
                style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                {seeding ? t('Cargando ejemplo...', 'Loading sample...') : t('Explorar con datos de ejemplo', 'Explore with sample data')}
              </button>
            )}
            <button onClick={() => { handleFinish(); setTimeout(() => onAction?.('add'), 300) }}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-medium border"
              style={{ color: 'var(--accent-blue)', borderColor: 'rgba(37,99,235,0.35)' }}>
              {t('Agregar mi primer activo', 'Add my first asset')}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button onClick={handleFinish} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                {t('Omitir', 'Skip')}
              </button>
              <button onClick={() => { setMode('classic'); setStep(1) }}
                className="text-xs underline underline-offset-2" style={{ color: 'var(--text-muted)' }}>
                {t('Solo cuéntame cómo funciona', 'Just tell me how it works')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Progress dots */}
            <div className="flex justify-center gap-1.5 pb-4">
              {classicSteps.map((_, i) => (
                <button key={i} onClick={() => setStep(i)}
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: i === step ? '1.5rem' : '0.5rem',
                    backgroundColor: i === step ? 'var(--accent-blue-soft)' : i < step ? 'rgba(37,99,235,0.4)' : '#475569'
                  }} />
              ))}
            </div>

            <div className="flex border-t border-glass-border">
              <button onClick={handleFinish}
                className="flex-1 px-4 py-3.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
                {t('Omitir', 'Skip')}
              </button>
              {current.action && (
                <button onClick={() => { handleFinish(); setTimeout(() => onAction?.(current.action), 250) }}
                  className="flex-1 px-4 py-3.5 text-sm font-medium transition-colors border-l border-glass-border hover:opacity-80"
                  style={{ color: '#22d3ee' }}>
                  {current.action === 'add' ? t('Agregar ahora', 'Add now') : t('Ir a ajustes', 'Go to settings')}
                </button>
              )}
              <button onClick={() => { if (step < classicSteps.length - 1) setStep(step + 1); else handleFinish() }}
                className="flex-1 px-4 py-3.5 text-sm font-medium transition-colors border-l border-glass-border hover:opacity-80"
                style={{ color: 'var(--accent-blue)' }}>
                {step < classicSteps.length - 1 ? t('Siguiente', 'Next') : t('Empezar', 'Start')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
