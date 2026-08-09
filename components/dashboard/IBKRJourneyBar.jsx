'use client'

// FASE GM. La barra de progreso del viaje continuo de IBKR: un strip fijo
// ARRIBA de cualquier modal del viaje (z-index mayor que el z-50 de los
// modales) que responde las dos preguntas que el flujo viejo dejaba en el
// aire: ¿en qué paso voy? y ¿cuántos faltan? El bug reportado que motiva
// esto: subir el archivo soltaba al usuario en el dashboard sin decirle si
// había más pasos ("me quedo pensando si habrán más pasos o con eso ya
// estoy"). Regla dura del usuario: secuencia seguida, sin pop-ups
// inesperados, y NUNCA de vuelta a la pantalla principal a mitad del viaje.
//
// Ningún paso es obligatorio (regla de la casa desde FASE EZ): "Saltar"
// avanza sin hacer el paso, "Salir" abandona el viaje entero. El contenido
// de cada paso lo renderiza el orquestador (app/dashboard/page.jsx) reusando
// los modales existentes; esta barra solo lleva el hilo.

export default function IBKRJourneyBar({ step = 1, total = 5, title = '', onSkip, onExit, lang = 'es' }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  return (
    <div className="fixed top-0 inset-x-0 z-[60] px-4 py-2.5 flex items-center gap-3"
      style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--card-border)', boxShadow: 'var(--shadow-modal)' }}>
      <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="h-1.5 rounded-full transition-all"
            style={{
              width: i + 1 === step ? 22 : 10,
              backgroundColor: i + 1 <= step ? 'var(--accent-blue)' : 'var(--bg-tertiary)',
            }} />
        ))}
      </div>
      <p className="text-xs min-w-0 flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
        <span className="font-semibold">{t(`Paso ${step} de ${total}`, `Step ${step} of ${total}`)}</span>
        {title ? <span style={{ color: 'var(--text-muted)' }}> · {title}</span> : null}
      </p>
      {onSkip && step < total && (
        <button type="button" onClick={onSkip}
          className="text-xs px-2.5 py-1 rounded-lg border shrink-0"
          style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
          {t('Saltar este paso', 'Skip this step')}
        </button>
      )}
      {onExit && (
        <button type="button" onClick={onExit}
          className="text-xs px-2.5 py-1 rounded-lg shrink-0"
          style={{ color: 'var(--text-muted)' }}>
          {t('Salir', 'Exit')}
        </button>
      )}
    </div>
  )
}
