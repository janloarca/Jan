'use client'

import { useState, useCallback } from 'react'
import BusyLabel from '@/components/ui/BusyLabel'
import InlineNotice from '@/components/ui/InlineNotice'
import { Shimmer } from '@/components/dashboard/Skeleton'
import VerifiedBadge from '@/components/friends/VerifiedBadge'
import { avatarColor, pctColor, fmtPct, initialOf, MEDALS } from '@/components/friends/friendsUi'

// El ranking global anónimo.
//
// Antes esta tarjeta decía "Participa para ver el ranking global." cada vez que
// la lista venía vacía, y eso pasaba en CUATRO situaciones distintas: cargando,
// la llamada falló, todavía no participa nadie, y tú no participas. Encima la
// frase era falsa: el servidor devuelve el top participes o no, así que unirte
// nunca fue lo que destrababa la lista.
//
// Ahora cada situación dice lo suyo, y `optedIn` llega del servidor en vez de
// deducirse del ranking (se deducía de `yourRank != null`, que es null si tu
// YTD todavía no existe, así que a quien ya participaba el botón le seguía
// diciendo "Participar").
export default function GlobalBoard({ global, loading, error, lang, t, api, flash, onChanged, onRetry }) {
  const [busy, setBusy] = useState(false)
  const optedIn = !!global?.optedIn
  const top = global?.top || []
  const total = global?.total ?? 0

  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      await api({ action: 'global-optin', on: !optedIn })
      await onChanged()
      flash(optedIn ? t('Saliste del ranking global', 'Left the global ranking') : t('Estás en el ranking global', 'You are in the global ranking'), 'success')
    } catch (e) { flash(e.message, 'warn') }
    setBusy(false)
  }, [api, optedIn, onChanged, flash, t])

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>🌎 {t('Ranking global', 'Global ranking')}</div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {t('Anónimo: solo un seudónimo y tu % del año.', 'Anonymous: just a pseudonym and your yearly %.')}
          </div>
        </div>
        <button onClick={toggle} disabled={busy}
          className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md disabled:opacity-50 border"
          style={optedIn
            ? { borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }
            : { borderColor: 'var(--accent-blue)', color: '#fff', backgroundColor: 'var(--accent-blue)' }}>
          <BusyLabel busy={busy} lang={lang}>{optedIn ? t('Salir', 'Leave') : t('Participar', 'Join')}</BusyLabel>
        </button>
      </div>

      {error ? (
        <div className="p-3">
          <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={onRetry} busy={loading}>
            {t('No se pudo cargar el ranking global.', 'Could not load the global ranking.')}
          </InlineNotice>
        </div>
      ) : loading && !global ? (
        <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
          {/* Filas esqueleto con la MISMA forma que las reales, para que al
              llegar los datos no salte el layout. Usan el `Shimmer` compartido,
              que es el único átomo de carga de la app. */}
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <Shimmer className="w-6 h-3 shrink-0" />
              <Shimmer className="w-6 h-6 rounded-full shrink-0" />
              <Shimmer className="flex-1 h-3" />
              <Shimmer className="w-12 h-3 shrink-0" />
            </div>
          ))}
        </div>
      ) : top.length === 0 ? (
        <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {optedIn
            ? t('Ya estás dentro. Todavía nadie más participa: en cuanto entre alguien lo verás acá.',
                'You are in. Nobody else has joined yet: as soon as someone does you will see them here.')
            : t('Todavía no participa nadie. Puedes ser el primero.',
                'Nobody has joined yet. You can be the first.')}
        </p>
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
                <span className="w-6 text-center text-base shrink-0">
                  {isPodium ? MEDALS[r.rank - 1] : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.rank}</span>}
                </span>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color }}>
                  {initialOf(r.pseudonym)}
                </div>
                <span className="flex-1 min-w-0 text-sm truncate flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                  <span className="truncate">{r.pseudonym}</span>
                  {r.verified && <VerifiedBadge lang={lang} />}
                  {r.isYou && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>({t('tú', 'you')})</span>}
                </span>
                <span className="text-sm font-bold font-mono tabular-nums shrink-0" style={{ color: pctColor(r.ytd) }}>{fmtPct(r.ytd)}</span>
              </div>
            )
          })}

          {/* Los tres casos que la lista sola no cuenta. */}
          {!optedIn && (
            <div className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {total === 1
                ? t('Hay 1 persona participando y tú no estás.', 'There is 1 person taking part and you are not in.')
                : t(`Hay ${total} personas participando y tú no estás.`, `There are ${total} people taking part and you are not in.`)}
            </div>
          )}
          {optedIn && global?.yourRank == null && (
            <div className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('Ya estás dentro, pero todavía no tenemos tu % del año, así que no apareces en la tabla.',
                 'You are in, but we do not have your yearly % yet, so you are not on the board.')}
            </div>
          )}
          {optedIn && global?.yourRank != null && global.yourRank > top.length && (
            <div className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('Tu posición', 'Your rank')}: #{global.yourRank} {t('de', 'of')} {total}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
