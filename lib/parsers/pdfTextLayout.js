// pdf.js text items → layout-preserving plain text, the shape the bank
// statement parsers consume.
//
// Why this exists: a bank statement is a TABLE, and pdf.js hands back loose
// text fragments with x/y coordinates, in stream order (not reading order).
// The parsers in guateCardStatements.js decide débito-vs-crédito and
// quetzales-vs-dólares by COLUMN POSITION, so the reconstruction must place
// each fragment at a character column proportional to its x coordinate, the
// same thing `pdftotext -layout` does. Both extractors then feed the same
// parser, and the parsers self-calibrate against each document's own total
// lines instead of trusting absolute offsets.
//
// Pure module: takes already-extracted items, touches no pdf.js API, so it
// tests without a PDF engine and runs in browser and Node alike.

// ~10pt statement fonts run ~5pt per character; the exact value only scales
// the columns, it never reorders them, and every consumer calibrates
// per-document anyway.
const CHAR_W = 4.8
// Fragments whose baselines differ by less than this are the same visual line.
const LINE_TOLERANCE = 2.5

// items: [{ str, x, y, w? }] with y growing UPWARD (pdf.js convention); w is
// the rendered width when known. Returns text lines for ONE page, top to
// bottom.
export function itemsToLayoutLines(items) {
  const frags = (items || [])
    .filter((it) => it && typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => ({ str: it.str, x: Number(it.x) || 0, y: Number(it.y) || 0, w: Number(it.w) || 0 }))
  if (!frags.length) return []

  // Cluster into lines by y. Sorting first makes clustering a single pass.
  frags.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  let current = null
  for (const f of frags) {
    if (!current || Math.abs(current.y - f.y) > LINE_TOLERANCE) {
      current = { y: f.y, frags: [] }
      lines.push(current)
    }
    current.frags.push(f)
  }

  return lines.map((line) => {
    line.frags.sort((a, b) => a.x - b.x)
    let out = ''
    let lastEndX = null
    for (const f of line.frags) {
      const col = Math.max(0, Math.round(f.x / CHAR_W))
      if (col > out.length) {
        out += ' '.repeat(col - out.length)
      } else if (out.length > 0 && !out.endsWith(' ')) {
        // A fragment that starts where the previous one ENDED (per its
        // rendered width) is a kerned mid-word split and joins with no space
        // ("Hill" + "US" → "HillUS"); anything with real horizontal distance
        // is a separate word and keeps one.
        const contiguous = lastEndX != null && f.x - lastEndX < CHAR_W * 0.6
        if (!contiguous) out += ' '
      }
      out += f.str
      lastEndX = f.x + (f.w || f.str.length * CHAR_W)
    }
    return out
  })
}

// pdf.js getTextContent() → items for itemsToLayoutLines. transform[4]/[5]
// are the x / y of each fragment's baseline.
export function textContentToItems(textContent) {
  return (textContent?.items || [])
    .filter((it) => typeof it?.str === 'string')
    .map((it) => ({ str: it.str, x: it.transform?.[4] ?? 0, y: it.transform?.[5] ?? 0, w: it.width ?? 0 }))
}

// Full document: [{ items }, ...] per page → one text blob, pages separated by
// a form feed so a parser can reason per-page if it ever needs to.
export function pagesToLayoutText(pages) {
  return (pages || [])
    .map((page) => itemsToLayoutLines(page.items).join('\n'))
    .join('\n\f\n')
}
