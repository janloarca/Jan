'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import AnimatedNumber from '@/components/ui/AnimatedNumber'
import { formatCurrency, formatDate, formatShortDate, getBaseCurrency, getTypeCategory, getItemValue, isExcludedFromNetWorth, TYPE_COLORS, CHART_PALETTE } from './utils'
import { InfoTip } from '../ui/Tooltip'
import { attributionRefusalText } from '@/lib/ytdAttribution'
import { computeDayMovers } from '@/lib/dayMovers'

const QUICK_CURRENCIES = ['USD', 'EUR', 'GBP', 'MXN', 'GTQ', 'COP', 'BRL', 'CAD']

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

// Los tres términos por cuenta (arranque / hoy / movimientos) más el ancla del
// portafolio. Un solo componente para los dos estados del panel (rechazo y
// éxito): dos copias del mismo render es como una se queda atrás.
// De dónde salió el arranque de cada cuenta. El arranque es el ÚNICO término
// estimado del reparto, así que es el único lugar por donde entra error: sin
// esto, una fila que no coincide con la gráfica de su cuenta obliga a deducir
// la fuente de los síntomas, que es lo que consume una ronda entera.
const START_SRC_LABEL = {
  api: { es: 'medido', en: 'measured' },
  sheet: { es: 'hoja', en: 'sheet' },
  flat: { es: 'estimado', en: 'estimated' },
  // Vino del API, pero el server no consiguió su historial de precios y lo
  // reconstruyó PLANO en el valor de hoy: el activo aporta cero al retorno del
  // período. Decir "medido" acá sería la afirmación más engañosa posible.
  flatprice: { es: 'sin precios: plano', en: 'no prices: flat' },
  new: { es: 'abrió este año', en: 'opened this year' },
  nav: { es: 'NAV broker', en: 'broker NAV' },
  derived: { es: 'despejado', en: 'derived' },
  mixed: { es: 'mixto', en: 'mixed' },
  none: { es: 'sin fuente', en: 'no source' },
}

// De qué DOC salió el ancla del año. Importa porque las dos formas se
// comportan distinto ante la reparación diaria: un doc derivado se re-deriva
// solo, una observación en vivo solo se reescribe si contradice a la
// composición por un margen ancho. Sin esto, un descuadre chico contra el
// ancla no se puede diagnosticar: no se sabe si va a corregirse o no.
const ANCHOR_SRC_LABEL = {
  daily: { es: 'observado', en: 'observed' },
  manual: { es: 'transcrito', en: 'transcribed' },
  backfill: { es: 'derivado', en: 'derived' },
  ibkr: { es: 'NAV broker', en: 'broker NAV' },
  ibkr_quarterly: { es: 'trimestre transcrito', en: 'transcribed quarter' },
}

