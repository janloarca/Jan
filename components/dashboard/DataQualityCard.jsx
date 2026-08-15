'use client'

// "How true is my data?" as one calm card instead of a checklist that nags.
//
// Three stages, in the order that each one pays off, with exactly ONE action
// offered at a time: asking for three uploads at once is what makes this kind
// of onboarding exhausting. The ring shows the measured score (lib/dataReconcile
// assessDataSources), not a fixed number, so it moves as real data lands.
//
// Below it, when there is enough history to measure, the wealth bridge answers
// the question the number can't: where did my money actually come from.

import { useMemo } from 'react'
import { assessDataSources, buildWealthBridge } from '@/lib/dataReconcile'
import { formatCurrency } from './utils'

const RING = 54
const CIRC = 2 * Math.PI * RING

export default function DataQualityCard({
  items = [], transactions = [], snapshots = [],
  convert, baseCurrency = 'USD', lang = 'es',
  onConnect, onImportBroker,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const assessment = useMemo(
    () => assessDataSources({ items, transactions, snapshots }),
    [items, transactions, snapshots]
  )
  const bridge = useMemo(
    () => buildWealthBridge({ snapshots, transactions, convert, baseCurrency }),
    [snapshots, transactions, convert, baseCurrency]
  )

  const STAGES = {
    positions: {
      title: t('Qué tienes hoy', 'What you hold today'),
      why: t('Tu patrimonio actual es real.', 'Your current net worth is real.'),
      how: t('Conecta tu broker', 'Connect your broker'),
      act: () => onConnect && onConnect(),
    },
    history: {
      title: t('Cuánto valía antes', 'What it was worth before'),
      why: t('El gráfico deja de estimar el pasado.', 'The chart stops estimating the past.'),
      how: t('Sube tu reporte de historial', 'Upload your history report'),
      act: () => onImportBroker && onImportBroker('ibkr'),
    },
    movements: {
      title: t('Cada movimiento', 'Every movement'),
      why: t('Retornos, costos y fechas exactos.', 'Exact returns, costs and dates.'),
      how: t('Sube tu estado de cuenta', 'Upload your account statement'),
      act: () => onImportBroker && onImportBroker('ibkr'),
    },
  }

  const score = assessment.score
  const nextKey = assessment.next
  const next = nextKey ? STAGES[nextKey] : null
  const ringColor = score >= 100 ? 'var(--accent-green)' : score >= 60 ? 'var(--accent-blue)' : '#fbbf24'

  return (
    <div>
      <div className="flex items-start gap-5">
        <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
          <svg viewBox="0 0 128 128" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="64" cy="64" r={RING} fill="none" stroke="var(--card-border)" strokeWidth="9" />
            <circle
              cx="64" cy="64" r={RING} fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - Math.max(0, Math.min(100, score)) / 100)}
              style={{ transition: 'stroke-dashoffset .6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold" style={{ color: ringColor }}>{score}%</span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {t('datos reales', 'real data')}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-white mb-0.5">
            {t('Qué tan real es tu historia', 'How real is your history')}
          </h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            {score >= 100
              ? t('Todo lo que ves viene de tu broker, nada estimado.', 'Everything you see comes from your broker, nothing estimated.')
              : t('Cada paso reemplaza estimaciones por datos de tu broker.', 'Each step replaces estimates with data from your broker.')}
          </p>

          <ol className="space-y-1.5">
            {assessment.stages.map((st, i) => {
              const meta = STAGES[st.key]
              const isNext = st.key === nextKey
              const color = st.done ? 'var(--accent-green)' : isNext ? 'var(--accent-blue)' : 'var(--text-muted)'
              return (
                <li key={st.key} className="flex items-start gap-2">
                  <span
                    className="shrink-0 w-4 h-4 mt-0.5 rounded-full flex items-center justify-center text-[9px] font-bold"
                    style={st.done
                      ? { backgroundColor: 'var(--accent-green)', color: 'var(--bg-card)' }
                      : { border: `1px solid ${color}`, color }}
                  >
                    {st.done ? '✓' : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="text-xs font-medium" style={{ color: st.done ? 'var(--text-primary)' : color }}>
                      {meta.title}
                    </span>
                    <span className="block text-[11px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                      {meta.why}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>

          {next && (
            <button
              onClick={next.act}
              className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
            >
              {next.how}
            </button>
          )}
        </div>
      </div>

      {/* Where the money came from. Only shown once there is a measurable window,
          because a bridge over two days says nothing. */}
      {bridge && Math.abs(bridge.changeInNav) > 0.01 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--card-border)' }}>
          <p className="text-xs font-medium text-white mb-2">
            {t('De dónde salió tu cambio de patrimonio', 'Where your net worth change came from')}
            <span className="font-normal ml-1" style={{ color: 'var(--text-muted)' }}>
              {bridge.from} → {bridge.to}
            </span>
          </p>
          <div className="space-y-1">
            {[
              { label: t('Lo que aportaste', 'What you put in'), v: bridge.flows },
              { label: t('Mercado', 'Market'), v: bridge.market, muted: true },
              { label: t('Dividendos e intereses', 'Dividends and interest'), v: bridge.income },
              { label: t('Comisiones e impuestos', 'Fees and taxes'), v: bridge.costs },
            ].filter((r) => Math.abs(r.v) > 0.005).map((r) => (
              <div key={r.label} className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                <span style={{ color: r.v >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                  {r.v >= 0 ? '+' : ''}{formatCurrency(r.v)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs pt-1 mt-1 border-t" style={{ borderColor: 'var(--card-border)' }}>
              <span className="font-medium text-white">{t('Cambio total', 'Total change')}</span>
              <span className="font-medium" style={{ color: bridge.changeInNav >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                {bridge.changeInNav >= 0 ? '+' : ''}{formatCurrency(bridge.changeInNav)}
              </span>
            </div>
          </div>
          {/* Market is a residual, so when nothing else is recorded it silently
              absorbs missing deposits and dividends. Say so rather than letting
              the user read an invented return. */}
          {bridge.recordedShare < 0.15 && (
            <p className="text-[11px] mt-2" style={{ color: '#fcd34d' }}>
              {t('Casi todo tu cambio está cayendo en "Mercado" porque no tenemos tus movimientos registrados. Con ellos, esta cuenta se vuelve exacta.',
                 'Almost all of your change is landing in "Market" because we have no movements recorded. With them, this breakdown becomes exact.')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
