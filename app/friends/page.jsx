'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useDashboardData } from '@/hooks/useDashboardData'
import { authFetch, safeJson } from '@/lib/authFetch'
import { buildFriendStats } from '@/lib/friendsStats'
import { getItemValue } from '@/components/dashboard/utils'
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

// El umbral de la insignia "sincronizado". El servidor la DERIVA de syncedPct
// con este mismo número (app/api/friends/route.js), así que los dos tienen que
// coincidir o la insignia diría una cosa distinta de la que se calculó acá.
const VERIFIED_MIN_SYNCED = 0.6

export default function FriendsPage() {
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

  useEffect(() => {
    let unsubscribe = () => {}
    async function initAuth() {
      const { auth } = await import('@/lib/firebase')
      const { onIdTokenChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push('/login'); return }
      unsubscribe = onIdTokenChanged(auth, (currentUser) => {
        if (!currentUser) router.push('/login')
        else setUser(currentUser)
        setAuthLoading(false)
      })
    }
    initAuth()
    return () => unsubscribe()
  }, [router])

  const {
    enrichedItems, returnYTD, returnMTD, ibkrReturnYTD, ibkrReturnMTD, ibkrDayChange,
    dailyChange, totalAssets, profile, settings, dataLoading, saveProfile,
  } = useDashboardData({ user, lang, activePortfolio: '__all__' })

  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])

  const displayName = useMemo(
    () => profile?.name || user?.displayName || (user?.email ? user.email.split('@')[0] : 'Anónimo'),
    [profile, user]
  )
  const avatar = useMemo(() => (displayName || '?').trim().charAt(0).toUpperCase(), [displayName])

  const hasIbkr = useMemo(() => (enrichedItems || []).some((it) => it._source === 'ibkr'), [enrichedItems])

  // "Verified" = most of the portfolio value comes from a LIVE broker sync
  // (ibkr/blockchain/ledger/API brokers), not hand-typed. Statement imports
  // (Hapi) leave _source unset, so they honestly don't count as synced.
  const { verified, syncedPct } = useMemo(() => {
    const EXCLUDE = new Set(['demo', 'manual', 'hapi', 'import'])
    let synced = 0
    for (const it of enrichedItems || []) {
      const v = getItemValue(it)
      if (v > 0 && it._source && !EXCLUDE.has(it._source)) synced += v
    }
    const pct = totalAssets > 0 ? synced / totalAssets : 0
    return { verified: pct >= VERIFIED_MIN_SYNCED, syncedPct: pct }
  }, [enrichedItems, totalAssets])

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

  const api = useCallback(async (payload) => {
    const res = await authFetch('/api/friends', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await safeJson(res)
    if (!res.ok) throw new Error(data?.error || 'Error')
    return data
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [g, gl] = await Promise.all([api({ action: 'list' }), api({ action: 'global' })])
      setGroups(g.groups || [])
      setGlobal(gl)
      setLoadError(null)
    } catch (e) {
      // Se conserva lo que ya estaba en pantalla (un dato viejo vale más que una
      // pantalla vacía), pero el fallo SE DICE y se puede reintentar.
      setLoadError(e.message || 'Error')
    }
  }, [api])

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
      await api({ action: 'sync', displayName, avatar, stats: myStats, verified, syncedPct })
      await refresh()
      return true
    } catch (e) {
      flash(e.message, 'warn')
      return false
    }
  }, [api, myStats, displayName, avatar, verified, syncedPct, refresh, flash])

  const [refreshing, setRefreshing] = useState(false)
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await doSync() } finally { setRefreshing(false) }
  }, [doSync])

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
  const copyCode = useCallback(async (code) => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Chispudo', text: code })
        return
      } catch (e) {
        // Cancelar el menú nativo no es un fallo, no hay nada que avisar.
        if (e?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(code)
      flash(t('Código copiado', 'Code copied'), 'success')
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
        updatedAt={groups?.flatMap((g) => g.rows || []).find((r) => r.isYou)?.updatedAt}
        lang={lang} t={t}
        busy={busy} savingName={savingName}
        onUpdate={handleUpdate} onSaveName={handleSaveName} />

      {startButtons}

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
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={12}
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

      <GlobalBoard global={global} loading={refreshing} error={loadError && !global} lang={lang} t={t}
        api={api} flash={flash} onChanged={refresh} onRetry={handleManualRefresh} />

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
