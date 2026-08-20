'use client'

import { useMemo, useState } from 'react'
import { Trash2, Download } from 'lucide-react'
import BusyLabel from '@/components/ui/BusyLabel'
import { planFinanceWipe, monthsPresent, transportsPresent, methodOfTx } from '@/lib/financeWipe'
import { financeBackupCsv, downloadCsv } from '@/lib/financeCsv'

// Borrado selectivo del historial de Flujo, por mes y por método de captura.
//
// Vive en su propio archivo (y no inline en SettingsModal) para poder montarlo
// solo en una prueba: verificar un borrado con props hechos a mano en vez del
// componente real es el atajo que ya dejó pasar un crash en producción.
//
// Tres decisiones que gobiernan la pantalla:
//
//   · La VISTA PREVIA sale de la misma función que resuelve los ids. Si fueran
//     dos, el número que ves y el número que desaparece podrían discrepar, y en
//     una acción irreversible ese es el error que no se puede cometer.
//   · El respaldo se ofrece ANTES de borrar, no como consuelo después. Lo
//     capturado por el atajo o el correo NO vuelve solo (el correo ya quedó
//     marcado leído), así que sin archivo ese borrado es definitivo.
//   · Los transportes de la captura automática se ofrecen solo cuando hay más
//     de uno en los datos: con un solo teléfono conectado serían tres botones
//     para una distinción que los datos no pueden hacer.

const MONTH_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// 'YYYY-MM' a "Julio 2026", por recorte de texto: new Date() sobre esa cadena
// la lee como UTC y al oeste de UTC puede caer en el mes anterior.
function monthLabel(key, lang) {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return key
  const names = lang === 'es' ? MONTH_ES : MONTH_EN
  return `${names[Number(m[2]) - 1]} ${m[1]}`
}

const TRANSPORT_LABEL = {
  shortcut: { es: 'Atajo de iPhone', en: 'iPhone shortcut' },
  email: { es: 'Correo reenviado', en: 'Forwarded email' },
  android: { es: 'Android', en: 'Android' },
}

