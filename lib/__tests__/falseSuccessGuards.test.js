// FASE NB, Ronda 2 de la auditoría de UX: "éxitos falsos". Tres guardianes.
//
// (1) toastStyleFor: un tipo DESCONOCIDO cae a 'info', nunca a 'success'. Un
//     tono que no está en la tabla es un typo del caller, y pintarle un check
//     verde a un mensaje cuyo tono nadie declaró es afirmar un éxito que nadie
//     afirmó. (Los callers que OMITEN el tipo no pasan por acá: showToast tiene
//     su propio default 'success'.)
//
// (2) y (3) son guardianes de FUENTE (precedente `ibkrImportGate.test.js`,
//     `moneyInputs.test.js`): las reglas viven en JSX/handlers que jest no
//     puede montar sin el modal entero, así que se fija el CÓDIGO que las
//     implementa. Dientes verificados: revertir el countdown a
//     `needsHistory ? -1 : 5` tumba (2), y devolver el gate a parseFloat
//     tumba (3).

const fs = require('fs')
const path = require('path')

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')

describe('toastStyleFor: el respaldo de un tipo desconocido no es un check verde', () => {
  const { toastStyleFor, toastIconFor, TOAST_STYLE, TOAST_ICON } = require('../toastStyle')

  it('un tipo que no existe cae a info, no a success', () => {
    expect(toastStyleFor('typo-inexistente')).toBe(TOAST_STYLE.info)
    expect(toastIconFor('typo-inexistente')).toBe(TOAST_ICON.info)
    expect(toastStyleFor('typo-inexistente')).not.toBe(TOAST_STYLE.success)
  })

  it('los cuatro tipos declarados siguen resolviendo a sí mismos', () => {
    for (const k of ['error', 'warn', 'info', 'success']) {
      expect(toastStyleFor(k)).toBe(TOAST_STYLE[k])
      expect(toastIconFor(k)).toBe(TOAST_ICON[k])
    }
  })
})

describe('DoneStep de IBKR: ningún aviso puede aparecer bajo un auto-cierre (FASE NB)', () => {
  const src = read('components/IBKRSyncModal.jsx')

  it('el countdown inicial se decide con hasWarnings, no solo con needsHistory', () => {
    expect(src).toMatch(/useState\(hasWarnings \? -1 : 5\)/)
  })

  it('hasWarnings cubre las seis condiciones que renderizan un aviso', () => {
    const at = src.indexOf('const hasWarnings =')
    expect(at).toBeGreaterThan(-1)
    const line = src.slice(at, src.indexOf('\n', at))
    for (const cond of ['needsHistory', 'credWarning', 'shortHistory', 'zeroFlows', 'multiAccount', 'result.partial']) {
      expect(line).toContain(cond)
    }
  })
})

describe('el gate del import de snapshots juzga con el MISMO lector que guarda (FASE NB)', () => {
  const src = read('components/dashboard/PortfolioGrowthChart.jsx')
  const at = src.indexOf('const handleSaveSnapshots')
  // Se juzga el CÓDIGO, no la prosa: el comentario que explica el arreglo
  // nombra parseFloat a propósito (precedente: el guardián de FASE LE
  // strippea comentarios antes de comparar).
  const block = src.slice(at, src.indexOf('const periodSelector', at))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('handleSaveSnapshots existe y no usa parseFloat en ninguna parte', () => {
    expect(at).toBeGreaterThan(-1)
    // El gate juzgaba con parseFloat y el guardado leía con parseAmount:
    // "0,5" (coma decimal) se rechazaba aunque el escritor la leía perfecta.
    expect(block).not.toContain('parseFloat')
    expect(block).toContain('parseAmount')
  })

  it('una fila inválida entre válidas rehúsa el lote entero, nunca guarda un subconjunto en silencio', () => {
    expect(block).toMatch(/valid\.length < filled\.length/)
  })
})
