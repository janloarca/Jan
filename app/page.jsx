'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

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
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0d1117]">
        <div className="text-blue-400 animate-pulse text-lg font-bold">Chispudo</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      {/* Hero */}
      <header className="max-w-5xl mx-auto px-6 py-6 flex items-center justify-between">
        <span className="text-emerald-400 font-bold text-xl">Chispudo</span>
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/login')}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors">
            Log in
          </button>
          <button onClick={() => router.push('/login')}
            className="px-5 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors">
            Get started
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6">
        {/* Hero section */}
        <section className="py-20 text-center">
          <h1 className="text-5xl font-black tracking-tight mb-4 text-[var(--text-primary)]">
            Track your entire portfolio.<br />Not just stocks.
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
            Bonds, real estate, DeFi, SAFE notes, private equity, bank accounts — all in one place.
            Built for Latin America. Works everywhere.
          </p>
          <div className="flex items-center justify-center gap-4">
            <button onClick={() => router.push('/login')}
              className="px-8 py-3 text-base font-medium bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-600/20">
              Start for free
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-4">No credit card needed. Free forever.</p>
        </section>

        {/* Features grid */}
        <section className="py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: '🌎',
                title: 'LatAm Native',
                desc: 'GTQ, MXN, COP, CLP. Detect institutions in Guatemala, Mexico, Colombia. No Plaid required.',
              },
              {
                icon: '📊',
                title: 'Every Asset Type',
                desc: 'Stocks, crypto, bonds, real estate, funds, DeFi yield, SAFE notes, private debt, and more.',
              },
              {
                icon: '💰',
                title: 'Income Tracking',
                desc: 'Auto-detect dividends, model variable rates, track continuous DeFi yield in real-time.',
              },
              {
                icon: '📅',
                title: 'Maturity Calendar',
                desc: 'See when bonds mature, when payments arrive, and what capital returns are coming.',
              },
              {
                icon: '🔒',
                title: 'Advisor Mode',
                desc: 'Share a read-only link with your financial advisor or accountant. Privacy built in.',
              },
              {
                icon: '📁',
                title: 'Document Vault',
                desc: 'Attach contracts, certificates, and receipts directly to each asset.',
              },
            ].map((f, i) => (
              <div key={i} className="bg-[#161b22]/60 border border-[#21262d]/50 rounded-xl p-6">
                <span className="text-2xl mb-3 block">{f.icon}</span>
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
                <tr className="border-b border-[#21262d]">
                  <th className="text-left py-3 px-4 text-slate-400 font-medium">Feature</th>
                  <th className="py-3 px-4 text-emerald-400 font-bold">Chispudo</th>
                  <th className="py-3 px-4 text-slate-500 font-medium">Kubera</th>
                  <th className="py-3 px-4 text-slate-500 font-medium">Others</th>
                </tr>
              </thead>
              <tbody className="text-slate-400">
                {[
                  ['LatAm currencies & institutions', '✓', '✗', '✗'],
                  ['Variable rate instruments', '✓', '~', '✗'],
                  ['DeFi yield tracking', '✓', '✗', '~'],
                  ['Bond maturity tracking', '✓', '✗', '~'],
                  ['SAFE / VC tracking', '✓', '~', '✗'],
                  ['Debt / liability tracking', '✓', '✓', '~'],
                  ['Advisor mode (read-only share)', '✓', '✗', '✗'],
                  ['Document vault', '✓', '✓', '✗'],
                  ['Multi-currency income', '✓', '~', '~'],
                  ['Price', 'Free', '$150/yr', 'Varies'],
                ].map(([feat, c, k, o], i) => (
                  <tr key={i} className="border-b border-[#21262d]/30">
                    <td className="py-2.5 px-4 text-slate-300">{feat}</td>
                    <td className="py-2.5 px-4 text-center text-emerald-400 font-medium">{c}</td>
                    <td className="py-2.5 px-4 text-center">{k}</td>
                    <td className="py-2.5 px-4 text-center">{o}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to see your full picture?</h2>
          <p className="text-slate-400 mb-8">Free. No credit card. Takes 2 minutes.</p>
          <button onClick={() => router.push('/login')}
            className="px-10 py-4 text-base font-medium bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-600/20">
            Create your portfolio
          </button>
        </section>
      </main>

      <footer className="border-t border-[#21262d]/50 py-8">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-xs text-slate-600">
          <span>Chispudo · chispu.xyz</span>
          <span>The portfolio tracker that actually works for Latin America.</span>
        </div>
      </footer>
    </div>
  )
}
