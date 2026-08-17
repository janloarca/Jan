'use client'

import { useState, useEffect, useCallback } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import BusyLabel from '@/components/ui/BusyLabel'
import VerifiedBadge from '@/components/friends/VerifiedBadge'
import { YOU_COLOR, pctColor, fmtPct, timeAgo, initialOf } from '@/components/friends/friendsUi'

// El servidor recorta el nombre a 40 (route.js). Se recorta acá también para
// que nadie escriba 60 caracteres y descubra al guardar que se le comieron 20.
const MAX_NAME = 40

// Tu propia tarjeta: el ancla de la pantalla.
//
// Tres filas, y esa es la razón de ser del layout. Antes eran DOS columnas
// (avatar + nombre a la izquierda, un bloque fijo a la derecha con dos
// pastillas Y una tercera línea "hoy" colgando debajo), así que en un teléfono
// el bloque derecho se comía ~150px y el nombre quedaba en "janmar…". Con las
// métricas en su propia fila de tres columnas iguales, el nombre se queda con
// el ancho completo.
export default function YourCard({
  displayName, verified, stats, updatedAt, lang, t,
  busy = false, savingName = false, onUpdate, onSaveName,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(displayName || '')

  // Si el nombre cambia por fuera (otra pestaña, un sync), el borrador tiene que
  // seguirlo mientras NO se esté editando. Pisarlo durante la edición borraría
  // lo que la persona está escribiendo.
  useEffect(() => { if (!editing) setDraft(displayName || '') }, [displayName, editing])

  const commit = useCallback(async () => {
    const next = draft.trim().slice(0, MAX_NAME)
    if (!next || next === displayName) { setEditing(false); return }
    const ok = await onSaveName(next)
    if (ok) setEditing(false)
  }, [draft, displayName, onSaveName])

  const cancel = useCallback(() => { setDraft(displayName || ''); setEditing(false) }, [displayName])

  const initial = initialOf(editing ? draft : displayName)
  const ago = timeAgo(updatedAt, lang)

  return (
    <div
      className="card card-hero p-4 sm:p-5 relative overflow-hidden"
      style={{
        // Siempre el azul de marca, nunca un color hasheado: tu tarjeta no es
        // una serie de gráfica. Antes salía del hash del uid, y a quien le
        // tocaba el rojo (que es el mismo rojo que la app usa para DEUDA) veía
        // su propia tarjeta teñida como si fuera una pérdida.
        background: `linear-gradient(135deg, color-mix(in srgb, ${YOU_COLOR} 10%, var(--bg-card)) 0%, var(--bg-card) 60%)`,
      }}
    >
      <div className="flex items-center gap-3.5">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
          style={{
            backgroundColor: `color-mix(in srgb, ${YOU_COLOR} 18%, transparent)`,
            color: YOU_COLOR,
            boxShadow: `0 0 0 2px ${YOU_COLOR}`,
          }}
        >
          {initial}
        </div>

        {editing ? (
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              maxLength={MAX_NAME}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
              aria-label={t('Tu nombre para mostrar', 'Your display name')}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-base font-semibold bg-theme-surface border focus:outline-none"
              style={{ borderColor: 'var(--card-border)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={commit}
              disabled={savingName}
              aria-label={t('Guardar nombre', 'Save name')}
              className="shrink-0 p-1.5 rounded-lg disabled:opacity-60"
              style={{ color: '#fff', backgroundColor: 'var(--accent-blue)' }}
            >
              <BusyLabel busy={savingName} lang={lang}><Check size={16} /></BusyLabel>
            </button>
            <button
              onClick={cancel}
              aria-label={t('Cancelar', 'Cancel')}
              className="shrink-0 p-1.5 rounded-lg"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
              <span className="truncate">{displayName}</span>
              {verified && <VerifiedBadge lang={lang} />}
              <button
                onClick={() => setEditing(true)}
                aria-label={t('Cambiar tu nombre', 'Change your name')}
                className="shrink-0 p-1 rounded-md transition-opacity opacity-60 hover:opacity-100"
                style={{ color: 'var(--text-muted)' }}
              >
                <Pencil size={13} />
              </button>
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('Tú', 'You')}
              {/* La edad de la foto que publicaste. Sin esto el modelo es
                  invisible: se ve un número y nada dice que es una instantánea
                  que se queda quieta hasta que la vuelvas a publicar. */}
              {ago && <> · {t('publicado hace', 'published')} {ago}</>}
            </div>
          </div>
        )}
      </div>

      {/* Tres columnas iguales. Antes YTD y mes eran pastillas apretadas a la
          derecha y "hoy" colgaba solo debajo, en letra más chica, como si fuera
          menos importante que las otras dos. */}
      <div className="grid grid-cols-3 gap-2 mt-4">
        {[
          { k: 'ytd', label: t('AÑO', 'YEAR'), v: stats?.ytd },
          { k: 'mtd', label: t('MES', 'MONTH'), v: stats?.mtd },
          { k: 'day', label: t('HOY', 'TODAY'), v: stats?.day },
        ].map((m) => (
          <div
            key={m.k}
            className="rounded-lg px-2 py-2 text-center"
            style={{ backgroundColor: `color-mix(in srgb, ${pctColor(m.v)} 12%, transparent)` }}
          >
            <div className="text-lg font-bold font-mono tabular-nums leading-tight" style={{ color: pctColor(m.v) }}>
              {fmtPct(m.v)}
            </div>
            <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t" style={{ borderColor: 'var(--card-border)' }}>
        <p className="text-[10px] min-w-0" style={{ color: 'var(--text-muted)' }}>
          🔒 {t('Solo se comparte tu % y tus símbolos: nunca montos.', 'Only your % and symbols are shared: never amounts.')}
        </p>
        <button
          onClick={onUpdate}
          disabled={busy}
          className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ color: '#fff', backgroundColor: 'var(--accent-blue)' }}
        >
          <BusyLabel busy={busy} lang={lang}>{t('Publicar', 'Publish')}</BusyLabel>
        </button>
      </div>
    </div>
  )
}
