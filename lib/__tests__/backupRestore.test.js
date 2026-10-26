import { parseBackup, planRestore } from '../backupRestore'

describe('parseBackup', () => {
  it('rechaza JSON roto y archivos que no son un respaldo', () => {
    expect(parseBackup('{no').error).toBe('invalid-json')
    expect(parseBackup('[1]').error).toBe('not-a-backup')
    expect(parseBackup('{"foo":1}').error).toBe('not-a-backup')
  })
  it('acepta un respaldo con alguna colección', () => {
    expect(parseBackup('{"items":[]}').data.items).toEqual([])
  })
})

describe('planRestore', () => {
  const data = {
    items: [{ id: 'a', name: 'A', x: undefined }, { id: 'b', name: 'B' }, { name: 'sin id' }],
    lots: [{ id: 'l1', status: 'closed' }],
    transactions: [{ id: 't1', type: 'DEPOSIT' }],
    snapshots: [{ id: 's1' }], settings: { a: 1 },
  }
  it('omite lo que ya existe y lo que no trae id, conserva el id y el estado del lote', () => {
    const r = planRestore(data, { items: [{ id: 'a' }] })
    expect(r.plan.items).toEqual([{ id: 'b', data: { name: 'B' } }])
    expect(r.plan.lots[0].data.status).toBe('closed')
    expect(r.skipped).toBe(2)
    expect(r.toWrite).toBe(3)
  })
  it('nunca planea snapshots ni configuración', () => {
    expect(Object.keys(planRestore(data).plan).sort()).toEqual(['items', 'lots', 'transactions'])
  })
})
