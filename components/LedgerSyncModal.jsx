'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { authFetch, safeJson } from '@/lib/authFetch'
import { normalizeWalletName, buildWalletOptions, addSavedWallet } from '@/lib/customWallets'

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

// Where the coins are kept: becomes the item's institution so the portfolio
// can group by custody. Watch-only either way, the device is never touched.
// OTHER_WALLET reveals a free-text input ("which wallet?") whose value is used
// as the institution and kept as its own option next time (saved on the user's
// preferences doc, loaded below when the modal opens).
const BASE_CUSTODIES = ['Ledger', 'Trezor', 'Coldcard', 'Exchange']
const OTHER_WALLET = 'Otra wallet'

// The asset the BALANCE is denominated in, per chain. L2s settle in ETH: a
// balance read from Arbitrum/Base/Optimism is ETH, not the ARB/OP token, so
// pricing it by chain key undervalued it by ~1000x.
const CHAIN_ASSET = { BTC: 'BTC', ETH: 'ETH', SOL: 'SOL', MATIC: 'MATIC', AVAX: 'AVAX', ARB: 'ETH', BASE: 'ETH', OP: 'ETH' }

// USD price for a date from a daily [{date:'YYYY-MM-DD', close}] series:
// exact match, else the nearest close within 3 days (weekend gaps), else null.
function priceOnDate(prices, dateStr) {
  if (!Array.isArray(prices) || prices.length === 0) return null
  const direct = prices.find((p) => p.date === dateStr && isFinite(p.close))
  if (direct) return direct.close
  const target = new Date(dateStr + 'T00:00:00Z').getTime()
  let best = null
  let bestDelta = Infinity
  for (const p of prices) {
    if (!p || !p.date || !isFinite(p.close)) continue
    const delta = Math.abs(new Date(p.date + 'T00:00:00Z').getTime() - target)
    if (delta < bestDelta) { bestDelta = delta; best = p }
  }
  return bestDelta <= 3 * 86400000 ? best.close : null
}

