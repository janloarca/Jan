'use client'

import { useState, useCallback } from 'react'
import { MoreHorizontal, Check, X } from 'lucide-react'
import BusyLabel from '@/components/ui/BusyLabel'
import VerifiedBadge from '@/components/friends/VerifiedBadge'
import { avatarColor, pctColor, fmtPct, timeAgo, initialOf, MEDALS, dayLabel, sessionDayLabel } from '@/components/friends/friendsUi'

const MAX_NAME = 40

// Toda acción destructiva va con el patrón de DOS TOQUES que el resto de la app
// ya usa (components/SettingsModal.jsx): el primer toque arma y cambia el
// rótulo a "Confirmar", el segundo ejecuta, y tocar cualquier otra cosa desarma.
// Antes esta pantalla usaba window.confirm, que era uno de los dos únicos
// diálogos nativos de toda la app.
//
// Un solo `armed` por tarjeta ({kind, id}), así nunca hay dos acciones armadas
// al mismo tiempo: armar "eliminar grupo" desarma un "quitar miembro" pendiente.
export default function GroupCard({
  group, lang, t, metric = 'ytd', expanded, setExpanded,
  onCopy, onLeave, onRename, onDelete, onKick, pending,
}) {
  const [armed, setArmed] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(group.name)

  const isArmed = (kind, id) => armed?.kind === kind && armed?.id === id
  const isPending = (kind, id) => pending?.kind === kind && pending?.id === id

  // Un toque en una acción distinta desarma la anterior. Ejecuta solo si ESA ya
  // estaba armada.
  const arm = useCallback((kind, id, run) => {
    if (isArmed(kind, id)) { setArmed(null); run(); return }
    setArmed({ kind, id })
  }, [armed]) // eslint-disable-line react-hooks/exhaustive-deps

  const commitRename = useCallback(async () => {
    const next = nameDraft.trim().slice(0, MAX_NAME)
    if (!next || next === group.name) { setRenaming(false); return }
    const ok = await onRename(group.id, next)
    if (ok) { setRenaming(false); setMenuOpen(false) }
  }, [nameDraft, group.id, group.name, onRename])

  // El servidor ordena por YTD; se reordena acá según la métrica activa para que
  // el selector "Este mes" re-rankee al instante (los nulos se van al fondo).
  const rows = [...(group.rows || [])].sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity))

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {renaming ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  maxLength={MAX_NAME}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setNameDraft(group.name); setRenaming(false) } }}
                  aria-label={t('Nombre del grupo', 'Group name')}
                  className="flex-1 min-w-0 px-2 py-1 rounded-lg text-sm font-semibold bg-theme-surface border focus:outline-none"
                  style={{ borderColor: 'var(--card-border)', color: 'var(--text-primary)' }}
                />
                <button onClick={commitRename} disabled={isPending('rename', group.id)}
                  aria-label={t('Guardar nombre', 'Save name')}
                  className="shrink-0 p-1 rounded-md disabled:opacity-60"
                  style={{ color: '#fff', backgroundColor: 'var(--accent-blue)' }}>
                  <BusyLabel busy={isPending('rename', group.id)} lang={lang}><Check size={14} /></BusyLabel>
                </button>
                <button onClick={() => { setNameDraft(group.name); setRenaming(false) }}
                  aria-label={t('Cancelar', 'Cancel')} className="shrink-0 p-1" style={{ color: 'var(--text-muted)' }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="text-sm font-semibold truncate flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                {group.name}
                <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                  {group.scope === 'ibkr' ? t('Solo IBKR', 'IBKR only') : t('Todo', 'All')}
                </span>
              </div>
            )}
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {group.memberCount} {t('miembros', 'members')}
              {group.pendingCount > 0 && (
                <> · {group.pendingCount} {t('aún no publican', 'have not published yet')}</>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => onCopy(group.inviteCode, group.name)}
              aria-label={t('Compartir el código de invitación', 'Share the invite code')}
              className="px-2 py-1 text-xs font-mono rounded-md"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--accent-blue)' }}>
              {group.inviteCode}
            </button>
            <button onClick={() => { setMenuOpen((v) => !v); setArmed(null) }}
              aria-label={t('Opciones del grupo', 'Group options')}
              className="p-1 rounded-md" style={{ color: 'var(--text-muted)' }}>
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
            {/* Renombrar y eliminar son del DUEÑO: el servidor ya lo valida
                (route.js), así que esconderlos para el resto es solo no ofrecer
                un botón que iba a devolver 403. */}
            {group.isOwner && !renaming && (
              <button onClick={() => { setRenaming(true); setArmed(null) }}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border"
                style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                {t('Renombrar', 'Rename')}
              </button>
            )}
            {group.isOwner && (
              <button
                onClick={() => arm('delete', group.id, () => onDelete(group.id))}
                onBlur={() => isArmed('delete', group.id) && setArmed(null)}
                disabled={isPending('delete', group.id)}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border disabled:opacity-70"
                style={isArmed('delete', group.id)
                  ? { backgroundColor: 'var(--text-negative)', color: '#ffffff', borderColor: 'var(--text-negative)' }
                  : { color: 'var(--text-negative)', borderColor: 'color-mix(in srgb, var(--text-negative) 30%, transparent)' }}>
                <BusyLabel busy={isPending('delete', group.id)} lang={lang}>
                  {isArmed('delete', group.id) ? t('Confirmar: eliminar grupo', 'Confirm: delete group') : t('Eliminar grupo', 'Delete group')}
                </BusyLabel>
              </button>
            )}
            <button
              onClick={() => arm('leave', group.id, () => onLeave(group.id, group.isOwner))}
              onBlur={() => isArmed('leave', group.id) && setArmed(null)}
              disabled={isPending('leave', group.id)}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border disabled:opacity-70"
              style={isArmed('leave', group.id)
                ? { backgroundColor: 'var(--text-negative)', color: '#ffffff', borderColor: 'var(--text-negative)' }
                : { color: 'var(--text-negative)', borderColor: 'color-mix(in srgb, var(--text-negative) 30%, transparent)' }}>
              <BusyLabel busy={isPending('leave', group.id)} lang={lang}>
                {isArmed('leave', group.id) ? t('Confirmar: salir', 'Confirm: leave') : t('Salir del grupo', 'Leave group')}
              </BusyLabel>
            </button>
            {/* La consecuencia real de salir siendo dueño, dicha ANTES de armar,
                no en un window.confirm que aparece encima de todo. */}
            {group.isOwner && isArmed('leave', group.id) && (
              <p className="w-full text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {t('Si eres el único, el grupo se elimina; si no, pasa al miembro más antiguo.',
                   'If you are the last one the group is deleted; otherwise ownership passes to the oldest member.')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
        {rows.length === 0 && (
          <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>{t('Sin datos aún.', 'No data yet.')}</p>
        )}
        {rows.map((r, i) => {
          const key = `${group.id}:${r.uid}`
          const isOpen = !!expanded[key]
          const hasDetail = (r.movers && r.movers.length > 0) || r.day != null
          const isPodium = i < 3
          const color = avatarColor(r.uid || r.displayName)
          return (
            <div key={r.uid}>
              <div
                className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors"
                style={r.isYou
                  ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 8%, transparent)' }
                  : isPodium ? { backgroundColor: 'color-mix(in srgb, var(--text-primary) 3%, transparent)' } : undefined}>
                <button
                  onClick={() => hasDetail && setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                  className="flex-1 min-w-0 flex items-center gap-3 text-left">
                  <span className="w-6 text-center text-base shrink-0">
                    {metric === 'mtd' && i === 0 ? '👑' : isPodium ? MEDALS[i] : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>}
                  </span>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`, color }}>
                    {initialOf(r.avatar || r.displayName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* El nombre se ENVUELVE hasta dos líneas en vez de
                        cortarse. En un teléfono, una fila con tres porcentajes
                        al lado deja ~82px para el nombre, y "janmarcofuentes"
                        necesita 118: recortarlo convertía a la persona en
                        "janma…", que es justo lo que se reportó de la tarjeta
                        de arriba. La fila crece un renglón solo para los
                        nombres largos, que son la excepción. */}
                    <div className="text-sm flex items-start gap-1" style={{ color: 'var(--text-primary)' }}>
                      <span className="line-clamp-2 break-words leading-tight">{r.displayName}</span>
                      {r.verified && <span className="mt-0.5"><VerifiedBadge lang={lang} /></span>}
                    </div>
                    {/* "Tú" va en la segunda línea, no pegado al nombre: en un
                        teléfono ese paréntesis le robaba ~34px a la fila más
                        larga y cortaba justo el nombre propio. Mismo lugar
                        donde tu propia tarjeta ya dice "Tú". */}
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {r.isYou && <>{t('Tú', 'You')} · </>}
                      {t('act.', 'upd.')} {timeAgo(r.updatedAt, lang)}
                    </div>
                  </div>
                  {/* Un miembro sin datos para el ALCANCE del grupo (ej. sin
                      broker conectado en un grupo "Solo IBKR") no se rellena con
                      su portafolio completo: se dice que no tiene esa cuenta.
                      Sin esta línea, su fila en blanco se lee como una tarjeta
                      rota en vez de como lo que es. */}
                  {r.outOfScope ? (
                    <div className="text-right shrink-0 max-w-[7.5rem]">
                      <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{t('Sin datos', 'No data')}</div>
                      <div className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>
                        {t('no tiene esta cuenta conectada', 'no such account connected')}
                      </div>
                    </div>
                  ) : (
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold font-mono tabular-nums" style={{ color: pctColor(r[metric]) }}>{fmtPct(r[metric])}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {metric === 'mtd'
                        ? <>YTD <span style={{ color: pctColor(r.ytd) }}>{fmtPct(r.ytd, 1)}</span></>
                        : <>{t('mes', 'month')} <span style={{ color: pctColor(r.mtd) }}>{fmtPct(r.mtd, 1)}</span></>}
                      {/* FASE KO: "hoy" solo cuando de verdad es hoy. Con la
                          bolsa cerrada esta cifra es la de la última sesión, y
                          decirle "hoy" comparaba a quien tiene acciones
                          (congelado) contra quien tiene cripto (que sí se
                          movió) bajo la misma palabra. */}
                      {' · '}{dayLabel(r.dayAsOf, lang).text} <span style={{ color: pctColor(r.day) }}>{fmtPct(r.day, 1)}</span>
                    </div>
                  </div>
                  )}
                  {hasDetail && <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>}
                </button>
                {/* Quitar a alguien solo lo ve el dueño, y nunca sobre sí mismo:
                    para eso está "Salir del grupo". */}
                {menuOpen && group.isOwner && !r.isYou && (
                  <button
                    onClick={() => arm('kick', r.uid, () => onKick(group.id, r.uid))}
                    onBlur={() => isArmed('kick', r.uid) && setArmed(null)}
                    disabled={isPending('kick', r.uid)}
                    className="shrink-0 px-2 py-1 text-[10px] font-medium rounded-md border disabled:opacity-70"
                    style={isArmed('kick', r.uid)
                      ? { backgroundColor: 'var(--text-negative)', color: '#ffffff', borderColor: 'var(--text-negative)' }
                      : { color: 'var(--text-negative)', borderColor: 'color-mix(in srgb, var(--text-negative) 30%, transparent)' }}>
                    <BusyLabel busy={isPending('kick', r.uid)} lang={lang}>
                      {isArmed('kick', r.uid) ? t('Confirmar', 'Confirm') : t('Quitar', 'Remove')}
                    </BusyLabel>
                  </button>
                )}
              </div>
              {isOpen && (
                <div className="px-4 pb-3 pt-1" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  <div className="text-[10px] mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    {(() => {
                      const d = dayLabel(r.dayAsOf, lang)
                      if (!d.stale) return t('Posiciones de mayor impacto hoy', 'Biggest impact on today')
                      const when = sessionDayLabel(r.dayAsOf, lang)
                      return t(`Posiciones de mayor impacto · cierre del ${when}`, `Biggest impact · ${when} close`)
                    })()}
                  </div>
                  {(r.movers || []).length === 0 ? (
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {dayLabel(r.dayAsOf, lang).stale
                        ? t('Sin movimientos en esa sesión.', 'No market moves that session.')
                        : t('Sin movimientos de mercado hoy.', 'No market moves today.')}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {/* La lista YA viene ordenada por impacto (lo decide el
                          cliente que publica, y el orden se conserva), así que
                          la posición en la lista sigue diciendo cuál movió más.
                          El NÚMERO del impacto no se muestra ni se publica: al
                          lado del cambio de la posición dejaba despejar su peso
                          en el portafolio. Ver lib/friendsStats.js. */}
                      {r.movers.map((m, mi) => (
                        <div key={mi} className="flex items-center justify-between text-[11px]">
                          <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{m.symbol}</span>
                          <span style={{ color: pctColor(m.changePct) }}>{fmtPct(m.changePct, 1)}</span>
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
