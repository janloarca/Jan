'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useSpreadsheetContext } from '@/hooks/useSpreadsheetContext'
import SheetTabs from '@/components/spreadsheet/SheetTabs'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import ModalMount from '@/components/ui/ModalMount'
import useModalExit from '@/hooks/useModalExit'
import { SkeletonTable } from '@/components/dashboard/Skeleton'
import PageTour from '@/components/dashboard/PageTour'
import Header from '@/components/dashboard/Header'
import MobileNav from '@/components/dashboard/MobileNav'
import { TEMPLATES } from '@/lib/spreadsheet/formulas'

const SpreadsheetGrid = dynamic(() => import('@/components/spreadsheet/SpreadsheetGrid'), { ssr: false })
const PortfolioSpreadsheet = dynamic(() => import('@/components/dashboard/PortfolioSpreadsheet'), { ssr: false })
const DebtSpreadsheet = dynamic(() => import('@/components/dashboard/DebtSpreadsheet'), { ssr: false })
const PatrimonioSpreadsheet = dynamic(() => import('@/components/dashboard/PatrimonioSpreadsheet'), { ssr: false })
const EditAccountModal = dynamic(() => import('@/components/EditAccountModal'), { ssr: false })
const AccountReviewModal = dynamic(() => import('@/components/dashboard/AccountReviewModal'), { ssr: false })
const AddAccountModal = dynamic(() => import('@/components/AddAccountModal'), { ssr: false })
const ChatWidget = dynamic(() => import('@/components/ChatWidget'), { ssr: false })

