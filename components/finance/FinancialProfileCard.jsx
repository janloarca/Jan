'use client'

// The financial profile used to hide in a Settings tab where nobody found it.
// It lives HERE now, on the finances page: visible, glanceable when collapsed,
// and stamped with its age — the world changes and this data must keep up.

import { useState } from 'react'
import BusyLabel from '@/components/ui/BusyLabel'

const fmtQ = (n) => `Q${Math.round(n || 0).toLocaleString()}`

function profileAge(updatedAt, t) {
  if (!updatedAt) return null
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (!isFinite(days) || days < 0) return null
  if (days === 0) return t('actualizado hoy', 'updated today')
  if (days === 1) return t('actualizado ayer', 'updated yesterday')
  if (days < 60) return t(`actualizado hace ${days} días`, `updated ${days} days ago`)
  const months = Math.floor(days / 30)
  return t(`actualizado hace ${months} meses`, `updated ${months} months ago`)
}

export default function FinancialProfileCard({ profile, onSaveProfile, analysis, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [form, setForm] = useState({
    monthlyIncome: profile?.monthlyIncome || '',
    monthlyExpenses: profile?.monthlyExpenses || '',
    monthlySavings: profile?.monthlySavings || '',
    age: profile?.age || '',
    retirementAge: profile?.retirementAge || '',
    emergencyMonths: profile?.emergencyMonths || 6,
    incomeGoal: profile?.incomeGoal || '',
    portfolioGoal: profile?.portfolioGoal || '',
    targetYear: profile?.targetYear || '',
    riskTolerance: profile?.riskTolerance || 'moderate',
  })

  // FASE KB. El perfil financiero tiene su PROPIO reloj. `saveProfile` estampa
  // `updatedAt` en cada escritura del doc, y ese doc también guarda el nombre,
  // así que guardar un nombre (desde Amigos, o desde el campo nuevo de Ajustes)
  // reiniciaba esta fecha: el perfil quedaba como recién revisado sin serlo, y
  // el aviso de los 90 días no volvía a sonar nunca.
  //
  // El respaldo a `updatedAt` importa: quien ya tiene perfil guardado solo
  // tiene esa fecha, y sin el fallback su rótulo diría "nunca revisado" de
  // golpe. Se corrige solo en el primer guardado del perfil.
  const financialTs = profile?.financialUpdatedAt || profile?.updatedAt
  const age = profileAge(financialTs, t)
  // Nudge when the profile has gone stale — this data is time-sensitive.
  const isStale = financialTs
    ? Date.now() - new Date(financialTs).getTime() > 90 * 86400000
    : false
  const isEmpty = !profile?.monthlyIncome && !profile?.monthlyExpenses

  const RISK_LABEL = {
    conservative: t('Conservador', 'Conservative'),
    moderate: t('Moderado', 'Moderate'),
    aggressive: t('Agresivo', 'Aggressive'),
  }

  const handleSave = async () => {
    if (!onSaveProfile) return
    setSaving(true)
    try {
      const data = {}
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'riskTolerance') { data[k] = v; return }
        if (v !== '' && v != null) data[k] = Number(v)
      })
      // El reloj de frescura de ESTE perfil, movido solo por ESTE formulario.
      data.financialUpdatedAt = new Date().toISOString()
      await onSaveProfile(data)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
      setOpen(false)
    } catch { /* keep the form open so nothing is lost */ }
    setSaving(false)
  }

  const FIELDS = [
    { key: 'monthlyIncome', label: t('Ingreso mensual', 'Monthly income'), placeholder: '5000', hint: analysis?.income > 0 ? t(`Este mes registraste ${fmtQ(analysis.income)}`, `This month you logged ${fmtQ(analysis.income)}`) : null },
    { key: 'monthlyExpenses', label: t('Gastos mensuales', 'Monthly expenses'), placeholder: '3000', hint: analysis?.expenses > 0 ? t(`Este mes registraste ${fmtQ(analysis.expenses)}`, `This month you logged ${fmtQ(analysis.expenses)}`) : null },
    { key: 'monthlySavings', label: t('Ahorro mensual', 'Monthly savings'), placeholder: '1000' },
    { key: 'age', label: t('Edad', 'Age'), placeholder: '30' },
    { key: 'retirementAge', label: t('Edad de retiro', 'Retirement age'), placeholder: '60' },
    { key: 'emergencyMonths', label: t('Meses de emergencia', 'Emergency months'), placeholder: '6' },
    { key: 'incomeGoal', label: t('Meta ingreso pasivo/mes', 'Passive income goal/mo'), placeholder: '2000' },
    { key: 'portfolioGoal', label: t('Meta de portafolio', 'Portfolio goal'), placeholder: '500000' },
    { key: 'targetYear', label: t('Año objetivo', 'Target year'), placeholder: '2030' },
  ]

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            👤 {t('Mi perfil financiero', 'My financial profile')}
            {savedFlash && <span className="text-xs font-medium" style={{ color: 'var(--accent-green)' }}>✓ {t('Guardado', 'Saved')}</span>}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: isStale ? 'var(--alert-warn-icon)' : 'var(--text-muted)' }}>
            {isEmpty
              ? t('Complétalo para recibir insights y proyecciones personalizadas.', 'Complete it to get personalized insights and projections.')
              : isStale
                ? t(`⚠ ${age || 'sin fecha'}: dale una revisada, el mundo cambia.`, `⚠ ${age || 'no date'}: give it a review, things change.`)
                : age || t('Alimenta las proyecciones y los insights.', 'Feeds projections and insights.')}
          </p>
        </div>
        <button onClick={() => setOpen(!open)}
          className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:bg-blue-500/10"
          style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
          {open ? t('Cerrar', 'Close') : isEmpty ? t('Completar', 'Complete') : t('Actualizar', 'Update')}
        </button>
      </div>

      {/* Collapsed glance: the numbers that matter, no clicks needed */}
      {!open && !isEmpty && (
        <div className="flex flex-wrap gap-2 mt-3">
          {profile?.monthlyIncome > 0 && (
            <span className="text-xs px-2 py-1 rounded-lg bg-theme-base border border-glass-border/60 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              💼 {fmtQ(profile.monthlyIncome)}/{t('mes', 'mo')}
            </span>
          )}
          {profile?.monthlyExpenses > 0 && (
            <span className="text-xs px-2 py-1 rounded-lg bg-theme-base border border-glass-border/60 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              💳 {fmtQ(profile.monthlyExpenses)}/{t('mes', 'mo')}
            </span>
          )}
          {profile?.portfolioGoal > 0 && (
            <span className="text-xs px-2 py-1 rounded-lg bg-theme-base border border-glass-border/60 font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              🎯 {fmtQ(profile.portfolioGoal)}{profile?.targetYear ? ` · ${profile.targetYear}` : ''}
            </span>
          )}
          <span className="text-xs px-2 py-1 rounded-lg bg-theme-base border border-glass-border/60" style={{ color: 'var(--text-secondary)' }}>
            {RISK_LABEL[profile?.riskTolerance] || RISK_LABEL.moderate}
          </span>
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {FIELDS.map((field) => (
              <div key={field.key}>
                <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">{field.label}</label>
                <input type="number" value={form[field.key]} onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 bg-theme-base border border-glass-border/60 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50" />
                {field.hint && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{field.hint}</p>}
              </div>
            ))}
          </div>

          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">{t('Tolerancia al riesgo', 'Risk tolerance')}</label>
            <div className="flex gap-2">
              {Object.entries(RISK_LABEL).map(([key, label]) => (
                <button key={key} onClick={() => setForm((p) => ({ ...p, riskTolerance: key }))}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    form.riskTolerance === key ? 'border' : 'bg-theme-base border border-glass-border text-slate-300 hover:border-slate-500'
                  }`}
                  style={form.riskTolerance === key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' } : undefined}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full py-2.5 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors text-sm font-medium" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
            {<BusyLabel busy={saving} lang={lang}>{t('Guardar perfil', 'Save profile')}</BusyLabel>}
          </button>
        </div>
      )}
    </div>
  )
}
