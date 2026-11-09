// Guardián: el script inline de app/layout.jsx es un string, así que ni el build
// ni jest lo parseaban. Un `} }` de más lo rompió entero en producción
// ("Missing catch or finally after try"): tema, build id y chequeo de versión
// dejaban de correr sin ningún aviso del build.
const fs = require('fs')
const path = require('path')
const vm = require('vm')

describe('script inline del layout', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'layout.jsx'), 'utf8')
  const start = src.indexOf('const themeScript = `') + 'const themeScript = `'.length
  const end = src.indexOf('\n  `\n', start)

  test('lo encontramos', () => {
    expect(start).toBeGreaterThan(30)
    expect(end).toBeGreaterThan(start)
  })

  test('es JavaScript válido', () => {
    const code = src.slice(start, end).replace(/\$\{buildId\}/g, 'test-build')
    expect(() => new vm.Script(code)).not.toThrow()
  })
})
