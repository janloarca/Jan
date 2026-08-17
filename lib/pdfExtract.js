// Client-side PDF text extraction (pdf.js) with layout preserved, for the
// deterministic bank-statement parsers. Deliberately best-effort: ANY failure
// (worker setup in an exotic browser, an image-only scan, a corrupt file)
// returns null and the caller falls back to the AI reading path, so this can
// only ever ADD a faster/free path, never block the one that already worked.
//
// pdfjs-dist is imported dynamically: it only loads when someone actually
// uploads a PDF, so it never touches the shared bundle.

import { pagesToLayoutText, textContentToItems } from './parsers/pdfTextLayout'

export async function extractPdfLayoutText(file) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // The worker is served as a static file from /public, NOT bundled:
    // webpack cannot parse the pre-minified worker (its own "Syntax Error" at
    // build time, seen firsthand), and referencing it via new URL() pulls it
    // into the build. public/pdf.worker.min.mjs is a vendored copy of
    // node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs and MUST be
    // re-copied whenever the pdfjs-dist dependency version changes: pdf.js
    // refuses to run when the API and worker versions differ, so a stale copy
    // fails loudly (and this whole path then falls back to the AI reader).
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    const data = new Uint8Array(await file.arrayBuffer())
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
    const pages = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      pages.push({ items: textContentToItems(tc) })
    }
    const text = pagesToLayoutText(pages)
    // An image-only scan yields near-empty text; report it as unreadable so
    // the AI path (which does read images) takes over.
    return text.trim().length >= 40 ? text : null
  } catch (err) {
    console.warn('[pdfExtract] falling back to AI path:', err?.message)
    return null
  }
}
