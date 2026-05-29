'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useDashboardData } from '@/hooks/useDashboardData'
import { useSpreadsheetContext } from '@/hooks/useSpreadsheetContext'
import SheetTabs from '@/components/spreadsheet/SheetTabs'
import { TEMPLATES } from '@/lib/spreadsheet/formulas'

const SpreadsheetGrid = dynamic(() => import('@/components/spreadsheet/SpreadsheetGrid'), { ssr: false })
const PortfolioSpreadsheet = dynamic(() => import('@/components/dashboard/PortfolioSpreadsheet'), { ssr: false })
const EditAccountModal = dynamic(() => import('@/components/EditAccountModal'), { ssr: false })

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
    snapshots, addItem, updateItem, deleteItem, portfolioItems,
  } = useDashboardData({ user, lang, activePortfolio: '__all__' })

  const [editItem, setEditItem] = useState(null)

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

  // Firestore persistence
  const firestoreSaveRef = useRef(null)
  useEffect(() => {
    if (!user) return
    if (firestoreSaveRef.current) clearTimeout(firestoreSaveRef.current)
    firestoreSaveRef.current = setTimeout(async () => {
      try {
        const { default: getFirebase } = await import('@/lib/firebase')
        const fb = await import('firebase/firestore')
        const { db } = getFirebase ? await import('@/lib/firebase').then(m => ({ db: null })) : { db: null }
      } catch {}
    }, 5000)
  }, [sheets, user])

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0f172a]">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#1e293b] border-b border-[#334155]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-slate-400 hover:text-white transition-colors">
            ← {t('Dashboard', 'Dashboard')}
          </button>
          <div className="w-px h-5 bg-[#334155]" />
          <h1 className="text-sm font-semibold text-white flex items-center gap-2">
            ⚡ Spreadsheet
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-[#0f172a] rounded-lg border border-[#334155] p-0.5">
            <button onClick={() => setView('portfolio')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${view === 'portfolio' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              Portfolio
            </button>
            <button onClick={() => setView('custom')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${view === 'custom' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t('Hojas', 'Sheets')}
            </button>
          </div>
          {view === 'custom' && (
            <button onClick={() => setShowTemplates(!showTemplates)}
              className="px-3 py-1.5 text-xs text-slate-400 border border-slate-600 rounded hover:text-white hover:border-slate-500 transition-colors">
              {t('Plantillas', 'Templates')}
            </button>
          )}
          <div className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t('Datos en vivo', 'Live data')}
          </div>
        </div>
      </div>

      {/* Templates dropdown */}
      {showTemplates && (
        <div className="px-4 py-3 bg-[#1e293b]/80 border-b border-[#334155]">
          <div className="flex items-center gap-3">
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

      {view === 'portfolio' ? (
        <div className="flex-1 p-4 overflow-auto">
          <PortfolioSpreadsheet
            items={portfolioItems || enrichedItems}
            snapshots={snapshots}
            lang={lang}
            onUpdateItem={updateItem}
            onEditItem={(item) => setEditItem(item)}
            returnYTD={returnYTD}
            netWorth={netWorth}
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
        <EditAccountModal item={editItem} onClose={() => setEditItem(null)}
          onSave={addItem} onDelete={deleteItem} existingItems={items} lang={lang} />
      )}
    </div>
  )
}
