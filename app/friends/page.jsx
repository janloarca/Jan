'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useDashboardData } from '@/hooks/useDashboardData'
import { authFetch, safeJson } from '@/lib/authFetch'
import { buildFriendStats } from '@/lib/friendsStats'
import { getItemValue } from '@/components/dashboard/utils'
import PageShell, { PageTitle } from '@/components/PageShell'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { Users, UserPlus, KeyRound } from 'lucide-react'
import { SkeletonCard } from '@/components/dashboard/Skeleton'
import PageTour from '@/components/dashboard/PageTour'
import { CHART_PALETTE } from '@/lib/colors'

// A distinct color per person, stable across renders/reloads (hashed from
// their uid, never random) — the SAME validated palette the rest of the app
// uses for chart series (OKLCH-checked, ΔE ≥ 18 between adjacent entries),
// not a new one invented for this page. Every avatar was flat gray before;
// this is what actually reads as "more colorful" without adding noise, since
// it's carrying real information (which person is which) instead of decoration.
function avatarColor(seed) {
  const s = String(seed || '?')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return CHART_PALETTE[h % CHART_PALETTE.length]
}

// Tokens, not literals: these used to be the DARK-theme hex values hardcoded, so in
// light theme every percentage on this page rendered as pale pastel on white while
// the other tabs shifted correctly.
function pctColor(v) { return v == null ? 'var(--text-secondary)' : v >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }
function fmtPct(v, decimals = 2) {
  if (v == null || !isFinite(v)) return '-'
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`
}
function timeAgo(iso, lang) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (!isFinite(diff) || diff < 0) return ''
  const min = Math.floor(diff / 60000)
  if (min < 1) return lang === 'es' ? 'ahora' : 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return lang === 'es' ? `${d}d` : `${d}d`
}

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
    dailyChange, totalAssets, baseCurrency, profile, settings, dataLoading,
  } = useDashboardData({ user, lang, activePortfolio: '__all__' })

  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])

  const displayName = useMemo(
    () => profile?.name || user?.displayName || (user?.email ? user.email.split('@')[0] : 'Anónimo'),
    [profile, user]
  )
  const avatar = useMemo(() => (displayName || '?').trim().charAt(0).toUpperCase(), [displayName])
  const myColor = useMemo(() => avatarColor(user?.uid || displayName), [user, displayName])

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
    return { verified: pct >= 0.6, syncedPct: pct }
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
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createScope, setCreateScope] = useState('all')
  const [joinCode, setJoinCode] = useState('')
  const [metric, setMetric] = useState('ytd') // 'ytd' | 'mtd' (Este mes)
  const syncedRef = useRef(false)

  const flash = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2500) }, [])

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
    } catch { /* leave prior state */ }
  }, [api])

  // Refresco A PEDIDO (el gesto de jalar, y el botón del header). `refresh` por
  // sí solo no sirve para alimentar un indicador: no dice cuándo terminó, así
  // que el anillo se cerraría antes de que lleguen los datos.
  const [refreshing, setRefreshing] = useState(false)
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await refresh() } finally { setRefreshing(false) }
  }, [refresh])

  // Publish my stats once data is ready, then load groups + global.
  const doSync = useCallback(async () => {
    if (!myStats.all) return
    try {
      await api({ action: 'sync', displayName, avatar, stats: myStats, verified, syncedPct })
      await refresh()
    } catch (e) { flash(e.message) }
  }, [api, myStats, displayName, avatar, verified, syncedPct, refresh, flash])

  useEffect(() => {
    if (syncedRef.current) return
    if (!user || dataLoading) return
    if (!myStats.all || myStats.all.ytd == null && myStats.all.day == null && myStats.all.movers.length === 0 && (enrichedItems || []).length === 0) {
      // Nothing to publish yet (no items). Still load groups so the UI isn't blank.
      refresh()
      return
    }
    syncedRef.current = true
    doSync()
  }, [user, dataLoading, myStats, enrichedItems, doSync, refresh])

  const handleUpdate = useCallback(async () => {
    setBusy(true)
    await doSync()
    setBusy(false)
    flash(t('Actualizado', 'Updated'))
  }, [doSync, flash, t])

  const handleCreate = useCallback(async () => {
    if (!createName.trim()) return
    setBusy(true)
    try {
      await api({ action: 'create-group', name: createName.trim(), scope: createScope })
      setCreating(false); setCreateName(''); setCreateScope('all')
      await doSync()
      flash(t('Grupo creado', 'Group created'))
    } catch (e) { flash(e.message) }
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
      flash(t('Te uniste al grupo', 'Joined the group'))
    } catch (e) { flash(e.message) }
    setBusy(false)
  }, [api, joinCode, doSync, flash, t])

  const handleLeave = useCallback(async (groupId, isOwner) => {
    const msg = isOwner
      ? t('¿Salir? Si eres el único, el grupo se elimina; si no, pasa al miembro más antiguo.', 'Leave? If you\'re the last one the group is deleted; otherwise ownership passes to the oldest member.')
      : t('¿Salir del grupo?', 'Leave this group?')
    if (!window.confirm(msg)) return
    setBusy(true)
    try { await api({ action: 'leave', groupId }); await refresh() }
    catch (e) { flash(e.message) }
    setBusy(false)
  }, [api, refresh, flash, t])

  const copyCode = useCallback((code) => {
    navigator.clipboard?.writeText(code)
    flash(t('Código copiado', 'Code copied'))
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-5">
          <SkeletonCard /><SkeletonCard />
        </div>
      </div>
    )
  }
  if (!user) return null

  const my = myStats.all || { ytd: null, day: null }
  const createDisabled = busy || !createName.trim()
  const joinDisabled = busy || !joinCode.trim()

  return (
    <PageShell user={user} lang={lang} setLang={handleSetLang} settings={settings} width="narrow"
      // Sin esto el botón de refrescar del header es un control MUERTO en esta
      // pantalla: PageShell le pasa `onRefresh={() => {}}` por default, y el
      // spread de headerProps es lo último, así que lo pisa.
      // Sin etapas a propósito: acá el refresco es UN viaje de red (dos
      // llamadas en paralelo), no hay sub-etapas independientes que reportar,
      // así que el anillo barre indeterminado en vez de inventar un porcentaje.
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

        {/* Your card — a hero treatment (bigger avatar, ring in your own
            color, soft gradient wash), so this reads as the anchor of the
            page instead of just another row like everyone else's. */}
        <div className="rounded-2xl p-4 sm:p-5 border relative overflow-hidden" style={{
          borderColor: 'var(--card-border)',
          background: `linear-gradient(135deg, color-mix(in srgb, ${myColor} 14%, var(--bg-card)) 0%, var(--bg-card) 65%)`,
        }}>
          <div className="flex items-center gap-3.5">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0 ring-2"
              style={{ backgroundColor: `color-mix(in srgb, ${myColor} 22%, transparent)`, color: myColor, boxShadow: `0 0 0 1px ${myColor}` }}>
              {avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold text-white truncate flex items-center gap-1.5">
                <span className="truncate">{displayName}</span>
                {verified && <VerifiedBadge lang={lang} />}
              </div>
              <div className="text-xs text-slate-500">{t('Tú', 'You')}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="flex items-end gap-2.5 justify-end">
                <div className="px-2 py-1 rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${pctColor(my.ytd)} 14%, transparent)` }}>
                  <div className="text-lg font-bold font-mono tabular-nums leading-tight" style={{ color: pctColor(my.ytd) }}>{fmtPct(my.ytd)}</div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide text-center">YTD</div>
                </div>
                <div className="px-2 py-1 rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${pctColor(my.mtd)} 14%, transparent)` }}>
                  <div className="text-lg font-bold font-mono tabular-nums leading-tight" style={{ color: pctColor(my.mtd) }}>{fmtPct(my.mtd)}</div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide text-center">{t('mes', 'month')}</div>
                </div>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{t('hoy', 'today')} <span className="font-semibold" style={{ color: pctColor(my.day) }}>{fmtPct(my.day)}</span></div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3.5 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
            <p className="text-[10px] text-slate-600">🔒 {t('Solo se comparte tu % y tus símbolos: nunca montos.', 'Only your % and symbols are shared: never amounts.')}</p>
            <button onClick={handleUpdate} disabled={busy}
              className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50" style={{ color: '#fff', backgroundColor: 'var(--accent-blue)' }}>
              {busy ? '…' : t('Actualizar', 'Update')}
            </button>
          </div>
        </div>

        {/* Create / join */}
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

        {creating && (
          <div className="rounded-xl p-3 space-y-3 border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)' }}>
            <input value={createName} onChange={(e) => setCreateName(e.target.value)} maxLength={40}
              placeholder={t('Nombre del grupo (ej. Los Inversionistas)', 'Group name (e.g. The Investors)')}
              className="w-full px-3 py-2 rounded-lg text-xs text-white bg-theme-surface border border-glass-border/60 focus:outline-none" />
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">{t('¿Qué se compara en este grupo?', 'What does this group compare?')}</label>
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
              {t('Crear y obtener código', 'Create & get code')}
            </button>
          </div>
        )}

        {joining && (
          <div className="rounded-xl p-3 space-y-3 border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)' }}>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={12}
              placeholder={t('Pega el código del grupo', 'Paste the group code')}
              className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono tracking-widest bg-theme-surface border border-glass-border/60 focus:outline-none" />
            <button onClick={handleJoin} disabled={joinDisabled}
              className="w-full py-2 rounded-lg text-xs font-medium transition-colors"
              style={joinDisabled
                ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                : { backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
              {t('Unirme', 'Join')}
            </button>
          </div>
        )}

        {/* Metric toggle: rank by the year (YTD) or the current month (competencia) */}
        {groups && groups.length > 0 && (
          <div className="flex items-center gap-1.5 justify-center">
            {[{ k: 'ytd', l: t('YTD (año)', 'YTD (year)') }, { k: 'mtd', l: t('Este mes', 'This month') }].map((o) => (
              <button key={o.k} onClick={() => setMetric(o.k)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
                style={metric === o.k
                  ? { borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)', color: 'var(--accent-blue)' }
                  : { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                {o.k === 'mtd' && '🏁 '}{o.l}
              </button>
            ))}
          </div>
        )}

        {/* Groups */}
        {groups === null ? (
          <p className="text-xs text-slate-500">…</p>
        ) : groups.length === 0 ? (
          <div className="rounded-2xl p-6 text-center border" style={{ borderColor: 'var(--card-border)', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-blue) 6%, var(--bg-card)) 0%, var(--bg-card) 70%)' }}>
            <div className="text-4xl mb-2">🏆</div>
            <p className="text-sm text-white font-medium">{t('Aún no estás en ningún grupo', 'You\'re not in any group yet')}</p>
            <p className="text-xs text-slate-500 mt-1">{t('Crea uno y comparte el código con tus amigos, o únete con el código de alguien.', 'Create one and share the code with friends, or join with someone\'s code.')}</p>
          </div>
        ) : (
          groups.map((g) => (
            <GroupCard key={g.id} group={g} lang={lang} t={t} metric={metric} expanded={expanded} setExpanded={setExpanded}
              onCopy={copyCode} onLeave={handleLeave} />
          ))
        )}

        {/* Global anonymous leaderboard */}
        <GlobalBoard global={global} lang={lang} t={t} api={api} flash={flash} onChanged={refresh} />

        <div className="text-center text-micro pt-2" style={{ color: 'var(--text-muted)' }}>Chispudo · chispu.xyz</div>

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-xs text-white shadow-lg" style={{ backgroundColor: 'var(--accent-blue)' }}>
          {toast}
        </div>
      )}
    </PageShell>
  )
}

