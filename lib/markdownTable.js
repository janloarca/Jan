// FASE RQ. Tabla Markdown del chat -> {head, rows}. Puro para poder probarlo.

export function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}
export const isSeparatorRow = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

export function parseMarkdownTable(lines) {
  if (lines.length < 2 || !isSeparatorRow(lines[1])) return null
  const head = splitRow(lines[0])
  const rows = lines.slice(2).map(splitRow)
  return { head, rows }
}

