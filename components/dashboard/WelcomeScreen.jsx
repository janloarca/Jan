'use client'

import AssetTypePicker from './AssetTypePicker'
import BusyLabel from '@/components/ui/BusyLabel'
import Logo from '@/components/ui/Logo'

/**
 * Lo primero que ve alguien que acaba de entrar y todavía no tiene nada.
 *
 * Reemplaza al EmptyState viejo, que ofrecía CUATRO tarjetas parejas, una
 * pastilla de datos de ejemplo y ocho pastillas de "tipos soportados": trece
 * decisiones antes de poder hacer nada, con el camino más amable rotulado como
 * el más tedioso ("Agregar manualmente · Una posición a la vez").
 *
 * Acá la pantalla ES la pregunta. Se marca lo que uno tiene y se empieza; todo
 * lo demás (broker, archivo, ejemplo, cómo funciona) baja a una fila de links,
 * que es el peso que le corresponde a un camino alternativo.
 *
 * NO lleva un botón de descartar a propósito: con cero activos el cuerpo del
 * tablero está apagado entero, así que descartar dejaría una página en blanco
 * bajo el encabezado. La salida honesta son los links de abajo. Y como la única
 * compuerta es el conteo real de activos, salirse del recorrido sin agregar
 * nada devuelve acá solo, con lo marcado intacto.
 */
export default function WelcomeScreen({
  picked = [],
  onToggle,
  onStart,
  onConnect,
  onImport,
  onDemo,
  onHowItWorks,
  demoBusy = false,
  ownerName = '',
  lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const first = (ownerName || '').trim().split(/\s+/)[0] || ''

  return (
    <div className="max-w-2xl mx-auto w-full py-6 sm:py-10 space-y-5">
      <div className="text-center space-y-2">
        <div className="flex justify-center mb-1">
          <Logo variant="icon" size={30} />
        </div>
        <h2 className="text-h1" style={{ color: 'var(--text-primary)' }}>
          {first
            ? t(`Empecemos, ${first}`, `Let's start, ${first}`)
            : t('Empecemos', 'Let us start')}
        </h2>
        <p className="text-body max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
          {t('Chispudo junta todo lo que tienes en un solo lugar. Contanos qué es lo tuyo y lo armamos juntos.',
             'Chispudo brings everything you own into one place. Tell us what you have and we build it together.')}
        </p>
      </div>

      <div className="card p-4 sm:p-5 space-y-4">
        <div>
          <h3 className="text-h2" style={{ color: 'var(--text-primary)' }}>
            {t('¿Qué tienes?', 'What do you have?')}
          </h3>
          <p className="text-caption mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('Marca todo lo que aplique. Puedes agregar más después.',
               'Check everything that applies. You can add more later.')}
          </p>
        </div>

        <AssetTypePicker
          picked={picked} onToggle={onToggle} onStart={onStart}
          lang={lang} variant="page"
        />

        <p className="text-micro text-center" style={{ color: 'var(--text-muted)' }}>
          {t('Son 2 o 3 preguntas por cada uno.', 'It is 2 or 3 questions for each one.')}
        </p>
      </div>

      {/* Los otros caminos existen, pero no compiten con el principal. */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-caption">
        {onConnect && (
          <button type="button" onClick={onConnect} className="px-2 py-1 min-h-[28px] underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}>
            {t('¿Tu broker se conecta solo?', 'Does your broker sync itself?')}
          </button>
        )}
        {onConnect && onImport && <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>·</span>}
        {onImport && (
          <button type="button" onClick={onImport} className="px-2 py-1 min-h-[28px] underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}>
            {t('Tengo un archivo', 'I have a file')}
          </button>
        )}
        {onImport && onDemo && <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>·</span>}
        {onDemo && (
          <button type="button" onClick={onDemo} disabled={demoBusy}
            className="px-2 py-1 min-h-[28px] underline underline-offset-2 disabled:opacity-60"
            style={{ color: 'var(--text-muted)' }}>
            <BusyLabel busy={demoBusy} lang={lang}>
              {t('Ver un ejemplo', 'See an example')}
            </BusyLabel>
          </button>
        )}
        {onDemo && onHowItWorks && <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>·</span>}
        {onHowItWorks && (
          <button type="button" onClick={onHowItWorks} className="px-2 py-1 min-h-[28px] underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}>
            {t('¿Cómo funciona?', 'How does it work?')}
          </button>
        )}
      </div>
    </div>
  )
}
