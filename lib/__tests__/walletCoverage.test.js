import { walletCoverage } from '../walletCoverage'

const wrow = (desc, over = {}) => ({ description: desc, merchant: desc, wallet: 'applepay', ...over })
const plain = (desc) => ({ description: desc, merchant: desc })
const auto = (transport) => ({ _source: `auto_${transport}` })

describe('mide la cobertura de la automatización, no la adivina', () => {
  it('cuenta solo las filas que el estado marcó con billetera', () => {
    const r = walletCoverage({
      confirmed: [{ row: wrow('PARQUEO'), match: auto('shortcut') }],
      review: [],
      newTxs: [plain('DECLARAGUATE'), wrow('CAFE')],
    })
    expect(r.total).toBe(2) // el cargo de impuestos no lleva marcador
    expect(r.captured).toBe(1)
    expect(r.missing).toBe(1)
    expect(r.pct).toBeCloseTo(50, 5)
  })

  it('un estado sin marcadores no afirma nada', () => {
    // BI y BAC no marcan la billetera. Reportar 0% ahí sería decir que la
    // automatización falló, cuando lo cierto es que no se puede saber.
    const r = walletCoverage({
      confirmed: [{ row: plain('A'), match: auto('shortcut') }],
      review: [],
      newTxs: [plain('B')],
    })
    expect(r.total).toBe(0)
    expect(r.pct).toBeNull()
  })

  it('separa el atajo del correo, que es la pregunta abierta', () => {
    // Si el correo la trajo y el atajo no, la alerta del banco sí salió y la
    // automatización de Wallet no corrió. Mirando solo "el gasto está" las dos
    // situaciones se ven idénticas.
    const r = walletCoverage({
      confirmed: [
        { row: wrow('A'), match: auto('shortcut') },
        { row: wrow('B'), match: auto('email') },
        { row: wrow('C'), match: auto('email') },
      ],
      review: [],
      newTxs: [],
    })
    expect(r.byTransport).toEqual({ shortcut: 1, email: 2 })
    expect(r.captured).toBe(3)
  })

  it('lo escrito a mano no cuenta como capturado', () => {
    const r = walletCoverage({
      confirmed: [{ row: wrow('A'), match: { id: 'x' } }],
      review: [],
      newTxs: [],
    })
    expect(r.captured).toBe(0)
    expect(r.byHand).toBe(1)
    expect(r.pct).toBe(0)
  })

  it('una fila a revisar cuenta como capturada, que es el lado prudente', () => {
    // Si resultara ser un cobro aparte, la cobertura BAJA. O sea el error
    // posible va hacia "la automatización anda peor de lo que dije", nunca
    // hacia declararla sana sin serlo.
    const r = walletCoverage({
      confirmed: [],
      review: [{ row: wrow('A'), match: auto('shortcut') }],
      newTxs: [],
    })
    expect(r.captured).toBe(1)
  })

  it('devuelve las filas que faltaron, para poder mirarlas', () => {
    const r = walletCoverage({
      confirmed: [], review: [],
      newTxs: [wrow('Temu.com'), wrow('CINEPOLIS')],
    })
    expect(r.missingRows.map((x) => x.description)).toEqual(['Temu.com', 'CINEPOLIS'])
  })

  it('aguanta una entrada vacía', () => {
    const r = walletCoverage({})
    expect(r.total).toBe(0)
    expect(r.pct).toBeNull()
    expect(r.missingRows).toEqual([])
  })
})
