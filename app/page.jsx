'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Logo from '@/components/ui/Logo'
import ChispudoLoader from '@/components/ui/ChispudoLoader'
import { Globe, BarChart3, Coins, Calendar, Lock, FolderOpen, Check, X, Minus, ArrowRight } from 'lucide-react'

// Ambient brand glow — same dual radial-blue idiom app/login/page.jsx already
// uses for its full-screen background, just scaled up for a landing hero.
// Reusing the exact color (rgba(37,99,235,...) === --accent-blue) instead of
// inventing a new gradient keeps this the same brand, louder.
const HERO_GLOW = {
  background: [
    'radial-gradient(ellipse 60% 50% at 15% 20%, rgba(37,99,235,0.10) 0%, transparent 60%)',
    'radial-gradient(ellipse 50% 45% at 85% 0%, rgba(37,99,235,0.08) 0%, transparent 55%)',
    'radial-gradient(ellipse 40% 35% at 50% 100%, rgba(37,99,235,0.05) 0%, transparent 60%)',
    'var(--bg-primary)',
  ].join(', '),
}
const CTA_GLOW = {
  background: [
    'radial-gradient(ellipse 55% 60% at 50% 0%, rgba(37,99,235,0.07) 0%, transparent 60%)',
    'var(--bg-primary)',
  ].join(', '),
}

const FEATURES = [
  {
    Icon: Globe,
    color: 'var(--accent-blue)',
    title: 'LatAm Native',
    desc: 'GTQ, MXN, COP, CLP. Detect institutions in Guatemala, Mexico, Colombia. No Plaid required.',
  },
  {
    Icon: BarChart3,
    color: 'var(--accent-purple)',
    title: 'Every Asset Type',
    desc: 'Stocks, crypto, bonds, real estate, funds, DeFi yield, SAFE notes, private debt, and more.',
  },
  {
    Icon: Coins,
    color: 'var(--accent-green)',
    title: 'Income Tracking',
    desc: 'Auto-detect dividends, model variable rates, track continuous DeFi yield in real-time.',
  },
  {
    Icon: Calendar,
    color: 'var(--accent-orange)',
    title: 'Maturity Calendar',
    desc: 'See when bonds mature, when payments arrive, and what capital returns are coming.',
  },
  {
    Icon: Lock,
    color: 'var(--accent-cyan)',
    title: 'Advisor Mode',
    desc: 'Share a read-only link with your financial advisor or accountant. Privacy built in.',
  },
  {
    Icon: FolderOpen,
    color: 'var(--accent-pink)',
    title: 'Document Vault',
    desc: 'Attach contracts, certificates, and receipts directly to each asset.',
  },
]

const COMPARE_ROWS = [
  ['LatAm currencies & institutions', 'yes', 'no', 'no'],
  ['Variable rate instruments', 'yes', 'partial', 'no'],
  ['DeFi yield tracking', 'yes', 'no', 'partial'],
  ['Bond maturity tracking', 'yes', 'no', 'partial'],
  ['SAFE / VC tracking', 'yes', 'partial', 'no'],
  ['Debt / liability tracking', 'yes', 'yes', 'partial'],
  ['Advisor mode (read-only share)', 'yes', 'no', 'no'],
  ['Document vault', 'yes', 'yes', 'no'],
  ['Multi-currency income', 'yes', 'partial', 'partial'],
  ['Price', 'Free', '$150/yr', 'Varies'],
]

// The state a cell can be in gets a shape AND a color, never color alone —
// same principle the dashboard redesign used for allocation/health status.
function CompareMark({ state }) {
  const styles = {
    yes: { bg: 'color-mix(in srgb, var(--accent-green) 16%, transparent)', fg: 'var(--accent-green)', Icon: Check },
    no: { bg: 'color-mix(in srgb, var(--text-negative) 12%, transparent)', fg: 'var(--text-negative)', Icon: X },
    partial: { bg: 'color-mix(in srgb, var(--accent-orange) 15%, transparent)', fg: 'var(--accent-orange)', Icon: Minus },
  }[state]
  const { Icon, bg, fg } = styles
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ backgroundColor: bg, color: fg }}>
      <Icon size={13} strokeWidth={3} />
    </span>
  )
}

