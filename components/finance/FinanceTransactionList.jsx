'use client'

import { useState, useEffect } from 'react'
import { CATEGORY_COLORS } from '@/lib/financeCategories'
import { cashFlowOf, flowSign, flowMagnitude, isReversal } from '@/lib/financeAmount'
import { formatFinanceDate } from '@/lib/financeMonth'
import CategoryEditor from '@/components/finance/CategoryEditor'

// The month's ledger. Two layouts on purpose: a table from `sm` up, and one
// card per row below it. A five-column table on a phone needs sideways
// scrolling to reach the description, and it lives INSIDE a vertical scroller,
// so the gesture that reveals it competes with the one that scrolls the list —
// the description column was simply off-screen in the user's own screenshot.

// ⛔ Estos cuatro viven FUERA del componente, y no es estilo.
//
// Definidos adentro, su identidad es NUEVA en cada render, así que React los
// ve como otro tipo y DESMONTA Y REMONTA su nodo. Si eso cae entre el down y
// el up del dedo, el nodo que recibió el toque ya no existe al soltar y el
// CLICK NUNCA LLEGA: hay que tocar varias veces. Medido en el navegador con el
// mecanismo aislado: 40 de 40 clics perdidos adentro, 0 de 40 afuera.
//
// Todo lo que antes venía del closure viaja como prop.
function CategoryCell({ tx, i, onRecategorize, setEditing, keyOf, t }) {
  return (
  <button
    onClick={() => onRecategorize && setEditing(keyOf(tx, i))}
    disabled={!onRecategorize}
    title={onRecategorize ? t('Cambiar categoría', 'Change category') : undefined}
    className="inline-flex items-center gap-1 rounded-md px-1 -mx-1 transition-colors disabled:cursor-default hover:bg-theme-elevated max-w-full">
    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[tx.category] || 'var(--text-muted)' }} />
    <span className="truncate" style={{ color: 'var(--text-secondary)' }}>
      {tx.category}{tx.userLabel ? ` · ${tx.userLabel}` : ''}
    </span>
    {tx._needsReview && (
      <span title={t('Revisa la categoría', 'Check the category')} style={{ color: 'var(--alert-warn-icon)' }}>?</span>
    )}
  </button>
)
}

function DeleteButton({ tx, i, onDelete, confirming, setConfirming, keyOf, t }) {
  if (!onDelete) return null
  const k = keyOf(tx, i)
  return confirming === k ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <button onClick={() => { onDelete(tx.id); setConfirming(null) }}
        className="font-semibold" style={{ color: 'var(--text-negative)' }}>
        {t('Borrar', 'Delete')}
      </button>
      <button onClick={() => setConfirming(null)} style={{ color: 'var(--text-muted)' }}>
        {t('No', 'No')}
      </button>
    </span>
  ) : (
    <button onClick={() => setConfirming(k)}
      aria-label={t('Eliminar', 'Delete')}
      className="transition-colors hover:opacity-100 opacity-60"
      style={{ color: 'var(--text-muted)' }}>
      &times;
    </button>
  )
}

function Amount({ tx, t, fmt }) {
  return (
  <span className="whitespace-nowrap">
    <span className="font-medium font-mono tabular-nums"
      style={{ color: cashFlowOf(tx) >= 0 ? 'var(--accent-green)' : 'var(--text-negative)' }}>
      {flowSign(tx)}Q{fmt(flowMagnitude(tx))}
    </span>
    {tx._originalCurrency && tx._originalCurrency !== 'GTQ' && (
      <span className="block text-[10px] font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}
        title={t('Monto original del cobro', 'Original charge amount')}>
        {tx._originalCurrency} {fmt(flowMagnitude({ ...tx, amount: tx._originalAmount }))}
      </span>
    )}
  </span>
)
}

