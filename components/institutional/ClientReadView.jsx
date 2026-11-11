'use client'

// Vista de lectura de UN cliente para su asesor. Reutiliza los componentes del
// producto (Asignación, Hoja, Ingresos pasivos, Metas, lista de Flujo) SIN
// pasarles ningún handler de escritura: cada uno ya esconde sus controles de
// edición cuando no recibe con qué guardar.
// ⛔ Aquí no se archiva snapshot, no corre backfill y no se escribe nada del
// cliente. Las cifras de cabecera son las que su panel archivó.
import { useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useClientReadData } from '@/hooks/useClientReadData'
import { setBaseCurrency, setLang as setUtilsLang, formatCurrency, getItemValue, projectItemAnnualIncome } from '@/components/dashboard/utils'
import { trailingDividends, projectedAnnualIncome } from '@/lib/serverPortfolio'
import InlineNotice from '@/components/ui/InlineNotice'

const AssetAllocation = dynamic(() => import('@/components/dashboard/AssetAllocation'), { ssr: false })
const DividendIncome = dynamic(() => import('@/components/dashboard/DividendIncome'), { ssr: false })
const GoalTracker = dynamic(() => import('@/components/dashboard/GoalTracker'), { ssr: false })
const PortfolioSpreadsheet = dynamic(() => import('@/components/dashboard/PortfolioSpreadsheet'), { ssr: false })
const FinanceTransactionList = dynamic(() => import('@/components/finance/FinanceTransactionList'), { ssr: false })

function Figure({ label, value, note, tone }) {
  return (
    <div className="min-w-0">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-xl sm:text-2xl font-semibold tabular-nums break-words" style={{ color: tone || 'var(--text-primary)' }}>{value}</p>
      {note && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{note}</p>}
    </div>
  )
}

export default function ClientReadView({ clientUid, scopes, screen, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const d = useClientReadData({ clientUid, scopes, enabled: true })
  const { baseCurrency, convert, items, transactions, summary } = d

  useEffect(() => { setBaseCurrency(baseCurrency) }, [baseCurrency])
  useEffect(() => { setUtilsLang(lang) }, [lang])

  const totalAssets = useMemo(
    () => items.reduce((s, it) => (it.isDebt ? s : s + (getItemValue(it) || 0)), 0),
    [items]
  )
  const income = useMemo(() => ({
    trailing: trailingDividends(transactions, { convert, baseCurrency, items }),
    projected: projectedAnnualIncome(items, { convert, baseCurrency, projectItemAnnualIncome }),
  }), [transactions, items, convert, baseCurrency])

  if (d.loading) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('Cargando datos del cliente...', 'Loading client data...')}</p>

  const asOf = summary?.at ? String(summary.at).slice(0, 10) : null
  const noSummary = (
    <InlineNotice tone="info">
      {t('El cliente todavía no tiene un snapshot archivado. Aparece la próxima vez que abra su panel.',
         'The client has no archived snapshot yet. It appears the next time they open their panel.')}
    </InlineNotice>
  )

  if (screen === 'panel') {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="card p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="card-title">{t('Patrimonio', 'Net worth')}</h2>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
              {t('Declarado por el cliente', 'Declared by the client')}
            </span>
          </div>
          {summary ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Figure label={t('Patrimonio neto', 'Net worth')} value={formatCurrency(summary.netWorth, baseCurrency)}
                note={asOf ? `${t('Snapshot del', 'Snapshot of')} ${asOf}` : null} />
              <Figure label={t('Invertible (sin vivienda)', 'Investable (no home)')}
                value={Number.isFinite(summary.investable) ? formatCurrency(summary.investable, baseCurrency) : '-'} />
              <Figure label="YTD"
                value={Number.isFinite(summary.ytdPct) ? `${summary.ytdPct >= 0 ? '+' : ''}${summary.ytdPct.toFixed(2)}%` : '-'}
                tone={!Number.isFinite(summary.ytdPct) ? 'var(--text-muted)' : summary.ytdPct >= 0 ? 'var(--accent-green)' : 'var(--text-negative)'}
                note={Number.isFinite(summary.ytdChange) ? formatCurrency(summary.ytdChange, baseCurrency) : null} />
            </div>
          ) : noSummary}
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('Cifras del último snapshot que el panel del cliente archivó. No se recalculan aquí.',
               'Figures from the last snapshot the client panel archived. They are not recalculated here.')}
          </p>
        </div>
        {items.length > 0 && (
          <div className="card p-4 sm:p-5">
            <AssetAllocation embedded items={items} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} ibkrDataComplete={null} />
          </div>
        )}
      </div>
    )
  }

  if (screen === 'hoja') {
    return (
      <PortfolioSpreadsheet readOnly items={items} snapshots={d.snapshots} lang={lang} convert={convert} baseCurrency={baseCurrency}
        netWorth={summary?.netWorth ?? null} returnYTD={summary?.ytdPct ?? null}
        onLoadItemSnapshots={d.loadItemSnapshots} observations={d.observations} lots={d.lots} transactions={transactions} />
    )
  }

  if (screen === 'dividendos') {
    return <DividendIncome transactions={transactions} items={items} convert={convert} baseCurrency={baseCurrency} lang={lang} totalAssets={totalAssets} />
  }

  if (screen === 'metas') {
    return (
      <div className="space-y-3">
        {!summary && noSummary}
        <GoalTracker readOnly netWorth={summary?.netWorth ?? 0} totalAssets={items.length ? totalAssets : null}
          investableAssets={Number.isFinite(summary?.investable) ? summary.investable : null}
          annualDividends={income.trailing} estimatedAnnualIncome={income.projected}
          goals={d.goals} lang={lang} convert={convert} baseCurrency={baseCurrency} transactions={transactions} items={items} />
        {items.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('El avance de ingresos solo se calcula si el cliente compartió su patrimonio o sus dividendos.',
               'Income progress is only computed if the client shared their net worth or dividends.')}
          </p>
        )}
      </div>
    )
  }

  if (screen === 'flujo') {
    return (
      <div className="card p-4 sm:p-5">
        <h2 className="card-title mb-3">{t('Flujo: movimientos', 'Cash flow: transactions')}</h2>
        {d.financeTransactions.length === 0
          ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('El cliente no tiene movimientos registrados.', 'The client has no recorded transactions.')}</p>
          : <FinanceTransactionList transactions={d.financeTransactions} lang={lang} />}
      </div>
    )
  }
  return null
}
