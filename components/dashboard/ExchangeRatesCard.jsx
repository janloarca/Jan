'use client'

import { useMemo } from 'react'
import { InfoTip } from '../ui/Tooltip'
import { usedCurrencies, buildRateRows, formatRate, ANCHOR } from '@/lib/currencyRates'

// Las tasas que la app está usando AHORA MISMO, para las monedas que este
// portafolio de verdad tiene.
//
// Por qué existe: todo el tablero se muestra convertido a la moneda base y no
// había ningún lugar que dijera con qué tasa. Quien tiene quetzales y dólares
// veía su patrimonio en dólares sin poder saber si el quetzal entró a 7.70 o a
// 7.90, ni de cuándo era ese número. La única superficie que mostraba una tasa
// (`CurrencyImpact`) vive dentro de una pestaña de una pestaña y además excluye
// la moneda base, así que el ancla 1:1 no aparecía en ninguna parte.
//
// TRES DECISIONES QUE NO SON DECORACIÓN:
//
// 1. El ancla es el DÓLAR y las filas se leen "1 USD = X". Esa es la forma
//    NATIVA del mapa que devuelve /api/exchange-rates; anclarlo a la moneda
//    base obligaría a dividir, y una división produce un número que no vino de
//    ninguna fuente. Cuál es la base se marca aparte, con un chip.
// 2. Una moneda sin tasa se dice, no se esconde. Ese es exactamente el caso en
//    que `convert` devuelve el monto CRUDO, o sea el patrimonio está sumando
//    sin convertir: es lo más importante que esta tarjeta puede reportar.
// 3. La FRESCURA va arriba, no al pie. Una tasa de ayer sigue siendo mucho
//    mejor que 1:1 (por eso se persisten entre sesiones), pero tiene que
//    decirse que es de ayer.
export default function ExchangeRatesCard({
  items, rates, baseCurrency = 'USD', ratesUpdate, ratesStale, ratesLoading, lang = 'es',
}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const rows = useMemo(() => {
    const currencies = usedCurrencies(items)
    return buildRateRows({ currencies, rates, baseCurrency })
  }, [items, rates, baseCurrency])

  // Con una sola moneda (y siendo esa el ancla) la tarjeta diría "1 USD = 1
  // USD": un control que no informa nada. Misma regla que el resto de la app
  // para lo que no aplica.
  if (rows.length < 2) return null

  const missing = rows.filter((r) => r.rate == null)

  const updated = ratesUpdate ? new Date(ratesUpdate) : null
  const updatedLabel = updated && !isNaN(updated)
    ? updated.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-cyan)' }} />
          {t('TIPO DE CAMBIO', 'EXCHANGE RATES')}
          <InfoTip text={t(
            'Las tasas con las que se está convirtiendo tu patrimonio ahora mismo. Solo se listan las monedas que tienes. El dólar es el ancla: las demás se leen como cuántas unidades hay en un dólar.',
            'The rates your net worth is being converted with right now. Only the currencies you hold are listed. The dollar is the anchor: the others read as how many units make one dollar.'
          )} />
        </h3>
      </div>

      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        {ratesLoading && !updatedLabel
          ? t('Actualizando...', 'Updating...')
          : updatedLabel
            ? (ratesStale
                ? t(`Últimas conocidas · ${updatedLabel}`, `Last known · ${updatedLabel}`)
                : t(`Actualizado ${updatedLabel}`, `Updated ${updatedLabel}`))
            : t('Sin fecha de actualización', 'No update time')}
      </p>

      <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>
        {rows.map((r) => {
          const formatted = formatRate(r.rate, lang)
          return (
            <div key={r.code} className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {r.code}
                </span>
                {r.isBase && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)', color: 'var(--accent-blue)' }}>
                    {t('base', 'base')}
                  </span>
                )}
              </div>
              <div className="text-right shrink-0">
                {formatted ? (
                  <span className="text-sm font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {r.isAnchor
                      ? t('1.0000 · ancla', '1.0000 · anchor')
                      : <>1 {ANCHOR} = {formatted}</>}
                  </span>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--alert-warn-icon)' }}>
                    {t('sin tasa', 'no rate')}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {missing.length > 0 && (
        <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
          {t(
            `Sin tasa para ${missing.map((m) => m.code).join(', ')}: esos montos se están sumando SIN convertir.`,
            `No rate for ${missing.map((m) => m.code).join(', ')}: those amounts are being added up WITHOUT converting.`
          )}
        </p>
      )}
    </div>
  )
}
