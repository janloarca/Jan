'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Per-page leg of the demo walkthrough. The dashboard tour hands off to this chain
// via sessionStorage ('chispudo-tour-page' = pageKey): each page mounts a PageTour
// that, when the flag matches, walks through centered cards explaining THAT page,
// then advances the flag and routes to the next stop. The last stop routes back to
// /dashboard with 'chispudo-tour-final' so OnboardingTour reopens on its final card.
const FLAG = 'chispudo-tour-page'
const FINAL_FLAG = 'chispudo-tour-final'

export default function PageTour({ pageKey, steps, nextRoute, nextFlag, lang = 'es' }) {
  const router = useRouter()
  const t = (es, en) => lang === 'es' ? es : en
  const [active, setActive] = useState(false)
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(FLAG) === pageKey) {
        setActive(true)
        setTimeout(() => setVisible(true), 250)
      }
    } catch {}
  }, [pageKey])

  if (!active || !steps || steps.length === 0) return null
  const current = steps[step]

  const advance = () => {
    try {
      if (nextFlag) {
        sessionStorage.setItem(FLAG, nextFlag)
      } else {
        sessionStorage.removeItem(FLAG)
        sessionStorage.setItem(FINAL_FLAG, '1')
      }
    } catch {}
    setActive(false)
    router.push(nextRoute || '/dashboard')
  }

  const endTour = () => {
    // Skipping ends the whole chain and returns home to the closing card.
    try {
      sessionStorage.removeItem(FLAG)
      sessionStorage.setItem(FINAL_FLAG, '1')
    } catch {}
    setActive(false)
    router.push('/dashboard')
  }

  const handleNext = () => {
    if (step < steps.length - 1) setStep(step + 1)
    else advance()
  }

  return (
    <div className={`fixed inset-0 z-[60] flex items-center justify-center p-4 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div className="modal-glass max-w-md w-full overflow-hidden">
        <div className="p-6">
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            {step + 1} / {steps.length} · {current.tab}
          </p>
          <h2 className="text-lg font-bold text-white mb-2">{current.title}</h2>
          <p className="text-slate-400 text-sm leading-relaxed">{current.body}</p>
          {current.tip && (
            <div className="mt-3 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)' }}>
              <p className="text-xs" style={{ color: 'var(--accent-blue)' }}>{current.tip}</p>
            </div>
          )}
        </div>
        <div className="flex border-t border-glass-border">
          <button onClick={endTour}
            className="flex-1 px-3 py-3 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            {t('Terminar tour', 'End tour')}
          </button>
          <button onClick={handleNext}
            className="flex-1 px-3 py-3 text-xs font-medium transition-colors border-l border-glass-border hover:opacity-80"
            style={{ color: 'var(--accent-blue)' }}>
            {step < steps.length - 1 ? t('Siguiente', 'Next') : (nextFlag ? t('Siguiente página', 'Next page') : t('Volver al inicio', 'Back home'))}
          </button>
        </div>
      </div>
    </div>
  )
}