function Description({ tx, t }) {
  return (
  <>
    {String(tx._source || '').startsWith('auto_') && (
      <span title={t('Capturado automáticamente', 'Captured automatically')} className="mr-1">⚡</span>
    )}
    {tx.description || '-'}
    {/* A negative expense with nothing saying why reads as a bug, so the row
        names what it is. It stays in the merchant's category on purpose:
        that is what makes the category report net spend. */}
    {isReversal(tx) && (
      <span className="ml-1 text-[10px] px-1 py-0.5 rounded"
        style={{ color: 'var(--alert-success-icon)', backgroundColor: 'var(--alert-success-bg)' }}>
        {t('reembolso', 'refund')}
      </span>
    )}
    {tx.location && <span style={{ color: 'var(--text-muted)' }}> · {tx.location}</span>}
  </>
)
}

export default function FinanceTransactionList({ transactions, onDelete, onRecategorize, lang = 'es' }) {
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  // Row whose category select is open. Editing inline (rather than in a modal)
  // matters here: correcting an auto-captured category is the gesture that
  // teaches the classifier, so it has to be one click away.
  const [editing, setEditing] = useState(null)
  // Two-tap delete instead of window.confirm: this was one of the last native
  // dialogs left in the app, and it cannot be styled or dismissed by tapping
  // away on a phone.
  const [confirming, setConfirming] = useState(null)
  const t = (es, en) => lang === 'es' ? es : en

  const filtered = transactions
    .filter(tx => filter === 'ALL' || tx.type === filter)
    .filter(tx => {
      if (!search) return true
      const q = search.toLowerCase()
      return (tx.description || '').toLowerCase().includes(q) ||
        (tx.category || '').toLowerCase().includes(q)
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const fmt = (v) => v.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // The hour, when the capture carried one. It is what makes two identical
  // charges legible as two instead of looking like a duplicate the app failed
  // to catch, so it belongs on screen and not only in the dedup logic.
  //
  // Only after mounting: the stored value is an absolute instant and the hour a
  // reader wants is their OWN, which the server cannot know — rendering it
  // during SSR puts UTC in the HTML and the local hour in the browser, and React
  // throws out the whole tree over the mismatch.
  //
  // Built by hand rather than with toLocaleTimeString: `hour: '2-digit'` gives
  // 12-hour time with a " p. m." tail in es-GT, which is long and noisy in a
  // dense row, and `hour12: false` renders midnight as 24:00 in some locales.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const timeOf = (tx) => {
    if (!mounted || !tx.occurredAt) return null
    const d = new Date(tx.occurredAt)
    if (isNaN(d.getTime())) return null
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const shownTotal = filtered.reduce((s, tx) => s + cashFlowOf(tx), 0)

  const keyOf = (tx, i) => tx.id || i

  // La fila que se está corrigiendo. El editor NO se ancla a ella: los dos
  // layouts (tarjetas y tabla) viven en el DOM al mismo tiempo, así que un
  // popover por fila se montaba dos veces, y además la lista tiene scroll en
  // ambos ejes, que lo recortaba y arrastraba las filas de lado al abrirlo
  // (medido en un teléfono: la descripción se salía de pantalla).
  //
  // En su lugar se monta UNA sola capa centrada, fuera de los dos contenedores
  // con scroll. Nada que recortar y nada que duplicar.
  const editingTx = editing == null ? null : filtered.find((tx, i) => keyOf(tx, i) === editing)



  // Sign and colour both follow the CASH FLOW, not the row's type: a refund is
  // an expense with a negative amount, so reading the type alone printed
  // "-Q-488.07" in the red of a purchase for money that came back.
  // Flujo está denominado en quetzales y sus totales suman el monto ya
  // convertido, así que ese es el número que manda. Lo que faltaba es decir
  // cuándo el cobro NO fue en quetzales: un cargo de $200 y uno de Q200 se
  // veían idénticos, con casi ocho veces de diferencia. El dato ya viajaba en
  // la fila (`_originalAmount`/`_originalCurrency`, y el CSV sí lo exporta):
  // solo la pantalla no lo miraba. Misma familia del bug que FASE FS arregló
  // en Patrimonio, en la superficie que aquella pasada no tocó.


  return (
    <div className="card p-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('Transacciones', 'Transactions')}</h3>
          {filtered.length > 0 && (
            <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {filtered.length} · {shownTotal >= 0 ? '+' : '-'}Q{fmt(Math.abs(shownTotal))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex bg-theme-base rounded-lg border border-glass-border text-xs shrink-0">
            {[
              { key: 'ALL', label: t('Todos', 'All') },
              { key: 'INCOME', label: t('Ingresos', 'Income') },
              { key: 'EXPENSE', label: t('Gastos', 'Expenses') },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className="px-3 py-1.5 transition-colors rounded-lg"
                style={filter === f.key ? { backgroundColor: 'var(--accent-blue)', color: '#ffffff' } : { color: 'var(--text-secondary)' }}>
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('Buscar...', 'Search...')}
            className="px-3 py-1.5 bg-theme-base border border-glass-border rounded-lg text-xs focus:outline-none focus:border-blue-500/50 w-full sm:w-36"
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>{t('Sin transacciones', 'No transactions')}</p>
      ) : (
        <>
          {/* Phone: one card per row, nothing to reach sideways for. */}
          <div className="sm:hidden max-h-96 overflow-y-auto divide-y" style={{ borderColor: 'var(--card-border)' }}>
            {filtered.map((tx, i) => (
              <div key={keyOf(tx, i)} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}><Description tx={tx} t={t} /></p>
                  <div className="flex items-center gap-2 mt-1 text-xs min-w-0">
                    <span className="font-mono tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {formatFinanceDate(tx.date)}{timeOf(tx) ? ` ${timeOf(tx)}` : ''}
                    </span>
                    <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>·</span>
                    <CategoryCell tx={tx} i={i} onRecategorize={onRecategorize} setEditing={setEditing} keyOf={keyOf} t={t} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Amount tx={tx} t={t} fmt={fmt} />
                  <span className="text-xs"><DeleteButton tx={tx} i={i} onDelete={onDelete} confirming={confirming} setConfirming={setConfirming} keyOf={keyOf} t={t} /></span>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden sm:block max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-glass-border sticky top-0 bg-theme-card" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left py-2 px-2 font-normal">{t('Fecha', 'Date')}</th>
                  <th className="text-left py-2 px-2 font-normal">{t('Descripción', 'Description')}</th>
                  <th className="text-left py-2 px-2 font-normal">{t('Categoría', 'Category')}</th>
                  <th className="text-right py-2 px-2 font-normal">{t('Monto', 'Amount')}</th>
                  <th className="text-center py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx, i) => (
                  <tr key={keyOf(tx, i)} className="border-b border-glass-border/50 hover:bg-theme-elevated">
                    <td className="py-2 px-2 font-mono tabular-nums whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      {formatFinanceDate(tx.date)}
                      {/* Espacio de verdad, no solo un margen: si no, copiar la
                          celda o leerla con lector de pantalla da "2026-08-0320:32". */}
                      {timeOf(tx) && <span className="opacity-70">{' '}{timeOf(tx)}</span>}
                    </td>
                    <td className="py-2 px-2 max-w-[200px] truncate" style={{ color: 'var(--text-primary)' }}>
                      <Description tx={tx} t={t} />
                    </td>
                    <td className="py-2 px-2 max-w-[160px]"><CategoryCell tx={tx} i={i} onRecategorize={onRecategorize} setEditing={setEditing} keyOf={keyOf} t={t} /></td>
                    <td className="py-2 px-2 text-right"><Amount tx={tx} t={t} fmt={fmt} /></td>
                    <td className="py-2 px-2 text-center"><DeleteButton tx={tx} i={i} onDelete={onDelete} confirming={confirming} setConfirming={setConfirming} keyOf={keyOf} t={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editingTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null) }}
        >
          <CategoryEditor
            tx={editingTx}
            lang={lang}
            onCancel={() => setEditing(null)}
            onApply={(category, label) => { onRecategorize(editingTx, category, label); setEditing(null) }}
          />
        </div>
      )}
    </div>
  )
}
