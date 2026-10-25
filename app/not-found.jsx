'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// 404 bilingüe. La preferencia de idioma vive en localStorage, así que se lee
// en un efecto (nunca durante el render: el servidor no la tiene y rompería la
// hidratación). Arranca en español, el idioma por defecto de la app.
export default function NotFound() {
  const [lang, setLang] = useState('es')
  useEffect(() => {
    try {
      if (localStorage.getItem('chispudo-lang') === 'en') setLang('en')
    } catch { /* sin storage: queda el default */ }
  }, [])
  const t = (es, en) => (lang === 'es' ? es : en)
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center" style={{ background: 'var(--bg-primary)' }}>
      <h1 className="text-h2" style={{ color: 'var(--text-primary)' }}>{t('Página no encontrada', 'Page not found')}</h1>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('La página que buscas no existe o se movió.', 'The page you are looking for does not exist or has moved.')}</p>
      <Link href="/dashboard" className="btn-primary px-4 py-2 rounded-xl text-sm">{t('Ir al tablero', 'Go to dashboard')}</Link>
    </main>
  )
}
