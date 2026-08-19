'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { Zap } from 'lucide-react'
import { authFetch, safeJson } from '@/lib/authFetch'
import { isFirestoreQuotaError } from '@/lib/firestoreErrors'
import LearnedRulesList from '@/components/finance/LearnedRulesList'

// Standalone entry point for auto-captured expenses (iPhone Shortcut + forwarded
// bank alerts), scoped to Flujo. Lives here instead of the shared Settings modal
// (which opens from Patrimonio/dashboard) so configuring it never pulls a Flujo
// user away from this page — the entire feature is Flujo's, not Patrimonio's.
export default function AutoCaptureModal({ onClose, lang = 'es' }) {
  const trapRef = useFocusTrap()
  const t = (es, en) => lang === 'es' ? es : en

  const [ingest, setIngest] = useState(null) // null = not loaded yet
  // Separate from ingestLoading: that flag also covers create/revoke actions,
  // so a button that only disables on ingestLoading goes quiet-and-unresponsive
  // (no visual change) for however long the INITIAL list fetch takes — which on
  // a cold serverless function can be a few real seconds. initialLoading lets
  // the button say so instead of just ignoring taps.
  const [initialLoading, setInitialLoading] = useState(true)
  const [initialError, setInitialError] = useState(null)
  const [ingestLoading, setIngestLoading] = useState(false)
  const [ingestCopied, setIngestCopied] = useState(null) // `${token}:${what}` just copied
  const [ingestSyncing, setIngestSyncing] = useState(false)
  const [flashMsg, setFlashMsg] = useState(null)

  const flash = (type, msg) => { setFlashMsg({ type, msg }); setTimeout(() => setFlashMsg(null), 3000) }

  // The raw server error is shown as-is (that's what saves a diagnosis round
  // trip), except when it's the database's daily free-tier quota: that's a
  // gRPC code nobody can act on, and it resolves itself within hours, so it
  // gets translated into what happened and that it isn't a bug to report.
  const humanizeError = (raw) => (isFirestoreQuotaError(raw) ? t(
    'Se alcanzó el límite diario gratuito de la base de datos. Se reinicia solo en unas horas; no es un error de la app, y el atajo del iPhone y el correo automático no dependen de este botón.',
    'The database hit its free daily quota. It resets on its own within hours; this is not an app bug, and the iPhone shortcut and automatic email do not depend on this button.',
  ) : (raw || t('Error', 'Error')))

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const ingestApi = useCallback(async (payload) => {
    const res = await authFetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await safeJson(res)
    // `detail` (Firestore code + message, from a genuine server error) rides
    // alongside `error` when present — surfacing it here is what turns a
    // screenshot of this modal into a real diagnosis instead of another guess.
    if (!res.ok) throw new Error(data?.detail ? `${data.error} (${data.detail})` : (data?.error || 'Error'))
    return data
  }, [])

  // A failed initial load used to fall back to a silent "0 tokens" state,
  // indistinguishable from a genuinely empty account — the exact silent
  // degradation this app's own history warns against. Now it surfaces as a
  // real error with a retry, and the create button stays reachable meanwhile.
  const loadIngest = useCallback(() => {
    setInitialLoading(true)
    setInitialError(null)
    ingestApi({ action: 'list' })
      .then(setIngest)
      .catch((e) => setInitialError(humanizeError(e.message)))
      .finally(() => setInitialLoading(false))
  }, [ingestApi])

  useEffect(() => { loadIngest() }, [loadIngest])

  // The token is the credential for BOTH paths: the Shortcut sends it as a
  // bearer header, and the forwarding address carries it as a plus-label.
  const forwardAddressFor = (token) => {
    const base = ingest?.emailIngest?.address
    if (!base || !base.includes('@')) return null
    const [user, domain] = base.split('@')
    return `${user}+${token}@${domain}`
  }


  // Último uso del token, en palabras. "Nunca" es la respuesta más informativa
  // de todas: significa que el atajo no ha llegado ni una vez al servidor, o sea
  // el problema está en el teléfono y no acá.
  const lastUse = (tk) => {
    if (!tk.lastUsedAt) {
      return { text: t('Nunca se ha usado', 'Never used'), tone: 'var(--alert-warn-icon)' }
    }
    const ms = Date.now() - new Date(tk.lastUsedAt).getTime()
    const ago = !isFinite(ms) || ms < 0 ? null
      : ms < 60000 ? t('hace instantes', 'moments ago')
        : ms < 3600000 ? t(`hace ${Math.round(ms / 60000)} min`, `${Math.round(ms / 60000)} min ago`)
          : ms < 86400000 ? t(`hace ${Math.round(ms / 3600000)} h`, `${Math.round(ms / 3600000)} h ago`)
            : t(`hace ${Math.round(ms / 86400000)} d`, `${Math.round(ms / 86400000)} d`)
    const r = tk.lastResult
    const outcome = r === 'created' ? t('gasto registrado', 'expense recorded')
      : r === 'duplicate' ? t('ya estaba registrado', 'already recorded')
        : r ? t(`rechazado: ${r}`, `rejected: ${r}`)
          : null
    const bad = r && r !== 'created' && r !== 'duplicate'
    return {
      text: [t('Último uso ', 'Last used '), ago, outcome ? ` · ${outcome}` : ''].filter(Boolean).join(''),
      tone: bad ? 'var(--alert-warn-icon)' : 'var(--text-muted)',
    }
  }

  const copyIngest = (token, what, value) => {
    navigator.clipboard.writeText(value)
    setIngestCopied(`${token}:${what}`)
    setTimeout(() => setIngestCopied(null), 2000)
  }

  const handleCreateIngestToken = async () => {
    setIngestLoading(true)
    try {
      const { token } = await ingestApi({ action: 'create', label: 'iPhone' })
      setIngest((p) => ({ ...p, tokens: [...(p?.tokens || []), token] }))
      copyIngest(token.token, 'token', token.token)
      flash('ok', t('Token creado y copiado', 'Token created and copied'))
    } catch (e) { flash('err', humanizeError(e.message)) }
    setIngestLoading(false)
  }

  const handleRevokeIngestToken = async (token) => {
    setIngestLoading(true)
    try {
      await ingestApi({ action: 'revoke', token })
      setIngest((p) => ({ ...p, tokens: (p?.tokens || []).filter((tk) => tk.token !== token) }))
      flash('ok', t('Token revocado', 'Token revoked'))
    } catch (e) { flash('err', humanizeError(e.message)) }
    setIngestLoading(false)
  }

  const handleSyncEmail = async () => {
    setIngestSyncing(true)
    try {
      const res = await ingestApi({ action: 'sync-email' })
      // Un barrido que no encuentra nada tiene tres causas MUY distintas y desde
      // afuera se ven iguales: no llegó nada, llegó pero ninguno traía token (o
      // sea la regla de reenvío apunta a la dirección sin +token), o llegaron
      // los nuestros y ya estaban registrados. Decir cuál ahorra la ronda de
      // diagnóstico, que es la lección del botón "Reparar ahora".
      if (res.created > 0) {
        flash('ok', t(
          `${res.created} gasto(s) nuevo(s) de ${res.ours} correo(s) tuyo(s).`,
          `${res.created} new expense(s) from ${res.ours} of your emails.`
        ))
      } else if (res.ours > 0) {
        flash('ok', t(
          `${res.ours} correo(s) tuyo(s), nada nuevo que agregar (ya estaban o no eran cobros).`,
          `${res.ours} of your emails, nothing new to add (already recorded or not charges).`
        ))
      } else if (res.scanned > 0) {
        flash('err', t(
          `Revisé ${res.scanned} correo(s) y ninguno venía con tu token. Revisa que la regla reenvíe a la dirección con +token de arriba.`,
          `Checked ${res.scanned} email(s), none carried your token. Check that your rule forwards to the +token address above.`
        ))
      } else {
        flash('ok', t('No había correos nuevos.', 'No new emails.'))
      }
    } catch (e) { flash('err', humanizeError(e.message)) }
    setIngestSyncing(false)
  }

  const handleForgetRule = async (match) => {
    try {
      const { rules } = await ingestApi({ action: 'forget', match })
      setIngest((p) => ({ ...p, rules }))
    } catch (e) { flash('err', humanizeError(e.message)) }
  }

  const tokens = ingest?.tokens || []
  const rules = ingest?.rules || []
  const emailReady = ingest?.emailIngest?.configured && ingest?.emailIngest?.address
  const endpoint = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/ingest/expense`
  const copyLabel = (token, what) => (ingestCopied === `${token}:${what}` ? t('¡Copiado!', 'Copied!') : t('Copiar', 'Copy'))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="auto-capture-title"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="auto-capture-title" className="text-lg font-bold text-white flex items-center gap-2">
            <Zap size={20} style={{ color: 'var(--accent-blue)' }} />
            {t('Gastos automáticos', 'Automatic expenses')}
          </h2>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        {flashMsg && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-lg text-xs font-medium transition-all" style={{ color: flashMsg.type === 'ok' ? 'var(--accent-green)' : 'var(--accent-red)', backgroundColor: flashMsg.type === 'ok' ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)' }}>
            {flashMsg.msg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <p className="text-xs text-slate-500">{t(
            'Cada compra con tarjeta entra sola a tu Flujo, con categoría, monto, moneda, comercio y ubicación. Hay dos caminos y conviene usar los dos: el atajo del iPhone captura al instante los pagos con Apple Pay, y el reenvío de correo recoge todo lo demás una vez al día (tarjeta física y cobros en línea). Si un cobro llega por los dos, se guarda una sola vez.',
            'Every card purchase lands in your Flujo on its own, with category, amount, currency, merchant and location. There are two paths and both are worth using: the iPhone shortcut captures Apple Pay charges instantly, and email forwarding picks up everything else once a day (physical card and online charges). If a charge arrives through both, it is stored only once.'
          )}</p>

          {initialError ? (
            <div className="p-3 rounded-xl border text-xs" style={{ borderColor: 'var(--alert-warn-border)', backgroundColor: 'var(--alert-warn-bg)', color: 'var(--alert-warn-icon)' }}>
              {t('No se pudo cargar tus tokens: ', 'Could not load your tokens: ')}{initialError}
              <button onClick={loadIngest} className="ml-2 underline font-medium">{t('Reintentar', 'Retry')}</button>
            </div>
          ) : initialLoading ? (
            <p className="text-xs text-slate-500">…</p>
          ) : tokens.length === 0 ? (
            <p className="text-xs text-slate-600">{t(
              'Genera un token para conectar tu iPhone. Es la llave que usan los dos caminos.',
              'Generate a token to connect your iPhone. It is the key both paths use.'
            )}</p>
          ) : (
            <div className="space-y-1.5">
              {tokens.map((tk) => {
                const address = forwardAddressFor(tk.token)
                return (
                  <div key={tk.token} className="p-3 bg-theme-base border border-glass-border rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium truncate">📱 {tk.label}</p>
                        <p className="text-xs text-slate-500 font-mono truncate">{tk.token.slice(0, 8)}…{tk.token.slice(-4)}</p>
                        {/* La línea que contesta "¿funcionó?". Sin ella, un gasto
                            que no aparece puede ser que la automatización nunca
                            disparó, que disparó y la rechazamos, o que era
                            duplicado — y las tres se ven exactamente igual. */}
                        <p className="text-xs mt-0.5" style={{ color: lastUse(tk).tone }}>{lastUse(tk).text}</p>
                      </div>
                      <button onClick={() => handleRevokeIngestToken(tk.token)} disabled={ingestLoading} aria-label={t('Revocar', 'Revoke')}
                        className="shrink-0 px-2 py-1 text-xs hover:opacity-100 transition-opacity" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>
                        ✕
                      </button>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <button onClick={() => copyIngest(tk.token, 'token', tk.token)}
                        className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                        {copyLabel(tk.token, 'token')} {t('token', 'token')}
                      </button>
                      {address && (
                        <button onClick={() => copyIngest(tk.token, 'email', address)}
                          className="px-2.5 py-1 text-xs font-medium rounded-md border transition-colors hover:bg-blue-500/10"
                          style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                          {copyLabel(tk.token, 'email')} {t('correo', 'email')}
                        </button>
                      )}
                    </div>
                    {address && <p className="text-xs text-slate-600 font-mono break-all">{address}</p>}
                  </div>
                )
              })}
            </div>
          )}

          {tokens.length > 0 && (
            <div className="p-3 bg-theme-base border border-glass-border rounded-xl space-y-3">
              <div>
                <p className="text-xs font-medium text-white mb-1">{t('1. Atajo del iPhone (instantáneo)', '1. iPhone shortcut (instant)')}</p>
                <p className="text-xs text-slate-500">{t(
                  'Atajos, pestaña Automatización, Nueva automatización, Transacción. Elige tu tarjeta y "Ejecutar inmediatamente". Adentro: Obtener contenido de una URL, método POST, y este endpoint:',
                  'Shortcuts app, Automation tab, New automation, Transaction. Pick your card and "Run immediately". Inside: Get Contents of URL, POST method, and this endpoint:'
                )}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="flex-1 text-xs text-slate-400 font-mono break-all bg-theme-surface px-2 py-1 rounded">{endpoint}</code>
                  <button onClick={() => copyIngest('endpoint', 'url', endpoint)}
                    className="shrink-0 px-2 py-1 text-xs font-medium rounded-md" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                    {copyLabel('endpoint', 'url')}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-white mb-1">{t('2. Reenvío de correo (una vez al día)', '2. Email forwarding (once a day)')}</p>
                <p className="text-xs text-slate-500">{emailReady ? t(
                  'En tu correo, crea una regla que reenvíe las alertas de tu banco a la dirección de arriba. Captura también las compras con tarjeta física, que Apple Pay no ve.',
                  'In your mail client, create a rule that forwards your bank alerts to the address above. This also captures physical card purchases, which Apple Pay never sees.'
                ) : t(
                  'Falta configurar el buzón del servidor (IMAP). Mientras tanto funciona solo el atajo del iPhone.',
                  'The server mailbox (IMAP) is not configured yet. Until then only the iPhone shortcut works.'
                )}</p>
                {emailReady && (
                  <button onClick={handleSyncEmail} disabled={ingestSyncing}
                    className="mt-2 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
                    style={{ borderColor: 'color-mix(in srgb, var(--accent-green) 30%, transparent)', color: 'var(--accent-green)' }}>
                    {ingestSyncing ? t('Revisando…', 'Checking…') : t('Sincronizar ahora', 'Sync now')}
                  </button>
                )}
              </div>
            </div>
          )}

          <button onClick={handleCreateIngestToken} disabled={ingestLoading || initialLoading}
            className="w-full px-3 py-2.5 text-xs font-medium text-slate-400 border border-dashed border-glass-border rounded-xl hover:text-blue-400 hover:border-blue-500/30 transition-colors disabled:opacity-50">
            {initialLoading
              ? t('Cargando…', 'Loading…')
              : ingestLoading
                ? t('Generando…', 'Generating…')
                : `+ ${t('Generar token para un dispositivo', 'Generate a token for a device')}`}
          </button>

          <LearnedRulesList rules={rules} onForget={handleForgetRule} busy={ingestLoading} lang={lang} />

          <p className="text-xs text-slate-600">{t(
            'El token da permiso para agregar gastos a tu cuenta, nunca para leerla. Si pierdes el teléfono, revócalo aquí.',
            'The token grants permission to add expenses to your account, never to read it. If you lose your phone, revoke it here.'
          )}</p>
        </div>
      </div>
    </div>
  )
}