export default function LedgerSyncModal({ onClose, onSyncComplete, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const [addresses, setAddresses] = useState([{ chain: 'BTC', address: '' }])
  const [custody, setCustody] = useState('Ledger')
  const [customName, setCustomName] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('input')
  const [results, setResults] = useState(null)
  // Custom "Otra wallet" names persist on the same preferences doc the data
  // layer writes (users/{uid}/settings/preferences): loaded once on open so
  // the select can offer them again, saved on confirm.
  const [savedWallets, setSavedWallets] = useState([])

  const t = (es, en) => lang === 'es' ? es : en

  const walletOptions = [...buildWalletOptions(BASE_CUSTODIES, savedWallets), OTHER_WALLET]

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { auth, db } = await import('@/lib/firebase')
        const fs = await import('firebase/firestore')
        const uid = auth.currentUser?.uid
        if (!uid || !db) return
        const snap = await fs.getDoc(fs.doc(db, `users/${uid}/settings`, 'preferences'))
        const ws = snap.data()?._customWallets
        if (!cancelled && Array.isArray(ws)) setSavedWallets(ws)
      } catch { /* saved wallets are a convenience: the select works regardless */ }
    })()
    return () => { cancelled = true }
  }, [])

  const addRow = () => {
    setAddresses(prev => [...prev, { chain: 'BTC', address: '' }])
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

      const data = await safeJson(res) || {}
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

  const handleConfirm = useCallback(async () => {
    if (!results) return

    // The wallet the user typed under "Otra wallet" becomes the institution
    // (and a saved option for next time); empty text keeps the generic label.
    const custom = custody === OTHER_WALLET ? normalizeWalletName(customName) : ''
    const effCustody = custody === OTHER_WALLET ? (custom || OTHER_WALLET) : custody
    if (custom) {
      const next = addSavedWallet(savedWallets, custom)
      if (next !== savedWallets) {
        setSavedWallets(next)
        // Same doc and merge semantics as useFirestoreItems.saveSettings, so
        // the dashboard's settings listener picks the new option up by itself.
        try {
          const { auth, db } = await import('@/lib/firebase')
          const fs = await import('firebase/firestore')
          const uid = auth.currentUser?.uid
          if (uid && db) {
            await fs.setDoc(fs.doc(db, `users/${uid}/settings`, 'preferences'),
              { _customWallets: next, updatedAt: new Date().toISOString() }, { merge: true })
          }
        } catch { /* the import still applies the name */ }
      }
    }

    // Historical USD prices for assets that have detected inflows, so each
    // inflow imports as a BUY at that day's price (real cost basis). One
    // chart call per asset, via our own cached prices API.
    const chainsWithFlows = [...new Set(results.results.filter(r => r.inflows?.length > 0).map(r => CHAIN_ASSET[r.chain] || r.chain))]
    const charts = {}
    await Promise.all(chainsWithFlows.map(async (chain) => {
      try {
        // type=crypto is mandatory: without it the route proxies Yahoo, where
        // BTC resolves to nothing and ETH to Ethan Allen Interiors.
        const res = await authFetch(`/api/prices/chart?symbol=${chain}&range=max&interval=1d&type=crypto`)
        const data = await safeJson(res)
        if (res.ok && Array.isArray(data?.prices)) charts[chain] = data.prices
      } catch { /* pricing is best-effort: unpriced inflows import at 0 and stay editable */ }
    }))

    // Current price for EVERY imported asset, stored on the item itself. An
    // item that lands with currentPrice 0 shows $0.00 (or its historical
    // cost) until the dashboard poll happens to win, which on a shared-IP
    // CoinGecko rate limit can be a while: price it now, at import time.
    const spot = {}
    try {
      const assets = [...new Set(results.results.map((r) => CHAIN_ASSET[r.chain] || r.chain))]
      const res = await authFetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: assets.map((a) => ({ symbol: a, type: 'Crypto' })) }),
      })
      const data = await safeJson(res)
      if (res.ok && data?.prices) {
        for (const a of assets) {
          const p = data.prices[a]?.price
          if (p != null && isFinite(p) && p > 0) spot[a] = p
        }
      }
    } catch { /* spot is best-effort: the next dashboard poll retries */ }

    const items = []
    const transactions = []
    for (const r of results.results) {
      const asset = CHAIN_ASSET[r.chain] || r.chain
      const inflows = r.inflows || []
      const priced = inflows
        .map((f) => ({ ...f, price: priceOnDate(charts[asset], f.date) }))
        .filter((f) => f.price != null && f.price > 0)
      const totalQty = priced.reduce((s, f) => s + f.amount, 0)
      const avgCost = totalQty > 0
        ? priced.reduce((s, f) => s + f.amount * f.price, 0) / totalQty
        : 0

      items.push({
        symbol: asset,
        name: `${r.chain} (${effCustody})`,
        type: 'Crypto',
        quantity: r.balance,
        // Without priced inflows the cost basis is unknown: default to the
        // current price (flat return) instead of 0, which read as "no price".
        purchasePrice: avgCost > 0 ? avgCost : (spot[asset] || 0),
        currentPrice: spot[asset] || 0,
        currency: 'USD',
        institution: effCustody,
        custodyType: effCustody === 'Exchange' ? 'custodial' : 'self_custody',
        custodyDetails: r.address,
        _source: 'ledger',
        _walletAddress: r.address,
        ...(r.firstSeen ? { acquisitionDate: r.firstSeen } : {}),
      })

      for (const f of priced) {
        transactions.push({
          type: 'BUY',
          symbol: asset,
          quantity: f.amount,
          pricePerUnit: f.price,
          totalAmount: f.amount * f.price,
          currency: 'USD',
          date: f.date,
          description: t('Entrada on-chain detectada', 'Detected on-chain inflow'),
          _source: 'ledger',
          _walletAddress: r.address,
        })
      }
    }

    onSyncComplete({ items, transactions, mode: 'merge' })
    onClose()
  }, [results, custody, customName, savedWallets, onSyncComplete, onClose, t])

  const inputCls = 'w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">🔒</span> {t('Cripto por dirección', 'Crypto by address')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none" aria-label="Close">&times;</button>
        </div>

        {step === 'input' && (
          <div className="p-6 space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <p className="text-xs text-blue-400 font-medium mb-1">{t('Cómo funciona:', 'How it works:')}</p>
              <p className="text-xs text-blue-300/80">
                {t(
                  'Pega tus direcciones públicas. Leemos balance e historial directo del blockchain (mempool.space para Bitcoin, Routescan para Ethereum): no conectas tu dispositivo ni compartes keys privadas.',
                  'Paste your public addresses. We read balance and history straight from the blockchain (mempool.space for Bitcoin, Routescan for Ethereum): no device connection, no private keys.'
                )}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">{t('¿Dónde guardas esta cripto?', 'Where do you keep this crypto?')}</label>
              <select value={custody} onChange={e => setCustody(e.target.value)}
                className="w-full px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white">
                {walletOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {custody === OTHER_WALLET && (
                <>
                  <input value={customName} onChange={e => setCustomName(e.target.value)}
                    placeholder={t('Ej.: Phantom, MetaMask, Tangem', 'E.g.: Phantom, MetaMask, Tangem')}
                    maxLength={30}
                    className={inputCls + ' mt-2'} />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {t('El nombre se queda guardado como opción para la próxima vez.', 'The name stays saved as an option for next time.')}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-3">
              {addresses.map((row, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="w-20 shrink-0">
                    <select value={row.chain} onChange={e => updateRow(i, 'chain', e.target.value)}
                      className="w-full px-2 py-2 bg-theme-base border border-glass-border rounded-lg text-xs text-white">
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
              className="w-full py-2.5 bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2" style={{ color: '#ffffff' }}>
              {syncing ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t('Leyendo blockchain...', 'Reading blockchain...')}
                </>
              ) : t('Leer blockchain', 'Read blockchain')}
            </button>
          </div>
        )}

        {step === 'preview' && results && (
          <div className="p-6 space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              <p className="text-sm text-emerald-400 font-medium">{t('Lo que encontramos', 'What we found')}</p>
            </div>

            <div className="space-y-2">
              {results.results.map((r, i) => (
                <div key={i} className="px-3 py-2 bg-theme-base rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-white text-sm font-medium">{r.chain}</span>
                      <span className="text-slate-500 text-xs ml-2 font-mono">{r.address.slice(0, 8)}...{r.address.slice(-6)}</span>
                    </div>
                    <span className="text-white text-sm font-mono">
                      {r.balance.toLocaleString(undefined, { maximumFractionDigits: 8 })} {r.chain}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 mt-1">
                    {r.balance === 0 && (
                      <span className="text-[11px]" style={{ color: '#f59e0b' }}>
                        {t('balance 0: dirección vacía o con movimientos sin confirmar', '0 balance: empty address or unconfirmed moves')}
                      </span>
                    )}
                    {r.firstSeen && (
                      <span className="text-[11px] text-slate-500">{t('desde', 'since')} {r.firstSeen}</span>
                    )}
                    {r.inflows?.length > 0 && (
                      <span className="text-[11px] text-slate-500">
                        {r.inflows.length} {r.inflows.length === 1 ? t('entrada', 'inflow') : t('entradas', 'inflows')}
                      </span>
                    )}
                    {r.historyTruncated && (
                      <span className="text-[11px]" style={{ color: '#f59e0b' }}>
                        {t('historial parcial (dirección muy activa)', 'partial history (very active address)')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {results.results.some(r => r.inflows?.length > 0) && (
              <p className="text-[11px] text-slate-500">
                {t(
                  'Las entradas se importan como compras al precio USD de ese día, para que tu costo y retorno salgan bien.',
                  'Inflows import as buys at that day\'s USD price, so your cost basis and return come out right.'
                )}
              </p>
            )}

            {results.errors?.length > 0 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-xs text-amber-400 font-medium mb-1">{t('Errores:', 'Errors:')}</p>
                {results.errors.map((e, i) => (
                  <p key={i} className="text-xs text-amber-300/70">{e.address?.slice(0, 12)}...: {e.error}</p>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => { setStep('input'); setResults(null) }}
                className="flex-1 py-2.5 border border-glass-border text-slate-300 rounded-lg hover:bg-theme-base transition-colors text-sm">
                {t('Atrás', 'Back')}
              </button>
              <button onClick={handleConfirm}
                className="flex-1 py-2.5 bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors text-sm font-medium" style={{ color: '#ffffff' }}>
                {t('Importar', 'Import')} ({results.results.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