const MEDALS = ['🥇', '🥈', '🥉']

// Soft trust signal — portfolio is mostly broker-synced, not hand-typed.
function VerifiedBadge({ lang }) {
  return (
    <span title={lang === 'es' ? 'Portafolio sincronizado con un broker' : 'Portfolio synced with a broker'}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold shrink-0"
      style={{ backgroundColor: 'color-mix(in srgb, var(--accent-green) 22%, transparent)', color: 'var(--accent-green)' }}>
      ✓
    </span>
  )
}

function GroupCard({ group, lang, t, metric = 'ytd', expanded, setExpanded, onCopy, onLeave }) {
  // Server sends rows sorted by YTD; re-sort locally by the active metric so the
  // "Este mes" toggle instantly re-ranks (nulls sink to the bottom).
  const rows = [...(group.rows || [])].sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity))
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate flex items-center gap-2">
            {group.name}
            <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              {group.scope === 'ibkr' ? t('Solo IBKR', 'IBKR only') : t('Todo', 'All')}
            </span>
          </div>
          <div className="text-[10px] text-slate-500">{group.memberCount} {t('miembros', 'members')}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => onCopy(group.inviteCode)}
            className="px-2 py-1 text-xs font-mono rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-blue)' }}>
            {group.inviteCode}
          </button>
          <button onClick={() => onLeave(group.id, group.isOwner)} aria-label={t('Salir', 'Leave')}
            className="px-1.5 py-1 text-xs" style={{ color: 'var(--text-negative)', opacity: 0.6 }}>✕</button>
        </div>
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
        {rows.length === 0 && (
          <p className="px-4 py-3 text-xs text-slate-500">{t('Sin datos aún.', 'No data yet.')}</p>
        )}
        {rows.map((r, i) => {
          const key = `${group.id}:${r.uid}`
          const isOpen = !!expanded[key]
          const hasDetail = (r.movers && r.movers.length > 0) || r.day != null
          const isPodium = i < 3
          const color = avatarColor(r.uid || r.displayName)
          return (
            <div key={r.uid}>
              <button onClick={() => hasDetail && setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-card-hover)]"
                style={r.isYou
                  ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)' }
                  : isPodium ? { backgroundColor: 'color-mix(in srgb, var(--text-primary) 3%, transparent)' } : undefined}>
                <span className="w-6 text-center text-base shrink-0">{metric === 'mtd' && i === 0 ? '👑' : isPodium ? MEDALS[i] : <span className="text-xs text-slate-500">{i + 1}</span>}</span>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color }}>
                  {(r.avatar || r.displayName || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate flex items-center gap-1">
                    <span className="truncate">{r.displayName}</span>
                    {r.verified && <VerifiedBadge lang={lang} />}
                    {r.isYou && <span className="text-[10px] text-slate-500">({t('tú', 'you')})</span>}
                  </div>
                  <div className="text-[10px] text-slate-600">{t('act.', 'upd.')} {timeAgo(r.updatedAt, lang)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold font-mono tabular-nums" style={{ color: pctColor(r[metric]) }}>{fmtPct(r[metric])}</div>
                  <div className="text-[10px] text-slate-500">
                    {metric === 'mtd'
                      ? <>YTD <span style={{ color: pctColor(r.ytd) }}>{fmtPct(r.ytd, 1)}</span></>
                      : <>{t('mes', 'month')} <span style={{ color: pctColor(r.mtd) }}>{fmtPct(r.mtd, 1)}</span></>}
                    {' · '}{t('hoy', 'today')} <span style={{ color: pctColor(r.day) }}>{fmtPct(r.day, 1)}</span>
                  </div>
                </div>
                {hasDetail && <span className="text-slate-600 text-xs shrink-0">{isOpen ? '▾' : '▸'}</span>}
              </button>
              {isOpen && (
                <div className="px-4 pb-3 pt-1" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  <div className="text-[10px] text-slate-500 mb-1.5">{t('Posiciones de mayor impacto hoy', 'Biggest impact on today')}</div>
                  {(r.movers || []).length === 0 ? (
                    <p className="text-[11px] text-slate-600">{t('Sin movimientos de mercado hoy.', 'No market moves today.')}</p>
                  ) : (
                    <div className="space-y-1">
                      {r.movers.map((m, mi) => (
                        <div key={mi} className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-300 font-mono">{m.symbol}</span>
                          <div className="flex items-center gap-3">
                            <span style={{ color: pctColor(m.changePct) }}>{fmtPct(m.changePct, 1)}</span>
                            <span className="text-slate-500 w-16 text-right">{t('impacto', 'impact')} {fmtPct(m.impactPct, 2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GlobalBoard({ global, lang, t, api, flash, onChanged }) {
  const [busy, setBusy] = useState(false)
  const optedIn = global?.yourRank != null
  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      await api({ action: 'global-optin', on: !optedIn })
      await onChanged()
      flash(optedIn ? t('Saliste del ranking global', 'Left the global ranking') : t('Estás en el ranking global', 'You\'re in the global ranking'))
    } catch (e) { flash(e.message) }
    setBusy(false)
  }, [api, optedIn, onChanged, flash, t])

  const top = global?.top || []
  return (
    <div className="rounded-xl border" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <div>
          <div className="text-sm font-semibold text-white">🌎 {t('Ranking global', 'Global ranking')}</div>
          <div className="text-[10px] text-slate-500">{t('Anónimo: solo un seudónimo y tu % YTD.', 'Anonymous: just a pseudonym and your YTD %.')}</div>
        </div>
        <button onClick={toggle} disabled={busy}
          className="px-2.5 py-1 text-xs font-medium rounded-md disabled:opacity-50 border"
          style={optedIn
            ? { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }
            : { borderColor: 'var(--accent-blue)', color: '#fff', backgroundColor: 'var(--accent-blue)' }}>
          {optedIn ? t('Salir', 'Leave') : t('Participar', 'Join')}
        </button>
      </div>
      {top.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-500">{t('Participa para ver el ranking global.', 'Join to see the global ranking.')}</p>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
          {top.map((r) => {
            const isPodium = r.rank <= 3
            const color = avatarColor(r.pseudonym)
            return (
              <div key={r.rank} className="flex items-center gap-3 px-4 py-2"
                style={r.isYou
                  ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)' }
                  : isPodium ? { backgroundColor: 'color-mix(in srgb, var(--text-primary) 3%, transparent)' } : undefined}>
                <span className="w-6 text-center text-base shrink-0">{isPodium ? MEDALS[r.rank - 1] : <span className="text-xs text-slate-500">{r.rank}</span>}</span>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color }}>
                  {(r.pseudonym || '?').charAt(0).toUpperCase()}
                </div>
                <span className="flex-1 min-w-0 text-sm text-white truncate flex items-center gap-1">
                  <span className="truncate">{r.pseudonym}</span>
                  {r.verified && <VerifiedBadge lang={lang} />}
                  {r.isYou && <span className="text-[10px] text-slate-500">({t('tú', 'you')})</span>}
                </span>
                <span className="text-sm font-bold font-mono tabular-nums shrink-0" style={{ color: pctColor(r.ytd) }}>{fmtPct(r.ytd)}</span>
              </div>
            )
          })}
          {global?.yourRank != null && global.yourRank > top.length && (
            <div className="px-4 py-2 text-xs text-slate-500">{t('Tu posición', 'Your rank')}: #{global.yourRank} {t('de', 'of')} {global.total}</div>
          )}
        </div>
      )}
    </div>
  )
}
