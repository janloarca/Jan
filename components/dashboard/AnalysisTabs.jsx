'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { InfoTip } from '@/components/ui/Tooltip'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import SubTabs from '@/components/ui/SubTabs'
import CardBoundary from '@/components/dashboard/CardBoundary'
import DataQualityCard from '@/components/dashboard/DataQualityCard'
import { SkeletonCard } from '@/components/dashboard/Skeleton'

// Rediseño, sección 2: vivía como función local de app/dashboard/page.jsx, o
// sea no se podía montar sola para verificarla (un archivo de página del App
// Router solo admite los exports que Next reconoce). Se mudó tal cual.
const FinancialHealth = dynamic(() => import('@/components/dashboard/FinancialHealth'), { loading: () => <SkeletonCard /> })
const ConcentrationRisk = dynamic(() => import('@/components/dashboard/ConcentrationRisk'), { loading: () => <SkeletonCard /> })
const GainsReport = dynamic(() => import('@/components/dashboard/GainsReport'), { loading: () => <SkeletonCard /> })
const PerformanceAttribution = dynamic(() => import('@/components/dashboard/PerformanceAttribution'), { loading: () => <SkeletonCard /> })
const RiskMetrics = dynamic(() => import('@/components/dashboard/RiskMetrics'), { loading: () => <SkeletonCard /> })
const BenchmarkComparison = dynamic(() => import('@/components/dashboard/BenchmarkComparison'), { loading: () => <SkeletonCard /> })

