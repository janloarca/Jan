'use client'

import { useState, useEffect, useCallback } from 'react'

const CHAINS = [
  { key: 'BTC', label: 'Bitcoin', placeholder: 'bc1q... or 1... or 3...' },
  { key: 'ETH', label: 'Ethereum', placeholder: '0x...' },
  { key: 'SOL', label: 'Solana', placeholder: 'So1...' },
  { key: 'MATIC', label: 'Polygon', placeholder: '0x...' },
  { key: 'AVAX', label: 'Avalanche', placeholder: '0x...' },
  { key: 'ARB', label: 'Arbitrum', placeholder: '0x...' },
  { key: 'BASE', label: 'Base', placeholder: '0x...' },
  { key: 'OP', label: 'Optimism', placeholder: '0x...' },
]

export default function LedgerSyncModal({ onClose, onSyncComplete, lang = 'es' }) {
  const [addresses, setAddresses] = useState([{ chain: 'BTC', address: '', label: '' }])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('input')
  const [results, setResults] = useState(null)

  const t = (es, en) => lang === 'es' ? es : en

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const addRow = () => {
    setAddresses(prev => [...prev, { chain: 'BTC', address: '', label: '' }])
  }

  const removeRow = (i) => {
    setAddresses(prev => prev.filter((_, idx) => idx !== i))
  }

  const updateRow = (i, field, value) => {
    setAddresses(prev => prev.map((row, idx) => idx === i ? { ...row, [field]: value } : row))
  }

  const handleSync = useCallback(async () => {
    const valid = addresses.filter(a => a.address.trim())
    if (valid.length === 0) {
      setError(t('Ingresa al menos una dirección.', 'Enter at least one address.'))
      return
    }
    setSyncing(true)
    setError('')
    try {
      const { auth } = await import('@/lib/firebase')
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/brokers/ledger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ addresses: valid }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')

      if (data.errors?.length > 0 && data.results?.length === 0) {
        setError(data.errors.map(e => `${e.address}: ${e.error}`).join('\n'))
        setSyncing(false)
        return
      }

      setResults(data)
      setStep('preview')
    } catch (err) {
      setError(err.message)
    }
    setSyncing(false)
  }, [addresses, t])

  const handleConfirm = useCallback(() => {
    if (!results) return
    const items = results.results.map(r => ({
      symbol: r.chain,
      name: r.label || `${r.chain} (Ledger)`,
      type: 'Crypto',
      quantity: r.balance,
      purchasePrice: 0,
      currentPrice: 0,
      currency: 'USD',
      institution: 'Ledger',
      custodyType: 'self_custody',
      custodyDetails: r.address,
      _source: 'ledger',
      _walletAddress: r.address,
    }))
    onSyncComplete({ items, mode: 'merge' })
    onClose()
  }, [results, onSyncComplete, onClose])

  const inputCls = 'w-full px-3 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-[#1C1C1E] border border-[#38383A] rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#38383A]">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">🔒</span> Ledger Sync
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {step === 'input' && (
          <div className="p-6 space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <p className="text-xs text-blue-400 font-medium mb-1">{t('Cómo funciona:', 'How it works:')}</p>
              <p className="text-[11px] text-blue-300/80">
                {t(
                  'Pega tus direcciones públicas. Leemos el balance directamente del blockchain. No necesitas conectar tu Ledger ni compartir keys privadas.',
                  'Paste your public addresses. We read the balance directly from the blockchain. No need to connect your Ledger or share private keys.'
                )}
              </p>
            </div>

            <div className="space-y-3">
              {addresses.map((row, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="w-20 shrink-0">
                    <select value={row.chain} onChange={e => updateRow(i, 'chain', e.target.value)}
                      className="w-full px-2 py-2 bg-[#000000] border border-[#38383A] rounded-lg text-xs text-white">
                      {CHAINS.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <input value={row.address} onChange={e => updateRow(i, 'address', e.target.value)}
                      placeholder={CHAINS.find(c => c.key === row.chain)?.placeholder || 'Address'}
                      className={inputCls + ' text-xs font-mono'} />
                  </div>
                  {addresses.length > 1 && (
                    <button onClick={() => removeRow(i)} className="text-slate-500 hover:text-red-400 text-lg px-1 mt-1">×</button>
                  )}
                </div>
              ))}
            </div>

            <button onClick={addRow} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              + {t('Agregar otra dirección', 'Add another address')}
            </button>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 whitespace-pre-wrap">
                {error}
              </div>
            )}

            <button onClick={handleSync} disabled={syncing}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2">
              {syncing ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('Leyendo blockchain...', 'Reading blockchain...')}
                </>
              ) : t('Leer balances', 'Read balances')}
            </button>
          </div>
        )}

        {step === 'preview' && results && (
          <div className="p-6 space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <p className="text-sm text-emerald-400 font-medium">{t('Balances encontrados', 'Balances found')}</p>
            </div>

            <div className="space-y-2">
              {results.results.map((r, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 bg-[#000000] rounded-lg">
                  <div>
                    <span className="text-white text-sm font-medium">{r.chain}</span>
                    <span className="text-slate-500 text-xs ml-2 font-mono">{r.address.slice(0, 8)}...{r.address.slice(-6)}</span>
                  </div>
                  <span className="text-white text-sm font-mono">
                    {r.balance.toLocaleString(undefined, { maximumFractionDigits: 8 })} {r.chain}
                  </span>
                </div>
              ))}
            </div>

            {results.errors?.length > 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-xs text-amber-400 font-medium mb-1">{t('Errores:', 'Errors:')}</p>
                {results.errors.map((e, i) => (
                  <p key={i} className="text-[11px] text-amber-300/70">{e.address?.slice(0, 12)}... — {e.error}</p>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setStep('input'); setResults(null) }}
                className="flex-1 py-2.5 border border-[#38383A] text-slate-300 rounded-lg hover:bg-[#000000] transition-colors text-sm">
                {t('Atrás', 'Back')}
              </button>
              <button onClick={handleConfirm}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium">
                {t('Importar', 'Import')} ({results.results.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
