'use client'

import { useEffect, useState } from 'react'
import { parseAmount, parseQuantity } from '@/lib/numberParse'

/**
 * Cuerpo GUIADO del alta de un activo: una pregunta por pantalla.
 *
 * Esto es SOLO render. No tiene estado propio de formulario, no arma ningún
 * item y no escribe nada: recibe el mismo `form`/`set` de AddAccountModal y
 * termina llamando a SU `handleSubmit`. Es deliberado y es lo que hace que
 * este archivo no pueda divergir del formulario largo:
 *
 *   · El depósito de apertura (⛔ superficie G de
 *     lib/assetLogic/corporateBondWithEntryFee.js) lo sigue escribiendo
 *     handleSubmit, sin tocar. El modo guiado no pide comisión de entrada, así
 *     que cae en el caso fee = 0 de esa misma fórmula, nunca en una copia.
 *   · La búsqueda de símbolo, la cotización y el dividendo auto-detectado son
 *     los efectos que ya viven en AddAccountModal.
 *
 * Lo que el modo guiado NO pregunta (moneda, fecha, subtipo, comisiones,
 * calendario de pagos, fiscal, custodia) se queda con los defaults del
 * formulario y lo reclama después Enrich Data (lib/dataCompleteness.js), que
 * para eso existe y ya trae el botón "Usar esto".
 *
 * La MONEDA es la excepción a ese "se queda con el default": un saldo en el
 * banco equivocado no es un hueco que se pueda rellenar después sin que el
 * patrimonio mienta mientras tanto (una cuenta guatemalteca leída como USD
 * infla el total ~7,7x). Por eso este archivo detecta la moneda desde la
 * institución con el MISMO helper que el formulario largo, en vez de dejar
 * USD fijo.
 */

import { detectCurrency } from '@/lib/institutionCurrency'

const FIELD_SEQUENCES = {
  market: ['symbol', 'quantity', 'institution'],
  Bank: ['institution', 'amount'],
  // FASE OA: la institucion va ANTES del monto. `applyInstitution` sugiere
  // la moneda a partir del banco/casa de bolsa, y con el monto primero la
  // moneda cambiaba DESPUES de tecleado el numero (1,000 escritos "en USD"
  // pasaban a leerse en GTQ sin que el usuario volviera a ver el campo).
  // Mismo orden que Bank, que ya lo hacia bien.
  Bond: ['name', 'institution', 'amount'],
  RealEstate: ['name', 'amount'],
  Alternative: ['name', 'institution', 'amount'],
  Debt: ['name', 'amount'],
  generic: ['name', 'institution', 'amount'],
}

export function guidedFieldsFor({ type, isMarketAsset }) {
  if (isMarketAsset) return FIELD_SEQUENCES.market
  return FIELD_SEQUENCES[type] || FIELD_SEQUENCES.generic
}

const inputCls = 'w-full min-w-0 px-4 py-3 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-xl text-base text-[var(--text-primary,white)] placeholder-[var(--text-muted,#475569)] focus:outline-none focus:border-blue-500/50'

