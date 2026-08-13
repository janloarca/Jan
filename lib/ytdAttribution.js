// FASE GR. "Where your YTD comes from", rebuilt per ACCOUNT.
//
// The previous attempt decomposed the year position by position, straight from
// the historical reconstruction, and produced three separate species of wrong
// on real data in a single evening: broker deposits counted as profit (a $10K
// account credited with +$13,207 of "gain"), whole accounts silently missing,
// and per-account figures contradicting those accounts' own charts. It was the
// wrong foundation, not a set of bugs to keep patching.
//
// This version starts from the identity the headline itself is built on
// (computeModifiedDietz, components/dashboard/utils.js):
//
//     gain = endValue - startValue - sumFlows
//
// Partition each of those three terms across accounts and the per-account gains
// sum to the headline gain BY CONSTRUCTION, not by luck:
//
//   - endVal per account is exact. It is today's holdings, the same numbers the
//     account chips on the chart show.
//   - flow per account is exact. Account attribution is the rule already proven
//     by the calibration flow: a broker's own ledger by _source, manual money by
//     the item it is linked to.
//   - start per account is the ONLY estimated term, so it is the only place
//     error can enter -- and the residual of the whole panel is therefore
//     exactly (sum of account starts - portfolio start). Nothing else can drift.
//
// Because the residual has that single, known origin, it can be closed honestly
// instead of hidden: starts we actually KNOW (a broker's real year-start NAV, a
// calibration the user typed off their broker) are never touched, and only the
// estimated ones are scaled so the split adds up to the portfolio anchor the
// headline used. If the estimates are so far off that pinning them would be
// fiction, or if money could not be attributed at all, the panel refuses to
// render rather than show a number nobody can stand behind.

import { breakdownReconciles } from './ytdBreakdownGate'

// A leftover this large means the per-account starts and the portfolio anchor
// are telling different stories, and no honest row can be built from them.
// Proportional with a floor, like the other tolerances here.
export const MAX_UNEXPLAINED_FLOOR = 25
export const MAX_UNEXPLAINED_RATIO = 0.35
// FASE HY: el residuo es exactamente (suma de arranques por cuenta - ancla del
// portafolio): dos reconstrucciones INDEPENDIENTES de una cantidad del tamaño
// del PORTAFOLIO (el doc archivado de enero contra la reconstrucción viva por
// cuenta). Su ruido normal escala con el portafolio, no con la ganancia del
// año: dos motores que difieren 0.5% sobre un arranque de $26K ya son ~$130.
// Con el techo atado SOLO a la ganancia, un año de ganancia chica (+$241 =>
// techo $84) rehusaba casi permanentemente por ruido de reconstrucción, que
// fue exactamente el reporte del usuario ("necesito que YTD funcione"). El
// término nuevo tolera hasta 2% del arranque; más allá de eso el desacuerdo es
// genuino (un ancla vieja a nivel solo-manual, la firma del diente de sierra)
// y rehusar sigue siendo lo correcto.
export const MAX_UNEXPLAINED_START_RATIO = 0.02

// Unattributed external money breaks the partition the whole method rests on,
// so it is capped rather than quietly absorbed. Proportional with a floor, for
// the same reason the reconciliation tolerance is.
export const UNATTRIBUTED_FLOOR = 5
export const UNATTRIBUTED_RATIO = 0.05

// Below this, a leftover is rounding between two reconstruction paths and gets
// folded away rather than shown as its own row.
export const RESIDUAL_VISIBLE_MIN = 1

