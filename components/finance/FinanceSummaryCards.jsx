'use client'

// El resultado del mes: entró, salió, quedó.
//
// ⛔ SOLO dinero de Flujo. El ingreso por dividendos del portafolio se sumaba
// acá con una nota al pie ("incluye Q237.39 de inversión"), y con eso la
// pantalla llegaba a decir "Falta un lado" (ninguna fila de ingreso registrada)
// arriba de un "Entró Q237.39" y un ahorro de +20.2% medido contra dinero que
// el usuario nunca registró en Flujo. Son dos segmentos separados: lo que
// Patrimonio genera se mide en Patrimonio.
//
// Dos cosas que antes se decían mal:
//
// 1. La variación contra el mes pasado se dibujaba SIEMPRE que hubiera mes
//    anterior. Con el mes en curso eso compara media ventana contra una
//    completa, así que ahora la decide `momComparable` (financeMonth.js) y en
//    su lugar la barra de estado dice cuántos días van.
//
// 2. El ahorro imprimía su tasa aunque fuera -245.3%. Ese número es correcto y
//    no significa nada: un porcentaje sobre una base minúscula explota. La
//    cifra en quetzales es la que se entiende, y el porcentaje solo aparece
//    mientras siga siendo legible; pasado eso se dice en palabras cuántas veces
//    se gastó lo que entró, que es la misma verdad sin la explosión.

// Más allá de esto un porcentaje deja de informar: -100% ya es "gastaste el
// doble de lo que entró", y de ahí para abajo el número crece sin que la
// situación cambie de naturaleza.
const RATE_FLOOR = -100

export default function FinanceSummaryCards({
  income, expenses,
  momIncomePct = null, momExpensesPct = null, momComparable = true,
  lang = 'es',
}) {
  const totalIncome = income
  const savings = totalIncome - expenses
  const savingsRate = totalIncome > 0 ? (savings / totalIncome) * 100 : null
  const t = (es, en) => lang === 'es' ? es : en

  const fmt = (v) => Math.abs(v).toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // The sign goes OUTSIDE the currency mark. Savings is the one card here that
  // can go negative, and `Q${v}` printed it as "Q-118,879.20".
  const money = (v) => `${v < 0 ? '-' : ''}Q${fmt(v)}`

  const Delta = ({ pct, goodWhenDown = false }) => {
    if (!momComparable || pct == null || !isFinite(pct)) return null
    const up = pct >= 0
    const isGood = goodWhenDown ? !up : up
    return (
      <span className="text-xs font-mono tabular-nums ml-2" style={{ color: Math.abs(pct) < 3 ? 'var(--text-muted)' : isGood ? 'var(--accent-green)' : 'var(--alert-warn-icon)' }}
        title={t('vs mes pasado', 'vs last month')}>
        {up ? '↑' : '↓'}{Math.abs(pct).toFixed(0)}%
      </span>
    )
  }

  // Cuántas veces lo que entró: la lectura honesta cuando el porcentaje ya no
  // sirve. "Gastaste 3.5x lo que ingresó" dice lo mismo que -245% y se entiende.
  const overspendRatio = totalIncome > 0 && savings < 0 ? expenses / totalIncome : null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="card p-4">
        <p className="text-caption mb-1" style={{ color: 'var(--text-muted)' }}>{t('Entró', 'Came in')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: 'var(--accent-green)' }}>
          {money(totalIncome)}
          <Delta pct={momIncomePct} />
        </p>
      </div>
      <div className="card p-4">
        <p className="text-caption mb-1" style={{ color: 'var(--text-muted)' }}>{t('Salió', 'Went out')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: 'var(--text-negative)' }}>
          {money(expenses)}
          <Delta pct={momExpensesPct} goodWhenDown />
        </p>
      </div>
      <div className="card p-4">
        <p className="text-caption mb-1" style={{ color: 'var(--text-muted)' }}>{t('Quedó', 'Left over')}</p>
        <p className="text-h2 font-mono tabular-nums" style={{ color: savings >= 0 ? 'var(--accent-blue-soft)' : 'var(--text-negative)' }}>
          {money(savings)}
        </p>
        {savingsRate != null && savingsRate >= RATE_FLOOR && (
          <p className="text-xs font-mono tabular-nums mt-0.5" style={{ color: savingsRate >= 0 ? 'var(--accent-blue-soft)' : 'var(--text-negative)', opacity: 0.75 }}>
            {savingsRate >= 0 ? '+' : ''}{savingsRate.toFixed(1)}%
          </p>
        )}
        {savingsRate != null && savingsRate < RATE_FLOOR && overspendRatio != null && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {t(`Salió ${overspendRatio.toFixed(1)}x lo que entró`, `${overspendRatio.toFixed(1)}x what came in`)}
          </p>
        )}
      </div>
    </div>
  )
}