export default function FinanceWipePanel({
  transactions = [],
  onDeleteByIds,
  onDeleteAll,
  lang = 'es',
  onDone,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [month, setMonth] = useState('all')
  const [method, setMethod] = useState('all')
  const [transport, setTransport] = useState(null)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const months = useMemo(() => monthsPresent(transactions), [transactions])
  const transports = useMemo(() => transportsPresent(transactions), [transactions])
  const plan = useMemo(
    () => planFinanceWipe(transactions, { month, method, transport }),
    [transactions, month, method, transport],
  )

  // Cambiar cualquier filtro desarma el confirm: si no, se podría armar sobre
  // 3 filas, mover el filtro a 900 y confirmar sin volver a leer el número.
  const setFilter = (fn) => { setArmed(false); setError(''); fn() }

  const methods = [
    { key: 'all', label: t('Todo', 'Everything') },
    { key: 'auto', label: t('Captura automática', 'Automatic capture') },
    { key: 'statement', label: t('Estados de cuenta', 'Statements') },
    { key: 'manual', label: t('Manual', 'Manual') },
  ]

  const fmtTotal = () => plan.totals
    .map((x) => `${x.currency === 'USD' ? '$' : x.currency === 'GTQ' ? 'Q' : `${x.currency} `}${Math.abs(x.amount).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(' · ')

  const backup = () => {
    downloadCsv(
      financeBackupCsv(plan.rows, { methodOf: methodOfTx }),
      `chispudo-flujo-respaldo-${month === 'all' ? 'todo' : month}-${method}.csv`,
    )
  }

  const run = async (withBackup) => {
    if (plan.count === 0) return
    if (!armed) { setArmed(true); return }
    setBusy(withBackup ? 'backup' : 'delete')
    setError('')
    try {
      // El archivo primero: si el borrado falla a mitad, el respaldo ya está
      // en el disco del usuario. Al revés no sirve de nada.
      if (withBackup) backup()
      // Cuando el filtro abarca todo, una operación de colección en vez de
      // cientos de deletes.
      if (plan.isEverything && onDeleteAll) await onDeleteAll()
      else await onDeleteByIds(plan.ids)
      setArmed(false)
      if (onDone) onDone(plan.count)
    } catch (e) {
      setError(e?.message || t('Error al borrar', 'Error deleting'))
    } finally {
      setBusy(null)
    }
  }

  const chip = (active) => ({
    backgroundColor: active ? 'var(--accent-blue)' : 'transparent',
    color: active ? '#ffffff' : 'var(--text-secondary)',
    borderColor: active ? 'var(--accent-blue)' : 'var(--card-border)',
  })

  return (
    <div className="p-3 bg-theme-base border border-glass-border rounded-lg" data-testid="finance-wipe">
      <div className="flex items-start gap-2 mb-3">
        <Trash2 size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {t('Eliminar finanzas', 'Delete finance data')}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('Ingresos y gastos personales. Podés acotar por mes y por cómo entraron.',
               'Personal income and expenses. You can narrow it by month and by how they came in.')}
          </div>
        </div>
      </div>

      <label className="block text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
        {t('Mes', 'Month')}
      </label>
      <select
        value={month}
        onChange={(e) => setFilter(() => setMonth(e.target.value))}
        aria-label={t('Mes', 'Month')}
        className="w-full mb-3 px-2 py-1.5 text-sm rounded-lg border bg-theme-card"
        style={{ color: 'var(--text-primary)', borderColor: 'var(--card-border)' }}>
        <option value="all">{t(`Todos los meses (${transactions.length})`, `All months (${transactions.length})`)}</option>
        {/* Solo meses que EXISTEN: ofrecer uno vacío es ofrecer una acción que
            no hace nada. */}
        {months.map((m) => (
          <option key={m.month} value={m.month}>{monthLabel(m.month, lang)} · {m.count}</option>
        ))}
      </select>

      <label className="block text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
        {t('Cómo entraron', 'How they came in')}
      </label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {methods.map((m) => (
          <button key={m.key} type="button"
            onClick={() => setFilter(() => { setMethod(m.key); setTransport(null) })}
            className="px-2.5 py-1 text-xs rounded-lg border transition-colors"
            style={chip(method === m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Los transportes aparecen SOLO con más de uno en los datos: con un solo
          teléfono conectado no hay nada que separar. */}
      {method === 'auto' && transports.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-2 pl-2 border-l" style={{ borderColor: 'var(--card-border)' }}>
          <button type="button" onClick={() => setFilter(() => setTransport(null))}
            className="px-2 py-0.5 text-[11px] rounded-md border transition-colors"
            style={chip(transport === null)}>
            {t('Todos', 'All')}
          </button>
          {transports.map((x) => (
            <button key={x.transport} type="button" onClick={() => setFilter(() => setTransport(x.transport))}
              className="px-2 py-0.5 text-[11px] rounded-md border transition-colors"
              style={chip(transport === x.transport)}>
              {TRANSPORT_LABEL[x.transport]?.[lang === 'es' ? 'es' : 'en'] || x.transport} · {x.count}
            </button>
          ))}
        </div>
      )}

      {/* La vista previa. Un borrado filtrado sin conteo es un volado; con el
          conteo, un número inesperado ES el diagnóstico de que el filtro no
          dice lo que creías. */}
      <div className="text-xs mb-2 py-2 px-2 rounded-lg" data-testid="wipe-preview"
        style={{ backgroundColor: 'var(--bg-card-hover)', color: 'var(--text-secondary)' }}>
        {plan.count === 0
          ? t('No hay movimientos con ese filtro.', 'No movements match that filter.')
          : (
            <>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {plan.count === 1
                  ? t('Se borrará 1 movimiento', '1 movement will be deleted')
                  : t(`Se borrarán ${plan.count} movimientos`, `${plan.count} movements will be deleted`)}
              </span>
              {plan.totals.length > 0 && <span> · {fmtTotal()}</span>}
            </>
          )}
      </div>

      {/* El reflejo equivocado que esta pantalla podría reforzar: borrar un mes
          entero por una categoría mal puesta. Reclasificar arregla eso sin
          borrar nada. */}
      {method === 'statement' && plan.count > 0 && (
        <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
          {t('¿Solo está mal la categoría? Usá Reclasificar en Flujo, no hace falta borrar.',
             'Only the category is wrong? Use Reclassify in Flujo, no need to delete.')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => run(true)} disabled={plan.count === 0 || busy}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ color: 'var(--text-primary)', borderColor: 'var(--card-border)' }}>
          <BusyLabel busy={busy === 'backup'} lang={lang} busyLabel={t('Borrando…', 'Deleting…')}>
            <span className="inline-flex items-center gap-1.5"><Download size={12} />{armed ? t('Confirmar y descargar', 'Confirm and download') : t('Descargar y borrar', 'Download and delete')}</span>
          </BusyLabel>
        </button>
        <button type="button" onClick={() => run(false)} disabled={plan.count === 0 || busy}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border inline-flex items-center gap-1.5 disabled:opacity-50"
          style={armed
            ? { backgroundColor: 'var(--text-negative)', color: '#ffffff', borderColor: 'var(--text-negative)' }
            : { color: 'var(--text-negative)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <BusyLabel busy={busy === 'delete'} lang={lang} busyLabel={t('Borrando…', 'Deleting…')}>
            {armed ? t('Confirmar', 'Confirm') : t('Borrar', 'Delete')}
          </BusyLabel>
        </button>
      </div>

      <div className="overflow-hidden transition-all duration-200 ease-out"
        style={{ maxHeight: armed ? 60 : 0, opacity: armed ? 1 : 0 }}>
        <div className="text-xs mt-2 font-medium" style={{ color: 'var(--alert-warn-icon)' }}>
          {/* Cada método vuelve (o no) por su cuenta, y la diferencia importa
              antes de confirmar, no después. */}
          {method === 'statement'
            ? t('No se puede deshacer. Vuelven si re-importás el mismo estado de cuenta.',
                 'This cannot be undone. They come back if you re-import the same statement.')
            : t('No se puede deshacer. Lo capturado por el atajo o el correo NO vuelve solo.',
                 'This cannot be undone. What the shortcut or email captured does NOT come back on its own.')}
        </div>
      </div>

      {error && <div className="text-xs mt-2" style={{ color: 'var(--text-negative)' }}>{error}</div>}
    </div>
  )
}