// El segundo parámetro `diag` (opcional, FASE HT3) existe porque el motor
// rehúsa EN SILENCIO por diseño, y eso dejó al usuario (y a quien depura) sin
// forma de saber por qué el panel no aparece: la misma lección del botón
// "Reparar ahora" de FASE HP (un gate invisible consume rondas enteras de
// diagnóstico). Solo ESCRIBE en diag; cero cambio en la matemática o en qué
// se rechaza. Los callers viejos que no lo pasan quedan idénticos.
export function attributeYtd({ accounts, portfolioStart, headlineGain, unattributedFlow = 0 }, diag) {
  const refuse = (reason, detail) => {
    if (diag) { diag.reason = reason; if (detail) diag.detail = detail }
    return null
  }
  if (!Array.isArray(accounts) || accounts.length === 0) return refuse('no-accounts')
  if (!isFinite(portfolioStart) || portfolioStart <= 0) return refuse('no-anchor')
  if (headlineGain == null || !isFinite(headlineGain)) return refuse('no-headline')

  // Money we could not place would silently land nowhere, and the sum would be
  // wrong by exactly that amount. Refuse instead.
  const unattributedCap = Math.max(UNATTRIBUTED_FLOOR, Math.abs(headlineGain) * UNATTRIBUTED_RATIO)
  if (!isFinite(unattributedFlow) || Math.abs(unattributedFlow) > unattributedCap) {
    return refuse('unattributed-flow', { unattributedFlow, cap: unattributedCap })
  }

  for (const a of accounts) {
    if (!a || !isFinite(a.endVal) || !isFinite(a.flow) || !isFinite(a.start)) return refuse('bad-account-row', { name: a && a.name })
  }

  // Each account keeps ITS OWN start. Earlier versions scaled the estimated
  // ones so the rows would add up to the anchor exactly, and that is precisely
  // what broke LEGDER: it arrived with the right year-start (~$1,678, the same
  // one its own chart uses), got stretched to ~$1,050 to make the total look
  // tidy, and reported -$44 for a year its chart shows as -$667. Deforming a
  // correct number so the sum looks perfect is cosmetics, not accuracy.
  //
  // Whatever is left over is REPORTED instead. That leftover is not mysterious:
  // it is exactly (sum of account starts - portfolio start), the one place
  // error can enter, so naming it is strictly more honest than smearing it
  // across accounts that were already right.
  const rows = accounts.map((a) => {
    const gain = a.endVal - a.start - a.flow
    // The account's OWN return, on the same Modified Dietz base the headline
    // uses: start plus each flow weighted by how long it was actually invested.
    // This replaces the share-of-total-gain figure the panel used to print,
    // which read as a return and was not one: a broker up 7.40% on the year sat
    // next to a "75%" that merely meant "three quarters of this year's gain came
    // from here". Two different questions, one % sign.
    const base = a.start + (isFinite(a.flowBase) ? a.flowBase : 0)
    const ret = Math.abs(base) > 0.01
      ? Math.max(-200, Math.min(200, (gain / base) * 100))
      : null
    return {
      key: a.key,
      name: a.name,
      endVal: a.endVal,
      flow: a.flow,
      start: a.start,
      startIsReal: !!a.startIsReal,
      gain,
      ret: ret != null && isFinite(ret) ? ret : null,
    }
  })

  // PER-ACCOUNT sanity, not just the total (FASE GR5). Matching the headline is
  // a weaker guarantee than it sounds: rows whose errors cancel each other add
  // up perfectly while individually claiming the impossible. That is exactly
  // what shipped -- a clean $815.05 total with OSMO reporting -$407.63 on an
  // account holding $117. A total-only check is a lock on the wrong door.
  //
  // Two things no real account can do, both cheap to test:
  //   - start below zero. An account cannot have been worth negative money, and
  //     this is precisely the shape of the original blow-up (a broker whose
  //     reconstructed January value came out around -$3,195, turning its whole
  //     balance into "gain").
  //   - start larger than the entire portfolio it belongs to.
  const startCeiling = portfolioStart * 1.05
  for (const r of rows) {
    if (r.start < -0.005) return refuse('negative-start', { name: r.name, start: r.start })
    if (r.start > startCeiling) return refuse('start-exceeds-portfolio', { name: r.name, start: r.start, ceiling: startCeiling })
  }

  const attributed = rows.reduce((s, r) => s + r.gain, 0)
  const unexplained = headlineGain - attributed
  // Past this, the accounts and the anchor disagree so much that the panel is
  // not explaining the headline, it is guessing at it. Three terms because the
  // residual's noise scales with the PORTFOLIO (see MAX_UNEXPLAINED_START_RATIO
  // above), while a genuinely broken split still trips the start-scaled bound.
  const maxUnexplained = Math.max(
    MAX_UNEXPLAINED_FLOOR,
    Math.abs(headlineGain) * MAX_UNEXPLAINED_RATIO,
    portfolioStart * MAX_UNEXPLAINED_START_RATIO
  )
  if (Math.abs(unexplained) > maxUnexplained) return refuse('unexplained-too-large', { unexplained, cap: maxUnexplained })

  const totalGain = attributed + unexplained // === headlineGain, by construction
  // No share-of-total column any more. Dividing each row by the portfolio's NET
  // gain is unstable by construction: with a small net and large opposing
  // contributions it printed things like 1750% and -1650% for a year in which
  // one account made 7% and the other lost 13%. The row's own return answers
  // the question people were actually reading it as, and its denominator is
  // real capital, so it cannot blow up that way.
  const groups = rows.sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))

  if (groups.length === 0) return refuse('no-accounts')
  // Shown as its own row when material, so the visible figures still add up to
  // the headline without any account being quietly adjusted to get there.
  if (Math.abs(unexplained) >= RESIDUAL_VISIBLE_MIN) {
    // No return for this row on purpose: it is a residual, not an account, so
    // there is no capital of its own to measure a percentage against.
    groups.push({ key: '__unexplained__', name: null, isUnexplained: true, gain: unexplained, ret: null })
  }
  return { groups, totalGain, unexplained }
}

