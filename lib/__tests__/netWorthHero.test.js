/**
 * Rediseño, sección 1 (hero). Guardián de FUENTE del orden de la composición
 * y de que la card del patrimonio sigue trayendo todo lo que traía: el cambio
 * fue de layout, no de contenido.
 */
import fs from 'fs'
import path from 'path'
import { COMPOSITION_ORDER } from '../../components/dashboard/NetWorthCard'

const card = fs.readFileSync(path.join(__dirname, '../../components/dashboard/NetWorthCard.jsx'), 'utf8')

describe('hero del patrimonio', () => {
  it('la composición se lee Bonos, Acciones, Cripto, Caja & Bancos', () => {
    expect(COMPOSITION_ORDER).toEqual(['bonds', 'stocks', 'crypto', 'banks'])
  })

  it('el colapso a "Otros" sigue decidiéndose por valor, antes de reordenar', () => {
    const sortByValue = card.indexOf('.sort((a, b) => b.value - a.value)')
    const collapse = card.indexOf('if (segs.length > 5)')
    const reorder = card.indexOf('COMPOSITION_ORDER.indexOf')
    expect(sortByValue).toBeGreaterThan(0)
    expect(collapse).toBeGreaterThan(sortByValue)
    expect(reorder).toBeGreaterThan(collapse)
  })

  it('no se quitó ninguna pieza de la card', () => {
    for (const piece of ['YtdBreakdownToggle', 'moversTitle', 'staleSessionNote', "'Disponible'", 'ytdAnchorIgnored', 'scopedView', 'QUICK_CURRENCIES']) {
      expect(card).toContain(piece)
    }
  })
})
