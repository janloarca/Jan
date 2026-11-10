'use client'

import { useMemo, useState } from 'react'
import { computePeriodicReturns } from './analytics'
import { getTypeCategory } from './utils'
import { snapshotsWithoutRealEstate, ytdTwrFromSnapshots } from '@/lib/investable'
import SegmentedTabs from '../ui/SegmentedTabs'
import { InfoTip } from '../ui/Tooltip'

const fmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
const tone = (v) => (v >= 0 ? 'var(--accent-green)' : 'var(--text-negative)')

// FASE RQ. Comparar contra un índice exige decir QUÉ retorno es cuál:
// - TWR (ponderado por tiempo): ignora cuándo metiste dinero. Es el que se
//   compara contra un índice.
// - TIR aprox. (ponderado por dinero, Modified Dietz): el del encabezado; el
//   momento de tus aportes sí cuenta.
// - El S&P 500 (^GSPC) es retorno de PRECIO: no incluye dividendos.
// Y sin la vivienda, porque una casa no es lo que se le gana o pierde al índice.
export default function BenchmarkComparison({ benchmarkReturn, portfolioReturn, benchmarkName, lang, snapshots, transactions, convert, baseCurrency, items }) {
  const t = (es, en) => lang === 'es' ? es : en
  const name = benchmarkName || 'S&P 500'
  const homeIds = useMemo(() => new Set((items || []).filter((it) => !it.isDebt && getTypeCategory(it) === 'realestate').map((it) => it.id)), [items])
  const hasHome = homeIds.size > 0
  const [scope, setScope] = useState('investable')
  const investable = hasHome && scope === 'investable'

  const twr = useMemo(() => {
    const toUSD = (v) => (convert && baseCurrency && baseCurrency !== 'USD' ? convert(v, baseCurrency, 'USD') : v)
    const snaps = investable ? snapshotsWithoutRealEstate(snapshots, items, toUSD) : snapshots
    const txs = investable ? (transactions || []).filter((tx) => !(tx._linkedItemId && homeIds.has(tx._linkedItemId))) : transactions
    return ytdTwrFromSnapshots(snaps, txs, convert, computePeriodicReturns)
  }, [investable, snapshots, transactions, convert, baseCurrency, items, homeIds])

  if (benchmarkReturn == null || !isFinite(benchmarkReturn)) return (
    <div className="text-center py-2">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Benchmark no disponible', 'Benchmark unavailable')}</p>
    </div>
  )

  const mwr = portfolioReturn != null && isFinite(portfolioReturn) && Math.abs(portfolioReturn) <= 200 && !investable ? portfolioReturn : null
  const delta = twr != null ? twr - benchmarkReturn : null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{t('Benchmark · año en curso', 'Benchmark · year to date')}</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{name}</span>
      </div>
      {hasHome && (
        <SegmentedTabs
          tabs={[{ key: 'investable', label: t('Solo invertible', 'Investable only') }, { key: 'all', label: t('Todo', 'All assets') }]}
          value={scope} onChange={setScope} deps={[lang]} ariaLabel={t('Universo comparado', 'Compared universe')} className="mb-3"
        />
      )}

      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('Tu TWR (ponderado por tiempo)', 'Your TWR (time-weighted)')}
            <InfoTip text={t('Encadena el retorno de cada tramo neteando aportes y retiros: el momento en que metes dinero no cuenta. Es el que se compara contra un índice.', 'Chains each period\'s return net of deposits and withdrawals: when you add money does not count. This is the one to compare against an index.')} />
          </span>
          <span className="font-mono tabular-nums font-semibold" style={{ color: twr == null ? 'var(--text-muted)' : tone(twr) }}>{twr == null ? '-' : fmt(twr)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('Tu TIR aprox. (ponderada por dinero)', 'Your IRR approx. (money-weighted)')}
            <InfoTip text={t('Modified Dietz, el retorno del encabezado: pondera cada aporte por el tiempo que estuvo invertido, así que el momento de tus aportes sí cuenta.', 'Modified Dietz, the headline return: weights each contribution by how long it was invested, so the timing of your contributions counts.')} />
          </span>
          <span className="font-mono tabular-nums font-semibold" style={{ color: mwr == null ? 'var(--text-muted)' : tone(mwr) }}>{mwr == null ? '-' : fmt(mwr)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--text-secondary)' }}>{name} <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{t('(retorno de precio, sin dividendos)', '(price return, no dividends)')}</span></span>
          <span className="font-mono tabular-nums font-semibold" style={{ color: tone(benchmarkReturn) }}>{fmt(benchmarkReturn)}</span>
        </div>
      </div>

      {investable && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
          {t('Sin vivienda: la casa se resta a su valor de hoy. La TIR sin vivienda no se muestra porque el arranque del año no está separado por tipo.', 'Excluding home: the house is subtracted at today\'s value. The IRR without the home is not shown because the year-start value is not split by type.')}
        </p>
      )}

      {delta != null && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 mt-3 rounded-lg text-xs font-medium"
          style={{ backgroundColor: `color-mix(in srgb, ${tone(delta)} 12%, transparent)`, color: tone(delta) }}>
          <span>{delta >= 0 ? '▲' : '▼'}</span>
          <span>
            {delta >= 0
              ? t(`TWR ${Math.abs(delta).toFixed(2)} pp arriba de ${name}`, `TWR ${Math.abs(delta).toFixed(2)} pp above ${name}`)
              : t(`TWR ${Math.abs(delta).toFixed(2)} pp abajo de ${name}`, `TWR ${Math.abs(delta).toFixed(2)} pp below ${name}`)}
          </span>
        </div>
      )}
      {twr == null && (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>{t('Faltan registros de este año para calcular el TWR.', 'Not enough records this year to compute the TWR.')}</p>
      )}
    </div>
  )
}