// Texto humano de una razón de rechazo, para la tarjeta y los reportes (una
// sola copia: dos superficies mostrando la misma razón no pueden divergir).
// FASE HY: el tercer parámetro `detail` (opcional, el mismo objeto que
// attributeYtd escribe en diag.detail) agrega los NÚMEROS del rechazo al
// texto. Antes el detalle existía pero no se mostraba en ningún lado, así que
// cada rechazo real consumía una ronda entera de capturas para saber siquiera
// el orden de magnitud (¿$90 de ruido o $6,000 de ancla vieja?): la misma
// lección del botón "Reparar ahora" de FASE HP. Sin detail el texto es
// idéntico al de antes.
export function attributionRefusalText(reason, lang = 'es', detail = null) {
  const fmt = (v) => '$' + Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  let extra = ''
  if (detail) {
    if (reason === 'unexplained-too-large' && isFinite(detail.unexplained) && isFinite(detail.cap)) {
      extra = lang === 'es'
        ? ` (diferencia de ${fmt(detail.unexplained)}, tolerancia de ${fmt(detail.cap)})`
        : ` (off by ${fmt(detail.unexplained)}, tolerance ${fmt(detail.cap)})`
    } else if ((reason === 'negative-start' || reason === 'start-exceeds-portfolio') && detail.name) {
      extra = lang === 'es' ? ` (cuenta: ${detail.name})` : ` (account: ${detail.name})`
    } else if (reason === 'unattributed-flow' && isFinite(detail.unattributedFlow)) {
      extra = lang === 'es'
        ? ` (${fmt(detail.unattributedFlow)} sin ubicar)`
        : ` (${fmt(detail.unattributedFlow)} unplaced)`
    }
  }
  return refusalBaseText(reason, lang) + extra
}

function refusalBaseText(reason, lang) {
  const es = {
    'no-anchor': 'no hay un valor de arranque de año confiable todavía',
    'no-headline': 'el YTD del encabezado no está disponible',
    'no-accounts': 'no hay cuentas con institución asignada',
    'unattributed-flow': 'hay movimientos de dinero que no se pueden ubicar en ninguna cuenta',
    'bad-account-row': 'una cuenta tiene datos incompletos para el reparto',
    'negative-start': 'el valor de arranque reconstruido de una cuenta salió imposible (negativo)',
    'start-exceeds-portfolio': 'el arranque reconstruido de una cuenta excede el portafolio completo',
    'unexplained-too-large': 'los arranques por cuenta no cuadran con el ancla del año (suele corregirse solo cuando el historial termina de regenerarse)',
  }
  const en = {
    'no-anchor': 'there is no reliable year-start value yet',
    'no-headline': 'the headline YTD is unavailable',
    'no-accounts': 'no accounts have an institution assigned',
    'unattributed-flow': 'some money movements cannot be placed in any account',
    'bad-account-row': 'one account has incomplete data for the split',
    'negative-start': "one account's reconstructed year-start came out impossible (negative)",
    'start-exceeds-portfolio': "one account's reconstructed year-start exceeds the whole portfolio",
    'unexplained-too-large': 'per-account starts do not reconcile with the year anchor (usually self-corrects once history finishes regenerating)',
  }
  const map = lang === 'es' ? es : en
  return map[reason] || (lang === 'es' ? 'el reparto no pasó las validaciones de consistencia' : 'the split did not pass consistency checks')
}
