'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatDate, formatShortDate, getBaseCurrency, getTypeCategory, getItemValue, isExcludedFromNetWorth, TYPE_COLORS, CHART_PALETTE } from './utils'
import { InfoTip } from '../ui/Tooltip'
import { YtdBreakdownToggle } from './YtdBreakdownSection'
import { computeDayMovers } from '@/lib/dayMovers'

const QUICK_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

// Orden de lectura de la barra de composición (el resto va detrás, por valor).
export const COMPOSITION_ORDER = ['bonds', 'stocks', 'crypto', 'banks']

const CATEGORY_LABELS = {
  banks: { es: 'Caja & Bancos', en: 'Cash & Banks' },
  funds: { es: 'Fondos', en: 'Funds' },
  stocks: { es: 'Acciones', en: 'Stocks' },
  crypto: { es: 'Cripto', en: 'Crypto' },
  alternatives: { es: 'Alternativos', en: 'Alternatives' },
  bonds: { es: 'Bonos', en: 'Bonds' },
  realestate: { es: 'Bienes Raíces', en: 'Real Estate' },
  receivables: { es: 'Por Cobrar', en: 'Receivables' },
  other: { es: 'Otros', en: 'Other' },
}

function getGreeting(lang) {
  const hour = new Date().getHours()
  if (hour < 12) return lang === 'es' ? 'Buenos días' : 'Good morning'
  if (hour < 18) return lang === 'es' ? 'Buenas tardes' : 'Good afternoon'
  return lang === 'es' ? 'Buenas noches' : 'Good evening'
}

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, returnSinceStart, sinceStartDate, dailyChange, convert, lang, netContributions, cashTotal, snapshots, items, ytdCalibrated, ytdBreakdown, ytdBreakdownReason, ytdAnchorIgnored = 0, pricesUpdate = null, scopedView = false, ytdBreakdownOpen = false, onToggleYtdBreakdown = null }) {
  const hasYTD = returnYTD != null && isFinite(returnYTD)
  const displayReturn = hasYTD ? returnYTD : (returnSinceStart != null && isFinite(returnSinceStart) ? returnSinceStart : null)
  const hasReturn = displayReturn != null
  const isYTDPositive = (displayReturn ?? 0) >= 0
  const isDayPositive = dailyChange ? dailyChange.abs >= 0 : true
  const baseCur = getBaseCurrency()
  const [tempCurrency, setTempCurrency] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!showPicker) return
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const displayCur = tempCurrency || baseCur
  const cv = (val) => tempCurrency && convert ? convert(val, baseCur, tempCurrency) : val
  const displayValue = cv(netWorth)

  const greeting = getGreeting(lang)

  // Asset-class composition of net worth — fills the card and explains where
  // the money sits. Percentages are currency-agnostic; values use cv() so they
  // follow the temporary currency picker like the rest of the card.
  const allocation = useMemo(() => {
    if (!items || items.length === 0) return []
    const byGroup = {}
    let total = 0
    items.forEach((it) => {
      if (it.isDebt || isExcludedFromNetWorth(it)) return
      const val = getItemValue(it)
      if (val <= 0) return
      const key = getTypeCategory(it)
      byGroup[key] = (byGroup[key] || 0) + val
      total += val
    })
    let segs = Object.entries(byGroup)
      .map(([name, value], i) => ({
        name, value,
        pct: total > 0 ? (value / total) * 100 : 0,
        color: TYPE_COLORS[name]?.bg || CHART_PALETTE[i % CHART_PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value)
    // El colapso a "Otros" sigue decidiéndose por VALOR (lo chico se agrupa);
    // lo que cambia abajo es solo el ORDEN en que se dibuja lo que queda.
    if (segs.length > 5) {
      const tail = segs.slice(4)
      segs = segs.slice(0, 4)
      segs.push({
        name: '_more', isOther: true, count: tail.length,
        value: tail.reduce((s, x) => s + x.value, 0),
        pct: tail.reduce((s, x) => s + x.pct, 0),
        color: 'var(--text-muted)',
      })
    }
    // Rediseño, sección 1: orden FIJO de lectura (Bonos, Acciones, Cripto,
    // Caja & Bancos, y después el resto por valor, "Otros" siempre al final).
    // Con el orden por valor la barra se reacomodaba sola cada vez que una
    // clase le pasaba a otra, y el ojo tenía que volver a buscar cada color.
    // Es solo orden de dibujo: ningún porcentaje ni monto cambia.
    const rank = (seg) => {
      if (seg.isOther) return 1e9
      const i = COMPOSITION_ORDER.indexOf(seg.name)
      return i >= 0 ? i : COMPOSITION_ORDER.length
    }
    return segs
      .map((seg, i) => ({ seg, i }))
      .sort((a, b) => (rank(a.seg) - rank(b.seg)) || (a.i - b.i))
      .map(({ seg }) => seg)
  }, [items])

  const catLabel = (seg) => seg.isOther
    ? (lang === 'es' ? `Otros (${seg.count})` : `Others (${seg.count})`)
    : (CATEGORY_LABELS[seg.name]?.[lang] || seg.name)

  // Biggest movers of the day, split into two tabs (gainers / losers) instead
  // of one combined list — a portfolio with 5+ gainers used to bury every
  // loser past the slice(0,5) cut, so "biggest movers" only ever showed green.
  // Each row carries the dollar swing AND its impact on the whole portfolio
  // (weight × change1d, same formula as lib/friendsStats.js's movers) — the
  // % you'd otherwise only see is the position's OWN day change, which says
  // nothing about how much it actually moved your net worth. Deduped by item
  // id (two holdings sharing a symbol must not shadow each other) and gated
  // by position weight: a $5 position's ±10% shouldn't headline the card.
  // ⛔ FASE KN: el motor vive en lib/dayMovers.js, agregado POR ACTIVO. Este
  // bloque deduplicaba por ID DE ÍTEM, así que el mismo activo en dos cuentas
  // producía DOS filas compitiendo entre sí, y como el render las llaveaba por
  // etiqueta, esas dos filas homónimas dejaban un nodo rancio al cambiar de
  // pestaña (la lista de perdedores abría con una fila verde de ganancia).
  const movers = useMemo(() => computeDayMovers({
    items,
    getValue: getItemValue,
    isEligible: (it) => !it.isDebt && !isExcludedFromNetWorth(it),
  }), [items])

  // ⛔ FASE OZ. El desglose del YTD ya NO vive dentro de esta card: es una
  // sección de ancho completo, hermana de esta card y de la gráfica en el grid
  // del tablero (`YtdBreakdownSection`). Abrirlo no puede cambiar la altura de
  // esta card. Acá solo queda el CTA que la abre, y se ofrece cuando hay algo
  // que mostrar: un reparto, o la razón por la que el motor rehusó (FASE HT3:
  // un tap muerto no le dice nada a nadie).
  const hasBreakdown = !!ytdBreakdown && ytdBreakdown.groups.length > 0
  const canExpandYTD = hasYTD && (hasBreakdown || !!ytdBreakdownReason) && typeof onToggleYtdBreakdown === 'function'

  const [moversTab, setMoversTab] = useState('gainers')
  // If the tab the user is on empties out (e.g. everything is up today) and
  // the other one has content, land on the one with something to show.
  useEffect(() => {
    if (moversTab === 'gainers' && movers.gainers.length === 0 && movers.losers.length > 0) setMoversTab('losers')
    if (moversTab === 'losers' && movers.losers.length === 0 && movers.gainers.length > 0) setMoversTab('gainers')
  }, [movers, moversTab])

  // ⛔ FASE KN. BAJO QUÉ HORARIO corre esta lista. La respuesta honesta es que
  // NO hay un solo horario, y ese era el problema: para una acción `change1d`
  // mide la última SESIÓN BURSÁTIL completada (hora del exchange), y para cripto
  // una ventana RODANTE de 24 horas. La misma lista mezclaba las dos sin
  // decirlo, y un sábado titulaba "hoy" el movimiento del viernes.
  //
  // En vez de inventar un horario propio o de adivinar cuándo abre cada bolsa,
  // se usa la fecha que trae la PROPIA cotización: si la sesión más rancia de la
  // lista no es la de hoy, el título deja de decir "hoy" y nombra esa sesión.
  // Eso cubre fines de semana, feriados, medias sesiones y bolsas extranjeras
  // sin una sola hora escrita a mano.
  const { moversTitle, staleSessionNote } = useMemo(() => {
    const t = (es, en) => (lang === 'es' ? es : en)
    const notes = []

    const todayLocal = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
    const closedSession = movers.asOf && movers.asOf < todayLocal ? movers.asOf : null
    if (closedSession) {
      const label = formatDate(`${closedSession}T12:00:00Z`)
      notes.push(t(
        `Mercado cerrado: las acciones muestran su sesión del ${label}. La cripto sí son las últimas 24 h.`,
        `Market closed: stocks show their ${label} session. Crypto is the last 24h.`
      ))
    }

    // De DÓNDE y de CUÁNDO salen estos montos. La cotización no es en vivo: se
    // pide cada 5 minutos y el servidor la cachea otros 5, así que a media
    // sesión puede ir varios minutos atrás de lo que muestra el broker. Decir la
    // hora es lo único honesto: los montos no van a coincidir al centavo con una
    // pantalla en tiempo real, y sin esto parece un error de cálculo.
    if (pricesUpdate) {
      const d = new Date(pricesUpdate)
      if (!isNaN(d)) {
        const hhmm = d.toLocaleTimeString(lang === 'es' ? 'es' : 'en', { hour: '2-digit', minute: '2-digit' })
        notes.push(t(`Precios de las ${hhmm}, no en tiempo real.`, `Prices as of ${hhmm}, not real time.`))
      }
    }

    // Una fila servida desde el respaldo de precios puede tener días.
    const stalest = [...movers.gainers, ...movers.losers].filter((m) => m.stale).map((m) => m.label)
    if (stalest.length > 0) {
      notes.push(t(
        `Sin cotización fresca de ${stalest.join(', ')}: se usó la última conocida.`,
        `No fresh quote for ${stalest.join(', ')}: last known price used.`
      ))
    }

    return {
      moversTitle: closedSession
        ? t('Movimientos del último cierre', 'Moves at the last close')
        : t('Mayores movimientos hoy', "Today's biggest movers"),
      staleSessionNote: notes.length > 0 ? notes.join(' ') : null,
    }
  }, [movers, lang, pricesUpdate])

  // La columna derecha del hero solo existe si tiene algo: sin movimientos ni
  // efectivo, la card vuelve a una sola columna en vez de dejar media vacía.
  const hasSide = movers.gainers.length > 0 || movers.losers.length > 0 || (cashTotal != null && cashTotal > 0)

  const touchStartX = useRef(null)
  const onMoversTouchStart = (e) => { touchStartX.current = e.touches[0].clientX }
  const onMoversTouchEnd = (e) => {
    if (touchStartX.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) < 40) return // ignore taps/scrolls, only real swipes
    if (dx < 0 && movers.losers.length > 0) setMoversTab('losers')
    if (dx > 0 && movers.gainers.length > 0) setMoversTab('gainers')
  }

  // El contenedor ya no lleva `style` inline: duplicaba EXACTAMENTE lo que
  // .card-hero pone (sombra, borde, blur). Y no era inocuo: el tema claro apaga
  // el glassmorphism a propósito con `[data-theme="light"] .card-hero {
  // backdrop-filter: none }`, pero una regla CSS no puede vencer a un estilo
  // inline, así que esta card seguía creando una capa de composición en tema
  // claro contra la regla que el propio globals.css declara.
  // `card card-hero`: el fondo/borde/radio salen de .card como cualquier otra
  // card, y .card-hero solo aporta la sombra más profunda. Se va `rounded-2xl`
  // porque es exactamente el mismo 16px que .card ya pone.
  // El gradiente se queda: pinta encima del background-color de .card (es
  // background-IMAGE). En tema claro los dos extremos son #FFFFFF, así que ahí
  // no cambia un píxel; en oscuro el fondo queda un punto más opaco
  // (rgb(19,19,31) → rgb(23,23,36)), que para la card hero es la dirección
  // correcta.
  return (
    <div className={`card card-hero bg-gradient-to-br from-theme-card to-theme-surface p-5 sm:p-6 h-full flex flex-col${hasSide ? ' lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-x-8' : ''}`}>
      {/* Rediseño, sección 1 (hero). La card ocupa la fila entera del tablero,
          así que desde lg reparte su contenido en dos columnas: a la izquierda
          la cifra, el día, el YTD y la composición; a la derecha los
          movimientos del día y el efectivo. En móvil y tablet se apila igual
          que siempre. Nada se quitó: solo se reubicó. */}
      <div className="flex flex-col min-w-0">
      {/* Greeting + currency picker — the milestone pill (a second colored
          badge next to the picker) is gone: the combined today/YTD line below
          already says whether things are up or down, so a second label
          restating it in a pill was noise, not information. */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{greeting}</span>
        <div className="relative" ref={pickerRef}>
          <button onClick={() => setShowPicker(!showPicker)}
            className="text-xs px-2 py-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            style={{ border: '1px solid transparent', ...(showPicker ? { backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', border: 'var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.05)' } : {}) }}>
            {displayCur}
          </button>
          {showPicker && (
            <div className="absolute right-0 top-full mt-1 bg-theme-card/80 rounded-lg z-10 p-1 min-w-[80px]"
              style={{ backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)', boxShadow: 'var(--shadow-elevated)', border: 'var(--glass-border)' }}>
              {QUICK_CURRENCIES.map((c) => (
                <button key={c} onClick={() => { setTempCurrency(c === baseCur ? null : c); setShowPicker(false) }}
                  className="block w-full text-left px-3 py-1.5 text-xs rounded transition-colors"
                  style={displayCur === c ? { color: 'var(--accent-blue)', backgroundColor: 'rgba(37,99,235,0.1)' } : { color: 'var(--text-secondary)' }}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KPI: Main value — Level 1 typography, the one hero figure in the
          view. No sparkline beside it: at 60x24px it had no axis, no label
          and no legend, so it read as decoration nobody could interpret —
          the real chart is one tap away in the Valor/Rendimiento card. */}
      {/* Sin `drop-shadow-sm`: una sombra sobre un numeral de 48px es lo que
          hacía que la negrita sintetizada se viera sucia, y con el peso 700 ya
          cargado de verdad (app/layout.jsx) no aporta nada.
          `text-white` a var(--text-primary): no-op demostrable en ambos temas
          (en oscuro los dos son #FFFFFF, y en claro globals.css ya remapea
          .text-white a esa misma variable), pero quita una dependencia
          implícita de un remapeo que vive en otro archivo. */}
      {/* La cifra se MUEVE de su valor viejo al nuevo en vez de saltar. Es el
          número que más cambia solo de toda la app (cada tick de precios lo
          toca) y hasta hoy pasaba de A a B en un frame.
          Las reglas de cuándo NO animar viven en lib/tween.js: no anima en el
          primer render ni cuando el dato recién llega, así que abrir la app no
          se convierte en un contador de cajero. */}
      {/* La cifra grande no tenía ningún rótulo que dijera qué es: el número
          más prominente del dashboard, sin nombre. "Patrimonio neto" +
          InfoTip, mismo tratamiento que el resto de las cards. Sin deudas
          coincide con el total de activos, así que no hace falta aclarar
          nada más (mismo criterio que la caption "(solo activos)" de
          AssetAllocation, condicional a `items.some(it => it.isDebt)`). */}
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {lang === 'es' ? 'Patrimonio neto' : 'Net worth'}
        </span>
        <InfoTip text={lang === 'es'
          ? 'Tus activos registrados menos tus deudas.'
          : 'Your registered assets minus your debts.'} />
      </div>
      <AnimatedNumber
        value={displayValue}
        format={(v) => formatCurrency(v, displayCur)}
        className="block min-w-0 text-[2.25rem] sm:text-[3rem] leading-none tracking-tight font-bold font-mono mb-1.5"
        style={{ color: 'var(--text-primary)' }} />

      {/* Today + YTD, one line. Direction lives ONLY in the small arrow —
          the numbers themselves stay in plain text color, so the line reads
          as one calm sentence instead of two competing red/green claims. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {dailyChange && isFinite(dailyChange.pct) && (
          <span className="whitespace-nowrap">
            <span className="text-[11px] font-semibold tracking-wide mr-1" style={{ color: 'var(--text-muted)' }}>{lang === 'es' ? 'HOY' : 'TODAY'}</span>
            <span style={{ color: isDayPositive ? 'var(--accent-green)' : 'var(--text-negative)' }}>{isDayPositive ? '▲' : '▼'}</span>
            {' '}
            <span className="font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {/* El signo sale del valor que se está MOSTRANDO, no de una
                  bandera de afuera: si no, a mitad del movimiento un número que
                  ya cruzó a negativo seguiría imprimiendo "+". */}
              <AnimatedNumber value={cv(dailyChange.abs)} format={(v) => `${v >= 0 ? '+' : ''}${formatCurrency(v, displayCur)}`} />
              {' ('}
              <AnimatedNumber value={dailyChange.pct} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`} />
              {')'}
            </span>
          </span>
        )}
        {dailyChange && hasReturn && <span aria-hidden="true" style={{ color: 'var(--glass-border)' }}>│</span>}
        {hasReturn && (
          <span className="whitespace-nowrap">
            <span className="text-[11px] font-semibold tracking-wide mr-1" style={{ color: 'var(--text-muted)' }}>
              {hasYTD ? 'YTD' : ((lang === 'es' ? 'DESDE ' : 'SINCE ') + (sinceStartDate ? formatShortDate(sinceStartDate) : ''))}
            </span>
            <span style={{ color: isYTDPositive ? 'var(--accent-green)' : 'var(--text-negative)' }}>{isYTDPositive ? '▲' : '▼'}</span>
            {' '}
            <span className="font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {hasYTD && ytdChange != null && isFinite(ytdChange) && (
                <><AnimatedNumber value={cv(ytdChange)} format={(v) => `${v >= 0 ? '+' : ''}${formatCurrency(v, displayCur)}`} />{' '}</>
              )}
              {'('}<AnimatedNumber value={displayReturn} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`} />{')'}
            </span>
            {hasYTD && <InfoTip text={lang === 'es' ? 'El rendimiento YTD compara el patrimonio actual con el valor al inicio del año. Las transferencias entre cuentas propias no se consideran rendimiento.' : 'YTD performance compares your current net worth with its value at the start of the year. Transfers between your own accounts are not counted as performance.'} />}
            {ytdCalibrated && (
              <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}
                title={lang === 'es' ? 'Anclado al % que escribiste de tu broker. La curva intermedia se estima.' : 'Anchored to the % you typed from your broker. The in-between curve is estimated.'}>
                · {lang === 'es' ? 'calibrado' : 'calibrated'}
              </span>
            )}
          </span>
        )}
      </div>

      {/* El CTA que abre la sección de ancho completo de abajo. Texto + chevron
          (no solo un ícono), con aria-expanded/aria-controls apuntando a la
          región `#ytd-breakdown`, que vive fuera de esta card. */}
      {canExpandYTD && (
        <div className="mt-1">
          <YtdBreakdownToggle open={ytdBreakdownOpen} onToggle={onToggleYtdBreakdown} lang={lang} />
        </div>
      )}

      {/* ⛔ FASE NP. El aviso va FUERA del panel expandible, a diferencia del de
          FASE NN: acá lo que se dejó de usar es el ancla del AÑO, o sea el
          número grande de arriba cambió de valor. Un arranque que cambia sin
          una palabra se lee como que la app borró el trabajo del usuario. */}
      {/* FASE OG: con un portafolio o una entidad seleccionados el archivo de
          snapshots (patrimonio COMPLETO) no aplica: el YTD sale de la
          reconstrucción de este subconjunto, y lo que solo se mide contra el
          archivo (el mes, el riesgo, el historial) no se muestra en vez de
          medirse contra el universo equivocado. Se dice, porque un "-" sin
          razón se lee como que algo se rompió (la lección de FASE JK). */}
      {scopedView && (
        <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {lang === 'es'
            ? 'Solo lo seleccionado: el rendimiento se reconstruye para este subconjunto. El mes, el riesgo y el historial archivado se miden sobre tu patrimonio completo y no se muestran aquí.'
            : 'Selection only: the return is rebuilt for this subset. Month, risk and archived history are measured on your whole net worth and are not shown here.'}
        </p>
      )}
      {ytdAnchorIgnored > 0 && (
        <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
          {lang === 'es'
            ? `No se está usando ${ytdAnchorIgnored === 1 ? 'una calibración' : `${ytdAnchorIgnored} calibraciones`} como arranque del año: el valor que sale de ese % no cuadra con lo que la app midió el día de al lado, sin que haya entrado ni salido dinero. Vuelve a copiar el % desde tu broker para usarlo.`
            : `Not using ${ytdAnchorIgnored === 1 ? 'one calibration' : `${ytdAnchorIgnored} calibrations`} as the year's starting point: the value that % solves to does not match what the app measured the very next day, with no money moving in or out. Copy the % again from your broker to use it.`}
        </p>
      )}

      {/* Composition — fills the card, shows where the net worth sits */}
      {allocation.length > 0 && (
        <div className="mt-3 pt-3 border-t border-glass-border/50">
          <span className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2.5 block">{lang === 'es' ? 'Composición' : 'Composition'}</span>
          {/* Stacked bar */}
          {/* 2px of surface between segments: without the gap two adjacent
              fills read as one block wherever their hues are close, which is
              exactly where the eye needs the boundary most. */}
          <div className="w-full h-2.5 rounded-full overflow-hidden flex gap-[2px] mb-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            {allocation.map((seg) => (
              <div key={seg.name} className="h-full rounded-full"
                style={{ width: `${Math.max(seg.pct, 0.5)}%`, backgroundColor: seg.color }}
                title={`${catLabel(seg)} · ${seg.pct.toFixed(1)}%`} />
            ))}
          </div>
          {/* Legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-x-5 gap-y-2">
            {allocation.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between gap-2 min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                  <span className="text-xs text-slate-400 truncate">{catLabel(seg)}</span>
                </span>
                <span className="text-xs font-medium font-mono tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>{seg.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      {hasSide && (
      <div className="flex flex-col min-w-0 lg:pl-8 lg:border-l lg:border-glass-border/50 lg:[&>*:first-child]:mt-0 lg:[&>*:first-child]:pt-0 lg:[&>*:first-child]:border-t-0">
      {/* Biggest movers of the day — a tab per direction (swipe or tap),
          so a green-heavy day no longer buries every loser. Only the arrow
          carries green/red; the $ and portfolio-% stay plain text so rows
          read as one calm list either way. */}
      {(movers.gainers.length > 0 || movers.losers.length > 0) && (() => {
        const activeList = moversTab === 'gainers' ? movers.gainers : movers.losers
        return (
          <div className="mt-3 pt-3 border-t border-glass-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{moversTitle}</span>
              {movers.gainers.length > 0 && movers.losers.length > 0 && (
                <div className="flex gap-0.5 rounded-md p-0.5" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  {[
                    { key: 'gainers', icon: '▲', n: movers.gainers.length },
                    { key: 'losers', icon: '▼', n: movers.losers.length },
                  ].map((tab) => (
                    <button key={tab.key} type="button" onClick={() => setMoversTab(tab.key)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums transition-colors"
                      style={moversTab === tab.key
                        ? { color: tab.key === 'gainers' ? 'var(--accent-green)' : 'var(--text-negative)', backgroundColor: 'var(--bg-card)' }
                        : { color: 'var(--text-muted)' }}>
                      {tab.icon} {tab.n}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* key={moversTab}: cada pestaña es su propio subárbol, así que
                cambiar de pestaña DESMONTA la lista vieja entera en vez de
                reconciliar fila por fila. Defensa en profundidad contra la
                clase de bug que dejó una fila verde de ganancia colgada arriba
                de la lista de perdedores; las filas no tienen estado propio,
                así que remontarlas no cuesta nada. */}
            <div key={moversTab} className="space-y-1" onTouchStart={onMoversTouchStart} onTouchEnd={onMoversTouchEnd}>
              {activeList.map((m) => {
                // La dirección sale de la FILA, no de la pestaña: una flecha no
                // puede contradecir el signo del monto que tiene al lado.
                const up = m.dollarChange >= 0
                return (
                  <div key={m.key} className="flex items-center justify-between">
                    <span className="text-sm truncate pr-2" style={{ color: 'var(--text-secondary)' }}>
                      {m.label}
                      {/* Cuántas posiciones se fusionaron acá. Sin esto, alguien
                          con BTC en dos cuentas ve un monto que no cuadra con
                          ninguna de las dos por separado. */}
                      {m.count > 1 && (
                        <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>
                          {' '}{lang === 'es' ? `· ${m.count} cuentas` : `· ${m.count} accounts`}
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                      <span style={{ color: up ? 'var(--accent-green)' : 'var(--text-negative)' }}>{up ? '▲' : '▼'}</span>
                      {' '}{up ? '+' : ''}{formatCurrency(cv(m.dollarChange), displayCur)} ({up ? '+' : ''}{m.impactPct.toFixed(2)}%)
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es' ? '% = impacto sobre tu portafolio total' : '% = impact on your total portfolio'}
            </p>
            {staleSessionNote && (
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{staleSessionNote}</p>
            )}
          </div>
        )
      })()}

      {/* Cash available — anchored at the bottom */}
      {cashTotal != null && cashTotal > 0 && (
        <div className="mt-auto pt-3 border-t border-glass-border/50 flex items-center justify-between">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--accent-cyan)', opacity: 0.6 }} />
            {lang === 'es' ? 'Disponible' : 'Cash available'}
          </span>
          <AnimatedNumber value={cv(cashTotal)} format={(v) => formatCurrency(v, displayCur)} className="text-xs font-medium font-mono" style={{ color: 'var(--accent-cyan)' }} />
        </div>
      )}
      </div>
      )}
    </div>
  )
}