function AccountTermsTable({ accounts, anchor, anchorTs, anchorSrc, measuredTs, unmappedStart = 0, unmappedCount = 0, lang, cv, displayCur }) {
  return (
    <div className="mt-2">
      {/* ⛔ FASE KJ. Un BLOQUE por cuenta, no una rejilla de 4 columnas.
          Medido en el navegador a 390px (el ancho del teléfono del usuario):
          los tres importes en mono se comían el ancho y dejaban 102px para el
          nombre, así que "Interactive Brokers* (NAV broker · 1 ene 2026)"
          ocupaba TRES líneas, y la última columna (Movimientos) se salía de la
          tarjeta y quedaba CORTADA contra el borde. Eso no es densidad, es
          información perdida.
          Y la alineación por columnas, que es lo que se pierde, tampoco era lo
          que hacía útil a esta tabla: la comparación entre cuentas ya está
          arriba, ordenada. Acá se viene a contestar una pregunta sobre UNA
          cuenta ("¿por qué dice +$383.93?"), así que cada cuenta se lee como
          una unidad. */}
      {/* Mismo orden que la lista de arriba (por tamaño), para poder moverse
          entre las dos sin buscar. El orden que trae el motor es el de su mapa
          de cuentas: no significa nada. */}
      <div className="space-y-2">
        {[...accounts]
          .sort((x, y) => Math.abs((y.end ?? 0) - (y.start ?? 0) - (y.flow ?? 0)) - Math.abs((x.end ?? 0) - (x.start ?? 0) - (x.flow ?? 0)))
          .map((a) => {
          // La identidad que el motor usa, escrita para que se pueda comprobar:
          // ganancia = hoy − arranque − movimientos. No es un cálculo nuevo (es
          // la definición de attributeYtd), y ponerla acá conecta el bloque con
          // la cifra de la lista de arriba en vez de dejarla en la cabeza.
          const gain = (a.end ?? 0) - (a.start ?? 0) - (a.flow ?? 0)
          const g = gain === 0 ? 0 : gain
          return (
            <div key={a.name} className="pt-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] leading-tight min-w-0" style={{ color: 'var(--text-secondary)' }}>
                  {a.name}{a.real ? <span style={{ color: 'var(--accent-blue)' }}>*</span> : ''}
                  {START_SRC_LABEL[a.src] && (
                    <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      ({START_SRC_LABEL[a.src][lang === 'es' ? 'es' : 'en']}
                      {/* FASE IX7. De qué día salió ese NAV. El arranque del
                          broker se resuelve con arrastre, así que "el 1 de
                          enero" puede ser en realidad el cierre del 31 de
                          diciembre (feriado de mercado). Sin la fecha, la única
                          forma de saber qué día se está usando era deducirlo de
                          que el número no cambiaba. */}
                      {a.srcDate ? ` · ${formatDate(`${a.srcDate}T00:00:00Z`)}` : ''})
                    </span>
                  )}
                </span>
                <span className="text-[11px] font-mono tabular-nums shrink-0"
                  style={{ color: g > 0 ? 'var(--accent-green)' : g < 0 ? 'var(--text-negative)' : 'var(--text-muted)' }}>
                  {g >= 0 ? '+' : ''}{formatCurrency(cv(g), displayCur)}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                {[
                  { k: 'start', label: lang === 'es' ? 'Arranque' : 'Start', v: a.start ?? 0 },
                  { k: 'end', label: lang === 'es' ? 'Hoy' : 'Now', v: a.end ?? 0 },
                  { k: 'flow', label: lang === 'es' ? 'Movimientos' : 'Flows', v: a.flow ?? 0 },
                ].map((term) => (
                  <span key={term.k} className="flex items-baseline gap-1">
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{term.label}</span>
                    <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {formatCurrency(cv(term.v), displayCur)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )
          })}
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-2 pt-2" style={{ borderTop: '1px solid var(--glass-border)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {lang === 'es' ? 'Arranque del portafolio' : 'Portfolio year-start'}
          {anchorTs ? <span className="ml-1 text-[10px]">({formatDate(new Date(anchorTs))})</span> : null}
          {ANCHOR_SRC_LABEL[anchorSrc] ? (
            <span className="ml-1 text-[10px]">· {ANCHOR_SRC_LABEL[anchorSrc][lang === 'es' ? 'es' : 'en']}</span>
          ) : null}
        </span>
        <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(cv(anchor ?? 0), displayCur)}</span>
      </div>
      {/* FASE IX8. Arranque que el motor SÍ midió y el panel no pudo colgar de
          ninguna cuenta. Separa las dos causas posibles de "Sin atribuir", que
          desde afuera se ven idénticas: si esta línea aparece, parte del residuo
          se está perdiendo ACÁ, al agrupar por cuenta; si no aparece, viene de
          que el ancla archivada y el motor reconstruyen distinto. Solo se
          muestra cuando hay algo que nombrar. */}
      {unmappedStart ? (
        <div className="flex items-baseline justify-between gap-2 mt-1">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {lang === 'es'
              ? `Arranque sin cuenta (${unmappedCount})`
              : `Start with no account (${unmappedCount})`}
          </span>
          <span className="text-[11px] font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(cv(unmappedStart), displayCur)}</span>
        </div>
      ) : null}
      {/* FASE IU: el panel mide los arranques en el punto donde el API entrega
          el desglose, que NO tiene por que caer en la fecha del ancla. Cuando
          se separan, cada fila mide su cuenta en otro dia, y en una cuenta
          volatil eso aparece como un desvio que no cuadra con nada. Solo se
          nombra cuando de verdad difieren: si coinciden, decirlo seria ruido. */}
      {measuredTs && anchorTs && new Date(measuredTs).toISOString().slice(0, 10) !== new Date(anchorTs).toISOString().slice(0, 10) && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          {lang === 'es'
            ? `Los arranques por cuenta se midieron el ${formatDate(new Date(measuredTs))}, no en la fecha del ancla.`
            : `Per-account starts were measured on ${formatDate(new Date(measuredTs))}, not on the anchor's date.`}
        </p>
      )}
      {accounts.some((a) => a.real) && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--accent-blue)' }}>*</span>{' '}
          {lang === 'es'
            ? 'arranque real del broker: nunca se ajusta.'
            : 'real broker year-start: never adjusted.'}
        </p>
      )}
    </div>
  )
}

