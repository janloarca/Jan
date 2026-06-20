'use client'

import { useState, useEffect, useCallback } from 'react'
import { Zap, Plus, Wallet, Calendar, Globe, BarChart3 } from 'lucide-react'

const ICON_MAP = { Zap, Plus, Wallet, Calendar, Globe, BarChart3 }

const STEPS_ES = [
  {
    title: 'Bienvenido a Chispudo',
    body: 'Tu plataforma de control financiero personal. Aquí puedes trackear tu portafolio completo — stocks, crypto, bonos, fondos, inmuebles y más.',
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
    body: 'Cambia tu moneda base en ajustes. Soportamos 14 monedas con tipo de cambio en tiempo real — perfecto para portafolios LatAm.',
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
    body: 'Your personal financial control platform. Track your complete portfolio — stocks, crypto, bonds, funds, real estate and more.',
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
    body: 'Change your base currency in settings. We support 14 currencies with real-time exchange rates — perfect for LatAm portfolios.',
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

export default function OnboardingTour({ lang, onAction, onComplete }) {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)

  const steps = lang === 'es' ? STEPS_ES : STEPS_EN
  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  const handleNext = useCallback(() => {
    if (step < steps.length - 1) {
      setStep(step + 1)
    } else {
      handleFinish()
    }
  }, [step, steps.length])

  const handleFinish = useCallback(() => {
    setVisible(false)
    setTimeout(() => {
      try { localStorage.setItem('chispudo-onboarding-done', '1') } catch {}
      onComplete()
    }, 200)
  }, [onComplete])

  const handleAction = useCallback(() => {
    const action = steps[step]?.action
    if (action && onAction) {
      handleFinish()
      setTimeout(() => onAction(action), 250)
    }
  }, [step, steps, onAction, handleFinish])

  const current = steps[step]

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
            <div className="inline-block px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(59,130,246,0.2)' }}>
              <p className="text-xs" style={{ color: 'var(--accent-blue)' }}>{current.tip}</p>
            </div>
          )}
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 pb-4">
          {steps.map((_, i) => (
            <button key={i} onClick={() => setStep(i)}
              className="h-2 rounded-full transition-all"
              style={{
                width: i === step ? '1.5rem' : '0.5rem',
                backgroundColor: i === step ? 'var(--accent-blue-soft)' : i < step ? 'rgba(108,122,255,0.4)' : '#475569'
              }} />
          ))}
        </div>

        {/* Actions */}
        <div className="flex border-t border-glass-border">
          <button onClick={handleFinish}
            className="flex-1 px-4 py-3.5 text-sm text-slate-500 hover:text-slate-300 transition-colors">
            {t('Omitir', 'Skip')}
          </button>
          {current.action && (
            <button onClick={handleAction}
              className="flex-1 px-4 py-3.5 text-sm font-medium transition-colors border-l border-glass-border hover:opacity-80"
              style={{ color: '#22d3ee' }}>
              {current.action === 'add' ? t('Agregar ahora', 'Add now') : t('Ir a ajustes', 'Go to settings')}
            </button>
          )}
          <button onClick={handleNext}
            className="flex-1 px-4 py-3.5 text-sm font-medium transition-colors border-l border-glass-border hover:opacity-80"
            style={{ color: 'var(--accent-blue)' }}>
            {step < steps.length - 1 ? t('Siguiente', 'Next') : t('Empezar', 'Start')}
          </button>
        </div>
      </div>
    </div>
  )
}
