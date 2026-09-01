'use client'

// El estado del mes, arriba y en una línea.
//
// El badge decía "✓ Completo" a diez centímetros de un ahorro en -245.3%, o sea
// la pantalla se contradecía a sí misma. Las dos cosas eran ciertas por
// separado: `getMonthStatus` solo verifica que exista UNA fila de ingreso y UNA
// de gasto, y el -245% salía de dividir el gasto entre un ingreso al que le
// falta el salario. Lo que estaba mal era la PALABRA: "completo" promete algo
// que ese chequeo nunca miró.
//
// Ahora el badge dice lo que el código de verdad verifica, y al lado va cuánto
// del mes lleva transcurrido, que es la razón por la que las variaciones de las
// tarjetas de abajo están calladas.

const STATUS_META = {
  empty: {
    // FASE ME4: era rojo (alert-error). Un mes sin capturar es un pendiente,
    // no un daño: el rojo queda reservado para lo grave o irreversible
    // (regla de lib/toastStyle.js). Ámbar, igual que "falta un lado";
    // el icono y la palabra distinguen los dos estados.
    es: 'Sin registrar', en: 'Nothing logged', icon: '✗',
    color: 'var(--alert-warn-icon)', bg: 'var(--alert-warn-bg)', border: 'var(--alert-warn-border)',
    titleEs: 'Este mes no tiene ningún movimiento capturado.',
    titleEn: 'No movements logged for this month.',
  },
  partial: {
    es: 'Falta un lado', en: 'One side missing', icon: '⚠',
    color: 'var(--alert-warn-icon)', bg: 'var(--alert-warn-bg)', border: 'var(--alert-warn-border)',
    titleEs: 'Hay movimientos de un solo tipo: o ingresos o gastos, no los dos.',
    titleEn: 'Only one kind of movement is logged: income or expenses, not both.',
  },
  complete: {
    es: 'Registrado', en: 'Logged', icon: '✓',
    color: 'var(--accent-green)', bg: 'var(--alert-success-bg)', border: 'var(--alert-success-border)',
    titleEs: 'Hay ingresos y gastos capturados. No verifica que estén todos.',
    titleEn: 'Both income and expenses are logged. It does not check that everything is there.',
  },
}

export default function MonthStatusBar({
  status = 'empty', partialMonth = false, daysElapsed = 0, daysInMonth = 0, daysLeft = 0,
  reminderEnabled = false, onToggleReminder, reminderEmail = '', lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const meta = STATUS_META[status] || STATUS_META.empty

  return (
    <div className="card p-3 flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-2 justify-between">
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5">
        <span
          className="text-xs px-2.5 py-1 rounded-full font-semibold shrink-0"
          title={t(meta.titleEs, meta.titleEn)}
          style={{ color: meta.color, backgroundColor: meta.bg, border: `1px solid ${meta.border}` }}
        >
          {meta.icon} {t(meta.es, meta.en)}
        </span>

        {/* Cuánto del mes va, y con eso la razón de que las variaciones de las
            cards de abajo estén calladas. Se dice UNA vez, acá: repetir el
            párrafo entero dentro de cada desglose gastaba dos líneas por card
            para explicar lo mismo. */}
        {partialMonth && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            <span className="font-mono tabular-nums">{daysElapsed}</span>
            {t(` de ${daysInMonth} días`, ` of ${daysInMonth} days`)}
            {status !== 'complete' && (
              <>
                {' · '}
                {daysLeft === 0
                  ? t('último día para capturar', 'last day to log it')
                  : daysLeft === 1
                    ? t('queda 1 día', '1 day left')
                    : t(`quedan ${daysLeft} días`, `${daysLeft} days left`)}
              </>
            )}
            {' · '}
            {t('comparar contra un mes completo no dice nada, así que las variaciones aparecen al cerrar',
               'comparing against a full month says nothing, so changes appear once it closes')}
          </span>
        )}
      </div>

      {onToggleReminder && (
        <label className="flex items-center gap-2 cursor-pointer shrink-0">
          <button
            type="button" onClick={onToggleReminder} role="switch" aria-checked={reminderEnabled}
            className="w-8 h-4 rounded-full transition-colors relative shrink-0"
            style={{ backgroundColor: reminderEnabled ? 'var(--accent-blue)' : 'var(--card-border)' }}
          >
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
  )
}