function getGreeting(lang) {
  const hour = new Date().getHours()
  if (hour < 12) return lang === 'es' ? 'Buenos días' : 'Good morning'
  if (hour < 18) return lang === 'es' ? 'Buenas tardes' : 'Good afternoon'
  return lang === 'es' ? 'Buenas noches' : 'Good evening'
}

export default function NetWorthCard({ netWorth, returnYTD, ytdChange, returnSinceStart, sinceStartDate, dailyChange, convert, lang, netContributions, cashTotal, snapshots, items, ytdCalibrated, ytdBreakdown, ytdBreakdownReason, ytdBreakdownDetail, ytdBreakdownTerms, ytdDegradedAccounts, ytdStartValue = null, ytdStartTs = null, ytdStartSrc = null, ytdCalIgnored = 0, pricesUpdate = null }) {
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
    return segs
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

  // The YTD figure opens into its own parts: which institutions, and inside
  // them which holdings, actually produced the number. Closed by default so the
  // card stays a headline; one tap turns it into an explanation.
  const [showYTDDetail, setShowYTDDetail] = useState(false)
  const hasBreakdown = !!ytdBreakdown && ytdBreakdown.groups.length > 0
  // También se puede expandir cuando el motor REHUSÓ: antes el tap simplemente
  // no hacía nada y el usuario no tenía forma de saber por qué (FASE HT3). El
  // panel en ese caso explica la razón en vez de mostrar filas.
  const canExpandYTD = hasYTD && (hasBreakdown || !!ytdBreakdownReason)
  // El detalle por cuenta del rechazo es diagnóstico: vale tenerlo (una captura
  // del teléfono se vuelve el diagnóstico completo) pero no es lo que el
  // usuario viene a leer, así que arranca colapsado.
  const [showRefusalDetail, setShowRefusalDetail] = useState(false)
  // El texto de la librería viene en minúscula (está escrito para ir después de
  // dos puntos) y con un paréntesis explicativo al final. Aquí encabeza el
  // panel, así que se capitaliza; y el paréntesis se quita porque esa misma
  // explicación se renderiza abajo como su propia línea. La librería no se
  // toca: los reportes la siguen usando tal cual.
  const refusalHeadline = (() => {
    if (!ytdBreakdownReason) return ''
    const raw = attributionRefusalText(ytdBreakdownReason, lang === 'es' ? 'es' : 'en')
    const short = raw.replace(/\s*\([^)]*\)\s*$/, '')
    return short.charAt(0).toUpperCase() + short.slice(1)
  })()

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
    <div className="card card-hero bg-gradient-to-br from-theme-card to-theme-surface p-5 h-full flex flex-col">
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
            {canExpandYTD ? (
              <button type="button" onClick={() => setShowYTDDetail((v) => !v)}
                aria-expanded={showYTDDetail}
                className="font-mono tabular-nums underline decoration-dotted underline-offset-4 cursor-pointer"
                style={{ color: 'var(--text-primary)', textDecorationColor: 'var(--text-muted)' }}
                title={lang === 'es' ? 'Ver de dónde viene este número' : 'See where this number comes from'}>
                {ytdChange != null && isFinite(ytdChange) && (
                  <><AnimatedNumber value={cv(ytdChange)} format={(v) => `${v >= 0 ? '+' : ''}${formatCurrency(v, displayCur)}`} />{' '}</>
                )}
                {'('}<AnimatedNumber value={displayReturn} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`} />{')'}
                <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{showYTDDetail ? '▴' : '▾'}</span>
              </button>
            ) : (
              <span className="font-mono tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {hasYTD && ytdChange != null && isFinite(ytdChange) && (
                  <><AnimatedNumber value={cv(ytdChange)} format={(v) => `${v >= 0 ? '+' : ''}${formatCurrency(v, displayCur)}`} />{' '}</>
                )}
                {'('}<AnimatedNumber value={displayReturn} format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`} />{')'}
              </span>
            )}
            {hasYTD && <InfoTip text={lang === 'es' ? 'Year-to-Date: retorno desde el 1 de enero del año en curso. Calculado con el método Dietz Modificado, que descuenta tus depósitos y retiros para que solo cuente lo que ganaron tus inversiones (no el dinero nuevo que metiste).' : 'Year-to-Date: return since January 1st of the current year. Calculated with the Modified Dietz method, which adjusts for your deposits and withdrawals so only investment performance counts (not new money you put in).'} />}
            {ytdCalibrated && (
              <span className="ml-1 text-[10px]" style={{ color: 'var(--text-muted)' }}
                title={lang === 'es' ? 'Anclado al % que escribiste de tu broker. La curva intermedia se estima.' : 'Anchored to the % you typed from your broker. The in-between curve is estimated.'}>
                · {lang === 'es' ? 'calibrado' : 'calibrated'}
              </span>
            )}
          </span>
        )}
      </div>

      {/* What is behind the YTD number, by institution and then by holding.
          Each row is (value today − value on Jan 1) minus the money you moved
          in or out of it this year, so financing an account never shows up here
          as a profit. */}
      {canExpandYTD && showYTDDetail && (
        <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es' ? 'De dónde viene tu YTD' : 'Where your YTD comes from'}
            </span>
            <InfoTip text={lang === 'es'
              ? 'Por cada cuenta: valor de hoy menos valor de arranque del año, restando el dinero que metiste o sacaste. Los depósitos nunca cuentan como ganancia, y el dinero que pasa de una cuenta tuya a otra tampoco. El % es el retorno de esa cuenta, el mismo que ves en su gráfica. Las cuentas suman exactamente el YTD de arriba: si no cuadraran, este desglose no se muestra.'
              : 'Per account: today\'s value minus its year-start value, less any money you moved in or out. Deposits never count as gains, and neither does money moved between your own accounts. The % is that account\'s return, the same one its chart shows. The accounts add up to the YTD figure above exactly: if they did not, this breakdown would not be shown.'} />
          </div>
          {/* Motor rehusó: en vez de un tap muerto, el panel dice POR QUÉ no
              hay desglose (FASE HT3). El YTD de arriba sigue siendo correcto:
              lo que falta es el reparto por cuenta, no el número.
              FASE IC3: esto se veía como salida de consola en medio del
              dashboard (un párrafo largo con paréntesis técnicos + un volcado
              monoespaciado de los términos por cuenta). Ahora es una frase
              corta, las cifras del descuadre como dato con su etiqueta, y el
              detalle por cuenta detrás de un toggle y como TABLA alineada: la
              misma información, sin que parezca un log. */}
          {!hasBreakdown && (
            <div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {/* Sin el detalle numérico adentro: los números viven abajo, con
                    su etiqueta, en vez de entre paréntesis a mitad de frase. */}
                {refusalHeadline}
                {'. '}
                <span style={{ color: 'var(--text-muted)' }}>
                  {lang === 'es'
                    ? 'Tu YTD de arriba sigue siendo correcto: lo que falta es el reparto entre cuentas.'
                    : 'Your YTD above is still correct: what is missing is the split across accounts.'}
                </span>
              </p>

              {ytdBreakdownReason === 'unexplained-too-large' && ytdBreakdownDetail
                && isFinite(ytdBreakdownDetail.unexplained) && isFinite(ytdBreakdownDetail.cap) && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                  {[
                    { k: 'diff', label: lang === 'es' ? 'Diferencia' : 'Off by', value: Math.abs(ytdBreakdownDetail.unexplained) },
                    { k: 'cap', label: lang === 'es' ? 'Tolerancia' : 'Tolerance', value: Math.abs(ytdBreakdownDetail.cap) },
                  ].map((s) => (
                    <span key={s.k} className="flex items-baseline gap-1.5">
                      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
                      <span className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(cv(s.value), displayCur)}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Sin pedirle al usuario que apriete nada: Chispu regenera el
                  historial solo, una vez por día. La versión anterior mandaba a
                  "Agregar datos históricos" → "Reparar ahora"; el usuario lo
                  hizo, se reescribieron 219 días y el descuadre se movió $40,
                  o sea el consejo era trabajo manual que además no resolvía
                  nada. Un mensaje que manda a apretar un botón que la app ya
                  aprieta sola es peor que no decir nada. */}
              {ytdBreakdownReason === 'unexplained-too-large' && (
                <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {lang === 'es'
                    ? 'Chispu regenera el historial solo, sin que tengas que hacer nada. Si el desglose sigue sin aparecer, el detalle de abajo dice qué cuenta no cuadra.'
                    : 'Chispu regenerates history on its own, with nothing for you to do. If the breakdown still does not appear, the detail below says which account does not add up.'}
                </p>
              )}

              {/* FASE IB: los términos por cuenta del intento que rehusó. Con
                  solo el residuo total supimos la ESCALA del problema pero no
                  qué cuenta lo causaba; esta tabla convierte una captura del
                  teléfono en el diagnóstico completo (misma lección que el
                  reporte de "Reparar ahora", FASE HP). Colapsada por default:
                  es diagnóstico, no algo que el usuario venga a leer. */}
              {Array.isArray(ytdBreakdownDetail?.accounts) && ytdBreakdownDetail.accounts.length > 0 && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowRefusalDetail((v) => !v)}
                    aria-expanded={showRefusalDetail}
                    className="text-[11px] underline decoration-dotted underline-offset-2 cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}>
                    {showRefusalDetail
                      ? (lang === 'es' ? 'Ocultar detalle por cuenta' : 'Hide per-account detail')
                      : (lang === 'es' ? 'Ver detalle por cuenta' : 'See per-account detail')}
                  </button>
                  {showRefusalDetail && (
                    <AccountTermsTable accounts={ytdBreakdownDetail.accounts} anchor={ytdBreakdownDetail.anchor} anchorTs={ytdBreakdownDetail.anchorTs} anchorSrc={ytdBreakdownDetail.anchorSrc} measuredTs={ytdBreakdownDetail.measuredTs} unmappedStart={ytdBreakdownDetail.unmappedStart} unmappedCount={ytdBreakdownDetail.unmappedCount}
                      lang={lang} cv={cv} displayCur={displayCur} />
                  )}
                </div>
              )}
            </div>
          )}
          {/* One row per ACCOUNT (FASE GR). Every account is listed, including
              ones that contributed nothing: the previous version hid near-zero
              rows and accounts simply looked missing. */}
          <div className="space-y-2">
            {hasBreakdown && ytdBreakdown.groups.map((g) => (
              <div key={g.key} className="flex items-baseline justify-between gap-2">
                <span className="text-sm truncate" style={{ color: g.isUnexplained ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                  {g.isUnexplained
                    ? (lang === 'es' ? 'Sin atribuir' : 'Unattributed')
                    : (g.name || (lang === 'es' ? 'Sin institución' : 'No institution'))}
                </span>
                <span className="text-sm font-mono tabular-nums shrink-0" style={{ color: 'var(--text-primary)' }}>
                  {/* The account's OWN return, not its share of the total gain.
                      The share read as a return and was not one: a broker up
                      7.40% on the year showed "75%" next to it, which only meant
                      "most of this year's gain came from here". */}
                  {/* FASE KJ: `-0` normalizado a `0`. Una cuenta que no movió
                      nada (Banco Industrial: 4741.15 − 602.15 − 4139.00 = 0)
                      puede caer en cero NEGATIVO, y ahí `gain >= 0` es true en
                      JS (imprime '+') mientras Intl formatea -0 como "-$0.00":
                      el resultado era un "+-$0.00" en pantalla. */}
                  {g.ret != null && isFinite(g.ret) && (
                    <span className="mr-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {(g.ret === 0 ? 0 : g.ret) >= 0 ? '+' : ''}{(g.ret === 0 ? 0 : g.ret).toFixed(2)}%
                    </span>
                  )}
                  {(g.gain === 0 ? 0 : g.gain) >= 0 ? '+' : ''}{formatCurrency(cv(g.gain === 0 ? 0 : g.gain), displayCur)}
                </span>
              </div>
            ))}
          </div>
          {/* FASE IH: una cuenta cuyo arranque salió de un precio que no se
              pudo traer no está medida (quedó plana al valor de hoy). Decirlo
              en una línea es la diferencia entre una cifra que el usuario puede
              descartar y una que lo hace dudar de todo el panel. */}
          {/* FASE IJ: por qué una fila puede no coincidir con la gráfica de su
              propia cuenta. La gráfica escopada netea solo depósitos y retiros,
              así que un traspaso entre cuentas propias lo lee como rendimiento
              (pérdida en la que envía, ganancia en la que recibe); el panel sí
              lo netea, porque si no las filas no sumarían el encabezado. Nombrar
              el monto convierte una contradicción aparente en un hecho. */}
          {hasBreakdown && ytdBreakdown.groups.some((g) => Math.abs(g.internal || 0) >= 1) && (
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es' ? 'Movido entre tus propias cuentas: ' : 'Moved between your own accounts: '}
              {ytdBreakdown.groups
                .filter((g) => Math.abs(g.internal || 0) >= 1)
                .map((g) => `${g.name} ${g.internal >= 0 ? '+' : '−'}${formatCurrency(cv(Math.abs(g.internal)), displayCur)}`)
                .join(' · ')}
              {lang === 'es'
                ? '. Eso no es rendimiento y por eso se descuenta acá; la gráfica de esa cuenta no lo descuenta, así que va a mostrar otro número.'
                : '. That is not performance, so it is netted out here; that account\'s chart does not net it, so it will show a different figure.'}
            </p>
          )}
          {/* ⛔ FASE NL. El valor con el que arrancó el año, dicho de frente.
              TODO el YTD (el número grande, su %, y cada fila de este panel)
              cuelga de este único dato, y el panel nunca lo enunciaba: cuando
              el usuario reportó "los números no encajan del todo", la única
              forma de saber contra qué se estaba midiendo fue despejar el
              ancla del Dietz a mano desde una captura (salió 9,305.22 contra
              los 5,432.98 que el propio broker reporta para diciembre). Es la
              lección de FASE HP otra vez: un dato que la app ya tiene y no
              muestra cuesta una ronda entera de diagnóstico.

              Va como UNA línea y no como la tabla de términos que FASE KK
              quitó a pedido del usuario: acá el panel ya cuadra, esto es el
              punto de partida, no un volcado forense. */}
          {hasBreakdown && ytdStartValue != null && isFinite(ytdStartValue) && ytdStartValue > 0 && (
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es' ? 'Arranque del año: ' : 'Year-start: '}
              <span className="font-mono tabular-nums">{formatCurrency(cv(ytdStartValue), displayCur)}</span>
              {ytdStartTs ? ` · ${formatDate(new Date(ytdStartTs))}` : ''}
              {ANCHOR_SRC_LABEL[ytdStartSrc] ? ` · ${ANCHOR_SRC_LABEL[ytdStartSrc][lang === 'es' ? 'es' : 'en']}` : ''}
            </p>
          )}
          {/* FASE NN: una calibración que el NAV real del broker contradice se
              deja de aplicar, y eso hay que DECIRLO. El usuario tecleó ese
              porcentaje y sigue guardado; si el arranque cambia sin una
              palabra, la app se ve como que le borró el trabajo. */}
          {hasBreakdown && ytdCalIgnored > 0 && (
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--alert-warn-icon)' }}>
              {lang === 'es'
                ? `Se está ignorando ${ytdCalIgnored === 1 ? 'una calibración' : `${ytdCalIgnored} calibraciones`} de cuenta: el % que copiaste no cuadra con el valor que tu broker reporta para esa fecha. Vuelve a copiarlo desde tu broker para usarlo.`
                : `Ignoring ${ytdCalIgnored === 1 ? 'one account calibration' : `${ytdCalIgnored} account calibrations`}: the % you copied does not match the value your broker reports for that date. Copy it again from your broker to use it.`}
            </p>
          )}
          {hasBreakdown && Array.isArray(ytdDegradedAccounts) && ytdDegradedAccounts.length > 0 && (
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es'
                ? `Arranque de año ESTIMADO en ${ytdDegradedAccounts.join(', ')}: su fila puede no coincidir con su propia gráfica.`
                : `Year-start is ESTIMATED for ${ytdDegradedAccounts.join(', ')}: their row may not match their own chart.`}
            </p>
          )}
          {/* ⛔ FASE KK. Acá vivía "Ver detalle por cuenta" (FASE IK): los tres
              términos de cada fila cuando el panel SÍ muestra. Existió para
              diagnosticar una fila que no coincidía con la gráfica de su
              cuenta, y cumplió su trabajo: con el desglose ya cuadrando al
              centavo (FASE KH) es un volcado forense encima de un número que ya
              es correcto, y el usuario pidió quitarlo.
              La MISMA tabla sigue montada en la rama de RECHAZO (arriba): ahí el
              panel se niega a mostrar y esos términos son lo único que dice qué
              cuenta no cuadra, o sea justo cuando hace falta. */}
          {hasBreakdown && ytdBreakdown.groups.some((g) => g.isUnexplained) && (
            <p className="text-[10px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {lang === 'es'
                ? 'Cada cuenta muestra su propio número. Lo que no calza con el total va aparte, sin repartirlo entre las cuentas: viene del valor de arranque estimado de las cuentas sin historial del broker.'
                : 'Each account shows its own figure. Whatever does not match the total is listed separately rather than spread across accounts: it comes from the estimated year-start of accounts without broker history.'}
            </p>
          )}
        </div>
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
          <div className="grid grid-cols-2 gap-x-5 gap-y-2">
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
  )
}
