'use client'

import { useMemo } from 'react'
import { InfoTip } from '../ui/Tooltip'
import { usedCurrencies, buildRateRows, buildCurrencyHoldings, formatRate, showsRateTable, ANCHOR } from '@/lib/currencyRates'
import { formatCurrency, getItemValue, isExcludedFromNetWorth } from './utils'

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
  items, rates, baseCurrency = 'USD', ratesUpdate, ratesStale, ratesLoading, lang = 'es', embedded = false,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  const rows = useMemo(() => {
    const currencies = usedCurrencies(items)
    return buildRateRows({ currencies, rates, baseCurrency })
  }, [items, rates, baseCurrency])

  const holdings = useMemo(() => buildCurrencyHoldings({
    items, rates, baseCurrency,
    valueOf: (it) => (isExcludedFromNetWorth(it) ? null : getItemValue(it)),
  }), [items, rates, baseCurrency])
  const holdingOf = (code) => holdings.find((h) => h.code === code)

  // Con una sola moneda (y siendo esa el ancla) la tarjeta diría "1 USD = 1
  // USD": un control que no informa nada. Misma regla que el resto de la app
  // para lo que no aplica.
  if (!showsRateTable(items)) return null

  const missing = rows.filter((r) => r.rate == null)

  const updated = ratesUpdate ? new Date(ratesUpdate) : null
  const updatedLabel = updated && !isNaN(updated)
    ? updated.toLocaleString(lang === 'es' ? 'es-GT' : 'en-US', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <div className={embedded ? 'pt-3 mt-3' : 'card p-4 sm:p-5 h-full'} style={embedded ? { borderTop: '1px solid var(--glass-border)' } : undefined}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className={`card-title${embedded ? ' card-title-quiet' : ''}`}>
          {!embedded && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-cyan)' }} />}
          {embedded ? t('Por moneda y tipo de cambio', 'By currency & rates') : t('POR MONEDA Y TIPO DE CAMBIO', 'BY CURRENCY & RATES')}
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
          const h = holdingOf(r.code)
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
                {h && (
                  <div className="text-sm font-mono tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatCurrency(h.native, r.code)}
                    {!r.isBase && h.hasRate && (
                      <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>
                        ≈ {formatCurrency(h.baseValue, baseCurrency)}
                      </span>
                    )}
                    {h.pct != null && (
                      <span className="ml-1.5 text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>
                        {(h.pct * 100).toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}
                {formatted ? (
                  <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
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
