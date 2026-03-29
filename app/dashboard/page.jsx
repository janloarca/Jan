'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'
import FileImportModal from '@/components/FileImportModal'

const labels = {
  en: {
    appName: 'chispu.xyz',
    dashboard: 'Dashboard',
    importData: 'Import Data',
    signOut: 'Sign Out',
    totalAssets: 'Total Assets',
    netWorth: 'Net Worth',
    holdings: 'Holdings',
    returnYTD: 'Return YTD',
    portfolioHoldings: 'Portfolio Holdings',
    recentSnapshots: 'Recent Snapshots',
    recentTransactions: 'Recent Transactions',
    symbol: 'Symbol',
    name: 'Name',
    type: 'Type',
    quantity: 'Qty',
    purchasePrice: 'Purchase Price',
    institution: 'Institution',
    date: 'Date',
    totalActivosUSD: 'Total Assets (USD)',
    netWorthUSD: 'Net Worth (USD)',
    noHoldings: 'No holdings yet. Import data to get started.',
    noSnapshots: 'No snapshots recorded yet.',
    noTransactions: 'No transactions recorded yet.',
    loading: 'Loading...',
    language: 'EN',
  },
  es: {
    appName: 'chispu.xyz',
    dashboard: 'Panel',
    importData: 'Importar Datos',
    signOut: 'Cerrar Sesion',
    totalAssets: 'Total Activos',
    netWorth: 'Patrimonio Neto',
    holdings: 'Posiciones',
    returnYTD: 'Retorno YTD',
    portfolioHoldings: 'Posiciones del Portafolio',
    recentSnapshots: 'Snapshots Recientes',
    recentTransactions: 'Transacciones Recientes',
    symbol: 'Simbolo',
    name: 'Nombre',
    type: 'Tipo',
    quantity: 'Cant.',
    purchasePrice: 'Precio Compra',
    institution: 'Institucion',
    date: 'Fecha',
    totalActivosUSD: 'Total Activos (USD)',
    netWorthUSD: 'Patrimonio Neto (USD)',
    noHoldings: 'Sin posiciones. Importa datos para comenzar.',
    noSnapshots: 'Sin snapshots registrados.',
    noTransactions: 'Sin transacciones registradas.',
    loading: 'Cargando...',
    language: 'ES',
  },
}

