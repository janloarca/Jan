// FASE OJ, guardián de FUENTE (precedente: portfolioDeleteWired.test.js). Los
// tres escritores que creaban ítems SIN la etiqueta del portafolio viven en
// app/dashboard/page.jsx, que jest no puede montar sin el tablero entero. Se
// fija que reciban `addItemInScope` y nunca `addItem` crudo, y que no vuelva a
// nacer una copia inline de la regla de etiquetado fuera de lib/scopeTag.js.
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const page = strip(read('app/dashboard/page.jsx'))
const sheet = strip(read('app/spreadsheet/page.jsx'))

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/__tests__|node_modules/.test(e.name)) walk(rel, out) }
    else if (/\.jsx?$/.test(e.name)) out.push(rel)
  }
  return out
}

describe('FASE OJ: todo ítem nuevo nace con la etiqueta del alcance', () => {
  it('la cuenta destino "en línea" recibe addItemInScope en TODAS sus puertas, nunca addItem crudo', () => {
    for (const code of [page, sheet]) {
      expect(code).not.toMatch(/onCreateDestination=\{addItem\}/)
    }
    expect((page.match(/onCreateDestination=\{addItemInScope\}/g) || []).length).toBe(3)
    expect((sheet.match(/onCreateDestination=\{addItemInScope\}/g) || []).length).toBe(2)
  })
  it('Ledger y Blockchain.com escriben sus posiciones nuevas con addItemInScope', () => {
    const bc = page.match(/modalShown === 'blockchain'[\s\S]*?<\/ModalMount>/)
    const lg = page.match(/modalShown === 'ledger'[\s\S]*?<\/ModalMount>/)
    expect(bc).not.toBeNull(); expect(lg).not.toBeNull()
    for (const block of [bc[0], lg[0]]) {
      expect(block).toMatch(/await addItemInScope\(item\)/)
      expect(block).not.toMatch(/await addItem\(item\)/)
    }
  })
  it('el sync de IBKR del tablero y del hook piden la etiqueta a scopeTagFor', () => {
    expect(page).toMatch(/const tag = scopeTagFor\(activePortfolio, activeEntity\)/)
    expect(strip(read('hooks/useDashboardData.js'))).toMatch(/const tag = scopeTagFor\(activePortfolio, activeEntity\)/)
  })
  it('la regla no vuelve a copiarse inline en ningún archivo de la app', () => {
    const offenders = []
    for (const rel of [...walk('app'), ...walk('components'), ...walk('hooks')]) {
      if (rel === path.join('lib', 'scopeTag.js')) continue
      const code = strip(read(rel))
      if (/portfolioId\s*[:=]\s*activePortfolio\b/.test(code) || /entityId\s*[:=]\s*activeEntity\b/.test(code)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
  it('control positivo: el barrido de verdad leyó archivos', () => {
    expect(walk('components').length).toBeGreaterThan(20)
  })
})
