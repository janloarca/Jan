'use client'

import { useState, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'

// El mes leído como un ESTADO DE RESULTADOS.
//
// Reemplaza a las dos cards de desglose (una por lado) más la tarjeta de
// resumen: eran tres superficies dibujando el mismo dinero sin ningún orden
// entre ellas. Acá se lee de arriba abajo como una derivación, que es lo que
// hace que un P&L se entienda sin que nadie lo explique con oraciones:
//
//     INGRESOS                    Q15,000   100%
//     - Compromisos (fijos)        6,200     41%   ↑2%
//     - Discrecional (variable)    3,800     25%   ↓18%
//     = RESULTADO DEL MES          5,000     33%
//
// Las tres columnas de la derecha tienen ANCHO FIJO a propósito: pegadas al
// monto, cada porcentaje terminaba en un píxel distinto por fila y la columna
// se leía dispareja aunque estuviera alineada (la lección de FASE IB2).

const COLS = 'minmax(0,1fr) 5.4rem 3rem 3.1rem'

function fmtQ(v, lang) {
  const n = Math.round((v || 0) * 100) / 100
  const s = Math.abs(n).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // Paréntesis contables para un negativo: la convención que el reporte
  // impreso de esta misma app ya usa (FASE FK).
  return n < 0 ? `(Q${s})` : `Q${s}`
}

function Pct({ value }) {
  // Sin ingreso no hay denominador, así que no hay columna: un porcentaje sobre
  // cero no es 0%, es una división que no se puede hacer.
  if (value == null || !isFinite(value)) return <span aria-hidden="true" />
  const shown = Math.abs(value) < 10 ? value.toFixed(1) : value.toFixed(0)
  return (
    <span className="text-right font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
      {shown}%
    </span>
  )
}

function Delta({ pct, comparable, title, goodWhenDown = true }) {
  if (!comparable || pct == null || !isFinite(pct)) return <span aria-hidden="true" />
  const up = pct >= 0
  const good = goodWhenDown ? !up : up
  const color = Math.abs(pct) < 5 ? 'var(--text-muted)'
    : good ? 'var(--accent-green)' : 'var(--alert-warn-icon)'
  return (
    <span className="text-right font-mono tabular-nums" style={{ color }} title={title}>
      {up ? '↑' : '↓'}{Math.abs(pct).toFixed(0)}%
    </span>
  )
}

function Row({ row, lang, momTitle, goodWhenDown }) {
  const label = lang === 'es' ? row.label : row.labelEn
  return (
    <li className="grid items-center gap-x-2 py-[3px] text-[11px]" style={{ gridTemplateColumns: COLS }}>
      <span className="flex items-center gap-1.5 min-w-0" style={{ color: 'var(--text-secondary)' }}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-right font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtQ(row.amount, lang)}</span>
      <Pct value={row.pctOfIncome} />
      <Delta pct={row.momPct} comparable={row.comparable} title={momTitle} goodWhenDown={goodWhenDown} />
    </li>
  )
}

function Section({ title, hint, section, lang, momTitle, goodWhenDown = true, openByDefault = true, emptyText }) {
  const [open, setOpen] = useState(openByDefault)
  const rows = section?.rows || []

  return (
    <div>
      <button
        type="button"
        onClick={() => rows.length > 0 && setOpen((v) => !v)}
        aria-expanded={rows.length > 0 ? open : undefined}
        disabled={rows.length === 0}
        className={`w-full grid items-center gap-x-2 py-1.5 text-left ${rows.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}
        style={{ gridTemplateColumns: COLS }}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider truncate" style={{ color: 'var(--text-secondary)' }}>
            {title}
          </span>
          {hint && (
            <span className="hidden sm:inline text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>{hint}</span>
          )}
          {rows.length > 0 && (
            <ChevronDown size={11} aria-hidden="true" className="shrink-0 transition-transform"
              style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none' }} />
          )}
        </span>
        <span className="text-right text-xs font-semibold font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
          {fmtQ(section?.total, lang)}
        </span>
        <Pct value={section?.pctOfIncome} />
        <Delta pct={section?.momPct} comparable={section?.comparable} title={momTitle} goodWhenDown={goodWhenDown} />
      </button>

      {rows.length === 0 && emptyText && (
        <p className="text-[11px] pb-1" style={{ color: 'var(--text-muted)' }}>{emptyText}</p>
      )}

      {open && rows.length > 0 && (
        <ul className="pb-1">
          {rows.map((r) => (
            <Row key={r.key} row={r} lang={lang} momTitle={momTitle} goodWhenDown={goodWhenDown} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default function PnlStatement({ pnl, lang = 'es', momTitle = null, silentReason = null }) {
  const t = useCallback((es, en) => (lang === 'es' ? es : en), [lang])
  if (!pnl) return null

  const { bottom, committedPct, hasIncome } = pnl
  const bottomColor = bottom.surplus ? 'var(--accent-green)' : 'var(--text-negative)'

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="card-title">{t('Estado del mes', 'Month statement')}</h3>
        {/* Qué es la columna del medio. Cinco palabras en vez de un párrafo. */}
        {hasIncome && (
          <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
            {t('% = del ingreso', '% = of income')}
          </span>
        )}
      </div>
      {silentReason && (
        <p className="text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>{silentReason}</p>
      )}

      <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
        <Section
          title={t('Ingresos', 'Income')}
          section={pnl.income}
          lang={lang}
          momTitle={momTitle}
          goodWhenDown={false}
          emptyText={t('Sin ingresos registrados este mes', 'No income logged this month')}
        />
        <Section
          title={t('Compromisos', 'Committed')}
          hint={t('fijos', 'fixed')}
          section={pnl.fixed}
          lang={lang}
          momTitle={momTitle}
          emptyText={t('Ningún gasto fijo este mes', 'No fixed costs this month')}
        />
        <Section
          title={t('Discrecional', 'Discretionary')}
          hint={t('variable', 'variable')}
          section={pnl.variable}
          lang={lang}
          momTitle={momTitle}
          emptyText={t('Ningún gasto variable este mes', 'No variable spending this month')}
        />

        <div className="grid items-center gap-x-2 pt-2" style={{ gridTemplateColumns: COLS }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider truncate" style={{ color: 'var(--text-secondary)' }}>
            <span className="sm:hidden">{bottom.surplus ? t('Resultado', 'Result') : t('Déficit', 'Deficit')}</span>
            <span className="hidden sm:inline">{bottom.surplus ? t('Resultado del mes', 'Month result') : t('Déficit del mes', 'Month deficit')}</span>
          </span>
          <span className="text-right text-sm font-bold font-mono tabular-nums" style={{ color: bottomColor }}>
            {fmtQ(bottom.amount, lang)}
          </span>
          <Pct value={bottom.pctOfIncome} />
          <span aria-hidden="true" />
        </div>
      </div>

      {/* La cifra más accionable de un P&L de hogar: cuánto del ingreso ya
          estaba comprometido antes de decidir nada. Es un HECHO, no un
          consejo: arriba del 50% un mes flojo no se corrige recortando lo
          discrecional, y eso se lee del número sin que nadie lo diga. */}
      {committedPct != null && isFinite(committedPct) && (
        <p className="mt-3 pt-2 text-[11px] border-t" style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border)' }}>
          <span className="font-mono tabular-nums font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {committedPct.toFixed(0)}%
          </span>{' '}
          {t('de lo que entró ya estaba comprometido.', 'of what came in was already committed.')}
        </p>
      )}
    </div>
  )
}