export default function AnalysisTabs({ lang, portfolioItems, netWorth, totalAssets, snapshots, lots, transactions, convert, baseCurrency, benchmarkData, benchmarkName, benchmarkReturn, portfolioReturn, beginnerMode, onConnect, onImportBroker, brokersOn = true, embedded = false }) {
  const t = (es, en) => lang === 'es' ? es : en
  const hasLots = lots && lots.length > 0

  // FASE QI. Eran cuatro familias y dos sobraban, por repetir lo que el
  // tablero ya dice en otro sitio (auditado, no a ojo):
  //   Exposición > Mapa        = la misma repartición por tipo y sector de
  //                              Asignación de Activos, dibujada como treemap.
  //   Exposición > Moneda      = la vista "Moneda" de Asignación + la card de
  //                              Tipo de cambio.
  //   Exposición > Comisiones  = lo que la card de Costos ya suma.
  //   Proyección > Proyección  = el simulador repetía la sección "Proyecciones"
  //                              del propio tablero (patrimonio a diciembre y
  //                              comparador), con menos datos.
  // Los componentes siguen en disco; solo dejan de montarse acá.
  // Calidad de datos era lo único de Proyección que no se repetía, y pasa a
  // Riesgo: mide qué tan confiable es lo que se está leyendo.
  const families = [
    {
      key: 'performance', label: t('Rendimiento', 'Performance'),
      views: [
        { key: 'benchmark', label: t('Benchmark', 'Benchmark') },
        ...(beginnerMode ? [] : [{ key: 'attribution', label: t('Atribución', 'Attribution') }]),
        ...(hasLots ? [{ key: 'gains', label: t('Ganancias', 'Gains') }] : []),
      ],
    },
    {
      key: 'risk', label: t('Riesgo', 'Risk'),
      views: [
        { key: 'health', label: t('Salud', 'Health') },
        ...(beginnerMode ? [] : [{ key: 'risk', label: t('Métricas', 'Metrics') }]),
        { key: 'concentration', label: t('Concentración', 'Concentration') },
        // Integraciones con brokers ocultas: DataQualityCard solo gatea el
        // CLICK de sus botones, así que con onConnect en null quedaría un
        // botón visible y muerto. Se excluye la vista entera.
        ...(brokersOn ? [{ key: 'quality', label: t('Calidad de datos', 'Data quality') }] : []),
      ],
    },
  ].filter((f) => f.views.length > 0)

  const [family, setFamily] = useState('risk')
  const activeFamily = families.find((f) => f.key === family) || families[0]
  // La vista arranca en la primera de su familia y se re-ancla al cambiar de
  // familia, así que nunca queda una vista activa que no esté en la fila de
  // abajo (por ejemplo al entrar o salir de modo principiante).
  const [tab, setTab] = useState(activeFamily.views[0].key)
  const activeTab = activeFamily.views.some((v) => v.key === tab) ? tab : activeFamily.views[0].key

  return (
    <div className={embedded ? '' : 'card p-4 sm:p-5'}>
      {/* Header — mirrors AssetAllocation's so the two read as one pair */}
      <div className="flex items-center justify-between mb-3">
        <h3 className={`card-title${embedded ? ' card-title-quiet' : ''}`}>
          {!embedded && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-purple)' }} />}
          {embedded ? t('Análisis', 'Analysis') : t('ANÁLISIS', 'ANALYSIS')}
          <InfoTip text={t(
            'Distintas lecturas del mismo portafolio, agrupadas por la pregunta que contestan. Ninguna pestaña cambia tus datos.',
            'Different readings of the same portfolio, grouped by the question each one answers. No tab changes your data.'
          )} />
        </h3>
      </div>

      <SegmentedTabs
        tabs={families.map((f) => ({ key: f.key, label: f.label }))}
        value={activeFamily.key}
        onChange={(k) => {
          setFamily(k)
          const next = families.find((f) => f.key === k)
          if (next) setTab(next.views[0].key)
        }}
        deps={[lang, beginnerMode, hasLots]}
        ariaLabel={t('Familias de análisis', 'Analysis families')}
        className="mb-2"
      />
      {/* El segundo nivel solo aparece cuando de verdad hay algo que elegir. */}
      {activeFamily.views.length > 1 && (
        <SubTabs tabs={activeFamily.views} value={activeTab} onChange={setTab}
          ariaLabel={t('Vistas de esta familia', 'Views in this family')} className="mb-4" />
      )}
      {/* Rediseño, sección 2: el cuerpo desplaza DENTRO de un alto fijo (desde
          lg), así pasar de Riesgo a Proyección no estira la card ni mueve el
          resto del tablero. */}
      <div>
      {activeTab === 'health' && (
        // Concentration lives in its own dedicated tab; don't duplicate it here.
        <CardBoundary id="AN-01"><FinancialHealth items={portfolioItems} netWorth={netWorth} totalAssets={totalAssets} snapshots={snapshots} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'risk' && !beginnerMode && (
        <CardBoundary id="AN-05"><RiskMetrics snapshots={snapshots} benchmarkData={benchmarkData} netWorth={netWorth} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} benchmarkName={benchmarkName} /></CardBoundary>
      )}
      {activeTab === 'concentration' && (
        <CardBoundary id="AN-02b"><ConcentrationRisk items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'gains' && hasLots && (
        <CardBoundary id="AN-03"><GainsReport lots={lots} items={portfolioItems} lang={lang} convert={convert} baseCurrency={baseCurrency} /></CardBoundary>
      )}
      {activeTab === 'attribution' && !beginnerMode && (
        <CardBoundary id="AN-04"><PerformanceAttribution items={portfolioItems} lang={lang} transactions={transactions} convert={convert} baseCurrency={baseCurrency} /></CardBoundary>
      )}
      {activeTab === 'benchmark' && (
        <CardBoundary id="OL-02"><BenchmarkComparison benchmarkReturn={benchmarkReturn} portfolioReturn={portfolioReturn} benchmarkName={benchmarkName} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'quality' && (
        <CardBoundary id="HO-03"><DataQualityCard items={portfolioItems} transactions={transactions} snapshots={snapshots} convert={convert} baseCurrency={baseCurrency} lang={lang} onConnect={onConnect} onImportBroker={onImportBroker} /></CardBoundary>
      )}
      </div>
    </div>
  )
}
