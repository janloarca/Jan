'use client'

import { groupCountryOptions } from '@/components/dashboard/utils'

// FASE PT. El <select> de país/jurisdicción, agrupado por región. Vivía
// escrito CUATRO veces (jurisdicción y país, en el alta y en la edición) y
// agruparlo en cada una habría sido la cuarta divergencia: una sola definición.
//
// Si el valor guardado no está en la lista (un dato viejo o importado) se
// antepone tal cual, la misma regla que `currencyOptions` e `industryOptions`:
// un <select> cuyo value no está entre sus <option> renderiza la primera en
// silencio, o sea mostraría "vacío" sobre un dato que sí existe.
export default function CountrySelect({ id, value, onChange, options, lang = 'es', className, emptyLabel }) {
  const t = (es, en) => (lang === 'en' ? en : es)
  const known = options.some(o => o.key === value)
  const groups = groupCountryOptions(options)
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value)} className={className}>
      <option value="">{emptyLabel || t('-- Opcional --', '-- Optional --')}</option>
      {value && !known && <option value={value}>{value}</option>}
      {groups.map(g => (
        <optgroup key={g.key} label={t(g.es, g.en)}>
          {g.options.map(o => (
            <option key={o.key} value={o.key}>{o.flag ? o.flag + ' ' : ''}{t(o.es, o.en)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
