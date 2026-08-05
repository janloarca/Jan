'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useSpreadsheetContext } from '@/hooks/useSpreadsheetContext'
import SheetTabs from '@/components/spreadsheet/SheetTabs'
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
    snapshotsWithCalibration, addItem, updateItem, deleteItem, portfolioItems, convert, rates,
    baseCurrency, saveItemSnapshots, loadItemSnapshots, lots,
    addTransaction, addLot, closeLotsFIFO, executeContribution, dataLoading, settings,
  } = useDashboardData({ user, lang, activePortfolio: '__all__' })

  const [editItem, setEditItem] = useState(null)
  const [showReview, setShowReview] = useState(false)
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
      <Header user={user} lang={lang} setLang={handleSetLang}
        friendsEnabled={settings?.friendsEnabled !== false}
        onImport={() => router.push('/dashboard')} onSettings={() => router.push('/dashboard')}
        onSignOut={handleSignOut} onRefresh={() => {}} pricesLoading={false} />
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
          body: t('Arriba cambias de vista: Portfolio (inversiones), Deudas, Bienes (inmuebles y similares) y Hojas personalizadas. Los valores con "~" son estimados calculados con precios históricos; si conoces el valor real de un mes, haz clic en la celda y corrígelo.',
                  'Switch views up top: Portfolio (investments), Debts, Estate (real estate and similar) and custom Sheets. Values marked "~" are estimates from historical prices; if you know a month\'s real value, click the cell and correct it.'),
          tip: t('Tus correcciones manuales siempre ganan sobre los estimados.', 'Your manual corrections always win over estimates.'),
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
        <h1 className="text-h1 font-bold text-white">{t('Hoja de Cálculo', 'Spreadsheet')}</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--card-border)' }}>
            {[
              { key: 'portfolio', label: 'Portfolio' },
              { key: 'debts', label: t('Deudas', 'Debts') },
              // "Bienes", not "Patrimonio" — this tab sums only estate assets
              // (real estate/vehicles/alternatives), while the dashboard's
              // "Patrimonio Neto" is assets minus debt. Same word for two
              // different numbers was misleading.
              { key: 'patrimonio', label: t('Bienes', 'Estate') },
              { key: 'custom', label: t('Hojas', 'Sheets') },
            ].map(tab => (
              <button key={tab.key} onClick={() => setView(tab.key)}
                className="px-3 py-1 text-xs rounded-md transition-colors"
                style={view === tab.key ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff' } : { color: 'var(--text-muted)' }}>
                {tab.label}
              </button>
            ))}
          </div>
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
                className="px-3 py-1.5 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-500/20 transition-colors"
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
          <p className="font-semibold mb-2" style={{ color: '#0f172a' }}>{t('Aún no tienes activos', 'No assets yet')}</p>
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
            snapshots={snapshotsWithCalibration}
            lang={lang}
            onUpdateItem={updateItem}
            onEditItem={(item) => setEditItem(item)}
            returnYTD={returnYTD}
            netWorth={netWorth}
            convert={convert}
            baseCurrency={baseCurrency}
            onSaveItemSnapshots={saveItemSnapshots}
            onLoadItemSnapshots={loadItemSnapshots}
            lots={lots}
            transactions={transactions}
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

      {editItem && (
        <EditAccountModal key={editItem.id} item={(() => {
            const { _originalPrice, _originalPurchasePrice, _originalCurrency, _displayCurrency, totalValue, percentOfPortfolio, change1d, change7d, change30d, pnlPercent, ...rawItem } = editItem
            return rawItem
          })()} onClose={() => setEditItem(null)}
          onSave={async (updated) => {
            const { id, ...fields } = updated
            await updateItem(editItem.id, fields)
          }}
          onDelete={deleteItem} existingItems={items} lang={lang}
          onAddTransaction={addTransaction} onExecuteContribution={executeContribution}
          onCreateDestination={addItem}
          transactions={transactions} baseCurrency={baseCurrency} />
      )}

      {showAddModal && (
        <AddAccountModal
          onClose={() => { setShowAddModal(false); setAddModalDefaults(null) }}
          onAdd={addItem}
          onCreateDestination={addItem}
          existingItems={items}
          lang={lang}
          defaults={addModalDefaults}
        />
      )}

      {showReview && (
        <AccountReviewModal
          items={portfolioItems || enrichedItems}
          transactions={transactions}
          onClose={() => setShowReview(false)}
          onEditItem={(item) => { setShowReview(false); setEditItem(item) }}
          lang={lang}
        />
      )}

      <ChatWidget user={user} items={portfolioItems || enrichedItems} netWorth={netWorth}
        returnYTD={returnYTD} baseCurrency={baseCurrency} lang={lang} onUpdateItem={updateItem} />

      <MobileNav lang={lang} friendsEnabled={settings?.friendsEnabled !== false}
        onAdd={() => router.push('/dashboard')} onImport={() => router.push('/dashboard')}
        onExport={() => router.push('/dashboard')} onShare={() => router.push('/dashboard')}
        onSettings={() => router.push('/dashboard')} />
    </div>
  )
}
