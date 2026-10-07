import fs from 'fs'
import path from 'path'
import { assetSummary } from '../assetSummary'

const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8')

// El caso de referencia congelado (lib/assetLogic/corporateBondWithEntryFee.js):
// bono de 6,000 con 95.78 de comisión aparte y un cupón de 240 pagado en
// efectivo a otra cuenta. La ficha tiene que decir 3.94%, el MISMO número que
// Asignación de Activos, porque usa sus mismas funciones.
const vitali = {
  id: 'v', name: 'VITALI', symbol: 'VITALI', type: 'Bond', quantity: 1,
  purchasePrice: 6000, currentPrice: 6000, entryFee: 95.78, entryFeeMode: 'separate',
  institution: 'IDC', incomeDestination: 'fl',
}
const fondo = { id: 'fl', name: 'Fondo Líquido', type: 'Cuenta de ahorro', quantity: 1, purchasePrice: 240, currentPrice: 240 }
const cupon = { type: 'DIVIDEND', totalAmount: 240, currency: 'USD', _linkedItemId: 'v', _destinationItemId: 'fl' }

describe('assetSummary', () => {
  it('VITALI: invertido 6,095.78, rendimiento 240 y 3.94%', () => {
    const s = assetSummary(vitali, { transactions: [cupon], items: [vitali, fondo] })
    expect(s.invested).toBeCloseTo(6095.78, 2)
    expect(s.gain).toBeCloseTo(240, 2)
    expect(s.gainPct).toBeCloseTo(3.94, 2)
    expect(s.multiple).toBeCloseTo(6000 / 6095.78, 4)
  })

  it('el ingreso que ATERRIZA en una cuenta no cuenta como capital invertido', () => {
    const s = assetSummary(fondo, { transactions: [cupon], items: [vitali, fondo] })
    // costo 240 − 240 recibidos = 0 capital propio: sin base, no hay % ni múltiplo.
    expect(s.invested).toBe(0)
    expect(s.gainPct).toBeNull()
    expect(s.multiple).toBeNull()
  })

  it('una deuda no tiene rendimiento: solo saldo', () => {
    const d = { id: 'd', name: 'Hipoteca', type: 'Debt', isDebt: true, quantity: 1, currentPrice: 4000, purchasePrice: 4000 }
    const s = assetSummary(d, { transactions: [], items: [d] })
    expect(s.isDebt).toBe(true)
    expect(s.balance).toBe(4000)
    expect(s.gain).toBeNull()
    expect(s.multiple).toBeNull()
  })

  it('sector y ubicación salen de las mismas reglas que Asignación de Activos', () => {
    const a = { id: 'a', name: 'Apple', symbol: 'AAPL', type: 'Stock', quantity: 2, purchasePrice: 100, currentPrice: 150, sector: 'Technology', assetCountry: 'Guatemala' }
    const s = assetSummary(a, { transactions: [], items: [a] })
    expect(s.sector).toBe('Technology')
    expect(s.location).toBe('Guatemala')
    expect(s.gain).toBe(100)
    expect(s.gainPct).toBe(50)
  })

  it('sin ítem devuelve null, nunca lanza', () => {
    expect(assetSummary(null)).toBeNull()
  })
})

describe('cableado de la ficha en la Hoja', () => {
  it('el nombre abre la ficha y la ficha ofrece Editar (el editor de siempre)', () => {
    const sheet = read('components/dashboard/PortfolioSpreadsheet.jsx')
    expect(sheet).toMatch(/\(onShowItemInfo \|\| onEditItem\)\(item\)/)
    const page = read('app/spreadsheet/page.jsx')
    expect(page).toContain('onShowItemInfo={setInfoItem}')
    // Editar cierra la ficha y abre el MISMO editor que antes abría el nombre.
    expect(page).toMatch(/onEdit=\{\(it\) => \{ setInfoItem\(null\); handleOpenEditItem\(it\) \}\}/)
  })

  it('la ficha no calcula nada por su cuenta: usa lib/assetSummary', () => {
    const modal = read('components/dashboard/AssetInfoModal.jsx')
    expect(modal).toContain("from '@/lib/assetSummary'")
    const code = modal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/getItemCostBasis|getItemPrincipalCost|getInvestedCapital/)
  })
})
