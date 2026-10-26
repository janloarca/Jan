'use client'

import { useState, useRef } from 'react'
import { Upload } from 'lucide-react'
import { parseBackup, planRestore } from '@/lib/backupRestore'
import BusyLabel from '@/components/ui/BusyLabel'

// Restaurar el JSON de "Exportar Backup": posiciones, lotes y transacciones.
// No toca snapshots ni configuración, y no pisa lo que ya existe hoy.
export default function RestoreBackupCard({ onRestore, lang = 'es', existing }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const inputRef = useRef(null)
  const [pending, setPending] = useState(null) // { data, counts }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { tone, text }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setMsg(null)
    const parsed = parseBackup(await file.text())
    if (parsed.error) {
      setPending(null)
      setMsg({ tone: 'error', text: t('Ese archivo no es un respaldo de Chispudo.', 'That file is not a Chispudo backup.') })
      return
    }
    const r = planRestore(parsed.data, existing)
    setPending({ data: parsed.data, plan: r })
  }

  const confirm = async () => {
    setBusy(true)
    try {
      const res = await onRestore(pending.data)
      setMsg({ tone: 'ok', text: t(`Listo: ${res.written} restaurados, ${res.skipped} ya existían.`, `Done: ${res.written} restored, ${res.skipped} already existed.`) })
      setPending(null)
    } catch (err) {
      setMsg({ tone: 'error', text: t('No se pudo restaurar. Tus datos actuales no se tocaron.', 'Could not restore. Your current data was not touched.') })
    } finally { setBusy(false) }
  }

  const c = pending?.plan.plan
  return (
    <div className="p-3.5 rounded-xl border space-y-3" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 18%, transparent)' }}>
            <Upload size={16} style={{ color: 'var(--accent-blue)' }} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('Restaurar backup', 'Restore backup')}</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('Sube el JSON de "Exportar Backup". Restaura posiciones, lotes y transacciones.', 'Upload the "Export Backup" JSON. Restores positions, lots and transactions.')}</div>
          </div>
        </div>
        <button onClick={() => inputRef.current?.click()} disabled={busy}
          className="shrink-0 px-3.5 py-2 text-xs font-semibold rounded-lg hover:opacity-90" style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
          {t('Elegir archivo', 'Choose file')}
        </button>
        <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
      </div>
      {pending && (
        <div className="text-xs space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <p>
            {t(`Se restaurarán ${c.items.length} posiciones, ${c.lots.length} lotes y ${c.transactions.length} transacciones.`,
               `Will restore ${c.items.length} positions, ${c.lots.length} lots and ${c.transactions.length} transactions.`)}
            {pending.plan.skipped > 0 && ' ' + t(`${pending.plan.skipped} ya existen y se dejan como están.`, `${pending.plan.skipped} already exist and are left as is.`)}
          </p>
          <p>{t('No se tocan tus snapshots ni tu configuración.', 'Your snapshots and settings are not touched.')}</p>
          <div className="flex gap-2">
            <button onClick={confirm} disabled={busy || pending.plan.toWrite === 0}
              className="px-3 py-1.5 font-semibold rounded-lg disabled:opacity-50" style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
              <BusyLabel busy={busy} lang={lang}>{t("Restaurar", "Restore")}</BusyLabel>
            </button>
            <button onClick={() => setPending(null)} disabled={busy} className="px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
              {t('Cancelar', 'Cancel')}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs" style={{ color: msg.tone === 'ok' ? 'var(--accent-green)' : 'var(--text-negative)' }}>{msg.text}</p>}
    </div>
  )
}
