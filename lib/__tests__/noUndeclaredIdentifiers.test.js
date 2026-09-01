/**
 * @jest-environment node
 */
// Guard against the bug class that crashed the whole dashboard in FASE GQ3:
// a reference to an identifier that is never declared in any enclosing scope.
//
// `rows.push({ key, label, ... })` inside a `keys.forEach((k) => ...)` is valid
// JavaScript — the parser, the Next build and every existing test passed it
// happily — but `key` was an undeclared global, so it threw ReferenceError
// ("Can't find variable: key" in Safari) the instant that line executed. It sat
// dormant for days because the block it lived in was unreachable, then took the
// dashboard down for real users the moment a separate change made it reachable.
//
// There is no ESLint in this repo (no config, not installed), so `no-undef`
// never ran. This test is the substitute: it walks every source file with the
// Babel parser jest already depends on and fails on any identifier that has no
// binding and is not a known runtime global.
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ROOT = path.resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage', 'public'])

// Legitimate runtime globals. Add here ONLY things that genuinely exist at
// runtime in the environment the file runs in (browser or node) — never to
// silence a real finding.
const KNOWN_GLOBALS = new Set([
  // Browser
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'localStorage', 'sessionStorage',
  'fetch', 'Request', 'Response', 'Headers', 'FormData', 'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'queueMicrotask', 'structuredClone', 'AbortController', 'AbortSignal', 'DOMException', 'Event', 'CustomEvent',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'BroadcastChannel', 'KeyboardEvent', 'matchMedia', 'getComputedStyle',
  'alert', 'confirm', 'prompt', 'ReadableStream', 'WritableStream', 'TransformStream', 'TextEncoder', 'TextDecoder',
  'btoa', 'atob', 'crypto', 'performance', 'Image', 'Audio', 'Worker', 'WebSocket', 'EventSource', 'Notification',
  'HTMLElement', 'Node', 'SVGElement', 'CSS', 'indexedDB', 'IDBKeyRange', 'caches', 'self', 'top', 'parent', 'frames',
  // Language
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
  // Los seis constructores de error estandar del lenguaje. Faltaban tres
  // (ReferenceError, EvalError, URIError) simplemente porque el repo todavia no
  // los habia usado: el primer test que hizo `expect(...).toThrow(ReferenceError)`
  // los destapo. Son globales legitimos, asi que el hueco era de esta lista.
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Symbol', 'Proxy', 'Reflect', 'BigInt', 'Intl', 'Infinity', 'NaN', 'undefined', 'globalThis',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'ArrayBuffer', 'SharedArrayBuffer', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array',
  'Int32Array', 'Float32Array', 'Float64Array', 'DataView',
  // Node / build
  'process', 'Buffer', 'global', 'require', 'module', 'exports', '__dirname', '__filename',
  // Test runner
  'jest', 'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  // Framework
  'React', 'JSX',
])

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      sourceFiles(full, out)
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function undeclaredIn(file) {
  const ast = parser.parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
  })
  const found = []
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name
      if (KNOWN_GLOBALS.has(name)) return
      // hasBinding(name, true) walks every enclosing scope up to the program.
      if (p.scope.hasBinding(name, true)) return
      found.push(`${path.relative(ROOT, file)}:${p.node.loc?.start.line} references undeclared "${name}"`)
    },
  })
  return found
}

describe('no undeclared identifier references', () => {
  test('every source file only references declared bindings or known globals', () => {
    const problems = []
    for (const file of sourceFiles(ROOT)) problems.push(...undeclaredIn(file))
    expect(problems).toEqual([])
  })

  test('the checker actually catches the FASE GQ3 shape (shorthand key vs loop var k)', () => {
    // Fixture reproducing the real crash line, so a future refactor that
    // weakens the walk above fails here instead of passing silently.
    const tmp = path.join(require('os').tmpdir(), `undeclared-fixture-${process.pid}.js`)
    fs.writeFileSync(tmp, `
      const rows = []
      new Set(['a']).forEach((k) => {
        const label = k
        rows.push({ key, label })
      })
    `)
    try {
      const found = undeclaredIn(tmp)
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('undeclared "key"')
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})
