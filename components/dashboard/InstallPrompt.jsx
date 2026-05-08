'use client'

import { useState, useEffect } from 'react'

export default function InstallPrompt({ lang }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(display-mode: standalone)').matches) return
    if (localStorage.getItem('chispudo-pwa-dismissed')) return

    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    if (isIOSDevice && !navigator.standalone) {
      setIsIOS(true)
      setShow(true)
      return
    }

    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') setShow(false)
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    setShow(false)
    localStorage.setItem('chispudo-pwa-dismissed', '1')
  }

  if (!show) return null

  return (
    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">
          {t('Instala Chispudo', 'Install Chispudo')}
        </p>
        <p className="text-xs text-slate-400">
          {isIOS
            ? t('Toca Compartir → Agregar a pantalla de inicio', 'Tap Share → Add to Home Screen')
            : t('Acceso rápido desde tu pantalla de inicio', 'Quick access from your home screen')}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!isIOS && (
          <button onClick={handleInstall}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 active:bg-blue-700 transition-colors">
            {t('Instalar', 'Install')}
          </button>
        )}
        <button onClick={handleDismiss}
          className="text-slate-500 hover:text-slate-300 text-lg leading-none">&times;</button>
      </div>
    </div>
  )
}
