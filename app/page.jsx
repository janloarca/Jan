'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Logo from '@/components/ui/Logo'
import ChispudoLoader from '@/components/ui/ChispudoLoader'
import { ArrowRight, ShieldCheck, KeyRound, Lock, Share2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// La landing es una superficie de PALETA FIJA: se ve igual sin importar el tema
// del visitante, igual que PrintSummary se compromete con monocromo sobre papel.
//
// Eso NO es capricho. La app arranca en tema oscuro por default
// (app/layout.jsx) y el único selector de tema vive dentro de SettingsModal,
// detrás del login: un visitante deslogueado no tiene forma de cambiarlo. Si
// esta página usara los tokens, "fondo blanco" sería falso para todo el que
// llega por primera vez, que son exactamente las personas para las que existe.
//
// De ahí salen dos reglas que hay que respetar al editar este archivo:
//
//   1. NADA de `.text-white` ni de `.text-slate-300/400/500`. globals.css las
//      remapea con !important en tema claro, así que sobre una superficie
//      siempre-blanca dicen lo contrario de lo que uno escribió. Es el bug de
//      FASE HT2. Acá todo color va como hex explícito.
//   2. NADA de `.btn-primary`: es compartida y en tema claro se vuelve casi
//      negra, o sea el botón principal cambiaría de color según una preferencia
//      que el visitante ni siquiera puede tocar. Esta página lleva su botón.
// ---------------------------------------------------------------------------
const C = {
  ink: '#111827',      // títulos            17.74:1 sobre blanco
  body: '#374151',     // texto              10.31:1
  muted: '#6B7280',    // secundario          4.83:1, el mínimo que pasa AA
  line: '#E5E7EB',
  page: '#FFFFFF',
  band: '#F8F9FB',
  blue: '#2563EB',
  blueDark: '#1D4ED8',
}

// Los cuatro acentos salen de CHART_PALETTE y se eligieron MIDIENDO con
// lib/colorMath.js, no a ojo. Contra las otras dos combinaciones candidatas,
// esta tiene el mejor peor-caso bajo daltonismo (7.65 de ΔE, contra 3.27 de la
// alternativa con magenta) y 19.85 entre los dos más parecidos.
//
// ⚠️ Sobre blanco, el morado da 3.27 y el naranja 3.18 de contraste. Eso pasa
// AA solo para texto GRANDE (umbral 3.0) y FALLA para texto normal (4.5). Por
// eso el acento vive en la pastilla del icono, en el número de orden y en
// fondos teñidos, y NUNCA en texto chico: los títulos van en C.ink.
const MODES = [
  {
    num: '01',
    name: 'Wealth',
    accent: '#2563EB',
    title: 'Know what you own, and what it is actually doing.',
    lede: 'Wealth management for a portfolio that was never only stocks.',
    points: [
      'Net worth across every asset type, held in any of 60 currencies.',
      'Time-weighted and money-weighted return, side by side, so a deposit never reads as a gain.',
      'Dividends you already collected over 12 months, and 12 months projected forward.',
      'Allocation by type, sector, geography, currency, institution and maturity.',
      'Risk past the basics: Sharpe, Sortino, beta and maximum drawdown.',
      'Commissions, fees and withholding tax, on a page of their own.',
      'A scenario simulator that runs 1,000 Monte Carlo paths.',
    ],
  },
  {
    num: '02',
    name: 'Cash flow',
    accent: '#00764F',
    title: 'Earn more, spend less, on purpose.',
    lede: 'The part that decides how much there is to invest in the first place.',
    points: [
      'Income and expenses month by month, with your savings rate on top.',
      'Seventeen categories that fill themselves in.',
      'This month against last month, and against the same month last year.',
      'Expenses captured on their own, from your phone and from your bank alert emails.',
      'Statement import that adds only what is missing, and never a duplicate.',
      'It tells you what changed: the category that grew, the small spends that quietly add up.',
    ],
  },
  {
    num: '03',
    name: 'The sheet',
    accent: '#B274DC',
    title: 'Every month, every account, one grid.',
    lede: 'The long view, and the paperwork that comes with it.',
    points: [
      'Month by month, per asset and per institution, rebuilt from your real history.',
      'Year over year, plus separate views for debts and property.',
      'Multi-currency, with every month converted at the rates of that month.',
      'Excel download with the formatting inside: frozen panes, subtotals, accounting negatives.',
      'A statement-style PDF over five periods, with methodology and a glossary.',
      'Weekly, monthly and annual emails, with the PDF and the spreadsheet attached.',
    ],
  },
  {
    num: '04',
    name: 'Friends',
    accent: '#E07227',
    title: 'Compare returns. Never amounts.',
    lede: 'A leaderboard where nobody finds out what you are worth.',
    points: [
      'Private groups by invite code, ranked by the year or by the month.',
      'Only percentages and symbols ever leave your account.',
      'The server strips every other field before it reaches anyone else.',
      'An anonymous global ranking: a pseudonym and a percentage, nothing else.',
      'Turn it off and your public profile is deleted, out of every group, at once.',
    ],
  },
]

const SECURITY = [
  {
    Icon: ShieldCheck,
    title: 'Only you can read it',
    body: 'Database rules deny everyone by default. Your own space is the single path that opens, and it opens only for you.',
  },
  {
    Icon: KeyRound,
    title: 'We never ask for your bank password',
    body: 'No aggregator, no screen scraping. Broker connections are read-only keys you generate yourself and can revoke whenever you want.',
  },
  {
    Icon: Lock,
    title: 'Broker keys are encrypted',
    body: 'AES-256-GCM, with a key that lives on the server and never reaches the browser. A copy of the database alone does not open them.',
  },
  {
    Icon: Share2,
    title: 'You choose what you share',
    body: 'A read-only link, scoped to what you pick, with a percent-only mode that strips amounts on the server. Every link expires in 90 days.',
  },
]

// --- botón propio de la landing (ver regla 2 arriba) ------------------------
function CTA({ children, onClick, variant = 'primary', className = '' }) {
  const style = variant === 'primary'
    ? { backgroundColor: C.blue, color: '#FFFFFF', border: '1px solid ' + C.blue }
    : { backgroundColor: '#FFFFFF', color: C.ink, border: '1px solid ' + C.line }
  return (
    <button onClick={onClick}
      className={'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 ' + className}
      style={style}>
      {children}
    </button>
  )
}

// --- Las cuatro maquetas ----------------------------------------------------
// Dibujadas en HTML/CSS y no capturadas: una captura envejece con cada rediseño
// y llevaría datos adentro. Todas van aria-hidden porque son ilustraciones: lo
// que dicen ya está escrito en la lista de al lado, así que a un lector de
// pantalla solo le agregarían ruido.

function Frame({ children, accent }) {
  return (
    <div aria-hidden="true" className="rounded-2xl p-5 select-none"
      style={{ backgroundColor: '#FFFFFF', border: '1px solid ' + C.line, boxShadow: '0 12px 32px -18px rgba(17,24,39,0.28)' }}>
      <div className="h-1 w-10 rounded-full mb-4" style={{ backgroundColor: accent }} />
      {children}
    </div>
  )
}

// Los montos de las maquetas son OBVIAMENTE de ejemplo y redondos a propósito.
// Antes el hero traía $23,226.07 con +7.57% YTD hardcodeado, que era
// esencialmente la cartera real del dueño: la página pública estaba enseñando
// su patrimonio.
function WealthMock({ accent }) {
  const segs = [['Stocks', 46, accent], ['Bonds', 24, '#08A8AF'], ['Real estate', 18, '#00764F'], ['Cash', 12, '#94A3B8']]
  return (
    <Frame accent={accent}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[11px]" style={{ color: C.muted }}>Net worth</div>
          <div className="text-2xl font-black tabular-nums" style={{ color: C.ink, letterSpacing: '-0.02em' }}>$248,000</div>
        </div>
        <span className="text-[11px] font-semibold px-2 py-1 rounded-lg"
          style={{ backgroundColor: 'rgba(0,118,79,0.10)', color: '#006744' }}>Example</span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden mb-2">
        {segs.map(([, pct, col]) => <div key={col} style={{ width: pct + '%', backgroundColor: col }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-4">
        {segs.map(([label, pct, col]) => (
          <span key={label} className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: C.muted }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: col }} />{label} {pct}%
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[['TWR', '+12.4%'], ['MWR', '+9.8%'], ['Sharpe', '1.12']].map(([k, v]) => (
          <div key={k} className="rounded-lg px-2 py-2 text-center" style={{ backgroundColor: C.band }}>
            <div className="text-sm font-bold tabular-nums" style={{ color: C.ink }}>{v}</div>
            <div className="text-[9px] uppercase tracking-wide" style={{ color: C.muted }}>{k}</div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function FlowMock({ accent }) {
  const months = [['Jan', 62, 44], ['Feb', 58, 47], ['Mar', 66, 41], ['Apr', 60, 52], ['May', 71, 45], ['Jun', 68, 43]]
  return (
    <Frame accent={accent}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-[11px]" style={{ color: C.muted }}>Savings rate</div>
          <div className="text-2xl font-black tabular-nums" style={{ color: C.ink, letterSpacing: '-0.02em' }}>34%</div>
        </div>
        <div className="flex gap-3 text-[10px]" style={{ color: C.muted }}>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: accent }} />In</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#CBD5E1' }} />Out</span>
        </div>
      </div>
      <div className="flex items-end gap-2 h-24 mb-1">
        {months.map(([m, inc, exp]) => (
          <div key={m} className="flex-1 flex items-end gap-0.5 h-full">
            <div className="flex-1 rounded-t" style={{ height: inc + '%', backgroundColor: accent }} />
            <div className="flex-1 rounded-t" style={{ height: exp + '%', backgroundColor: '#CBD5E1' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {months.map(([m]) => <div key={m} className="flex-1 text-center text-[9px]" style={{ color: C.muted }}>{m}</div>)}
      </div>
      <div className="mt-4 rounded-lg px-3 py-2 text-[11px]" style={{ backgroundColor: C.band, color: C.body }}>
        Eating out grew 18% versus last month.
      </div>
    </Frame>
  )
}

function SheetMock({ accent }) {
  const rows = [
    ['Brokerage', ['41.2', '43.0', '42.1', '45.8', '47.3']],
    ['Bonds', ['22.0', '22.3', '22.6', '22.9', '23.2']],
    ['Property', ['95.0', '95.0', '95.0', '98.0', '98.0']],
  ]
  const cols = ['Jan', 'Feb', 'Mar', 'Apr', 'May']
  return (
    <Frame accent={accent}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px]" style={{ color: C.muted }}>Month by month, in thousands</div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded"
          style={{ backgroundColor: 'rgba(0,118,79,0.10)', color: '#006744' }}>XLSX</span>
      </div>
      <table className="w-full text-[10px] tabular-nums" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th className="text-left font-medium pb-1.5" style={{ color: C.muted }}> </th>
            {cols.map((c) => <th key={c} className="text-right font-medium pb-1.5 pl-2" style={{ color: C.muted }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, vals]) => (
            <tr key={label} style={{ borderTop: '1px solid ' + C.line }}>
              <td className="py-1.5 pr-2" style={{ color: C.body }}>{label}</td>
              {vals.map((v, i) => <td key={i} className="py-1.5 pl-2 text-right" style={{ color: C.body }}>{v}</td>)}
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid ' + C.line }}>
            <td className="py-1.5 pr-2 font-bold" style={{ color: C.ink }}>Total</td>
            {['158.2', '160.3', '159.7', '166.7', '168.5'].map((v, i) => (
              <td key={i} className="py-1.5 pl-2 text-right font-bold" style={{ color: C.ink }}>{v}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </Frame>
  )
}

function FriendsMock({ accent }) {
  const rows = [
    ['1', 'Quetzal Audaz 12', '+22.4%', '#B274DC'],
    ['2', 'Jaguar Sereno 7', '+15.1%', '#08A8AF'],
    ['3', 'Puma Veloz 44', '+9.8%', '#00764F'],
  ]
  return (
    <Frame accent={accent}>
      <div className="flex items-center justify-between mb-3 text-[10px] uppercase tracking-wide" style={{ color: C.muted }}>
        <span>This year</span>
        <span>Amount</span>
      </div>
      <div>
        {rows.map(([rank, name, pct, col]) => (
          <div key={rank} className="flex items-center gap-2.5 py-2" style={{ borderTop: '1px solid ' + C.line }}>
            <span className="w-4 text-center text-[10px] font-bold" style={{ color: C.muted }}>{rank}</span>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ backgroundColor: 'color-mix(in srgb, ' + col + ' 20%, transparent)', color: col }}>
              {name.charAt(0)}
            </span>
            <span className="flex-1 min-w-0 text-[11px] truncate" style={{ color: C.ink }}>{name}</span>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: '#006744' }}>{pct}</span>
            <span className="w-10 flex items-center justify-end gap-1 text-[10px]" style={{ color: C.muted }}>
              <Lock size={10} />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg px-3 py-2 text-[11px]"
        style={{ backgroundColor: 'rgba(224,114,39,0.08)', color: C.body }}>
        Percentages travel. Amounts never leave your account.
      </div>
    </Frame>
  )
}

const MOCKS = [WealthMock, FlowMock, SheetMock, FriendsMock]

// --- Tarjeta del hero -------------------------------------------------------
function HeroCard() {
  const points = [30, 34, 28, 40, 46, 42, 52, 58, 55, 64, 70, 66, 76]
  const W = 280, H = 72
  const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + (i * (W / (points.length - 1))) + ' ' + (H - (p / 100) * H)).join(' ')
  return (
    <div aria-hidden="true" className="rounded-2xl p-6 w-full max-w-[380px]"
      style={{
        backgroundColor: '#FFFFFF',
        border: '1px solid ' + C.line,
        transform: 'rotate(-1.2deg)',
        boxShadow: '0 24px 60px -24px rgba(37,99,235,0.30), 0 8px 24px -12px rgba(17,24,39,0.14)',
      }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium" style={{ color: C.muted }}>Net worth</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(0,118,79,0.10)', color: '#006744' }}>+12.4% this year</span>
      </div>
      <div className="text-3xl font-black mb-4 tabular-nums" style={{ color: C.ink, letterSpacing: '-0.02em' }}>$248,000.00</div>
      <svg width="100%" viewBox={'0 0 ' + W + ' ' + H} className="mb-4" preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.blue} stopOpacity="0.20" />
            <stop offset="100%" stopColor={C.blue} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={path + ' L' + W + ' ' + H + ' L0 ' + H + ' Z'} fill="url(#heroFill)" />
        <path d={path} fill="none" stroke={C.blue} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="flex h-1.5 rounded-full overflow-hidden mb-2">
        <div style={{ width: '54%', backgroundColor: C.blue }} />
        <div style={{ width: '27%', backgroundColor: '#08A8AF' }} />
        <div style={{ width: '12%', backgroundColor: '#B274DC' }} />
        <div style={{ width: '7%', backgroundColor: '#CBD5E1' }} />
      </div>
      <div className="flex justify-between text-[10px]" style={{ color: C.muted }}>
        <span>Stocks</span><span>Bonds</span><span>Crypto</span><span>Cash</span>
      </div>
      <div className="mt-4 pt-3 text-[10px]" style={{ borderTop: '1px solid ' + C.line, color: C.muted }}>
        Example numbers, not a real account.
      </div>
    </div>
  )
}

export default function Home() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  // El default se invierte respecto al resto de la app, y es a proposito: esta
  // pagina es de IDIOMA FIJO en ingles, igual que es de paleta fija (ver arriba).
  // Su unico uso de `lang` es la pantalla de carga que la precede, asi que con
  // el default 'es' del resto de la app un visitante nuevo leia "Cargando tu
  // portafolio" un segundo antes de una pagina entera en ingles. Una preferencia
  // YA elegida sigue mandando: quien puso espanol es alguien con sesion, que en
  // un instante se va al tablero, que si es bilingue.
  const [lang] = useState(() => (typeof window !== 'undefined' && localStorage.getItem('chispudo-lang') === 'es' ? 'es' : 'en'))

  useEffect(() => {
    let cancelled = false
    // `unsub` se guarda para poder cortar el listener al desmontar. Los imports
    // son dinámicos (Firebase no tiene por qué entrar al bundle de una página
    // que la mayoría de las visitas ven deslogueadas), así que la suscripción
    // aparece DESPUÉS del primer render y el cleanup puede correr antes: por eso
    // `cancelled` además de `unsub`.
    let unsub = null
    import('@/lib/firebase').then(({ auth }) => {
      if (!auth) { if (!cancelled) setChecking(false); return }
      return import('firebase/auth').then(({ onAuthStateChanged }) => {
        if (cancelled) return
        unsub = onAuthStateChanged(auth, (user) => {
          if (cancelled) return
          if (user) router.push('/dashboard')
          else setChecking(false)
        })
      })
    }).catch(() => {
      // Si Firebase no carga (config mala, un chunk que no llega, la SDK que
      // tira), lo ÚNICO que se pierde es poder mandar al tablero a quien ya
      // tiene sesión. La landing existe justamente para quien NO tiene cuenta,
      // así que ante la duda se muestra la página en vez de dejar a la persona
      // mirando "Cargando" para siempre, que es lo que pasaba sin este catch.
      if (!cancelled) setChecking(false)
    })
    return () => { cancelled = true; if (unsub) unsub() }
  }, [router])

  const go = () => router.push('/login')

  if (checking) {
    return <ChispudoLoader mode="fullscreen" state="initial-loading" lang={lang} />
  }

  return (
    <div style={{ backgroundColor: C.page, color: C.body }} className="min-h-screen">
      {/* --- Nav --- */}
      <header style={{ borderBottom: '1px solid ' + C.line, backgroundColor: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)' }}
        className="sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Logo size={28} tone="ink" />
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={go} className="px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-opacity hover:opacity-70"
              style={{ color: C.body }}>Log in</button>
            <button onClick={go} className="px-4 py-2 text-sm font-semibold rounded-lg whitespace-nowrap transition-opacity hover:opacity-90"
              style={{ backgroundColor: C.blue, color: '#FFFFFF' }}>Get started</button>
          </div>
        </div>
      </header>

      {/* --- Hero --- */}
      <section style={{
        background: [
          'radial-gradient(ellipse 55% 50% at 12% 8%, rgba(37,99,235,0.07) 0%, transparent 62%)',
          'radial-gradient(ellipse 45% 40% at 88% 0%, rgba(178,116,220,0.06) 0%, transparent 60%)',
          C.page,
        ].join(', '),
      }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 pb-20 grid lg:grid-cols-[1.25fr_0.75fr] gap-12 lg:gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
              style={{ backgroundColor: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.20)' }}>
              <Logo variant="icon" size={13} />
              <span className="text-xs font-semibold" style={{ color: C.blueDark }}>Built for Latin America</span>
            </div>

            <h1 className="font-black tracking-tight mb-5"
              style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)', lineHeight: 1.05, letterSpacing: '-0.03em', textWrap: 'balance' }}>
              <span style={{ color: C.ink }}>Track your entire portfolio.</span>
              <br />
              <span style={{ color: C.blue }}>Not just stocks.</span>
            </h1>

            <p className="text-base sm:text-lg leading-relaxed mb-8 max-w-xl" style={{ color: C.body }}>
              Bonds, real estate, DeFi, SAFE notes, private equity, bank accounts.
              Everything you own, in one place, in the currency you actually hold it in.
            </p>

            <div className="flex flex-wrap gap-3 mb-4">
              <CTA onClick={go}>Create your portfolio</CTA>
              <a href="#modes" className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-70"
                style={{ backgroundColor: '#FFFFFF', color: C.ink, border: '1px solid ' + C.line }}>
                See the four modes <ArrowRight size={16} />
              </a>
            </div>
            <p className="text-xs mb-10" style={{ color: C.muted }}>Takes about two minutes to set up.</p>

            <div className="flex flex-wrap gap-x-10 gap-y-4">
              {[
                ['15', 'LatAm currencies'],
                ['12+', 'Asset types'],
                ['Yours', 'And only yours'],
              ].map(([num, label]) => (
                <div key={label}>
                  <div className="text-2xl font-black" style={{ color: C.blue, letterSpacing: '-0.02em' }}>{num}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <HeroCard />
          </div>
        </div>
      </section>

      {/* --- Las cuatro modalidades --- */}
      <section id="modes" className="scroll-mt-20 pt-16 pb-4" style={{ backgroundColor: C.page }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-3"
            style={{ color: C.ink, letterSpacing: '-0.02em' }}>Four ways to use it.</h2>
          <p className="text-base max-w-2xl mx-auto" style={{ color: C.body }}>
            Each mode answers a different question. Use one, or use all four.
          </p>
        </div>
      </section>

      {MODES.map((mode, i) => {
        const Mock = MOCKS[i]
        const banded = i % 2 === 1
        return (
          <section key={mode.num} className="py-14 sm:py-16"
            style={{ backgroundColor: banded ? C.band : C.page, borderTop: '1px solid ' + C.line }}>
            <div className={'max-w-6xl mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center'}>
              <div className={banded ? 'lg:order-2' : ''}>
                <div className="flex items-center gap-2.5 mb-4">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-black"
                    style={{ backgroundColor: 'color-mix(in srgb, ' + mode.accent + ' 14%, #FFFFFF)', color: mode.accent }}>
                    {mode.num}
                  </span>
                  <span className="text-sm font-bold uppercase tracking-wide" style={{ color: C.ink }}>{mode.name}</span>
                </div>

                <h3 className="text-2xl sm:text-3xl font-black tracking-tight mb-3"
                  style={{ color: C.ink, letterSpacing: '-0.02em', textWrap: 'balance' }}>{mode.title}</h3>
                <p className="text-base mb-6" style={{ color: C.body }}>{mode.lede}</p>

                <ul className="space-y-2.5">
                  {mode.points.map((p) => (
                    <li key={p} className="flex gap-3 text-sm leading-relaxed" style={{ color: C.body }}>
                      <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: mode.accent }} />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={banded ? 'lg:order-1' : ''}>
                <Mock accent={mode.accent} />
              </div>
            </div>
          </section>
        )
      })}

      {/* --- Seguridad --- */}
      <section className="py-16 sm:py-20" style={{ backgroundColor: C.page, borderTop: '1px solid ' + C.line }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-3"
              style={{ color: C.ink, letterSpacing: '-0.02em' }}>Your data stays yours.</h2>
            <p className="text-base max-w-2xl mx-auto" style={{ color: C.body }}>
              Not a slogan. Here is how each part of it is actually enforced.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
            {SECURITY.map(({ Icon, title, body }) => (
              <div key={title} className="rounded-2xl p-6"
                style={{ backgroundColor: C.band, border: '1px solid ' + C.line }}>
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-4"
                  style={{ backgroundColor: 'rgba(37,99,235,0.10)', color: C.blue }}>
                  <Icon size={18} />
                </span>
                <h3 className="text-base font-bold mb-2" style={{ color: C.ink }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.body }}>{body}</p>
              </div>
            ))}
          </div>

          <p className="text-center text-sm mt-8" style={{ color: C.muted }}>
            And nothing is locked in: export everything to CSV, Excel or PDF, whenever you want.
          </p>
        </div>
      </section>

      {/* --- CTA final --- */}
      <section className="py-20 text-center"
        style={{
          background: [
            'radial-gradient(ellipse 50% 60% at 50% 0%, rgba(37,99,235,0.07) 0%, transparent 65%)',
            C.band,
          ].join(', '),
          borderTop: '1px solid ' + C.line,
        }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-3"
            style={{ color: C.ink, letterSpacing: '-0.02em' }}>Ready to see your full picture?</h2>
          <p className="text-base mb-8" style={{ color: C.body }}>Set it up once, in about two minutes.</p>
          <CTA onClick={go} className="px-8">Create your portfolio</CTA>
        </div>
      </section>

      {/* --- Footer --- */}
      <footer style={{ borderTop: '1px solid ' + C.line, backgroundColor: C.page }} className="py-8">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
          <span style={{ color: C.muted }}>Chispudo · chispu.xyz</span>
          <div className="flex items-center gap-5">
            <a href="/terms" className="transition-opacity hover:opacity-70" style={{ color: C.muted }}>Terms</a>
            <a href="/privacy" className="transition-opacity hover:opacity-70" style={{ color: C.muted }}>Privacy</a>
          </div>
          <span style={{ color: C.muted }}>The portfolio tracker built for Latin America.</span>
        </div>
      </footer>
    </div>
  )
}
