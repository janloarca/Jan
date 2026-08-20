'use client'

import { useState } from 'react'
import AddAccountModal from '../AddAccountModal'

/**
 * Primeros pasos de un usuario nuevo: le PREGUNTAMOS qué tiene y después lo
 * acompañamos activo por activo, uno a la vez, hasta que decida seguir solo.
 *
 * Por qué preguntar primero en vez de suponer: sin la lista, el total es
 * desconocido y lo único que se puede mostrar es un contador ciego. Con la
 * lista, el progreso es real ("2 de 4") y el recorrido solo pasa por lo que el
 * usuario dijo que tiene, en vez de pasearlo por ocho tipos de activo que no
 * le tocan.
 *
 * Este componente NO escribe nada: monta AddAccountModal en modo guiado, que
 * usa el mismo handleSubmit de siempre (y con él el depósito de apertura de la
 * lógica congelada). Acá solo vive la secuencia.
 */

const CATEGORIES = [
  { key: 'Stock', icon: '📈', es: 'Acciones', en: 'Stocks' },
  { key: 'Crypto', icon: '₿', es: 'Cripto', en: 'Crypto' },
  { key: 'Fund', icon: '💼', es: 'Fondos o ETFs', en: 'Funds or ETFs' },
  { key: 'Bank', icon: '🏦', es: 'Cuenta de banco', en: 'Bank account' },
  { key: 'Bond', icon: '🏛', es: 'Bonos o plazo fijo', en: 'Bonds or fixed term' },
  { key: 'RealEstate', icon: '🏠', es: 'Inmuebles', en: 'Real estate' },
  { key: 'Alternative', icon: '🔮', es: 'Inversiones privadas', en: 'Private investments' },
  { key: 'Debt', icon: '💳', es: 'Deudas', en: 'Debts' },
  // No es un tipo de activo: es un atajo. Si tiene cuenta en un broker,
  // teclear posición por posición sería absurdo cuando la app ya sabe
  // sincronizar. Lo manda al flujo de conexión que ya existe.
  { key: 'broker', icon: '🔗', es: 'Cuenta en un broker', en: 'A broker account', isBroker: true },
]

