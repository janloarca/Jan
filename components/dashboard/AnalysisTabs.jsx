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
const CurrencyImpact = dynamic(() => import('@/components/dashboard/CurrencyImpact'), { loading: () => <SkeletonCard /> })
const FeeAnalysis = dynamic(() => import('@/components/dashboard/FeeAnalysis'), { loading: () => <SkeletonCard /> })
const PortfolioMap = dynamic(() => import('@/components/dashboard/PortfolioMap'), { loading: () => <SkeletonCard /> })
const ProjectionSimulator = dynamic(() => import('@/components/dashboard/ProjectionSimulator'), { loading: () => <SkeletonCard /> })

export default function AnalysisTabs({ lang, portfolioItems, netWorth, totalAssets, snapshots, lots, transactions, convert, baseCurrency, rates, benchmarkData, benchmarkName, benchmarkReturn, portfolioReturn, volatility, goalValue, beginnerMode, onConnect, onImportBroker, brokersOn = true }) {
  const t = (es, en) => lang === 'es' ? es : en
  const hasLots = lots && lots.length > 0

  // Once vistas en UNA fila plana no son pestañas, son una lista que se sale de
  // la pantalla: en el iPad del usuario la última quedaba cortada, y la guía de
  // NN/g es explícita en que las pestañas sirven para "unas pocas secciones".
  //
  // Se agrupan en cuatro familias, y ninguna vista desaparece. El criterio es la
  // PREGUNTA que contesta cada una, no de dónde salió el componente:
  //   Rendimiento  -> cómo me fue y qué lo movió
  //   Riesgo       -> qué tan expuesto estoy a que salga mal
  //   Exposición   -> a qué estoy expuesto, y qué me cuesta
  //   Proyección   -> lo que viene, y qué tan confiable es lo que estoy viendo
  //
  // Cuatro chips entran completos hasta en un teléfono, y dentro de cada familia
  // quedan dos o tres vistas: los dos niveles son cortos.
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
      ],
    },
    {
      key: 'exposure', label: t('Exposición', 'Exposure'),
      views: [
        { key: 'map', label: t('Mapa', 'Map') },
        { key: 'currency', label: t('Moneda', 'Currency') },
        { key: 'fees', label: t('Comisiones', 'Fees') },
      ],
    },
    {
      key: 'outlook', label: t('Proyección', 'Outlook'),
      views: [
        { key: 'projection', label: t('Proyección', 'Projection') },
        // Integraciones con brokers ocultas: DataQualityCard no gatea su
        // propio render en onConnect/onImportBroker, solo el CLICK de sus
        // botones — con esos props en null el botón quedaría visible y
        // muerto. Se excluye la pestaña entera en vez de tocar el
        // componente.
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
    <div className="card p-4 sm:p-5 flex flex-col lg:h-[var(--composition-card-h)]">
      {/* Header — mirrors AssetAllocation's so the two read as one pair */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-purple)' }} />
          {t('ANÁLISIS', 'ANALYSIS')}
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
      <div className="flex-1 min-h-0 lg:overflow-y-auto lg:pr-1 lg:-mr-1">
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
      {activeTab === 'currency' && (
        <CardBoundary id="PR-04"><CurrencyImpact items={portfolioItems} convert={convert} baseCurrency={baseCurrency} rates={rates} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'fees' && (
        <CardBoundary id="IG-09"><FeeAnalysis items={portfolioItems} netWorth={netWorth} lang={lang} convert={convert} baseCurrency={baseCurrency} /></CardBoundary>
      )}
      {activeTab === 'quality' && (
        <CardBoundary id="HO-03"><DataQualityCard items={portfolioItems} transactions={transactions} snapshots={snapshots} convert={convert} baseCurrency={baseCurrency} lang={lang} onConnect={onConnect} onImportBroker={onImportBroker} /></CardBoundary>
      )}
      {activeTab === 'map' && (
        <CardBoundary id="OR-06"><PortfolioMap items={portfolioItems} lang={lang} /></CardBoundary>
      )}
      {activeTab === 'projection' && (
        <CardBoundary id="IG-11"><ProjectionSimulator netWorth={netWorth} lang={lang} volatility={volatility} goalValue={goalValue} /></CardBoundary>
      )}
      </div>
    </div>
  )
}
