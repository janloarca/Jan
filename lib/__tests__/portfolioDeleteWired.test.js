// FASE OI, guardián de FUENTE (precedente: moneyInputs.test.js). El reset de la
// vista al borrar el portafolio/entidad activos vive en app/dashboard/page.jsx,
// que jest no puede montar sin el tablero entero; se fija que el selector
// reciba el WRAPPER y no la función cruda del hook, y que el wrapper decida
// con la regla compartida.
const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '../../app/dashboard/page.jsx'), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(src)

describe('FASE OI: el tablero resetea la vista al borrar lo seleccionado', () => {
  it('PortfolioSelector recibe handleDeletePortfolio, nunca deletePortfolio crudo', () => {
    expect(code).toMatch(/onDelete=\{handleDeletePortfolio\}/)
    expect(code).not.toMatch(/onDelete=\{deletePortfolio\}/)
  })
  it('el wrapper borra y DESPUÉS decide la vista con activePortfolioAfterDelete', () => {
    const m = code.match(/const handleDeletePortfolio = useCallback\(async \(portfolioId\) => \{([\s\S]*?)\}, \[deletePortfolio\]\)/)
    expect(m).not.toBeNull()
    const body = m[1]
    expect(body).toMatch(/await deletePortfolio\(portfolioId\)/)
    expect(body).toMatch(/setActivePortfolio\(\(cur\) => activePortfolioAfterDelete\(cur, portfolioId\)\)/)
    expect(body.indexOf('await deletePortfolio')).toBeLessThan(body.indexOf('setActivePortfolio'))
  })
  it('las entidades tienen el mismo reset y SettingsModal recibe el wrapper', () => {
    expect(code).toMatch(/onDeleteEntity=\{handleDeleteEntity\}/)
    expect(code).not.toMatch(/onDeleteEntity=\{deleteEntity\}/)
    expect(code).toMatch(/setActiveEntity\(\(cur\) => \(cur === entityId \? '__all__' : cur\)\)/)
  })
})