export default function GuidedSetup({
  onClose, onAdd, onAddTransaction, onAddLot, onCreateDestination,
  existingItems = [], activePortfolio, activeEntity = 'default', lang = 'es',
  onConnectBroker,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [phase, setPhase] = useState('checklist') // checklist | asset | done
  const [picked, setPicked] = useState([])
  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(0)
  const [addedCount, setAddedCount] = useState(0)

  const toggle = (key) =>
    setPicked(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))

  const start = () => {
    // El orden de CATEGORIES manda, no el orden en que fue tocando: así el
    // recorrido es predecible y el broker (que es un atajo, no un activo)
    // siempre queda al final.
    const ordered = CATEGORIES.filter(c => picked.includes(c.key)).map(c => c.key)
    if (ordered.length === 0) return
    setQueue(ordered)
    setIndex(0)
    setPhase('asset')
  }

  const advance = () => {
    if (index < queue.length - 1) { setIndex(index + 1); return }
    setPhase('done')
  }

  const current = queue[index]
  const currentCat = CATEGORIES.find(c => c.key === current)

  // ---------- Pantalla 1: qué tenés ----------
  if (phase === 'checklist') {
    return (
      <Shell onClose={onClose}>
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary,white)' }}>
              {t('¿Qué tienes?', 'What do you have?')}
            </h2>
            <p className="text-sm mt-2" style={{ color: 'var(--text-secondary,#94a3b8)' }}>
              {t('Marca todo lo que aplique. Vamos a ir uno por uno, y siempre puedes agregar más después.',
                 'Check everything that applies. We will go one at a time, and you can always add more later.')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map(c => {
              const on = picked.includes(c.key)
              return (
                <button key={c.key} type="button" onClick={() => toggle(c.key)}
                  className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm text-left transition-colors"
                  style={{
                    border: `1px solid ${on ? 'var(--accent-blue)' : 'var(--card-border,#38383A)'}`,
                    background: on ? 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' : 'transparent',
                    color: 'var(--text-primary,white)',
                  }}>
                  <span className="text-lg shrink-0">{c.icon}</span>
                  <span className="min-w-0">{t(c.es, c.en)}</span>
                </button>
              )
            })}
          </div>

          <button type="button" onClick={start} disabled={picked.length === 0}
            className="w-full px-4 py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ background: 'var(--accent-blue)', color: '#ffffff' }}>
            {picked.length === 0
              ? t('Marca al menos uno', 'Check at least one')
              : t(`Empezar (${picked.length})`, `Start (${picked.length})`)}
          </button>

          <button type="button" onClick={onClose}
            className="w-full text-xs py-1" style={{ color: 'var(--text-muted,#475569)' }}>
            {t('Ya lo hago yo', 'I will take it from here')}
          </button>
        </div>
      </Shell>
    )
  }

  // ---------- Pantalla 2: el atajo del broker ----------
  if (phase === 'asset' && currentCat?.isBroker) {
    return (
      <Shell onClose={onClose}>
        <div className="p-6 space-y-5">
          <Progress items={queue} index={index} />
          <div>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary,white)' }}>
              {t('Conectemos tu broker', 'Let us connect your broker')}
            </h2>
            <p className="text-sm mt-2" style={{ color: 'var(--text-secondary,#94a3b8)' }}>
              {t('Así no tienes que teclear posición por posición: las traemos nosotros y se mantienen al día solas.',
                 'That way you do not have to type position by position: we bring them in and keep them up to date.')}
            </p>
          </div>
          <button type="button" onClick={() => { onConnectBroker?.(); onClose() }}
            className="w-full px-4 py-3 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent-blue)', color: '#ffffff' }}>
            {t('Elegir mi broker', 'Pick my broker')}
          </button>
          <button type="button" onClick={advance}
            className="w-full text-xs py-1" style={{ color: 'var(--text-muted,#475569)' }}>
            {t('Ahora no', 'Not now')}
          </button>
        </div>
      </Shell>
    )
  }

  // ---------- Pantalla 2: un activo ----------
  if (phase === 'asset') {
    return (
      <AddAccountModal
        // Remonta por posición: cada activo arranca con el formulario limpio.
        key={`${current}-${index}`}
        guidedType={current}
        guidedProgress={{ items: queue, index }}
        onSaved={() => { setAddedCount(c => c + 1); advance() }}
        onExitGuided={onClose}
        onClose={onClose}
        onAdd={onAdd}
        onAddTransaction={onAddTransaction}
        onAddLot={onAddLot}
        onCreateDestination={onCreateDestination}
        existingItems={existingItems}
        activePortfolio={activePortfolio}
        activeEntity={activeEntity}
        lang={lang}
      />
    )
  }

  // ---------- Pantalla 3: cierre ----------
  return (
    <Shell onClose={onClose}>
      <div className="p-6 space-y-5 text-center">
        <div className="text-4xl">🎉</div>
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary,white)' }}>
            {addedCount > 0
              ? t(`Listo: ${addedCount} ${addedCount === 1 ? 'cuenta agregada' : 'cuentas agregadas'}`,
                  `Done: ${addedCount} ${addedCount === 1 ? 'account added' : 'accounts added'}`)
              : t('Cuando quieras', 'Whenever you want')}
          </h2>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary,#94a3b8)' }}>
            {t('De aquí en adelante lo haces desde el botón "Nuevo", arriba a la derecha. Si dejaste algún dato pendiente, Chispu te lo va a ir pidiendo.',
               'From here on you do it from the "New" button, top right. If you left anything out, Chispu will ask you for it.')}
          </p>
        </div>
        <button type="button" onClick={() => { setPicked([]); setPhase('checklist') }}
          className="w-full px-4 py-3 rounded-xl text-sm font-semibold"
          style={{ background: 'var(--accent-blue)', color: '#ffffff' }}>
          {t('Agregar algo más', 'Add something else')}
        </button>
        <button type="button" onClick={onClose}
          className="w-full px-4 py-3 rounded-xl text-sm font-medium"
          style={{ color: 'var(--text-secondary,#94a3b8)', border: '1px solid var(--card-border,#38383A)' }}>
          {t('Ir a mi portafolio', 'Go to my portfolio')}
        </button>
      </div>
    </Shell>
  )
}

function Progress({ items, index }) {
  return (
    <div className="flex items-center gap-2">
      {items.map((it, i) => (
        <div key={it + i} className="h-1 rounded-full flex-1"
          style={{ background: i < index ? 'var(--accent-blue)' : i === index ? 'color-mix(in srgb, var(--accent-blue) 45%, transparent)' : 'var(--card-border,#38383A)' }} />
      ))}
    </div>
  )
}

function Shell({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)' }}>
      <div className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
