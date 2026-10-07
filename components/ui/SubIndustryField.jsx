'use client'

import { useState, useMemo } from 'react'
import { searchSubIndustries, findSubIndustry, subIndustryLabel } from '@/lib/classification'

/* Subindustria con type-ahead (FASE PR). Campo opcional y vacio por defecto:
 * jamas se infiere. Una sola definicion para el alta y la edicion (dos copias
 * es como una se queda atras). Controlado: no guarda nada por su cuenta.
 *
 * Elegir una subindustria prellena su industria padre (nunca al reves: una
 * industria no impone subindustria). `onPick(industry, subIndustry, custom)`
 * recibe los tres para que el caller escriba en su propio `form`.
 *
 * Si lo escrito no esta en el catalogo se ofrece "Usar «texto»" como valor
 * propio (`subIndustry: 'custom'`), que el World ignora y la ficha muestra
 * tal cual: nada se pierde ni se inventa.
 */
export default function SubIndustryField({
  industry, subIndustry, custom, onPick, lang = 'es', id, inputCls, labelCls,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const current = subIndustry ? subIndustryLabel(industry, subIndustry, lang, custom) : ''
  const results = useMemo(
    () => (open ? searchSubIndustries(query, { industry, lang, limit: 8 }) : []),
    [open, query, industry, lang]
  )
  const typed = query.trim()
  const exact = typed && results.some(r => (lang === 'en' ? r.en : r.es).toLowerCase() === typed.toLowerCase())

  const pick = (ind, key, cust = '') => {
    onPick(ind, key, cust)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <label className={labelCls} htmlFor={id}>{t('Subindustria', 'Subindustry')}</label>
      {current && !open ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            id={id}
            onClick={() => { setOpen(true); setQuery('') }}
            className={`${inputCls} text-left flex-1 min-w-0 truncate`}
          >
            {current}
          </button>
          <button
            type="button"
            onClick={() => pick(industry, '', '')}
            className="text-xs shrink-0 px-2 min-h-[28px] rounded-lg"
            style={{ color: 'var(--text-muted)' }}
            aria-label={t('Quitar subindustria', 'Clear subindustry')}
          >
            {t('Quitar', 'Clear')}
          </button>
        </div>
      ) : (
        <input
          id={id}
          type="text"
          value={query}
          autoComplete="off"
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t('Escribe para buscar (café, chips, seguros...)', 'Type to search (coffee, chips, insurance...)')}
          className={inputCls}
        />
      )}
      {open && (results.length > 0 || typed) && (
        <ul
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 rounded-xl overflow-hidden max-h-60 overflow-y-auto"
          style={{ background: 'var(--bg-primary)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow-elevated)' }}
        >
          {results.map(r => (
            <li key={`${r.industry}::${r.key}`} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(r.industry, r.key, '')}
                className="w-full text-left px-3 py-2 text-sm flex items-baseline justify-between gap-2"
                style={{ color: 'var(--text-primary)' }}
              >
                <span className="truncate">{lang === 'en' ? r.en : r.es}</span>
                {!industry && (
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {findSubIndustry(r.industry, r.key) ? r.industry : ''}
                  </span>
                )}
              </button>
            </li>
          ))}
          {typed && !exact && (
            <li role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(industry, 'custom', typed)}
                className="w-full text-left px-3 py-2 text-sm"
                style={{ color: 'var(--accent-blue)' }}
              >
                {t(`Usar "${typed}"`, `Use "${typed}"`)}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