function CompareCell({ value, isChispudo }) {
  if (value === 'yes' || value === 'no' || value === 'partial') return <CompareMark state={value} />
  return (
    <span className="font-semibold" style={{ color: isChispudo ? 'var(--accent-blue)' : 'var(--text-secondary)' }}>
      {value}
    </span>
  )
}

// A compact, deliberately stylized "at a glance" preview of what the real
// dashboard looks like — not a screenshot (none exists), and not trying to
// pass as one. Same visual grammar as the app's own charts (inline SVG area
// line, thin allocation bar), just small enough to sit beside the hero copy.
function HeroPreviewCard() {
  const points = [30, 34, 28, 40, 46, 42, 52, 58, 55, 64, 70, 66, 76]
  const W = 280, H = 72
  const x = (i) => (i / (points.length - 1)) * W
  const min = Math.min(...points), max = Math.max(...points)
  const y = (v) => H - ((v - min) / (max - min)) * (H - 8) - 4
  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L ${W} ${H} L 0 ${H} Z`

  return (
    <div
      className="card-glass rounded-2xl p-6 w-full max-w-[380px]"
      style={{ transform: 'rotate(-1.2deg)', boxShadow: '0 24px 60px -20px rgba(37,99,235,0.28), var(--shadow-elevated)' }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Patrimonio total</span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full landing-ytd-text"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent-green) 14%, transparent)' }}>
          +7.57% YTD
        </span>
      </div>
      <div className="text-3xl font-black tracking-tight mb-4" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        $23,226.07
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mb-4" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="heroPreviewFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#heroPreviewFill)" />
        <path d={line} fill="none" stroke="var(--accent-blue)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <div className="flex w-full h-2 rounded-full overflow-hidden mb-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
        <span style={{ width: '54%', backgroundColor: 'var(--accent-blue)' }} />
        <span style={{ width: '27%', backgroundColor: 'var(--accent-cyan)' }} />
        <span style={{ width: '12%', backgroundColor: 'var(--accent-purple)' }} />
        <span style={{ width: '7%', backgroundColor: 'var(--bg-tertiary)', filter: 'brightness(0.7)' }} />
      </div>
      <div className="flex items-center gap-3 text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
        <span>Acciones</span><span>Bonos</span><span>Cripto</span><span>Efectivo</span>
      </div>
    </div>
  )
}

export default function Home() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    import('@/lib/firebase').then(({ auth }) => {
      if (!auth) { setChecking(false); return }
      import('firebase/auth').then(({ onAuthStateChanged }) => {
        const unsub = onAuthStateChanged(auth, (user) => {
          if (user) {
            router.push('/dashboard')
          } else {
            setChecking(false)
          }
          unsub()
        })
      })
    })
  }, [router])

  if (checking) {
    return <ChispudoLoader mode="fullscreen" state="initial-loading" />
  }

  return (
    <div className="min-h-screen bg-theme-base text-white">
      {/* Small text on a tinted brand-color background needs a stronger variant
          than the base token to clear 4.5:1 (verified with real luminance math,
          not eyeballed) — the base --accent-blue only reaches ~3.6:1 on the dark
          background and --accent-green only ~3.8:1 on the light one. Reuses
          existing tokens where one already flips the right direction per theme
          (--accent-blue-soft/-strong); the green has no such pair, so its light
          value is the one deliberate literal, same AA-safe shade already used
          for this exact problem in the dashboard mockup. */}
      <style>{`
        .landing-badge-text { color: var(--accent-blue-soft); }
        [data-theme="light"] .landing-badge-text { color: var(--accent-blue-strong); }
        .landing-ytd-text { color: var(--accent-green); }
        [data-theme="light"] .landing-ytd-text { color: #0B7A54; }
      `}</style>
      {/* Hero + header share one ambient glow so the wash doesn't visibly seam */}
      <div style={HERO_GLOW}>
        <header className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          <Logo size={28} />
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/login')}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors">
              Log in
            </button>
            <button onClick={() => router.push('/login')}
              className="btn-primary text-sm">
              Get started
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6">
          {/* Hero section */}
          <section className="pt-14 pb-20 grid lg:grid-cols-[1.1fr_0.9fr] gap-14 items-center">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
                style={{ backgroundColor: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.22)' }}>
                <Logo variant="icon" size={13} />
                <span className="text-xs font-semibold landing-badge-text">Hecho para Latinoamérica</span>
              </div>

              <h1 className="font-black tracking-tight mb-5" style={{ fontSize: 'clamp(2.75rem, 5vw, 4.25rem)', lineHeight: 1.05, letterSpacing: '-0.03em', textWrap: 'balance' }}>
                <span style={{ color: 'var(--text-primary)' }}>Track your entire portfolio.</span>
                <br />
                <span style={{
                  backgroundImage: 'linear-gradient(90deg, var(--accent-blue), var(--accent-blue-strong))',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'var(--accent-blue)',
                }}>
                  Not just stocks.
                </span>
              </h1>

              <p className="text-lg max-w-xl mx-auto lg:mx-0 mb-8" style={{ color: 'var(--text-secondary)' }}>
                Bonds, real estate, DeFi, SAFE notes, private equity, bank accounts, all in one place.
                Built for Latin America. Works everywhere.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 mb-6">
                <button onClick={() => router.push('/login')}
                  className="btn-primary px-8 py-3 text-base w-full sm:w-auto">
                  Start for free
                </button>
                <a href="#features"
                  className="inline-flex items-center gap-1.5 px-8 py-3 text-base font-medium rounded-lg border transition-colors w-full sm:w-auto justify-center"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                  See how it works
                  <ArrowRight size={16} />
                </a>
              </div>
              <p className="text-xs mb-10" style={{ color: 'var(--text-muted)' }}>No credit card needed. Free forever.</p>

              <div className="flex items-center justify-center lg:justify-start gap-8">
                {[
                  ['6', 'Monedas LatAm'],
                  ['12+', 'Tipos de activo'],
                  ['100%', 'Gratis'],
                ].map(([num, label], i) => (
                  <div key={i} className="text-center lg:text-left">
                    <div className="text-2xl font-black" style={{ color: 'var(--accent-blue)', letterSpacing: '-0.01em' }}>{num}</div>
                    <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-center lg:justify-end">
              <HeroPreviewCard />
            </div>
          </section>
        </main>
      </div>

      <main className="max-w-6xl mx-auto px-6">
        {/* Features grid */}
        <section id="features" className="py-16 scroll-mt-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div key={i} className="rounded-xl p-6"
                style={{ backgroundColor: 'var(--bg-card)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-card)', border: 'var(--glass-border)' }}>
                <div className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
                  style={{
                    backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${f.color} 13%, transparent), color-mix(in srgb, ${f.color} 4%, transparent))`,
                    border: `1px solid color-mix(in srgb, ${f.color} 24%, transparent)`,
                  }}>
                  <f.Icon size={20} style={{ color: f.color }} strokeWidth={2} />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Comparison */}
        <section className="py-16">
          <h2 className="text-2xl font-bold text-center mb-8">Why Chispudo?</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-glass-border">
                  <th className="text-left py-3 px-4 text-slate-400 font-medium">Feature</th>
                  <th className="py-3 px-4 font-bold" style={{ color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 5%, transparent)' }}>Chispudo</th>
                  <th className="py-3 px-4 text-slate-500 font-medium">Kubera</th>
                  <th className="py-3 px-4 text-slate-500 font-medium">Others</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                {COMPARE_ROWS.map(([feat, c, k, o], i) => (
                  <tr key={i} className="border-b border-glass-border/30">
                    <td className="py-2.5 px-4 text-slate-300">{feat}</td>
                    <td className="py-2.5 px-4 text-center" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 5%, transparent)' }}>
                      <span className="inline-flex items-center justify-center"><CompareCell value={c} isChispudo /></span>
                    </td>
                    <td className="py-2.5 px-4 text-center"><span className="inline-flex items-center justify-center"><CompareCell value={k} /></span></td>
                    <td className="py-2.5 px-4 text-center"><span className="inline-flex items-center justify-center"><CompareCell value={o} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* CTA — its own subtler glow so it closes the page instead of repeating a flat block */}
      <div style={CTA_GLOW}>
        <section className="max-w-6xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to see your full picture?</h2>
          <p className="mb-8" style={{ color: 'var(--text-secondary)' }}>Free. No credit card. Takes 2 minutes.</p>
          <button onClick={() => router.push('/login')}
            className="btn-primary px-10 py-4 text-base">
            Create your portfolio
          </button>
        </section>
      </div>

      <footer className="border-t border-glass-border/50 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>Chispudo · chispu.xyz</span>
          <span>The portfolio tracker that actually works for Latin America.</span>
        </div>
      </footer>
    </div>
  )
}