function formatCurrency(value) {
  if (value == null || isNaN(value)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value)
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showImportModal, setShowImportModal] = useState(false)
  const [lang, setLang] = useState('es')

  const t = labels[lang]

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.push('/login')
      } else {
        setUser(currentUser)
      }
      setAuthLoading(false)
    })
    return () => unsubscribe()
  }, [router])

  const {
    items,
    snapshots,
    transactions,
    loading: dataLoading,
    addItem,
    deleteItem,
    deleteAllItems,
    saveSnapshot,
    deleteAllSnapshots,
    addTransaction,
    deleteAllTransactions,
  } = useFirestoreItems()

  const handleSignOut = async () => {
    await signOut(auth)
    router.push('/login')
  }

  // Compute summary values
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const totalAssets = latestSnapshot?.totalActivosUSD ?? 0
  const netWorth = latestSnapshot?.netWorthUSD ?? 0
  const holdingsCount = items.length

  const yearStart = snapshots.find((s) => {
    if (!s.date) return false
    const d = new Date(s.date)
    const now = new Date()
    return d.getFullYear() === now.getFullYear()
  })
  const startNetWorth = yearStart?.netWorthUSD ?? netWorth
  const returnYTD =
    startNetWorth > 0 ? ((netWorth - startNetWorth) / startNetWorth) * 100 : 0

  const recentSnapshots = [...snapshots].reverse().slice(0, 5)
  const recentTransactions = [...transactions].reverse().slice(0, 10)

  // Loading state
  if (authLoading || (user && dataLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="mt-4 text-gray-500">{t.loading}</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-bold text-gray-900">{t.appName}</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                {lang === 'en' ? 'ES' : 'EN'}
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600 transition-colors"
              >
                {t.importData}
              </button>
              <button
                onClick={handleSignOut}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                {t.signOut}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <SummaryCard label={t.totalAssets} value={formatCurrency(totalAssets)} />
          <SummaryCard label={t.netWorth} value={formatCurrency(netWorth)} />
          <SummaryCard label={t.holdings} value={holdingsCount.toString()} />
          <SummaryCard
            label={t.returnYTD}
            value={`${returnYTD >= 0 ? '+' : ''}${returnYTD.toFixed(2)}%`}
            valueColor={returnYTD >= 0 ? 'text-green-600' : 'text-red-600'}
          />
        </div>

        {/* Portfolio Holdings Table */}
        <section className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">{t.portfolioHoldings}</h2>
          </div>
          {items.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400">{t.noHoldings}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-6 py-3 font-medium">{t.symbol}</th>
                    <th className="px-6 py-3 font-medium">{t.name}</th>
                    <th className="px-6 py-3 font-medium">{t.type}</th>
                    <th className="px-6 py-3 font-medium text-right">{t.quantity}</th>
                    <th className="px-6 py-3 font-medium text-right">{t.purchasePrice}</th>
                    <th className="px-6 py-3 font-medium">{t.institution}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-900">
                        {item.symbol || '-'}
                      </td>
                      <td className="px-6 py-3 text-gray-600">{item.name || '-'}</td>
                      <td className="px-6 py-3">
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
                          {item.type || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right text-gray-900">
                        {item.quantity != null ? Number(item.quantity).toLocaleString() : '-'}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-900">
                        {item.purchasePrice != null
                          ? formatCurrency(item.purchasePrice)
                          : '-'}
                      </td>
                      <td className="px-6 py-3 text-gray-600">{item.institution || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Bottom grid: Snapshots + Transactions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Snapshots */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{t.recentSnapshots}</h2>
            </div>
            {recentSnapshots.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-400">{t.noSnapshots}</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {recentSnapshots.map((snap) => (
                  <li key={snap.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {formatDate(snap.date)}
                      </span>
                      <div className="text-right text-sm">
                        <div className="text-gray-500">
                          {t.totalActivosUSD}:{' '}
                          <span className="text-gray-900 font-medium">
                            {formatCurrency(snap.totalActivosUSD)}
                          </span>
                        </div>
                        <div className="text-gray-500">
                          {t.netWorthUSD}:{' '}
                          <span className="text-gray-900 font-medium">
                            {formatCurrency(snap.netWorthUSD)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recent Transactions */}
          <section className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{t.recentTransactions}</h2>
            </div>
            {recentTransactions.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-400">{t.noTransactions}</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {recentTransactions.map((tx) => (
                  <li key={tx.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-gray-900">
                          {tx.symbol || tx.description || '-'}
                        </span>
                        {tx.type && (
                          <span className="ml-2 inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                            {tx.type}
                          </span>
                        )}
                      </div>
                      <div className="text-right text-sm">
                        <div className="text-gray-900 font-medium">
                          {tx.amount != null ? formatCurrency(tx.amount) : '-'}
                        </div>
                        <div className="text-gray-400 text-xs">{formatDate(tx.date)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      {/* File Import Modal */}
      {showImportModal && (
        <FileImportModal
          onClose={() => setShowImportModal(false)}
          items={items}
          snapshots={snapshots}
          transactions={transactions}
          addItem={addItem}
          deleteItem={deleteItem}
          deleteAllItems={deleteAllItems}
          saveSnapshot={saveSnapshot}
          deleteAllSnapshots={deleteAllSnapshots}
          addTransaction={addTransaction}
          deleteAllTransactions={deleteAllTransactions}
        />
      )}
    </div>
  )
}

function SummaryCard({ label, value, valueColor = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
    </div>
  )
}
