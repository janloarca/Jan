import { financeReportCsv, financeBackupCsv } from '../financeCsv'
import { methodOfTx } from '../financeWipe'

const lines = (csv) => csv.split('\n')
const cols = (line) => line.split(',')

describe('el CSV de reporte no cambió de forma', () => {
  const tx = {
    date: '2026-07-05', type: 'EXPENSE', category: 'Alimentación', description: 'LA TORRE',
    amount: 689.8, _originalAmount: 89.58, _originalCurrency: 'USD',
  }

  it('mantiene el encabezado que ya se exportaba', () => {
    expect(lines(financeReportCsv([tx]))[0])
      .toBe('Date,Type,Category,Description,Amount,Currency,OriginalAmount,OriginalCurrency')
  })

  it('la columna Currency es la moneda a la que el caller ya normalizó', () => {
    const row = lines(financeReportCsv([tx], { currency: 'GTQ' }))[1]
    expect(row).toContain('689.8,"GTQ"')
    expect(row).toContain('89.58,"USD"')
  })

  it('sin moneda original deja esas dos columnas vacías', () => {
    // El monto va sin comillas y la moneda con ellas: es la forma exacta que
    // ya se exportaba, y el módulo la conserva byte por byte.
    const c = cols(lines(financeReportCsv([{ date: '2026-07-05', amount: 100 }]))[1])
    expect(c).toHaveLength(8)
    expect(c[6]).toBe('')
    expect(c[7]).toBe('""')
  })
})

describe('el respaldo sale del monto CRUDO, que es lo que lo hace un respaldo', () => {
  // El defecto que esto existe para impedir: escribir el monto convertido a
  // GTQ. Un respaldo así no permite restaurar lo que había, que es su único
  // propósito, y solo se descubre el día que hace falta.
  const raw = {
    id: 'x1', date: '2026-07-19', type: 'EXPENSE', category: 'Entretenimiento',
    description: 'BET365', amount: 200, currency: 'USD',
    source: 'card_import', kind: 'purchase', account: 'G&T •3294',
    // Lo que la pantalla habría mostrado tras normalizar. No debe aparecer.
    _originalAmount: 200, _originalCurrency: 'USD',
  }

  it('guarda el monto y la moneda tal como se almacenaron', () => {
    const row = lines(financeBackupCsv([raw]))[1]
    const c = cols(row)
    expect(c[5]).toBe('200')      // Amount, sin convertir
    expect(c[6]).toBe('"USD"')    // Currency, la real de la fila
    expect(row).not.toContain('GTQ')
  })

  it('lleva el id, sin el cual no se puede volver a emparejar nada', () => {
    expect(cols(lines(financeBackupCsv([raw]))[1])[0]).toBe('"x1"')
  })

  it('anota el método con la MISMA función que decide el borrado', () => {
    const row = lines(financeBackupCsv([raw], { methodOf: methodOfTx }))[1]
    expect(cols(row)[7]).toBe('"statement"')
  })

  it('un reembolso conserva su signo', () => {
    const row = lines(financeBackupCsv([{ id: 'r', amount: -488.07, currency: 'GTQ' }]))[1]
    expect(cols(row)[5]).toBe('-488.07')
  })

  it('escapa comillas en la descripción sin romper la fila', () => {
    const csv = financeBackupCsv([{ id: 'q', description: 'CAFE "EL BUENO"', amount: 10 }])
    expect(lines(csv)).toHaveLength(2)
    expect(csv).toContain('"CAFE ""EL BUENO"""')
  })

  it('una lista vacía deja el encabezado, no un archivo vacío', () => {
    expect(lines(financeBackupCsv([]))).toHaveLength(1)
  })
})
