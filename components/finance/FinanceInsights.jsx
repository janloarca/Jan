'use client'

import { INCOME_GROUPS } from '@/lib/financeCategories'

// The month's control center: completeness status + email-reminder opt-in,
// structured income (fixed / side hustle / investments-read-only / other),
// group comparison vs last month & same month last year, and the insight feed
// from lib/financeMonth. All colors inline (CLAUDE.md).

const fmtQ = (n) => `Q${(Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

const STATUS_META = {
  empty: { es: 'Sin llenar', en: 'Not filled', color: 'var(--alert-error-icon)', bg: 'var(--alert-error-bg)', border: 'var(--alert-error-border)', icon: '✗' },
  partial: { es: 'Parcial', en: 'Partial', color: 'var(--alert-warn-icon)', bg: 'var(--alert-warn-bg)', border: 'var(--alert-warn-border)', icon: '⚠' },
  complete: { es: 'Completo', en: 'Complete', color: 'var(--accent-green)', bg: 'var(--alert-success-bg)', border: 'var(--alert-success-border)', icon: '✓' },
}

const SEV_COLOR = { warn: 'var(--alert-warn-icon)', good: 'var(--accent-green)', info: 'var(--alert-info-icon)' }

export default function FinanceInsights({
  analysis, insights = [], investmentIncome, incomeByGroup = {}, lang = 'es',
  isCurrentMonth = false, daysLeft = 0, reminderEnabled = false, onToggleReminder,
  reminderEmail = '',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  if (!analysis) return null
  const status = STATUS_META[analysis.status] || STATUS_META.empty

  return (
    <div className="space-y-4">
      {/* ── Estado del mes + recordatorio ─────────────────────────────── */}
      <div className="bg-theme-card rounded-2xl border border-glass-border p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{ color: status.color, backgroundColor: status.bg, border: `1px solid ${status.border}` }}>
            {status.icon} {t(status.es, status.en)}
          </span>
          {isCurrentMonth && analysis.status !== 'complete' && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {daysLeft === 0
                ? t('Último día del mes: captura tus datos.', 'Last day of the month: log your data.')
                : daysLeft === 1
                  ? t('Queda 1 día para cerrar el mes.', '1 day left to close the month.')
                  : t(`Quedan ${daysLeft} días para cerrar el mes.`, `${daysLeft} days left to close the month.`)}
            </span>
          )}
        </div>
        {onToggleReminder && (
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <button type="button" onClick={onToggleReminder} role="switch" aria-checked={reminderEnabled}
              className="w-8 h-4 rounded-full transition-colors relative"
              style={{ backgroundColor: reminderEnabled ? 'var(--accent-blue)' : 'var(--card-border)' }}>
              <span className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${reminderEnabled ? 'left-4' : 'left-0.5'}`} />
            </button>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {t('Recordarme por correo si no he llenado el mes', 'Email me if I haven\'t filled the month')}
              {reminderEnabled && reminderEmail && (
                <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>→ {reminderEmail}</span>
              )}
            </span>
          </label>
        )}
      </div>

      {/* ── Ingresos estructurados ────────────────────────────────────── */}
      <div className="bg-theme-card rounded-2xl border border-glass-border p-4">
        <h3 className="text-sm font-semibold text-white mb-3">{t('Ingresos del mes', 'This month\'s income')}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {INCOME_GROUPS.map((g) => {
            const isAuto = g.autoOnly
            const amount = isAuto ? (investmentIncome?.total || 0) : (incomeByGroup[g.key] || 0)
            return (
              <div key={g.key} className="rounded-xl p-3 border"
                style={{ borderColor: isAuto ? 'var(--alert-info-border)' : 'var(--card-border)', backgroundColor: isAuto ? 'var(--alert-info-bg)' : 'transparent' }}>
                <p className="text-xs mb-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  {g.icon} {t(g.label, g.labelEn)}
                  {isAuto && (
                    <span className="text-[10px] px-1 py-0.5 rounded" style={{ color: 'var(--alert-info-icon)', backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)' }}
                      title={t('Se calcula solo, de los dividendos e intereses de tu portafolio. No se captura aquí.', 'Computed automatically from your portfolio\'s dividends and interest. Not entered here.')}>
                      auto
                    </span>
                  )}
                </p>
                <p className="text-sm font-bold font-mono tabular-nums text-white">{fmtQ(amount)}</p>
                {isAuto && investmentIncome?.count > 0 && (
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {investmentIncome.count} {t('pagos del portafolio', 'portfolio payments')}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Comparativa por grupo (MoM / YoY) ─────────────────────────── */}
      {analysis.groups.length > 0 && (
        <div className="bg-theme-card rounded-2xl border border-glass-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">{t('Gastos por grupo', 'Spending by group')}</h3>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {[analysis.prev && t('vs mes pasado', 'vs last month'), analysis.yoy && `vs ${analysis.yoy.key}`]
                .filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="space-y-2">
            {[...analysis.groups].sort((a, b) => b.amount - a.amount).map((g) => {
              const max = Math.max(...analysis.groups.map((x) => x.amount), 1)
              return (
                <div key={g.key}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span style={{ color: 'var(--text-secondary)' }}>{g.icon} {t(g.label, g.labelEn)}</span>
                    <span className="font-mono tabular-nums flex items-center gap-2">
                      <span className="text-white font-medium">{fmtQ(g.amount)}</span>
                      {g.momPct != null && (
                        <span style={{ color: g.momPct > 5 ? 'var(--alert-warn-icon)' : g.momPct < -5 ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {g.momPct >= 0 ? '↑' : '↓'}{Math.abs(g.momPct).toFixed(0)}%
                        </span>
                      )}
                      {g.yoyPct != null && (
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }} title={t('vs mismo mes del año pasado', 'vs same month last year')}>
                          ({g.yoyPct >= 0 ? '+' : ''}{g.yoyPct.toFixed(0)}% YoY)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--fill-secondary, rgba(100,116,139,0.2))' }}>
                    <div className="h-full rounded-full" style={{ width: `${(g.amount / max) * 100}%`, backgroundColor: g.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Insights ──────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div className="bg-theme-card rounded-2xl border border-glass-border p-4">
          <h3 className="text-sm font-semibold text-white mb-2">{t('Insights del mes', 'Monthly insights')}</h3>
          <ul className="space-y-1.5">
            {insights.map((ins, i) => (
              <li key={i} className="text-xs flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                <span className="mt-0.5 shrink-0" style={{ color: SEV_COLOR[ins.severity] || 'var(--text-muted)' }}>●</span>
                {lang === 'es' ? ins.textEs : ins.textEn}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
