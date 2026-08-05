'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { safeJson } from '@/lib/authFetch'

const STORAGE_KEY = 'chispudo-anthropic-key'

export default function ChatWidget({ user, items, netWorth, totalAssets, returnYTD, annualDividends, riskMetrics, baseCurrency, lang, onUpdateItem }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setApiKey(saved)
      else setShowKeyInput(true)
    }
  }, [])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
    if (!open) abortRef.current?.abort()
  }, [open])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const saveKey = useCallback((key) => {
    const trimmed = key.trim()
    setApiKey(trimmed)
    localStorage.setItem(STORAGE_KEY, trimmed)
    setShowKeyInput(false)
    setError('')
  }, [])

  const buildContext = useCallback(() => ({
    netWorth,
    totalAssets,
    returnYTD,
    annualDividends,
    baseCurrency,
    riskMetrics,
    items: (items || []).map(it => ({
      name: it.name, symbol: it.symbol, type: it.type, subtype: it.subtype,
      quantity: it.quantity, purchasePrice: it.purchasePrice, currentPrice: it.currentPrice,
      currency: it.currency, institution: it.institution,
      isDebt: it.isDebt, isReceivable: it.isReceivable,
      interestRate: it.interestRate, debtTerm: it.debtTerm,
      monthlyPayment: it.monthlyPayment, installmentsRemaining: it.installmentsRemaining,
      rewardType: it.rewardType, rewardBalance: it.rewardBalance, cardBrand: it.cardBrand,
      incomeRate: it.incomeRate, maturityDate: it.maturityDate,
      acquisitionDate: it.acquisitionDate, notes: it.notes,
    })),
  }), [items, netWorth, totalAssets, returnYTD, annualDividends, riskMetrics, baseCurrency])

  const handleActions = useCallback((actions) => {
    if (!actions || !onUpdateItem) return
    for (const action of actions) {
      if (action.action === 'update_item') {
        const match = items?.find(it =>
          (it.name && it.name.toLowerCase() === action.item_name?.toLowerCase()) ||
          (it.symbol && it.symbol.toLowerCase() === action.item_name?.toLowerCase())
        )
        if (match) onUpdateItem(match.id, action.fields)
      }
    }
  }, [items, onUpdateItem])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return
    if (!apiKey) { setShowKeyInput(true); return }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const userMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setError('')

    try {
      const token = await user.getIdToken()
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: newMessages,
          portfolioContext: buildContext(),
          apiKey,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await safeJson(res) || {}
        if (res.status === 401 && data.error === 'Invalid API key') {
          setError(t('API key inválida. Revisa tu key.', 'Invalid API key. Check your key.'))
          setShowKeyInput(true)
        } else {
          setError(data.error || 'Error')
        }
        setLoading(false)
        return
      }

      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('text/event-stream')) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let accumulated = ''

        setMessages(prev => [...prev, { role: 'assistant', content: '' }])

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const payload = line.slice(6)
              if (payload === '[DONE]') continue
              try {
                const evt = JSON.parse(payload)
                if (evt.text) {
                  accumulated += evt.text
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = { role: 'assistant', content: accumulated }
                    return updated
                  })
                }
              } catch {}
            }
          }
        } catch (readErr) {
          if (readErr.name !== 'AbortError') throw readErr
        }
      } else {
        const data = await safeJson(res) || {}
        setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
        if (data.actions?.length > 0) handleActions(data.actions)
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(t('Error de conexión', 'Connection error'))
    }
    setLoading(false)
  }, [input, loading, apiKey, messages, user, buildContext, t, handleActions])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (!user) return null

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 hover:opacity-90"
        style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
        title={t('Asistente AI', 'AI Assistant')}
        aria-label={open ? t('Cerrar asistente', 'Close assistant') : t('Abrir asistente', 'Open assistant')}
      >
        {open ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-36 sm:bottom-20 right-4 sm:right-6 z-50 w-[340px] sm:w-[380px] max-h-[70vh] bg-theme-card border border-glass-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-glass-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#34d399' }} />
              <span className="text-sm font-semibold text-white">{t('Asistente AI', 'AI Assistant')}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowKeyInput(!showKeyInput)}
                className="p-1 text-slate-400 hover:text-white transition-colors" title="API Key" aria-label="API Key">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </button>
              <button onClick={() => { setMessages([]); setError('') }}
                className="p-1 text-slate-400 hover:text-white transition-colors" title={t('Limpiar', 'Clear')} aria-label={t('Limpiar chat', 'Clear chat')}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <button onClick={() => setOpen(false)}
                className="p-1 text-slate-400 hover:text-white transition-colors" title={t('Minimizar', 'Minimize')} aria-label={t('Minimizar chat', 'Minimize chat')}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* API Key input */}
          {showKeyInput && (
            <div className="px-4 py-3 border-b border-glass-border bg-theme-base">
              <label className="text-xs text-slate-400 uppercase tracking-wide mb-1 block">Anthropic API Key</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  defaultValue={apiKey}
                  placeholder="sk-ant-..."
                  className="flex-1 px-2 py-1.5 bg-theme-card border border-glass-border rounded text-xs text-white focus:outline-none focus:border-blue-500"
                  onKeyDown={(e) => { if (e.key === 'Enter') saveKey(e.target.value) }}
                />
                <button
                  onClick={(e) => saveKey(e.target.previousSibling.value)}
                  className="px-3 py-1.5 text-xs rounded hover:opacity-90 transition-colors"
                  style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
                >
                  OK
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {t('Tu key se guarda solo en tu navegador. Nunca se almacena en nuestros servidores.',
                   'Your key is stored only in your browser. Never saved on our servers.')}
              </p>
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px] max-h-[45vh]">
            {messages.length === 0 && !loading && (
              <div className="text-center py-8">
                <p className="text-slate-400 text-sm mb-3">{t('Pregúntame sobre tu portafolio', 'Ask me about your portfolio')}</p>
                <div className="space-y-1.5">
                  {[
                    t('¿Cuánto valen mis millas?', 'How much are my miles worth?'),
                    t('¿Qué deuda pago primero?', 'Which debt should I pay first?'),
                    t('Dame un resumen financiero', 'Give me a financial summary'),
                  ].map((suggestion, i) => (
                    <button key={i} onClick={() => { setInput(suggestion) }}
                      className="block w-full text-left px-3 py-2 text-xs rounded-lg transition-colors"
                      style={{ color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.1)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(37,99,235,0.2)' }}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
                  msg.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
                }`}
                  style={msg.role === 'user'
                    ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff' }
                    : { backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border-color)' }
                  }>
                  <MessageContent content={msg.content} />
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-theme-base border border-glass-border rounded-xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="px-3 py-2 border rounded-lg text-xs" style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--text-negative)' }}>
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-glass-border">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('Escribe tu pregunta...', 'Type your question...')}
                disabled={loading}
                className="flex-1 px-3 py-2 bg-theme-base border border-glass-border rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
                aria-label={t('Enviar', 'Send')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function MessageContent({ content }) {
  if (!content) return null
  const parts = content.split(/(\*\*.*?\*\*|\n)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part === '\n') return <br key={i} />
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
