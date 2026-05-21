'use client'

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function MonthSelector({ month, year, onChange, lang = 'es' }) {
  const months = lang === 'es' ? MONTHS_ES : MONTHS_EN

  const prev = () => {
    if (month === 0) onChange(11, year - 1)
    else onChange(month - 1, year)
  }

  const next = () => {
    if (month === 11) onChange(0, year + 1)
    else onChange(month + 1, year)
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={prev} className="px-2 py-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-[#283548]">
        &larr;
      </button>
      <span className="text-white font-semibold text-sm min-w-[140px] text-center">
        {months[month]} {year}
      </span>
      <button onClick={next} className="px-2 py-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-[#283548]">
        &rarr;
      </button>
    </div>
  )
}