function generateId() {
  return `sheet_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export default function SpreadsheetPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [lang, setLang] = useState('es')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
    }
  }, [])

  const handleSetLang = useCallback(() => {
    const next = lang === 'en' ? 'es' : 'en'
    setLang(next)
    if (typeof window !== 'undefined') localStorage.setItem('chispudo-lang', next)
  }, [lang])

  const handleSignOut = useCallback(async () => {
    const { auth } = await import('@/lib/firebase')
    const { signOut } = await import('firebase/auth')
    document.cookie = '__session=; path=/; max-age=0'
    if (auth) await signOut(auth)
    router.push('/login')
  }, [router])

  useEffect(() => {
    async function initAuth() {
      const { auth } = await import('@/lib/firebase')
      const { onIdTokenChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push('/login'); return }
      const unsub = onIdTokenChanged(auth, (currentUser) => {
        if (!currentUser) { router.push('/login') }
        else { setUser(currentUser); setAuthLoading(false) }
      })
      return unsub
    }
    const cleanup = initAuth()
    return () => { cleanup.then?.(fn => fn?.()) }
  }, [router])

  const {
    items, enrichedItems, netWorth, transactions, financeTransactions, returnYTD,
    snapshots, addItem, updateItem, deleteItem, portfolioItems, convert, rates,
    baseCurrency, saveItemSnapshots, loadItemSnapshots, lots,
    addTransaction, updateTransaction, deleteTransaction, deleteTransactionWithReversal, updateTransactionWithReversal,
    addLot, closeLotsFIFO, executeContribution, dataLoading, settings,
    handleRefresh, pricesLoading, ratesLoading,
  } = useDashboardData({ user, lang, activePortfolio: '__all__' })

  // El usuario lo pidio con estas palabras: "utilizar el boton de refresh propio
  // para que recapacite y repare la tabla despues de poner info nueva". El
  // Spreadsheet registra aca su recalculo y el refresh del header lo dispara
  // junto con el refresco de precios de siempre, en vez de obligarlo a buscar un
  // segundo boton.
  const recalcRef = useRef(null)
  const handleHeaderRefresh = useCallback(() => {
    handleRefresh()
    if (recalcRef.current) recalcRef.current()
  }, [handleRefresh])
  const registerRecalculate = useCallback((fn) => { recalcRef.current = fn }, [])

  const [editItem, setEditItem] = useState(null)
  const [showReview, setShowReview] = useState(false)
  // Los modales sobreviven su animación de salida. Ver hooks/useModalExit.js.
  const [editShown, editClosing] = useModalExit(editItem)
  const [addShown, addClosing] = useModalExit(showAddModal)
  const [reviewShown, reviewClosing] = useModalExit(showReview)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalDefaults, setAddModalDefaults] = useState(null)

  const [view, setView] = useState('portfolio')

  const context = useSpreadsheetContext({
    items: enrichedItems,
    netWorth,
    transactions,
    financeTransactions,
    returnYTD,
  })

  const t = (es, en) => lang === 'es' ? es : en

  const [sheets, setSheets] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('chispudo-spreadsheets')
        if (saved) return JSON.parse(saved)
      } catch {}
    }
    return [{ id: 'default', name: t('Hoja 1', 'Sheet 1'), rows: [] }]
  })

  const [activeSheetId, setActiveSheetId] = useState(() => sheets[0]?.id || 'default')
  const [showTemplates, setShowTemplates] = useState(false)

  const saveToStorage = useCallback((updatedSheets) => {
    try { localStorage.setItem('chispudo-spreadsheets', JSON.stringify(updatedSheets)) } catch {}
  }, [])

  const activeSheet = sheets.find(s => s.id === activeSheetId) || sheets[0]

  const handleSaveRows = useCallback((rows) => {
    setSheets(prev => {
      const updated = prev.map(s => s.id === activeSheetId ? { ...s, rows } : s)
      saveToStorage(updated)
      return updated
    })
  }, [activeSheetId, saveToStorage])

  const handleAddSheet = useCallback(() => {
    const id = generateId()
    const newSheet = { id, name: `${t('Hoja', 'Sheet')} ${sheets.length + 1}`, rows: [] }
    const updated = [...sheets, newSheet]
    setSheets(updated)
    setActiveSheetId(id)
    saveToStorage(updated)
  }, [sheets, saveToStorage])

  const handleRenameSheet = useCallback((id, name) => {
    setSheets(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, name } : s)
      saveToStorage(updated)
      return updated
    })
  }, [saveToStorage])

  const handleDeleteSheet = useCallback((id) => {
    setSheets(prev => {
      const updated = prev.filter(s => s.id !== id)
      if (updated.length === 0) updated.push({ id: generateId(), name: t('Hoja 1', 'Sheet 1'), rows: [] })
      saveToStorage(updated)
      if (activeSheetId === id) setActiveSheetId(updated[0].id)
      return updated
    })
  }, [activeSheetId, saveToStorage])

  const handleApplyTemplate = useCallback((template) => {
    const id = generateId()
    const newSheet = {
      id,
      name: lang === 'es' ? template.nameEs : template.name,
      rows: template.rows,
    }
    const updated = [...sheets, newSheet]
    setSheets(updated)
    setActiveSheetId(id)
    saveToStorage(updated)
    setShowTemplates(false)
  }, [sheets, lang, saveToStorage])

  // Block on data too — otherwise the grids mount empty and the content pops in.
  if (authLoading || (user && dataLoading)) {
    return (
      <div className="min-h-screen bg-theme-base">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4">
          <SkeletonTable />
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen flex flex-col bg-theme-base">
      <a href="#main-content" className="skip-link">{t('Ir al contenido', 'Skip to content')}</a>
      {/* FASE EM. onRefresh was a no-op and loadStagesDone/Total weren't passed
          at all, so the refresh button on this page never did anything AND
          its ring could never show real progress — it looked broken because
          it was. Same handleRefresh + 3-stage signal app/dashboard/page.jsx
          already uses, so the ring here means the same thing it does there. */}
      <Header user={user} lang={lang} setLang={handleSetLang}
        friendsEnabled={settings?.friendsEnabled !== false}
        onImport={() => router.push('/dashboard')} onSettings={() => router.push('/dashboard')}
        onSignOut={handleSignOut} onRefresh={handleHeaderRefresh}
        pricesLoading={pricesLoading || ratesLoading}
        loadStagesDone={[!dataLoading, !ratesLoading, !pricesLoading].filter(Boolean).length}
        loadStagesTotal={3} />
      <PageTour pageKey="spreadsheet" nextRoute="/friends" nextFlag="friends" lang={lang} steps={[
        {
          tab: t('Hoja de Cálculo', 'Spreadsheet'),
          title: t('Tu patrimonio mes a mes', 'Your net worth month by month'),
          body: t('Esta es la matriz completa: cada fila es una cuenta o activo, cada columna un mes. Puedes ver cómo creció (o cayó) cada cosa que tienes a lo largo del tiempo, con totales por mes y retorno anual.',
                  'This is the full matrix: each row is an account or asset, each column a month. You can see how everything you own grew (or fell) over time, with monthly totals and annual return.'),
        },
        {
          tab: t('Hoja de Cálculo', 'Spreadsheet'),
          title: t('Vistas y celdas editables', 'Views and editable cells'),
          // Este paso prometía que se podía corregir CUALQUIER mes haciendo clic
          // en su celda, y que esa corrección ganaba sobre el estimado. Ninguna
          // de las dos cosas existe: solo la columna del mes actual es editable
          // (las demás se renderizan como texto plano, sin cursor ni mensaje),
          // así que quien intentaba corregir marzo hacía clic doce veces sin
          // ninguna respuesta. Corregir un mes pasado de verdad necesita una
          // capa persistida aparte que sobreviva a los bumps de
          // SNAPSHOT_VERSION, o sea una función con su propio diseño; mientras
          // no exista, el texto dice lo que la pantalla de verdad hace.
          body: t('Arriba cambias de vista: Portfolio (inversiones), Deudas, Bienes (inmuebles y similares) y Hojas personalizadas. Los valores con "~" son estimados calculados con precios históricos.',
                  'Switch views up top: Portfolio (investments), Debts, Estate (real estate and similar) and custom Sheets. Values marked "~" are estimates from historical prices.'),
          tip: t('La columna del mes actual es editable: haz clic en una celda para corregir su valor de hoy.', "The current month's column is editable: click a cell to correct today's value."),
        },
        {
          tab: t('Hoja de Cálculo', 'Spreadsheet'),
          title: t('Exporta cuando quieras', 'Export anytime'),
          body: t('Toda la matriz se puede descargar como Excel con un clic, lista para tu contador o tus propios análisis. Nada de tu información queda atrapada en la app.',
                  'The whole matrix downloads as Excel in one click, ready for your accountant or your own analysis. None of your data is locked in the app.'),
        },
      ]} />
      {/* View switcher. The global Header above owns navigation now; this bar only
          carries the view tabs and view-specific actions, in theme tokens. */}
      <div id="main-content" className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-h1" style={{ color: 'var(--text-primary)' }}>{t('Hoja de Cálculo', 'Spreadsheet')}</h1>
        <div className="flex items-center gap-2">
          {/* Otro SegmentedTabs escrito a mano, y este DIVERGÍA: su estado activo
              era un relleno sólido `var(--accent-blue)` mientras el primitivo usa
              una pastilla elevada `var(--bg-card)`. O sea la app decía "esta
              pestaña está activa" de dos formas distintas según la pantalla. */}
          <SegmentedTabs
            tabs={[
              { key: 'portfolio', label: 'Portfolio' },
              { key: 'debts', label: t('Deudas', 'Debts') },
              // "Bienes", not "Patrimonio" — this tab sums only estate assets
              // (real estate/vehicles/alternatives), while the dashboard's
              // "Patrimonio Neto" is assets minus debt. Same word for two
              // different numbers was misleading.
              { key: 'patrimonio', label: t('Bienes', 'Estate') },
              { key: 'custom', label: t('Hojas', 'Sheets') },
            ]}
            value={view}
            onChange={setView}
            deps={[lang]}
            ariaLabel={t('Vista de la hoja', 'Sheet view')}
          />
          {['portfolio', 'debts', 'patrimonio'].includes(view) && (portfolioItems || enrichedItems)?.length > 0 && (
            <button onClick={() => setShowReview(true)}
              className="px-3 py-1.5 text-xs rounded-lg border transition-colors hover:bg-theme-elevated"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
              {t('Revisar todas', 'Review all')}
            </button>
          )}
          {view === 'custom' && (
            <button onClick={() => setShowTemplates(!showTemplates)}
              className="px-3 py-1.5 text-xs rounded-lg border transition-colors hover:bg-theme-elevated"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
              {t('Plantillas', 'Templates')}
            </button>
          )}
        </div>
      </div>

      {/* Templates dropdown */}
      {showTemplates && (
        <div className="px-4 py-3 bg-theme-surface/80 border-b border-glass-border">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-500">{t('Crear desde plantilla:', 'Create from template:')}</span>
            {TEMPLATES.map(tmpl => (
              <button
                key={tmpl.id}
                onClick={() => handleApplyTemplate(tmpl)}
                // Era paleta cruda de Tailwind (`text-blue-400`), el único azul
                // de la app que no sale del token de marca.
                className="px-3 py-1.5 text-caption min-h-[28px] rounded border transition-colors"
                style={{
                  color: 'var(--accent-blue)',
                  backgroundColor: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)',
                }}
              >
                {lang === 'es' ? tmpl.nameEs : tmpl.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'portfolio' && (portfolioItems || enrichedItems)?.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="text-5xl mb-4">📈</div>
          {/* Era `#0f172a` fijo, un casi-negro de tema CLARO. Sobre el fondo
              oscuro (que es el tema por DEFECTO de la app) mide 1.10:1, o sea
              este mensaje era invisible justo para quien acaba de entrar y
              todavía no tiene nada cargado. El espejo exacto del defecto que el
              guardián persigue al revés. */}
          <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{t('Aún no tienes activos', 'No assets yet')}</p>
          <p className="text-sm mb-4" style={{ color: '#64748b' }}>
            {t('Agrega tu primer activo desde el dashboard para ver tu historial mensual aquí.',
               'Add your first asset from the dashboard to see your monthly history here.')}
          </p>
          <button onClick={() => router.push('/dashboard')}
            className="px-4 py-2 text-sm font-medium rounded-lg"
            style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
            {t('Ir al Dashboard', 'Go to Dashboard')}
          </button>
        </div>
      ) : view === 'portfolio' ? (
        <div className="flex-1 p-4 sm:p-6 overflow-auto">
          <PortfolioSpreadsheet
            items={portfolioItems || enrichedItems}
            snapshots={snapshots}
            lang={lang}
            onUpdateItem={updateItem}
            onAddTransaction={addTransaction}
            onEditItem={(item) => setEditItem(item)}
            returnYTD={returnYTD}
            netWorth={netWorth}
            convert={convert}
            baseCurrency={baseCurrency}
            onSaveItemSnapshots={saveItemSnapshots}
            onLoadItemSnapshots={loadItemSnapshots}
            lots={lots}
            transactions={transactions}
            onRegisterRecalculate={registerRecalculate}
          />
        </div>
      ) : view === 'debts' ? (
        <div className="flex-1 p-4 sm:p-6 overflow-auto">
          <DebtSpreadsheet
            items={portfolioItems || enrichedItems}
            lang={lang}
            onEditItem={(item) => setEditItem(item)}
            onAdd={() => { setAddModalDefaults({ isDebt: true }); setShowAddModal(true) }}
          />
        </div>
      ) : view === 'patrimonio' ? (
        <div className="flex-1 p-4 sm:p-6 overflow-auto">
          <PatrimonioSpreadsheet
            items={portfolioItems || enrichedItems}
            lang={lang}
            onEditItem={(item) => setEditItem(item)}
            onUpdateItem={updateItem}
            onAdd={(defaults) => { setAddModalDefaults(defaults || {}); setShowAddModal(true) }}
          />
        </div>
      ) : (
        <>
          <div className="flex-1">
            <SpreadsheetGrid
              key={activeSheetId}
              initialRows={activeSheet?.rows || []}
              context={context}
              onSave={handleSaveRows}
              lang={lang}
            />
          </div>
          <SheetTabs
            sheets={sheets}
            activeSheet={activeSheetId}
            onSelect={setActiveSheetId}
            onAdd={handleAddSheet}
            onRename={handleRenameSheet}
            onDelete={handleDeleteSheet}
            lang={lang}
          />
        </>
      )}

      <ModalMount closing={editClosing}>
      {editShown && (
        // Pass editItem AS-IS — no local stripping. editItem comes from the
        // enriched array (portfolioItems/enrichedItems), whose currentPrice/
        // purchasePrice are already converted to baseCurrency; the ONLY way
        // back to the item's own currency is _originalPrice/
        // _originalPurchasePrice/_originalCurrency. EditAccountModal already
        // prefers those fields itself (its own stripEnriched, plus the form's
        // initial state) — dropping them here before the modal ever saw them
        // defeated that fallback, so a GTQ item's form showed its USD-
        // converted number as if it were GTQ, and saving without changing it
        // wrote that wrong number back as the item's real GTQ price (XOCHI,
        // FASE EK). app/dashboard/page.jsx never had this bug: it always
        // passed editItem straight through.
        <EditAccountModal key={editItem.id} item={editItem} onClose={() => setEditItem(null)}
          onSave={async (updated) => {
            const { id, ...fields } = updated
            await updateItem(editItem.id, fields)
          }}
          onDelete={deleteItem} existingItems={items} lang={lang}
          onAddTransaction={addTransaction} onExecuteContribution={executeContribution}
          onDeleteTransaction={deleteTransactionWithReversal} onUpdateTransaction={updateTransactionWithReversal}
          onCreateDestination={addItem}
          transactions={transactions} baseCurrency={baseCurrency} convert={convert} />
      )}
      </ModalMount>

      <ModalMount closing={addClosing}>
      {addShown && (
        <AddAccountModal
          onClose={() => { setShowAddModal(false); setAddModalDefaults(null) }}
          onAdd={addItem}
          onCreateDestination={addItem}
          existingItems={items}
          lang={lang}
          defaults={addModalDefaults}
        />
      )}
      </ModalMount>

      <ModalMount closing={reviewClosing}>
      {reviewShown && (
        <AccountReviewModal
          items={portfolioItems || enrichedItems}
          transactions={transactions}
          onClose={() => setShowReview(false)}
          onEditItem={(item) => { setShowReview(false); setEditItem(item) }}
          lang={lang}
        />
      )}
      </ModalMount>

      <ChatWidget user={user} items={portfolioItems || enrichedItems} netWorth={netWorth}
        returnYTD={returnYTD} baseCurrency={baseCurrency} lang={lang} onUpdateItem={updateItem} />

      <MobileNav lang={lang} friendsEnabled={settings?.friendsEnabled !== false}
        onAdd={() => router.push('/dashboard')} onImport={() => router.push('/dashboard')}
        onExport={() => router.push('/dashboard')} onShare={() => router.push('/dashboard')}
        onSettings={() => router.push('/dashboard')} />
    </div>
  )
}
