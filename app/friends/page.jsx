'use client'

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useDashboardData } from '@/hooks/useDashboardData'
import { authFetch, safeJson } from '@/lib/authFetch'
import { buildFriendStats } from '@/lib/friendsStats'
import { toastStyleFor, toastIconFor } from '@/lib/toastStyle'
import PageShell, { PageTitle } from '@/components/PageShell'
import PullToRefresh from '@/components/ui/PullToRefresh'
import BusyLabel from '@/components/ui/BusyLabel'
import InlineNotice from '@/components/ui/InlineNotice'
import { Users, UserPlus, KeyRound } from 'lucide-react'
import { SkeletonCard } from '@/components/dashboard/Skeleton'
import PageTour from '@/components/dashboard/PageTour'
import YourCard from '@/components/friends/YourCard'
import GroupCard from '@/components/friends/GroupCard'
import GlobalBoard from '@/components/friends/GlobalBoard'

function FriendsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
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

  // A dónde volver después de iniciar sesión. Sin esto, quien toca un link de
  // invitación sin sesión cae en /login, se registra, y aterriza en el dashboard
  // SIN ninguna memoria de que venía a un grupo: la invitación muere ahí. El
  // login ya sabe leer `redirect` y ya se protege de open-redirect.
  const loginHref = useMemo(() => {
    const code = searchParams?.get('code')
    const dest = code ? `/friends?code=${encodeURIComponent(code)}` : '/friends'
    return `/login?redirect=${encodeURIComponent(dest)}`
  }, [searchParams])

  useEffect(() => {
    let unsubscribe = () => {}
    async function initAuth() {
      const { auth } = await import('@/lib/firebase')
      const { onIdTokenChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push(loginHref); return }
      unsubscribe = onIdTokenChanged(auth, (currentUser) => {
        if (!currentUser) router.push(loginHref)
        else setUser(currentUser)
        setAuthLoading(false)
      })
    }
    initAuth()
    return () => unsubscribe()
  }, [router, loginHref])

  const {
    enrichedItems, returnYTD, returnMTD, ibkrReturnYTD, ibkrReturnMTD, ibkrDayChange,
    dailyChange, totalAssets, profile, settings, dataLoading, saveProfile,
    ytdResolved, pricesLoading,
  } = useDashboardData({ user, lang, activePortfolio: '__all__' })

  // Las tres cifras de tu tarjeta cuelgan de dos piezas asíncronas que asientan
  // DESPUÉS de que `dataLoading` se apaga: los precios del día y la
  // reconstrucción del ancla del año. Sin esta señal, ese hueco se pintaba con
  // el mismo "-" que significa "no hay nada que medir".
  const statsReady = !!ytdResolved && !pricesLoading
  const hasPortfolio = (enrichedItems || []).length > 0

  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])

  const displayName = useMemo(
    () => profile?.name || user?.displayName || (user?.email ? user.email.split('@')[0] : 'Anónimo'),
    [profile, user]
  )
  const avatar = useMemo(() => (displayName || '?').trim().charAt(0).toUpperCase(), [displayName])

  const hasIbkr = useMemo(() => (enrichedItems || []).some((it) => it._source === 'ibkr'), [enrichedItems])

  // La insignia "sincronizado" ya NO se calcula acá.
  //
  // Antes esta pantalla medía qué fracción del portafolio venía de un broker en
  // vivo y mandaba ese número al servidor, que derivaba la insignia de él. O
  // sea era auto-reportada: un cliente modificado manda un 1 y se la otorga. Y
  // la insignia no le habla al usuario, le habla a sus amigos.
  //
  // Ahora la decide el servidor con los vaults de broker, cuyo `lastSync` lo
  // estampa la ruta del broker al terminar un sync real. Acá solo se muestra lo
  // que él contestó. Ver lib/friendsVerified.js.
  const [verified, setVerified] = useState(false)

  const myStats = useMemo(() => {
    const all = buildFriendStats({ enrichedItems, returnYTD, returnMTD, dailyChange, totalAssets })
    const out = { all }
    // IBKR block uses IBKR-scoped returns (broker NAV + broker flows), not the
    // whole-portfolio numbers — so "IBKR only" groups compare that account alone.
    if (hasIbkr) out.ibkr = buildFriendStats({ enrichedItems, returnYTD: ibkrReturnYTD, returnMTD: ibkrReturnMTD, dailyChange: ibkrDayChange, scopeFilter: (it) => it._source === 'ibkr' })
    return out
  }, [enrichedItems, returnYTD, returnMTD, ibkrReturnYTD, ibkrReturnMTD, ibkrDayChange, dailyChange, totalAssets, hasIbkr])

  const [groups, setGroups] = useState(null)
  const [global, setGlobal] = useState(null)
  // El ranking global tiene su propio error: si fallan tus grupos, la culpa no
  // es de esta tarjeta y no tiene por qué acusarse a sí misma.
  const [globalError, setGlobalError] = useState(null)
  const [globalLoading, setGlobalLoading] = useState(true)
  // Se sube para pedir el ranking de nuevo sin que su efecto dependa de nada
  // cuya identidad cambie sola (al publicar, al refrescar a mano, al entrar o
  // salir del ranking).
  const [globalEpoch, setGlobalEpoch] = useState(0)
  const reloadGlobal = useCallback(() => setGlobalEpoch((n) => n + 1), [])
  // Un error de carga es un ESTADO, no algo que se traga un catch vacío. Sin
  // esto, `groups` se quedaba en null para siempre y la pantalla mostraba un
  // "…" suelto sin decir nunca que la llamada había fallado, ni ofrecer
  // reintentar. El botón de refrescar del header y el gesto de jalar corren por
  // esta misma función, o sea que se podía jalar, ver el anillo girar entero y
  // no enterarse de nada.
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [pending, setPending] = useState(null)
  const [toast, setToast] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createScope, setCreateScope] = useState('all')
  const [joinCode, setJoinCode] = useState('')
  const [metric, setMetric] = useState('ytd') // 'ytd' | 'mtd' (Este mes)
  const syncedRef = useRef(false)
  const toastTimer = useRef(null)
  const codeSeededRef = useRef(false)

  // Un link de invitación (`/friends?code=XXXX`) abre el panel de unirse con el
  // código ya puesto. Sin esto, la página nunca leía el parámetro: quien tocaba
  // el link tenía que adivinar que había un botón "Unirme con código", abrirlo,
  // volver a WhatsApp y copiar el código a mano. Se siembra UNA sola vez, para
  // no volver a pisar lo que el usuario esté tecleando si el efecto re-corre.
  useEffect(() => {
    if (codeSeededRef.current) return
    const raw = searchParams?.get('code')
    if (!raw) return
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    if (!clean) return
    codeSeededRef.current = true
    setJoinCode(clean)
    setJoining(true)
    setCreating(false)
  }, [searchParams])

  // Con tono: antes todo salía en el mismo azul, así que un error se veía
  // idéntico a "Código copiado". Los estilos salen de lib/toastStyle.js, donde
  // vive además la regla de producto de que el ROJO queda para algo grave: algo
  // que se reintenta es 'warn'.
  const flash = useCallback((msg, type = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // El servidor devuelve un `code` estable y el texto vive acá, que es donde
  // está el idioma. Antes el mensaje crudo del servidor se pintaba tal cual, así
  // que un usuario con toda la app en español recibía "Invalid code" justo en el
  // paso más frágil de la cadena de invitación, sin decirle qué hacer.
  const errorText = useCallback((code, fallback) => {
    switch (code) {
      case 'invalid_code': return t('Ese código no existe. Pedile a tu amigo que lo copie de nuevo desde la app.', "That code doesn't exist. Ask your friend to copy it again from the app.")
      case 'group_full': return t('El grupo ya está lleno.', 'That group is already full.')
      case 'group_gone': return t('Ese grupo ya no existe.', 'That group no longer exists.')
      case 'owner_only': return t('Solo quien creó el grupo puede hacer eso.', 'Only the group owner can do that.')
      case 'name_required': return t('Escribí un nombre para el grupo.', 'Enter a name for the group.')
      case 'code_required': return t('Pegá el código del grupo.', 'Paste the group code.')
      case 'max_groups': return t('Llegaste al máximo de grupos que podés crear.', 'You reached the maximum number of groups you can create.')
      case 'missing_stats': return t('Todavía no hay números que publicar.', 'There are no numbers to publish yet.')
      case 'rate_limited': return t('Demasiados intentos seguidos. Esperá un momento.', 'Too many attempts in a row. Wait a moment.')
      default: return fallback || t('Algo salió mal. Intentá de nuevo.', 'Something went wrong. Try again.')
    }
  }, [t])

  const api = useCallback(async (payload) => {
    const res = await authFetch('/api/friends', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await safeJson(res)
    if (!res.ok) {
      const err = new Error(errorText(data?.code, data?.error))
      err.code = data?.code || null
      throw err
    }
    return data
  }, [errorText])

  const refresh = useCallback(async () => {
    try {
      const g = await api({ action: 'list' })
      setGroups(g.groups || [])
      setLoadError(null)
    } catch (e) {
      // Se conserva lo que ya estaba en pantalla (un dato viejo vale más que una
      // pantalla vacía), pero el fallo SE DICE y se puede reintentar.
      setLoadError(e.message || 'Error')
    }
  }, [api])

  // El ranking global vive en su propio efecto, keyeado por la MÉTRICA elegida.
  //
  // El orden y el corte del top ocurren en el servidor (la respuesta se recorta
  // a los primeros N), así que cambiar de "Año" a "Este mes" no se puede
  // resolver reordenando en el cliente: hay que volver a pedir la lista. Antes
  // el selector no tocaba esta tarjeta en absoluto, así que fuera de un grupo
  // era un control que no hacía nada.
  //
  // Separarlo de `refresh` además evita re-escanear el ranking entero en cada
  // publicación: ese escaneo lee hasta GLOBAL_SCAN_CAP documentos y esta app ya
  // tocó el techo de cuota de Firestore en producción (FASE IE9).
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setGlobalLoading(true)
    api({ action: 'global', metric })
      .then((gl) => { if (!cancelled) { setGlobal(gl); setVerified(!!gl?.yourVerified); setGlobalError(null) } })
      .catch((e) => { if (!cancelled) setGlobalError(e.message || 'Error') })
      .finally(() => { if (!cancelled) setGlobalLoading(false) })
    return () => { cancelled = true }
  }, [api, metric, user, globalEpoch])

  // Publica mis números y relee. Es lo que corre en TODO refresco de esta
  // pantalla: el botón del header, el gesto de jalar y el botón "Publicar" de
  // tu tarjeta hacen exactamente lo mismo.
  //
  // Antes no: "Actualizar" publicaba + releía, mientras el header y el gesto
  // solo releían, así que jalar en Amigos actualizaba los números de todos los
  // demás menos el tuyo. Un solo significado para una sola palabra.
  const doSync = useCallback(async () => {
    if (!myStats.all) { await refresh(); return true }
    try {
      const res = await api({ action: 'sync', displayName, avatar, stats: myStats })
      setVerified(!!res?.verified)
      await refresh()
      return true
    } catch (e) {
      flash(e.message, 'warn')
      return false
    }
  }, [api, myStats, displayName, avatar, refresh, flash])

  const [refreshing, setRefreshing] = useState(false)
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await doSync(); reloadGlobal() } finally { setRefreshing(false) }
  }, [doSync, reloadGlobal])

  useEffect(() => {
    if (syncedRef.current) return
    if (!user || dataLoading) return
    const nothingToPublish = !myStats.all
      || (myStats.all.ytd == null && myStats.all.day == null && myStats.all.movers.length === 0 && (enrichedItems || []).length === 0)
    if (nothingToPublish) {
      // Sin nada que publicar (cartera vacía). Se cargan los grupos igual para
      // que la pantalla no quede en blanco, pero NO se marca el ref: si más
      // adelante hay datos, esto tiene que volver a intentarlo.
      refresh()
      return
    }
    // El ref se marca DESPUÉS de que la publicación salga bien. Antes se
    // marcaba antes del await y `doSync` se tragaba su propio error, así que
    // una primera publicación fallida quedaba trabada el resto de la sesión sin
    // ningún reintento.
    doSync().then((ok) => { if (ok) syncedRef.current = true })
  }, [user, dataLoading, myStats, enrichedItems, doSync, refresh])

  const handleUpdate = useCallback(async () => {
    setBusy(true)
    const ok = await doSync()
    setBusy(false)
    // Solo se avisa "listo" si de verdad salió bien. Antes se avisaba siempre,
    // tapando el toast de error que doSync acababa de mostrar.
    if (ok) flash(t('Tus números están publicados', 'Your numbers are published'), 'success')
  }, [doSync, flash, t])

  const handleSaveName = useCallback(async (name) => {
    setSavingName(true)
    try {
      await saveProfile({ name })
    } catch (e) {
      setSavingName(false)
      flash(e.message || t('No se pudo guardar el nombre', 'Could not save the name'), 'warn')
      return false
    }
    // El nombre YA quedó guardado. Si la republicación falla, se dice tal cual
    // en vez de un error genérico que haría pensar que hay que escribirlo otra
    // vez.
    const published = await doSync()
    setSavingName(false)
    flash(published
      ? t('Nombre actualizado', 'Name updated')
      : t('Nombre guardado, pero no se pudo publicar todavía', 'Name saved, but could not publish it yet'),
      published ? 'success' : 'warn')
    return true
  }, [saveProfile, doSync, flash, t])

  const handleCreate = useCallback(async () => {
    if (!createName.trim()) return
    setBusy(true)
    try {
      await api({ action: 'create-group', name: createName.trim(), scope: createScope })
      setCreating(false); setCreateName(''); setCreateScope('all')
      await doSync()
      flash(t('Grupo creado', 'Group created'), 'success')
    } catch (e) { flash(e.message, 'warn') }
    setBusy(false)
  }, [api, createName, createScope, doSync, flash, t])

  const handleJoin = useCallback(async () => {
    const code = joinCode.trim()
    if (!code) return
    setBusy(true)
    try {
      await api({ action: 'join', code })
      setJoining(false); setJoinCode('')
      await doSync()
      flash(t('Te uniste al grupo', 'Joined the group'), 'success')
    } catch (e) { flash(e.message, 'warn') }
    setBusy(false)
  }, [api, joinCode, doSync, flash, t])

  // Las cuatro acciones sobre un grupo comparten forma: marcar cuál está en
  // vuelo (para que solo ESE botón muestre el anillo), llamar, releer y avisar.
  const runGroupAction = useCallback(async (kind, id, payload, okMsg) => {
    setPending({ kind, id })
    try {
      await api(payload)
      await refresh()
      flash(okMsg, 'success')
    } catch (e) { flash(e.message, 'warn') }
    setPending(null)
  }, [api, refresh, flash])

  const handleLeave = useCallback((groupId) => runGroupAction(
    'leave', groupId, { action: 'leave', groupId }, t('Saliste del grupo', 'Left the group')
  ), [runGroupAction, t])

  const handleRename = useCallback(async (groupId, name) => {
    setPending({ kind: 'rename', id: groupId })
    try {
      await api({ action: 'rename', groupId, name })
      await refresh()
      flash(t('Grupo renombrado', 'Group renamed'), 'success')
      setPending(null)
      return true
    } catch (e) {
      flash(e.message, 'warn')
      setPending(null)
      return false
    }
  }, [api, refresh, flash, t])

  const handleDeleteGroup = useCallback((groupId) => runGroupAction(
    'delete', groupId, { action: 'delete-group', groupId }, t('Grupo eliminado', 'Group deleted')
  ), [runGroupAction, t])

  const handleKick = useCallback((groupId, uid) => runGroupAction(
    'kick', uid, { action: 'kick', groupId, uid }, t('Miembro quitado', 'Member removed')
  ), [runGroupAction, t])

  // Compartir de verdad, y decir lo que DE VERDAD pasó. Antes hacía
  // `navigator.clipboard?.writeText(code)` sin esperar ni atrapar la promesa y
  // avisaba "Código copiado" pasara lo que pasara: en un contexto sin
  // portapapeles mentía. Mismo patrón que el botón de compartir del tablero.
  const copyCode = useCallback(async (code, groupName) => {
    // Se comparte una INVITACIÓN, no un código pelado. Con solo el código, quien
    // lo recibe tiene que saber que existe chispu.xyz, encontrar la pestaña
    // Amigos, dar con "Unirme con código" y pegarlo a mano: cinco pasos
    // adivinados. El link los hace cero, porque la página lee `?code=` y abre el
    // panel con el código ya puesto.
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://chispu.xyz'
    const url = `${origin}/friends?code=${encodeURIComponent(code)}`
    const named = groupName ? `"${groupName}"` : t('mi grupo', 'my group')
    const text = t(
      `Te invito a ${named} en Chispudo. Entra aquí: ${url}`,
      `I'm inviting you to ${named} on Chispudo. Join here: ${url}`
    )
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Chispudo', text })
        return
      } catch (e) {
        // Cancelar el menú nativo no es un fallo, no hay nada que avisar.
        if (e?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      flash(t('Invitación copiada', 'Invite copied'), 'success')
    } catch {
      flash(t('No se pudo copiar. El código es: ', 'Could not copy. The code is: ') + code, 'warn')
    }
  }, [flash, t])

  const handleSignOut = useCallback(async () => {
    const { auth } = await import('@/lib/firebase')
    const { signOut } = await import('firebase/auth')
    document.cookie = '__session=; path=/; max-age=0'
    if (auth) await signOut(auth)
    router.push('/login')
  }, [router])

  // ---- render gates live BELOW every hook ----------------------------------
  if (authLoading || (user && dataLoading)) {
    return (
      <div className="min-h-screen bg-theme-base">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
          <SkeletonCard /><SkeletonCard />
        </div>
      </div>
    )
  }
  if (!user) return null

  const createDisabled = busy || !createName.trim()
  const joinDisabled = busy || !joinCode.trim()
  // Los botones de empezar salen en UN solo lugar por estado. Existen en dos
  // sitios a propósito (arriba, y dentro de la tarjeta de "aún no estás en
  // ningún grupo", donde son la acción que se está pidiendo), pero sin grupos
  // se renderizaban LOS DOS a la vez: el mismo par de botones dos veces en la
  // misma pantalla.
  const loadingGroups = groups === null && !loadError
  const showStartOnTop = !loadingGroups && !(groups !== null && groups.length === 0)
  const startButtons = (
    <div className="flex gap-2">
      <button onClick={() => { setCreating((v) => !v); setJoining(false) }}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold rounded-xl border transition-colors"
        style={creating
          ? { borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }
          : { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
        <UserPlus size={14} /> {t('Crear grupo', 'Create group')}
      </button>
      <button onClick={() => { setJoining((v) => !v); setCreating(false) }}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold rounded-xl border transition-colors"
        style={joining
          ? { borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }
          : { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
        <KeyRound size={14} /> {t('Unirme con código', 'Join with code')}
      </button>
    </div>
  )

  return (
    <PageShell user={user} lang={lang} setLang={handleSetLang} settings={settings} width="narrow"
      // Sin esto el botón de refrescar del header es un control MUERTO en esta
      // pantalla: PageShell le pasa `onRefresh={() => {}}` por default, y el
      // spread de headerProps es lo último, así que lo pisa.
      // Sin etapas a propósito: acá el refresco es UN viaje de red, no hay
      // sub-etapas independientes que reportar, así que el anillo barre
      // indeterminado en vez de inventar un porcentaje.
      headerProps={{ onRefresh: handleManualRefresh, pricesLoading: refreshing }}>
      {/* Jalar para actualizar (FASE JH). Mismo `onRefresh` y misma señal de
          carga que el botón de arriba, para que los dos no puedan discrepar. */}
      <PullToRefresh onRefresh={handleManualRefresh} loading={refreshing} lang={lang} />
      <PageTour pageKey="friends" nextRoute="/dashboard" nextFlag={null} lang={lang} steps={[
        {
          tab: t('Amigos', 'Friends'),
          title: t('Compara sin revelar montos', 'Compare without revealing amounts'),
          body: t('Aquí compites sanamente con tus amigos: se comparan PORCENTAJES de retorno (del año y del mes), nunca cuánto dinero tiene cada quien. Tus montos jamás salen de tu cuenta.',
                  'Here you compete in a healthy way with friends: you compare return PERCENTAGES (yearly and monthly), never how much money anyone has. Your amounts never leave your account.'),
        },
        {
          tab: t('Amigos', 'Friends'),
          title: t('Grupos con código de invitación', 'Groups with invite codes'),
          body: t('Crea un grupo, comparte el código con tus amigos y listo: ranking del grupo con corona para quien va ganando el mes. También hay un ranking global anónimo por seudónimo.',
                  'Create a group, share the code with friends, done: a group ranking with a crown for whoever leads the month. There is also an anonymous global ranking by pseudonym.'),
        },
        {
          tab: t('Amigos', 'Friends'),
          title: t('Tú controlas tu privacidad', 'You control your privacy'),
          body: t('Puedes apagar Amigos cuando quieras en Ajustes: se borra tu perfil público y sales de todos los grupos al instante. Nada queda publicado si no quieres.',
                  'You can turn Friends off anytime in Settings: your public profile is deleted and you leave every group instantly. Nothing stays published unless you want it to.'),
        },
      ]} />

      <PageTitle icon={Users}
        title={t('Amigos', 'Friends')}
        subtitle={t('Compara tu retorno con tus amigos: sin revelar montos.', 'Compare your return with friends: without revealing amounts.')} />

      <YourCard
        displayName={displayName}
        verified={verified}
        stats={myStats.all}
        // Tu propia hora de publicación viene del servidor y no de tu fila
        // dentro de un grupo: derivada de los grupos, quien no está en ninguno
        // no la veía nunca, o sea leía un porcentaje sin nada que dijera que es
        // una foto quieta hasta que la vuelva a publicar.
        updatedAt={global?.yourUpdatedAt || groups?.flatMap((g) => g.rows || []).find((r) => r.isYou)?.updatedAt}
        ready={statsReady} hasPortfolio={hasPortfolio}
        lang={lang} t={t}
        busy={busy} savingName={savingName}
        onUpdate={handleUpdate} onSaveName={handleSaveName} />

      {showStartOnTop && startButtons}

      {creating && (
        <div className="card p-3 space-y-3">
          <input value={createName} onChange={(e) => setCreateName(e.target.value)} maxLength={40}
            placeholder={t('Nombre del grupo (ej. Los Inversionistas)', 'Group name (e.g. The Investors)')}
            className="w-full px-3 py-2 rounded-lg text-xs bg-theme-surface border border-glass-border/60 focus:outline-none"
            style={{ color: 'var(--text-primary)' }} />
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('¿Qué se compara en este grupo?', 'What does this group compare?')}</label>
            <div className="flex gap-1.5">
              {[{ k: 'all', l: t('Todo el portafolio', 'Whole portfolio') }, ...(hasIbkr ? [{ k: 'ibkr', l: t('Solo IBKR', 'IBKR only') }] : [])].map((o) => (
                <button key={o.k} onClick={() => setCreateScope(o.k)}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg border"
                  style={createScope === o.k
                    ? { borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }
                    : { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
          <button onClick={handleCreate} disabled={createDisabled}
            className="w-full py-2 rounded-lg text-xs font-medium transition-colors"
            style={createDisabled
              ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', cursor: 'not-allowed' }
              : { backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
            <BusyLabel busy={busy} lang={lang}>{t('Crear y obtener código', 'Create & get code')}</BusyLabel>
          </button>
        </div>
      )}

      {joining && (
        <div className="card p-3 space-y-3">
          {/* Se limpia lo pegado ANTES de recortarlo. Con `maxLength={12}` sobre
              el texto crudo, pegar "Código: K7MPQR3" desde WhatsApp guardaba
              "CÓDIGO: K7MP": el navegador cortaba antes de que el servidor
              pudiera sanear, y el usuario recibía "código inválido" sobre un
              código que estaba perfecto. Es el fallo más probable de toda la
              cadena de invitación, porque nadie manda el código pelado. */}
          <input value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            placeholder={t('Pega el código del grupo', 'Paste the group code')}
            className="w-full px-3 py-2 rounded-lg text-sm font-mono tracking-widest bg-theme-surface border border-glass-border/60 focus:outline-none"
            style={{ color: 'var(--text-primary)' }} />
          <button onClick={handleJoin} disabled={joinDisabled}
            className="w-full py-2 rounded-lg text-xs font-medium transition-colors"
            style={joinDisabled
              ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', cursor: 'not-allowed' }
              : { backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
            <BusyLabel busy={busy} lang={lang}>{t('Unirme', 'Join')}</BusyLabel>
          </button>
        </div>
      )}

      {/* Métrica del ranking: el año o el mes en curso. Ya no se esconde cuando
          no tienes grupos: escondido, nadie nuevo se enteraba de que existe. */}
      <div className="flex items-center gap-1.5 justify-center">
        {[{ k: 'ytd', l: t('Año (YTD)', 'Year (YTD)') }, { k: 'mtd', l: t('Este mes', 'This month') }].map((o) => (
          <button key={o.k} onClick={() => setMetric(o.k)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
            style={metric === o.k
              ? { borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }
              : { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
            {o.k === 'mtd' && '🏁 '}{o.l}
          </button>
        ))}
      </div>

      {/* Cuatro situaciones, cuatro respuestas. Antes las cuatro compartían un
          "…" suelto o no decían nada. */}
      {loadError && !groups ? (
        <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={handleManualRefresh} busy={refreshing}>
          {t('No se pudieron cargar tus grupos.', 'Could not load your groups.')}
        </InlineNotice>
      ) : groups === null ? (
        <SkeletonCard />
      ) : groups.length === 0 ? (
        <div className="card p-6 text-center"
          style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-blue) 6%, var(--bg-card)) 0%, var(--bg-card) 70%)' }}>
          <div className="text-4xl mb-2">🏆</div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('Aún no estás en ningún grupo', 'You are not in any group yet')}</p>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--text-muted)' }}>
            {t('Crea uno y comparte el código con tus amigos, o únete con el código de alguien.', 'Create one and share the code with friends, or join with someone\'s code.')}
          </p>
          {/* La acción, acá mismo. Antes los botones quedaban arriba, fuera de
              pantalla al llegar leyendo hasta este punto. */}
          {startButtons}
        </div>
      ) : (
        groups.map((g) => (
          <GroupCard key={g.id} group={g} lang={lang} t={t} metric={metric} expanded={expanded} setExpanded={setExpanded}
            pending={pending}
            onCopy={copyCode} onLeave={handleLeave} onRename={handleRename}
            onDelete={handleDeleteGroup} onKick={handleKick} />
        ))
      )}

      {/* Si los grupos SÍ cargaron pero la llamada falló después, el aviso va
          acá abajo en vez de reemplazar la lista que ya se ve. */}
      {loadError && groups && (
        <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={handleManualRefresh} busy={refreshing}>
          {t('Lo que ves puede estar desactualizado: la última actualización falló.', 'What you see may be out of date: the last refresh failed.')}
        </InlineNotice>
      )}

      <GlobalBoard global={global} loading={globalLoading} error={!!globalError && !global} lang={lang} t={t}
        metric={metric}
        api={api} flash={flash} onChanged={reloadGlobal} onRetry={reloadGlobal} />

      <div className="text-center text-micro pt-2" style={{ color: 'var(--text-muted)' }}>Chispudo · chispu.xyz</div>

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium shadow-xl border"
          role="status" aria-live="polite"
          style={toastStyleFor(toast.type)}>
          <span>{toastIconFor(toast.type)}</span>
          {toast.msg}
        </div>
      )}
    </PageShell>
  )
}

// `useSearchParams` obliga a un límite de Suspense en el App Router (el mismo
// patrón que ya usa /login). Sin él, el build falla al pre-renderizar.
export default function FriendsPage() {
  return (
    <Suspense fallback={null}>
      <FriendsPageInner />
    </Suspense>
  )
}
