'use client'

import { useState, useMemo } from 'react'
import { formatCurrency, getTypeCategory, TYPE_COLORS, getItemValue, categoryLabel } from './utils'
import ConfirmTap from '@/components/ui/ConfirmTap'
import AmountInput from '@/components/ui/AmountInput'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { parseAmount } from '@/lib/numberParse'
import { contributionPlan, sellCandidates, fundOverlap, EXAMPLE_INSTRUMENTS } from '@/lib/rebalancePlan'

const DEFAULT_TARGETS = {
  stocks: 40, crypto: 10, funds: 20, bonds: 15, banks: 5, realestate: 5, alternatives: 5,
}

export default function RebalanceSuggestions({ items, netWorth, goals, onSaveGoals, lang, onDismiss, lots }) {
  const t = (es, en) => lang === 'es' ? es : en
  const [editing, setEditing] = useState(false)
  // FASE RQ: rebalancear vendiendo, o solo con aportes nuevos (sin vender).
  const [mode, setMode] = useState('sell')
  const [newMoney, setNewMoney] = useState('')

  const usingDefaultTargets = !goals?.allocationTargets
  const targets = goals?.allocationTargets || DEFAULT_TARGETS
  // El form NO se siembra en el mount: `goals` llega async, así que sembrarlo
  // una sola vez lo dejaba con los DEFAULTS de fábrica aunque el usuario ya
  // tuviera su plan guardado — abrir Editar y tocar Guardar PISABA el plan real
  // con 40/20/15/10/5 sin ninguna señal. Se siembra al ABRIR el editor, desde
  // lo guardado en ese momento (mismo patrón re-seed de SettingsModal, FASE MW).
  const [form, setForm] = useState({ ...DEFAULT_TARGETS, ...targets })
  const openEditor = () => {
    setForm({ ...DEFAULT_TARGETS, ...(goals?.allocationTargets || DEFAULT_TARGETS) })
    setEditing(true)
  }

  const allocation = useMemo(() => {
    const cats = {}
    // FASE RL. La vivienda no entra al rebalanceo: no se "vende" para cumplir un objetivo.
    const assetItems = items.filter((it) => !it.isDebt && getTypeCategory(it) !== 'realestate')
    const totalAssets = assetItems.reduce((s, it) => s + Math.max(0, getItemValue(it)), 0)

    assetItems.forEach((it) => {
      const cat = getTypeCategory(it)
      const val = Math.max(0, getItemValue(it))
      cats[cat] = (cats[cat] || 0) + val
    })

    const allCats = new Set([...Object.keys(cats), ...Object.keys(targets)])
    const result = []

    for (const cat of allCats) {
      if (cat === 'debts' || cat === 'other' || cat === 'realestate') continue
      const current = cats[cat] || 0
      const currentPct = totalAssets > 0 ? (current / totalAssets) * 100 : 0
      const targetPct = targets[cat] || 0
      const diff = currentPct - targetPct
      const diffValue = totalAssets > 0 ? (diff / 100) * totalAssets : 0

      result.push({ cat, current, currentPct, targetPct, diff, diffValue })
    }

    return { categories: result.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), totalAssets }
  }, [items, targets])

  const maxDrift = Math.max(...allocation.categories.map((c) => Math.abs(c.diff)), 0)
  const isBalanced = maxDrift < 5

  // FASE NB: el guardado se ESPERA y el editor solo se cierra si terminó bien.
  // Antes era disparar-y-cerrar: un fallo de red dejaba el editor cerrado con
  // los % nuevos en pantalla (estado local) mientras Firestore conservaba los
  // viejos, y en la próxima carga el plan "guardado" volvía solo al anterior.
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const formTotal = Object.values(form).reduce((s, v) => s + (v || 0), 0)
  const handleSave = async () => {
    if (saving || formTotal !== 100) return
    setSaveError('')
    setSaving(true)
    try {
      if (onSaveGoals) await onSaveGoals({ ...goals, allocationTargets: form })
      setEditing(false)
    } catch {
      setSaveError(t('No se pudo guardar. Revisa tu conexión e intenta de nuevo.',
        'Could not save. Check your connection and try again.'))
    } finally {
      setSaving(false)
    }
  }

  const hasHome = items.some((it) => !it.isDebt && getTypeCategory(it) === 'realestate')
  return (
    <div className="card p-4 sm:p-5">
      {hasHome && (
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          {t('El rebalanceo mide solo tu portafolio invertible. Tu vivienda y su hipoteca se muestran aparte y nunca se sugiere venderlas.', 'Rebalancing covers only your investable portfolio. Your home and mortgage are shown separately and selling them is never suggested.')}
        </p>
      )}
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {t('REBALANCEO', 'REBALANCING')}
        </h3>
        <div className="flex items-center gap-2">
          {usingDefaultTargets && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
              title={t('Los % objetivo son los de fábrica (40/20/15/10/5…). El desvío y las sugerencias se calculan contra ellos: edítalos para que reflejen TU plan.', 'Target % are factory defaults (40/20/15/10/5…). Drift and suggestions are computed against them: edit to reflect YOUR plan.')}>
              {t('Objetivo por defecto', 'Default target')}
            </span>
          )}
          {isBalanced ? (
            <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              {t('Balanceado', 'Balanced')}
            </span>
          ) : (
            <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
              {t('Desvío', 'Drift')}: {maxDrift.toFixed(1)}%
            </span>
          )}
          <button onClick={() => (editing ? setEditing(false) : openEditor())}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
            {editing ? t('Cancelar', 'Cancel') : t('Editar', 'Edit')}
          </button>
          {/* FASE NC: dos toques. Esta × escondía la tarjeta ENTERA con un
              solo toque, para siempre y sin ningún camino de vuelta (la
              bandera solo se escribía, nadie ofrecía apagarla). Ahora confirma
              y el camino de vuelta existe en Ajustes → General. */}
          {onDismiss && (
            <ConfirmTap onConfirm={onDismiss}
              ariaLabel={t('Ocultar esta tarjeta', 'Hide this card')}
              confirmAriaLabel={t('Confirmar ocultar la tarjeta de rebalanceo', 'Confirm hiding the rebalancing card')}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
              confirmClassName="text-[11px] font-semibold whitespace-nowrap px-1.5 py-0.5 rounded"
              confirmStyle={{ color: 'var(--alert-warn-icon)', backgroundColor: 'var(--alert-warn-bg)' }}
              confirmContent={t('¿Ocultar? Vuelve en Ajustes', 'Hide? Restore in Settings')}>
              ✕
            </ConfirmTap>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          {allocation.categories.map((c) => (
            <div key={c.cat} className="flex items-center gap-2">
              <span className="text-xs text-slate-300 w-24">{categoryLabel(c.cat, lang)}</span>
              <input type="number" inputMode="numeric" min="0" max="100" step="5"
                value={form[c.cat] || 0}
                onChange={(e) => setForm({ ...form, [c.cat]: parseInt(e.target.value) || 0 })}
                className="w-16 px-2 py-1 text-xs bg-theme-base border border-glass-border rounded text-white text-center" />
              <span className="text-xs text-slate-500">%</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2">
            {(() => {
              const total = formTotal
              // Un plan que no suma 100 bloquea Guardar: un total de 60% o 161%
              // no es un plan y sus sugerencias saldrían contra un objetivo roto.
              return (
                <span className="text-xs" role={total !== 100 ? 'alert' : undefined} style={total === 100 ? { color: 'var(--text-muted)' } : { color: 'var(--alert-warn-icon)' }}>
                  {t('Total', 'Total')}: {total}%{total !== 100 ? ` · ${t('debe sumar 100 para guardar', 'must add to 100 to save')}` : ''}
                </span>
              )
            })()}
            <button onClick={handleSave} disabled={saving || formTotal !== 100}
              className="px-3 py-1.5 text-xs bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-60" style={{ color: '#ffffff' }}>
              {saving ? t('Guardando...', 'Saving...') : t('Guardar', 'Save')}
            </button>
          </div>
          {saveError && (
            <p className="text-xs" role="alert" style={{ color: 'var(--alert-warn-icon)' }}>{saveError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {allocation.categories.filter((c) => c.targetPct > 0 || c.currentPct > 1).map((c) => {
            const color = TYPE_COLORS[c.cat]?.bg || '#64748b'
            const isOver = c.diff > 2
            const isUnder = c.diff < -2
            return (
              <div key={c.cat}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300 capitalize flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    {categoryLabel(c.cat, lang)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{c.currentPct.toFixed(1)}%</span>
                    <span className="text-slate-600">/</span>
                    <span className="text-slate-400">{c.targetPct}%</span>
                    {(isOver || isUnder) && (
                      <span className="font-semibold font-mono tabular-nums px-1.5 py-0.5 rounded"
                        style={{ color: isOver ? 'var(--text-negative)' : 'var(--accent-green)', backgroundColor: isOver ? 'var(--alert-error-bg)' : 'var(--alert-success-bg)' }}>
                        {isOver ? '↑' : '↓'}{Math.abs(c.diff).toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-2 rounded-full overflow-hidden relative" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(c.currentPct, 100)}%`, backgroundColor: color }} />
                  {c.targetPct > 0 && (
                    <div className="absolute top-0 h-full w-0.5 opacity-50"
                      style={{ left: `${Math.min(c.targetPct, 100)}%`, backgroundColor: color }} />
                  )}
                </div>
              </div>
            )
          })}

          {!isBalanced && (
            <SegmentedTabs
              tabs={[{ key: 'sell', label: t('Vendiendo y comprando', 'Selling and buying') }, { key: 'contribute', label: t('Solo con aportes nuevos', 'With new money only') }]}
              value={mode} onChange={setMode} deps={[lang]} ariaLabel={t('Cómo rebalancear', 'How to rebalance')} className="pt-2"
            />
          )}
          {!isBalanced && mode === 'contribute' && (() => {
            const plan = contributionPlan(allocation.categories, allocation.totalAssets, parseAmount(newMoney))
            return (
              <div className="space-y-1.5 pt-1">
                <label className="text-xs flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                  {t('Monto a invertir', 'Amount to invest')}
                  <AmountInput value={newMoney} onChange={(e) => setNewMoney(e.target.value)} placeholder="0.00"
                    className="form-input w-32 text-xs" aria-label={t('Monto a invertir', 'Amount to invest')} />
                </label>
                {plan.allocations.map((a) => {
                  const own = items.filter((it) => !it.isDebt && getTypeCategory(it) === a.cat && it.symbol).sort((x, y) => getItemValue(y) - getItemValue(x))
                  const where = own.length ? own.slice(0, 2).map((it) => it.symbol).join(' o ') : (EXAMPLE_INSTRUMENTS[a.cat] || []).join(' / ')
                  return (
                    <div key={a.cat} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--alert-success-bg)' }}>
                      <span style={{ color: 'var(--accent-green)' }}>↑ {categoryLabel(a.cat, lang)}{where ? ` · ${own.length ? t('en', 'into') : t('ej.', 'e.g.')} ${where}` : ''}</span>
                      <span className="font-semibold font-mono tabular-nums" style={{ color: 'var(--accent-green)' }}>+{formatCurrency(a.amount)}</span>
                    </div>
                  )
                })}
                {plan.allocations.length > 0 && (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {plan.coversAll
                      ? t('Con este monto llegas al objetivo sin vender nada.', 'This amount reaches the target without selling anything.')
                      : t(`Para llegar al objetivo solo con aportes harían falta ${formatCurrency(plan.neededToBalance)}. Sin vender, no hay impuesto.`, `Reaching the target with new money alone would take ${formatCurrency(plan.neededToBalance)}. No selling, no tax.`)}
                  </p>
                )}
              </div>
            )
          })()}
          {!isBalanced && mode === 'sell' && (
            <div className="pt-2 border-t border-glass-border/30 space-y-1">
              {allocation.categories
                .filter((c) => Math.abs(c.diff) > 2 && c.targetPct > 0)
                .slice(0, 3)
                .map((c) => (
                  <div key={c.cat} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg"
                    style={{ backgroundColor: c.diff > 0 ? 'var(--alert-error-bg)' : 'var(--alert-success-bg)' }}>
                    <span className="font-medium" style={{ color: c.diff > 0 ? 'var(--text-negative)' : 'var(--accent-green)' }}>
                      {c.diff > 0
                        ? `↓ ${t('Reducir', 'Reduce')} ${categoryLabel(c.cat, lang)}`
                        : `↑ ${t('Aumentar', 'Increase')} ${categoryLabel(c.cat, lang)}`}
                    </span>
                    <span className="font-semibold font-mono tabular-nums" style={{ color: c.diff > 0 ? 'var(--text-negative)' : 'var(--accent-green)' }}>
                      {c.diff > 0 ? '-' : '+'}{formatCurrency(Math.abs(c.diffValue))}
                    </span>
                  </div>
                ))}
              {/* FASE RQ: con qué, y cuánto impuesto dispara vender cada lote. */}
              {allocation.categories.filter((c) => Math.abs(c.diff) > 2 && c.targetPct > 0).slice(0, 3).map((c) => {
                if (c.diff > 0) {
                  const cands = sellCandidates({ cat: c.cat, amount: Math.abs(c.diffValue), items, lots })
                  return cands.filter((x) => x.units > 0).slice(0, 1).map((x) => {
                    const lot = x.lots[0]
                    return (
                      <p key={'s' + c.cat} className="text-[11px] px-2.5" style={{ color: 'var(--text-muted)' }}>
                        {t(`Vender ~${x.units.toLocaleString(undefined, { maximumFractionDigits: 4 })} u. de ${x.item.symbol || x.item.name} (${formatCurrency(x.value)})`, `Sell ~${x.units.toLocaleString(undefined, { maximumFractionDigits: 4 })} units of ${x.item.symbol || x.item.name} (${formatCurrency(x.value)})`)}
                        {lot ? t(
                          ` · usar primero el lote del ${lot.since || '?'} (${lot.term === 'long' ? 'largo plazo' : 'corto plazo'}, ganancia ${formatCurrency(lot.gainPerUnit)}/u.): genera ganancia gravable según tu país.`,
                          ` · use the ${lot.since || '?'} lot first (${lot.term === 'long' ? 'long term' : 'short term'}, gain ${formatCurrency(lot.gainPerUnit)}/unit): it creates a taxable gain depending on your country.`,
                        ) : t(' · sin lotes registrados: no se puede estimar el impacto fiscal.', ' · no lots recorded: tax impact cannot be estimated.')}
                      </p>
                    )
                  })
                }
                const own = items.filter((it) => !it.isDebt && getTypeCategory(it) === c.cat && it.symbol)
                const where = own.length ? own.slice(0, 2).map((it) => it.symbol).join(' o ') : (EXAMPLE_INSTRUMENTS[c.cat] || []).join(' / ')
                return where ? (
                  <p key={'b' + c.cat} className="text-[11px] px-2.5" style={{ color: 'var(--text-muted)' }}>
                    {own.length ? t(`Comprar ${categoryLabel(c.cat, lang)}: sumar a ${where}.`, `Buy ${categoryLabel(c.cat, lang)}: add to ${where}.`) : t(`Comprar ${categoryLabel(c.cat, lang)}: por ejemplo ${where} (ejemplos de fondos amplios, no recomendación).`, `Buy ${categoryLabel(c.cat, lang)}: e.g. ${where} (broad-fund examples, not a recommendation).`)}
                  </p>
                ) : null
              })}
              <p className="text-[11px] px-2.5" style={{ color: 'var(--text-muted)' }}>
                {t('Vender realiza ganancias. Para no vender, usa "Solo con aportes nuevos".', 'Selling realizes gains. To avoid selling, use "With new money only".')}
              </p>
            </div>
          )}
          {fundOverlap(items).map((o) => (
            <p key={o.fund} className="text-[11px] pt-1" style={{ color: 'var(--text-muted)' }}>
              {t(`Exposición real: ${o.fund} ya incluye ${o.overlap.join(', ')}, que también tienes sueltas. Tu peso en esas empresas es mayor que el de sus posiciones individuales.`, `Real exposure: ${o.fund} already holds ${o.overlap.join(', ')}, which you also own directly. Your weight in those companies is higher than their individual positions.`)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
