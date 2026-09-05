// El viaje de IBKR como DATOS: los cuatro requisitos que hay detrás de
// "Llevar Interactive Brokers al 100%", con el estado de cada uno y un
// porcentaje de avance.
//
// Por qué existe aparte de lib/brokerCompletion.js: ese módulo describe los
// TRES pasos que gatean la inferencia de flujos (hasCompleteBrokerData), y su
// lista no puede crecer sin endurecer ese gate. Lo que la UI necesita mostrar
// es otra cosa: el viaje de 5 pasos que el usuario recorre (FASE GM), donde
// "traer los últimos ~365 días" es un requisito visible por derecho propio
// (es el paso 2 del viaje: subir el Flex XML) aunque el sync por API ya lo
// cumpla solo.
//
// Regla dura: los predicados NO se copian. Los tres pasos que ya viven en
// IBKR_STEPS se referencian desde ahí, así que el checklist, el gate de
// inferencia y este panel no pueden discrepar sobre qué significa "listo"
// (la lección de las dos copias que este repo ya pagó con InfoTip y
// lib/transferTx.js).
//
// El quinto paso del viaje es el resumen/conciliación: no es un requisito de
// datos sino la pantalla que muestra ESTE panel, así que no cuenta para el %.

import { IBKR_STEPS } from './brokerCompletion'

const predicate = (id, key) => {
  const step = IBKR_STEPS.find((s) => s.id === id)
  return step ? step[key] : undefined
}

// `step` es el número del paso dentro del viaje de 5 (app/dashboard/page.jsx):
// 1 conectar, 2 archivo, 3 trimestres, 4 retornos, 5 resumen. Es lo que la
// barra del viaje y el panel usan para saltar directo al paso que el usuario
// toca.
export const IBKR_JOURNEY_STEPS = [
  {
    id: 'connect', step: 1, kind: 'api',
    title: { es: 'Conectar por API', en: 'Connect via API' },
    desc: {
      es: 'Token y Query ID: a partir de ahí el sync se mantiene solo.',
      en: 'Token and Query ID: from there the sync keeps itself up to date.',
    },
    done: predicate('connect', 'done'),
  },
  {
    id: 'history', step: 2, kind: 'csv',
    title: { es: 'Traer tus últimos ~365 días', en: 'Bring your last ~365 days' },
    desc: {
      es: 'Posiciones, movimientos y el valor diario de tu cuenta. Llega por el sync o subiendo el Flex XML.',
      en: 'Positions, movements and your account\'s daily value. Arrives via the sync or by uploading the Flex XML.',
    },
    // Un solo día de NAV real ya prueba que el reporte llegó y se parseó. Se
    // cuenta por documentos, no por span: un sync de hoy tiene span 0 días y
    // sin embargo sí trajo datos.
    done: ({ ibkrNavDays }) => (ibkrNavDays || 0) > 0,
  },
  {
    id: 'quarterly', step: 3, kind: 'quarterly',
    title: { es: 'Transcribir lo más viejo', en: 'Transcribe what is older' },
    desc: {
      es: 'Si tu cuenta es más vieja que ~365 días: unos 4 números por año desde Portfolio Analyst.',
      en: 'If your account is older than ~365 days: about 4 numbers a year from Portfolio Analyst.',
    },
    done: predicate('quarterly', 'done'),
    skippable: predicate('quarterly', 'skippable'),
  },
  {
    id: 'returns', step: 4, kind: 'calibrate',
    title: { es: 'Copiar tus retornos (%)', en: 'Copy your returns (%)' },
    desc: {
      es: 'Ancla tu curva a los porcentajes que IBKR ya te muestra.',
      en: 'Anchors your curve to the percentages IBKR already shows you.',
    },
    done: predicate('returns', 'done'),
    // FASE NT: referenciado, no copiado, igual que `done`.
    attention: predicate('returns', 'attention'),
  },
]

// El paso 5 (resumen y conciliación) existe en el viaje pero no es requisito.
export const IBKR_JOURNEY_TOTAL_STEPS = 5
export const IBKR_JOURNEY_SUMMARY_STEP = 5

// `state` es el MISMO brokerCompletionState de useDashboardData que ya
// alimenta al checklist, más `ibkrNavDays`.
export function ibkrJourneyProgress(state = {}) {
  const steps = IBKR_JOURNEY_STEPS.map((s) => {
    const done = !!(s.done && s.done(state))
    // "No hace falta" solo se evalúa cuando no está hecho: un paso ya hecho se
    // reporta como hecho, nunca como innecesario.
    const skippable = !done && !!(s.skippable && s.skippable(state))
    // FASE NT: un aviso sobre el paso que NO cambia su estado (texto bilingüe
    // o null). Se evalúa aunque el paso esté hecho: una calibración que cuadra
    // y otra que no pueden convivir, y la segunda igual hay que nombrarla.
    const attention = s.attention ? (s.attention(state) || null) : null
    return {
      id: s.id, step: s.step, kind: s.kind, title: s.title, desc: s.desc,
      done, skippable, attention,
      status: done ? 'done' : skippable ? 'skippable' : 'todo',
    }
  })
  const total = steps.length
  const doneCount = steps.filter((s) => s.done).length
  // Un paso legítimamente innecesario cuenta para el %: exigirlo dejaría a una
  // cuenta nueva (sin nada anterior a los 365 días) tope en 75% para siempre.
  const satisfied = steps.filter((s) => s.done || s.skippable).length
  const next = steps.find((s) => s.status === 'todo') || null
  return {
    steps,
    total,
    done: doneCount,
    satisfied,
    pct: total ? Math.round((satisfied / total) * 100) : 0,
    started: doneCount > 0,
    complete: total > 0 && satisfied === total,
    nextStep: next ? next.step : null,
  }
}

// Cómo se DICE el avance, en UN solo lugar. Estaba escrito a mano en cada
// superficie y por eso podían contradecirse sobre el mismo viaje: la barra
// contaba PANTALLAS (5, incluida la de resumen) y el panel REQUISITOS (4),
// así que en el paso 5 la barra decía "Paso 5 de 5" (que se lee como
// "terminaste") tres centímetros arriba de un panel que decía "3 de 4
// listos". Dos denominadores para lo que el lector ve como una sola pregunta.
//
// La regla que queda: los CÍRCULOS de la barra dicen la posición (son cinco
// puntos, uno resaltado) y el TEXTO dice cuántos requisitos están cumplidos.
// Dos gramáticas distintas para dos preguntas distintas, y el número de
// "cuántos" sale siempre de aquí, así que ninguna superficie puede inventar
// el suyo.
export function journeyProgressLabel(progress, lang = 'es') {
  const es = lang !== 'en'
  if (!progress || !progress.total) return ''
  if (progress.complete) return es ? 'Todo listo' : 'All set'
  return es
    ? `${progress.satisfied} de ${progress.total} listos`
    : `${progress.satisfied} of ${progress.total} done`
}

// Los pasos que YA no hay que hacer: cumplidos o legítimamente innecesarios.
// Los dos cuentan para el 100% (ver `satisfied`), así que las dos superficies
// que dibujan un estado por paso tienen que marcarlos igual; la barra marcaba
// solo `done`, con lo que un paso que ya sumaba al porcentaje se dibujaba
// idéntico a uno pendiente.
export function journeySatisfiedSteps(progress) {
  return (progress?.steps || [])
    .filter((s) => s.done || s.skippable)
    .map((s) => ({ step: s.step, status: s.status }))
}
