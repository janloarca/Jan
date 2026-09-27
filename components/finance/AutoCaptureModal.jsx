'use client'

import { useState, useEffect, useCallback } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { Zap } from 'lucide-react'
import { authFetch, safeJson } from '@/lib/authFetch'
import { isFirestoreQuotaError } from '@/lib/firestoreErrors'
import LearnedRulesList from '@/components/finance/LearnedRulesList'
import { ANDROID_BODY_TEMPLATE } from '@/lib/androidCapture'

// Standalone entry point for auto-captured expenses (iPhone Shortcut + forwarded
// bank alerts), scoped to Flujo. Lives here instead of the shared Settings modal
// (which opens from Patrimonio/dashboard) so configuring it never pulls a Flujo
// user away from this page — the entire feature is Flujo's, not Patrimonio's.

// El cuerpo que la app de automatización de Android manda viene del módulo
// compartido: el SERVIDOR reconoce esos mismos marcadores para poder decir
// "llegó, pero falta reemplazarlos" en vez de contestar con un error sobre el
// monto. Dos copias de la plantilla es cómo el mensaje deja de corresponder con
// lo que el usuario tiene pegado en el teléfono.
//
// ⛔ `occurredAt` no es para la HORA (la de llegada ya sirve: un push llega en
// segundos), es para el DÍA. Un push no declara zona horaria, y sin ninguna el
// servidor tiene que leer el día en UTC, que en Guatemala rota a las seis de la
// tarde: una compra de la noche del último día del mes quedaría archivada en el
// mes siguiente, o sea dinero cambiado de mes en Flujo.

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

  useEscClose(onClose)

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
    // Un fallo del SERVIDOR (la base de datos no respondió) y un RECHAZO
    // nuestro (el atajo mandó algo que no se puede usar) son diagnósticos
    // opuestos: el primero se reintenta solo, el segundo hay que ir a
    // arreglarlo al teléfono. Decirle "rechazado" a un crash manda a revisar
    // justo donde no está el problema.
    // Un SKIP tampoco es un rechazo: un reverso, un cobro declinado o un aviso
    // que no era de compra son resultados legítimos, y llamarlos "rechazado"
    // manda a arreglar una macro que está bien.
    const outcome = r === 'created' ? t('gasto registrado', 'expense recorded')
      : r === 'duplicate' ? t('ya estaba registrado', 'already recorded')
        // Llegó, con el token y el header correctos: lo único que falta son las
        // variables. Se dice así y no como un rechazo, porque es la mitad buena.
        : r === 'EMPTY_ALERT' ? t('llegó, pero sin los datos de la notificación', 'arrived, but with no notification data')
          : r === 'credit' ? t('era un reverso, no un gasto', 'it was a refund, not an expense')
            : r === 'declined' ? t('el cobro fue rechazado por el banco', 'the bank declined the charge')
              : r === 'not-an-alert' ? t('no parecía un cobro', 'did not look like a charge')
                : r === 'error:quota' ? t('la base llegó a su límite diario', 'database hit its daily limit')
                  : String(r || '').startsWith('error') ? t('falló en el servidor', 'server failure')
                    : r ? t(`rechazado: ${r}`, `rejected: ${r}`)
                      : null
    // Un skip no pinta de aviso: nada se registró y eso es lo correcto.
    const fine = ['created', 'duplicate', 'credit', 'declined', 'not-an-alert']
    const bad = r && !fine.includes(r)
    return {
      text: [t('Último uso ', 'Last used '), ago, outcome ? ` · ${outcome}` : ''].filter(Boolean).join(''),
      tone: bad ? 'var(--alert-warn-icon)' : 'var(--text-muted)',
    }
  }

  // ¿Ha llegado algo POR CORREO con este token?
  //
  // El atajo dispara con cada compra, así que pisa el "último uso" el mismo día
  // y desde afuera "el reenvío nunca ha entregado nada" y "entregó y el atajo lo
  // tapó" se ven idénticos. Esa es justo la pregunta de quien acaba de
  // configurar la regla de reenvío, así que el uso se guarda por transporte y se
  // dice por separado.
  const transportUse = (tk, via) => {
    const u = tk?.usage?.[via]
    if (!u?.at) return null
    const ms = Date.now() - new Date(u.at).getTime()
    if (!isFinite(ms) || ms < 0) return null
    const ago = ms < 3600000 ? t(`hace ${Math.max(1, Math.round(ms / 60000))} min`, `${Math.max(1, Math.round(ms / 60000))} min ago`)
      : ms < 86400000 ? t(`hace ${Math.round(ms / 3600000)} h`, `${Math.round(ms / 3600000)} h ago`)
        : t(`hace ${Math.round(ms / 86400000)} d`, `${Math.round(ms / 86400000)} d`)
    return { ago, result: u.result || null }
  }

  const copyIngest = (token, what, value) => {
    navigator.clipboard.writeText(value)
    setIngestCopied(`${token}:${what}`)
    setTimeout(() => setIngestCopied(null), 2000)
  }

  const handleCreateIngestToken = async () => {
    setIngestLoading(true)
    try {
      const { token } = await ingestApi({ action: 'create', label: t('Teléfono', 'Phone') })
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
  // El origen se resuelve DESPUÉS de montar, no durante el render: el servidor
  // no tiene `window`, así que calcularlo acá pone una URL distinta en el HTML
  // que en el navegador y React tira el árbol entero por el desajuste. Hoy no se
  // nota porque el modal solo monta tras un clic, pero es la misma clase de
  // bug que la hora de la lista de transacciones, y basta con que alguien lo
  // renderice abierto para que aparezca.
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])
  const endpoint = `${origin}/api/ingest/expense`
  const copyLabel = (token, what) => (ingestCopied === `${token}:${what}` ? t('¡Copiado!', 'Copied!') : t('Copiar', 'Copy'))

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="auto-capture-title">
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
          <h2 id="auto-capture-title" className="text-lg font-bold text-white flex items-center gap-2">
            <Zap size={20} style={{ color: 'var(--accent-blue)' }} />
            {t('Gastos automáticos', 'Automatic expenses')}
          </h2>
          <button onClick={onClose} className="hover:text-white text-xl leading-none" style={{ color: 'var(--text-secondary)' }} aria-label="Close">&times;</button>
        </div>

        {flashMsg && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-lg text-xs font-medium transition-all" style={{ color: flashMsg.type === 'ok' ? 'var(--accent-green)' : 'var(--accent-red)', backgroundColor: flashMsg.type === 'ok' ? 'color-mix(in srgb, var(--accent-green) 15%, transparent)' : 'rgba(239,68,68,0.15)' }}>
            {flashMsg.msg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <p className="text-xs text-slate-500">{t(
            'Cada compra con tarjeta entra sola a tu Flujo, con categoría, monto, moneda, comercio y ubicación. En iPhone, el atajo captura al instante los pagos con Apple Pay. En Android, la notificación de tu banco captura todo al instante, incluida la tarjeta física. Y el reenvío de correo recoge lo que falte, una vez al día. Si un cobro llega por más de un camino, se guarda una sola vez.',
            'Every card purchase lands in your Flujo on its own, with category, amount, currency, merchant and location. On iPhone, the shortcut captures Apple Pay charges instantly. On Android, your bank notification captures everything instantly, physical card included. And email forwarding picks up whatever is left, once a day. If a charge arrives through more than one path, it is stored only once.'
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
                        {/* El "actualizar" va pegado a la línea que contesta, no
                            arriba del modal: quien acaba de correr la macro en el
                            teléfono mira ACÁ para ver si llegó, y sin esto había
                            que cerrar y reabrir el modal (loadIngest solo corre
                            al montar), o sea el lazo de diagnóstico no cerraba. */}
                        <p className="text-xs mt-0.5" style={{ color: lastUse(tk).tone }}>
                          {lastUse(tk).text}
                          <button onClick={loadIngest} disabled={initialLoading}
                            className="ml-1.5 underline disabled:opacity-50" style={{ color: 'var(--accent-blue)' }}>
                            {initialLoading ? t('…', '…') : t('actualizar', 'refresh')}
                          </button>
                        </p>
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
                      {/* El valor del header, que hasta ahora no se mostraba en
                          ninguna parte: las instrucciones decían "con el header
                          Authorization" sin decir nunca que el valor lleva
                          "Bearer " adelante, o sea había que saberlo. Se copia
                          el VALOR y no el par entero porque las dos apps piden
                          nombre y valor en campos separados. */}
                      <button onClick={() => copyIngest(tk.token, 'auth', `Bearer ${tk.token}`)}
                        className="px-2.5 py-1 text-xs font-medium rounded-md border transition-colors hover:bg-blue-500/10"
                        style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                        {copyLabel(tk.token, 'auth')} {t('header', 'header')}
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
                    {/* Junto a los botones que lo copian, no enterrado al pie
                        del modal: quien acaba de copiar el token es quien está a
                        punto de pegarlo en algún lado. */}
                    <p className="text-xs" style={{ color: 'var(--alert-warn-icon)' }}>
                      {t('No lo compartas: es como una contraseña. Cualquiera que lo tenga puede agregar gastos a tu cuenta (leerla, no).',
                         'Do not share it: it works like a password. Anyone who has it can add expenses to your account (not read it).')}
                    </p>
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
                <p className="text-xs font-medium text-white mb-1">{t('2. Android (instantáneo)', '2. Android (instant)')}</p>
                {/* Campo por campo, con el nombre de cada uno. Antes era un solo
                    párrafo que nombraba el endpoint, el header y el cuerpo sin
                    decir en qué casilla va cada cosa, y el resultado real fue
                    alguien pegando el JSON en el campo de la URL. */}
                <p className="text-xs text-slate-500">{t(
                  'Con MacroDroid o Tasker, una macro con un disparador y una acción:',
                  'With MacroDroid or Tasker, one macro with a trigger and an action:'
                )}</p>
                <ol className="text-xs text-slate-500 mt-1 space-y-1 list-decimal pl-4">
                  <li>{t(
                    'Dale a la app permiso de leer notificaciones (te lo pide el sistema, no la app).',
                    'Grant the app notification access (the system asks for it, not the app).'
                  )}</li>
                  <li>{t(
                    'Disparador: "Notificación recibida", filtrado a la app de tu banco.',
                    'Trigger: "Notification received", filtered to your bank app.'
                  )}</li>
                  <li>{t(
                    'Acción: "Petición HTTP" (HTTP Request). Método: POST.',
                    'Action: "HTTP Request". Method: POST.'
                  )}</li>
                  <li>{t(
                    'Campo URL: el endpoint de arriba, y nada más. El JSON NO va acá.',
                    'URL field: the endpoint above, and nothing else. The JSON does NOT go here.'
                  )}</li>
                  <li>{t(
                    'Tipo de contenido: application/json.',
                    'Content type: application/json.'
                  )}</li>
                  <li>{t(
                    'Encabezados (en MacroDroid suele llamarse "Parámetros de encabezado"): nombre Authorization, valor el del botón "Copiar header" de tu token.',
                    'Headers (MacroDroid usually calls this "Header parameters"): name Authorization, value the one from your token\'s "Copy header" button.'
                  )}</li>
                  <li>{t(
                    'Campo del cuerpo (Body / Contenido): este JSON, con los tres marcadores reemplazados.',
                    'Body / Content field: this JSON, with the three placeholders replaced.'
                  )}</li>
                </ol>
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="flex-1 min-w-0 text-xs text-slate-400 font-mono break-all bg-theme-surface px-2 py-1 rounded">{ANDROID_BODY_TEMPLATE}</code>
                  <button onClick={() => copyIngest('android', 'body', ANDROID_BODY_TEMPLATE)}
                    className="shrink-0 px-2 py-1 text-xs font-medium rounded-md" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                    {copyLabel('android', 'body')}
                  </button>
                </div>
                {/* Los nombres de las variables NO se afirman: cada app tiene los
                    suyos y desde acá no se pueden verificar (la lección de haber
                    afirmado dos veces un hecho externo sobre Apple Pay). Lo que
                    sí se dice es dónde encontrarlas. */}
                <p className="text-xs mt-1.5 text-slate-500">{t(
                  'Los tres marcadores se reemplazan con variables de la app, no con texto escrito: el título y el texto de la notificación, y la fecha y hora actuales. Cada app las nombra distinto, así que tomalas de su selector de variables (en MacroDroid, el botón de texto mágico). La fecha va con formato yyyy-MM-dd\'T\'HH:mm:ssZ: esa Z emite el desfase de tu zona, no una letra, y es lo que evita que una compra de la noche quede fechada mañana.',
                  'The three placeholders take app variables, not typed text: the notification title and text, and the current date and time. Each app names them differently, so pick them from its variable selector (in MacroDroid, the magic text button). The date needs the format yyyy-MM-dd\'T\'HH:mm:ssZ: that Z emits your zone offset, not a letter, and it is what keeps an evening purchase from being dated tomorrow.'
                )}</p>
                {/* La prueba honesta. Un botón de "enviar prueba" en la web
                    confirmaría nuestro endpoint desde el navegador y NO el
                    teléfono, o sea podría decir "funciona" con la macro mal
                    configurada: una confirmación falsa es peor que ninguna. El
                    botón de ejecutar de la propia app sí prueba el camino real, y
                    desde que el servidor reconoce los marcadores contesta con el
                    veredicto en vez de un error sobre el monto. */}
                <p className="text-xs mt-1.5" style={{ color: 'var(--accent-blue)' }}>{t(
                  'Para probar sin gastar: corré la macro con el botón de ejecutar de la app. Si todavía tiene los marcadores, la respuesta te dice que la conexión y el token ya funcionan y que solo faltan las variables.',
                  'To test without spending: run the macro with the app\'s run button. If the placeholders are still there, the response tells you the connection and token already work and only the variables are missing.'
                )}</p>
                {/* El modo de fallo típico de Android, en su propia línea con tono
                    de aviso: ya estaba dicho, pero al final de un párrafo largo y
                    en gris, y quien lo reportó no lo vio. */}
                <p className="text-xs mt-1.5" style={{ color: 'var(--alert-warn-icon)' }}>{t(
                  'Excluí la app de la optimización de batería (Ajustes → Batería → Sin restricciones). Sin eso Android apaga el escucha y las capturas se detienen sin avisar.',
                  'Exclude the app from battery optimization (Settings → Battery → Unrestricted). Without it Android kills the listener and captures stop with no warning.'
                )}</p>
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{t(
                  'Lee el aviso de tu banco, no la billetera, así que captura todo: tarjeta física, compras en línea y Google Pay.',
                  'It reads your bank alert, not the wallet, so it captures everything: physical card, online purchases and Google Pay.'
                )}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-white mb-1">{t('3. Reenvío de correo (una vez al día)', '3. Email forwarding (once a day)')}</p>
                <p className="text-xs text-slate-500">{emailReady ? t(
                  'En tu correo, crea una regla que reenvíe las alertas de tu banco a la dirección de arriba. Captura también las compras con tarjeta física, que Apple Pay no ve.',
                  'In your mail client, create a rule that forwards your bank alerts to the address above. This also captures physical card purchases, which Apple Pay never sees.'
                ) : t(
                  'Falta configurar el buzón del servidor (IMAP). Mientras tanto funcionan el atajo del iPhone y el camino de Android.',
                  'The server mailbox (IMAP) is not configured yet. Until then the iPhone shortcut and the Android path work.'
                )}</p>
                {/* Si el reenvío ha entregado algo alguna vez, dicho. Sin esto,
                    "configuré la regla y no entra nada" y "entra y el atajo lo
                    tapó en el último uso" se ven idénticos, que es la ronda de
                    diagnóstico que esto existe para no pagar. */}
                {emailReady && tokens.length > 0 && (() => {
                  const seen = tokens.map((tk) => transportUse(tk, 'email')).filter(Boolean)
                  const last = seen[0]
                  return (
                    <p className="text-xs mt-1.5" style={{ color: last ? 'var(--text-muted)' : 'var(--alert-warn-icon)' }}>
                      {last
                        ? t(`Último correo recibido ${last.ago}${last.result === 'created' ? ' · gasto registrado' : last.result ? ` · ${last.result}` : ''}`,
                             `Last email received ${last.ago}${last.result === 'created' ? ' · expense recorded' : last.result ? ` · ${last.result}` : ''}`)
                        : t('Todavía no ha llegado ningún correo con tu token. Si ya creaste la regla de reenvío, revisá que apunte a la dirección de arriba COMPLETA, con el +token.',
                             'No email with your token has arrived yet. If you already created the forwarding rule, check that it points to the FULL address above, including the +token.')}
                    </p>
                  )
                })()}
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