export default function GuidedAssetSteps({ ctx }) {
  const {
    t, form, set, type, typeLabel, typeIcon,
    isMarketAsset, isBank, isDebt, isProperty,
    fieldIndex, fields, goNext, goBack, onExit,
    searchResults, showDropdown, setShowDropdown, searchLoading, fetchingQuote, quoteFailed,
    handleSelectSymbol, inputRef, dropdownRef,
    filteredInstitutions, showInstSuggestions, setShowInstSuggestions,
    saving, error, progress,
  } = ctx

  const field = fields[fieldIndex]
  const isLast = fieldIndex === fields.length - 1

  const amountLabel = isBank
    ? t('¿Cuánto hay en la cuenta?', 'How much is in the account?')
    : isDebt
      ? t('¿Cuánto debes?', 'How much do you owe?')
      : isProperty
        ? t('¿Cuánto pagaste?', 'How much did you pay?')
        : t('¿Cuánto invertiste?', 'How much did you invest?')

  const nameLabel = isDebt
    ? t('¿Qué deuda es?', 'What debt is it?')
    : isProperty
      ? t('¿Qué propiedad es?', 'Which property is it?')
      : t('¿Cómo se llama?', 'What is it called?')

  const namePlaceholder = isDebt
    ? t('Hipoteca casa', 'Home mortgage')
    : isProperty
      ? t('Apartamento zona 14', 'Downtown apartment')
      : t('Bono Vitali 8%', 'Vitali Bond 8%')

  const QUESTIONS = {
    symbol: t('¿Cuál?', 'Which one?'),
    quantity: type === 'Crypto' ? t('¿Cuántas monedas tienes?', 'How many coins do you have?') : t('¿Cuántas tienes?', 'How many do you have?'),
    institution: isBank ? t('¿En qué banco?', 'Which bank?') : t('¿Dónde lo tienes?', 'Where do you hold it?'),
    name: nameLabel,
    amount: amountLabel,
  }

  // `parseFloat` no entiende la coma decimal, que es lo que teclea medio LatAm,
  // y los inputs de abajo son de texto justo para que el navegador ya no borre
  // lo que no puede parsear. Las dos mitades tienen que ir juntas.
  // Misma regla que el formulario largo (AddAccountModal): la institución
  // sugiere la moneda, y solo pisa el valor mientras siga siendo el default.
  // Si el usuario ya eligió una moneda a mano, no se le toca.
  const applyInstitution = (value) => {
    set('institution', value)
    const hint = detectCurrency(value)
    if (hint && form.currency === 'USD') set('currency', hint)
  }

  const price = parseAmount(form.purchasePrice)
  const qty = parseQuantity(form.quantity)
  const liveTotal = price > 0 && qty > 0 ? qty * price : 0

  // El precio de un activo de mercado normalmente lo trae la cotización sola, y
  // por eso la secuencia no tiene paso de precio. Cuando NO resuelve (el
  // proveedor caído, un símbolo que no cotiza, una cripto que no está en el
  // mapa), guardar igual deja el activo con costo CERO y un retorno inventado
  // de miles por ciento. Una pregunta más, solo cuando de verdad hace falta.
  //
  // Se ENGANCHA al símbolo, no al valor actual: derivarlo de `price <= 0` a
  // secas hace que el campo se desmonte apenas se teclea el primer dígito
  // (price pasa a > 0), o sea el resto de la escritura cae al vacío y queda un
  // precio de "2" en vez de "2400". Es exactamente el mismo defecto que este
  // cambio vino a arreglar, una capa más arriba, y lo cazó la prueba de
  // navegador tecleando carácter por carácter.
  const [manualPriceFor, setManualPriceFor] = useState('')
  useEffect(() => {
    if (isMarketAsset && field === 'quantity' && price <= 0 && form.symbol) setManualPriceFor(form.symbol)
  }, [isMarketAsset, field, price, form.symbol])
  const needsManualPrice = isMarketAsset && field === 'quantity'
    && (price <= 0 || manualPriceFor === form.symbol)

  const canAdvance = (() => {
    if (field === 'symbol') return !!form.symbol
    if (field === 'quantity') return qty > 0 && (!isMarketAsset || price > 0)
    if (field === 'name') return !!form.name.trim()
    if (field === 'amount') return isBank ? form.purchasePrice !== '' : price > 0
    // handleSubmit exige institución para TODO salvo inmueble y deuda (que ni
    // siquiera tienen este paso). Pedirla acá evita que el usuario llegue a
    // "Guardar" y reciba un error por un campo que ya había pasado.
    if (field === 'institution') return !!form.institution.trim()
    return true
  })()

  return (
    <div className="p-6 space-y-5">
      {/* Progreso: cuántos activos de los que el usuario dijo que tiene */}
      {progress && (
        <div className="flex items-center gap-2">
          {progress.items.map((it, i) => (
            <div key={it.key + i} className="h-1 rounded-full flex-1 transition-colors"
              style={{ background: i < progress.index ? 'var(--accent-blue)' : i === progress.index ? 'color-mix(in srgb, var(--accent-blue) 45%, transparent)' : 'var(--card-border,#38383A)' }} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary,#94a3b8)' }}>
        <span className="text-lg">{typeIcon}</span>
        <span>{typeLabel}</span>
        {progress && (
          <span style={{ color: 'var(--text-muted,#475569)' }}>
            · {t(`${progress.index + 1} de ${progress.items.length}`, `${progress.index + 1} of ${progress.items.length}`)}
          </span>
        )}
      </div>

      <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary,white)' }}>
        {QUESTIONS[field]}
      </h2>

      {/* ---- Campo de la pregunta actual ---- */}
      {field === 'symbol' && (
        <div className="relative">
          <input
            ref={inputRef}
            value={form.symbol}
            onChange={e => set('symbol', e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
            placeholder={type === 'Crypto' ? t('Bitcoin, ETH...', 'Bitcoin, ETH...') : t('Apple, AAPL, VOO...', 'Apple, AAPL, VOO...')}
            className={inputCls}
            autoFocus
          />
          {(searchLoading || fetchingQuote) && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted,#475569)' }}>
              {t('Buscando...', 'Searching...')}
            </p>
          )}
          {showDropdown && searchResults.length > 0 && (
            <div ref={dropdownRef} className="absolute z-10 w-full mt-1 rounded-xl overflow-hidden max-h-60 overflow-y-auto"
              style={{ background: 'var(--bg-card-hover,#1c1c24)', border: '1px solid var(--card-border,#38383A)' }}>
              {searchResults.map((r, i) => (
                <button key={`${r.symbol}-${i}`} type="button" onClick={() => handleSelectSymbol(r)}
                  className="w-full text-left px-4 py-3 hover:bg-black/20 transition-colors">
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary,white)' }}>{r.symbol}</div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-muted,#475569)' }}>{r.name}</div>
                </button>
              ))}
            </div>
          )}
          {form.symbol && price > 0 && (
            <p className="text-sm mt-3" style={{ color: 'var(--text-positive)' }}>
              ✓ {form.name || form.symbol} · {form.currency} {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </p>
          )}
          {/* Sin esto, elegir un símbolo cuyo proveedor está caído simplemente
              NO pinta la línea de arriba, y ese silencio se lee como que la app
              no hizo nada. El precio se pide en el paso siguiente, pero decir
              acá por qué falta es la diferencia entre una espera y una duda. */}
          {quoteFailed && !fetchingQuote && form.symbol && (
            <p className="text-sm mt-3" style={{ color: 'var(--alert-warn-icon)' }}>
              {t(`No pudimos traer el precio de ${form.symbol}. Te lo preguntamos en el paso siguiente.`,
                 `We could not fetch a price for ${form.symbol}. We will ask for it in the next step.`)}
            </p>
          )}
        </div>
      )}

      {field === 'quantity' && (
        <div>
          {/* type="text", no "number": con teclado en español el separador
              decimal es COMA, y un input numérico devuelve '' ante lo que no
              puede parsear, o sea el campo se borra solo tecla por tecla. Ese
              era el "BTC no me dejaba poner 0.0001". `inputMode` conserva el
              teclado numérico, y `parseQuantity` entiende las dos formas. */}
          <input
            value={form.quantity}
            onChange={e => set('quantity', e.target.value)}
            placeholder={type === 'Crypto' ? '0.5' : '10'}
            type="text" inputMode="decimal"
            className={inputCls}
            autoFocus
          />
          {needsManualPrice && (
            <div className="mt-4">
              <label htmlFor="guided-price" className="block text-sm mb-2" style={{ color: 'var(--text-secondary,#94a3b8)' }}>
                {quoteFailed
                  ? t(`No pudimos traer el precio de ${form.symbol}. ¿A cuánto está cada uno?`,
                       `We could not fetch a price for ${form.symbol}. What is each one worth?`)
                  : t('¿A cuánto está cada uno?', 'What is each one worth?')}
              </label>
              <input
                id="guided-price"
                value={form.purchasePrice}
                onChange={e => set('purchasePrice', e.target.value)}
                placeholder="150.00"
                type="text" inputMode="decimal"
                className={inputCls}
              />
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted,#475569)' }}>
                {t(`En ${form.currency}.`, `In ${form.currency}.`)}
              </p>
            </div>
          )}
          {liveTotal > 0 && (
            <p className="text-sm mt-3" style={{ color: 'var(--text-secondary,#94a3b8)' }}>
              {t('Eso son', 'That is')} <strong style={{ color: 'var(--text-primary,white)' }}>
                {form.currency} {liveTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </strong>
            </p>
          )}
        </div>
      )}

      {field === 'name' && (
        <input
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder={namePlaceholder}
          className={inputCls}
          autoFocus
        />
      )}

      {field === 'amount' && (
        <div>
          <input
            value={form.purchasePrice}
            onChange={e => set('purchasePrice', e.target.value)}
            placeholder="10000"
            type="text" inputMode="decimal"
            className={inputCls}
            autoFocus
          />
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted,#475569)' }}>
            {t(`En ${form.currency}. Puedes cambiar la moneda después.`, `In ${form.currency}. You can change the currency later.`)}
          </p>
        </div>
      )}

      {field === 'institution' && (
        <div className="relative">
          <input
            value={form.institution}
            onChange={e => { applyInstitution(e.target.value); setShowInstSuggestions(true) }}
            onFocus={() => setShowInstSuggestions(true)}
            placeholder={isBank ? t('Banco Industrial', 'Chase') : t('Interactive Brokers, Binance...', 'Interactive Brokers, Binance...')}
            className={inputCls}
            autoFocus
          />
          {!isBank && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted,#475569)' }}>
              {t('El broker, banco o app donde está.', 'The broker, bank or app where it is held.')}
            </p>
          )}
          {showInstSuggestions && filteredInstitutions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 rounded-xl overflow-hidden max-h-48 overflow-y-auto"
              style={{ background: 'var(--bg-card-hover,#1c1c24)', border: '1px solid var(--card-border,#38383A)' }}>
              {filteredInstitutions.map(inst => (
                <button key={inst} type="button"
                  onClick={() => { applyInstitution(inst); setShowInstSuggestions(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-black/20 transition-colors"
                  style={{ color: 'var(--text-primary,white)' }}>
                  {inst}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: 'var(--text-negative)' }}>{error}</p>
      )}

      {/* ---- Navegación ---- */}
      <div className="flex items-center gap-3 pt-2">
        {fieldIndex > 0 && (
          <button type="button" onClick={goBack} disabled={saving}
            className="px-4 py-3 rounded-xl text-sm font-medium transition-colors"
            style={{ color: 'var(--text-secondary,#94a3b8)', border: '1px solid var(--card-border,#38383A)' }}>
            {t('Atrás', 'Back')}
          </button>
        )}
        <button type="button" onClick={goNext} disabled={!canAdvance || saving}
          className="flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: 'var(--accent-blue)', color: '#ffffff' }}>
          {saving ? t('Guardando...', 'Saving...') : isLast ? t('Guardar', 'Save') : t('Continuar', 'Continue')}
        </button>
      </div>

      <button type="button" onClick={onExit} disabled={saving}
        className="w-full text-xs py-1 transition-colors"
        style={{ color: 'var(--text-muted,#475569)' }}>
        {t('Ya lo hago yo', 'I will take it from here')}
      </button>
    </div>
  )
}
