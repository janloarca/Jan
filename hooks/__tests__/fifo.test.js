/**
 * Tests for the FIFO lot closing logic from useFirestoreItems.js (closeLotsFIFO).
 *
 * The actual closeLotsFIFO runs inside a Firestore transaction. We extract
 * and test the pure FIFO algorithm: sorting, partial/full closing, gain calculation.
 */

const QTY_EPSILON = 0.0001
function roundQty(v) { return Math.round(v * 10000) / 10000 }

/**
 * Pure FIFO algorithm extracted from closeLotsFIFO (lines 383-431).
 * Takes open lots (already filtered by symbol/status/positive qty) and returns
 * the closed results plus mutation descriptors.
 */
function fifoClose(openLots, qtyToClose, closePrice, institution) {
  // Sort by acquisition date (FIFO)
  let sorted = [...openLots].sort(
    (a, b) => (a.acquisitionDate || '').localeCompare(b.acquisitionDate || '')
  )

  // Filter by institution if provided
  if (institution) {
    const instLots = sorted.filter(l => l.institution === institution)
    if (instLots.length > 0) sorted = instLots
  }

  let remaining = qtyToClose
  const closedResults = []
  const mutations = [] // track what would be written to Firestore

  for (const lot of sorted) {
    if (remaining <= 0) break
    const closable = Math.min(remaining, lot.quantity)
    const realizedGain = (closePrice - lot.costBasis) * closable

    if (closable >= lot.quantity - QTY_EPSILON) {
      // Full close
      mutations.push({
        type: 'fullClose',
        lotId: lot.id,
        update: {
          status: 'closed',
          quantity: closable, // NOT 0 — per CLAUDE.md rule
          realizedGain,
        },
      })
    } else {
      // Partial close — reduce original lot and create a new closed lot
      mutations.push({
        type: 'partialClose',
        lotId: lot.id,
        update: { quantity: roundQty(lot.quantity - closable) },
        newLot: {
          quantity: closable,
          status: 'closed',
          costBasis: lot.costBasis,
          realizedGain,
        },
      })
    }

    closedResults.push({
      lotId: lot.id,
      quantity: closable,
      costBasis: lot.costBasis,
      realizedGain,
    })
    remaining -= closable
  }

  return { closedResults, mutations, remaining }
}

describe('FIFO lot closing', () => {
  describe('basic ordering — sells oldest lots first', () => {
    it('closes the oldest lot first', () => {
      const lots = [
        { id: 'lot3', quantity: 10, costBasis: 130, acquisitionDate: '2025-03-01' },
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01' },
        { id: 'lot2', quantity: 10, costBasis: 120, acquisitionDate: '2025-02-01' },
      ]
      const { closedResults } = fifoClose(lots, 10, 150)
      expect(closedResults).toHaveLength(1)
      expect(closedResults[0].lotId).toBe('lot1') // oldest
      expect(closedResults[0].costBasis).toBe(100)
    })
  })

  describe('partial sell — splits lot correctly', () => {
    it('reduces the original lot and creates a closed portion', () => {
      const lots = [
        { id: 'lot1', quantity: 100, costBasis: 50, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults, mutations } = fifoClose(lots, 30, 80)

      expect(closedResults).toHaveLength(1)
      expect(closedResults[0].quantity).toBe(30)
      expect(closedResults[0].realizedGain).toBe((80 - 50) * 30) // 900

      expect(mutations).toHaveLength(1)
      expect(mutations[0].type).toBe('partialClose')
      expect(mutations[0].update.quantity).toBe(70) // 100 - 30
      expect(mutations[0].newLot.quantity).toBe(30)
      expect(mutations[0].newLot.status).toBe('closed')
    })

    it('handles fractional shares in partial sell', () => {
      const lots = [
        { id: 'lot1', quantity: 10.5, costBasis: 100, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults, mutations } = fifoClose(lots, 3.3, 120)

      expect(closedResults[0].quantity).toBe(3.3)
      expect(mutations[0].update.quantity).toBeCloseTo(7.2, 4)
    })
  })

  describe('full sell — closes lot with correct quantity (NOT 0)', () => {
    it('sets quantity to closable amount (the full lot quantity), not 0', () => {
      const lots = [
        { id: 'lot1', quantity: 50, costBasis: 100, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults, mutations } = fifoClose(lots, 50, 150)

      expect(closedResults).toHaveLength(1)
      expect(closedResults[0].quantity).toBe(50) // NOT 0
      expect(mutations[0].type).toBe('fullClose')
      expect(mutations[0].update.quantity).toBe(50) // NOT 0 — critical per CLAUDE.md
      expect(mutations[0].update.status).toBe('closed')
    })

    it('closes lot when qty is within epsilon of full quantity', () => {
      // If closable (10) >= lot.quantity (10.00005) - QTY_EPSILON (0.0001)
      // 10 >= 9.99995 → true → full close
      const lots = [
        { id: 'lot1', quantity: 10.00005, costBasis: 100, acquisitionDate: '2025-01-01' },
      ]
      const { mutations } = fifoClose(lots, 10, 120)
      expect(mutations[0].type).toBe('fullClose')
    })
  })

  describe('multiple lots to fulfill one sell', () => {
    it('closes across multiple lots in FIFO order', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01' },
        { id: 'lot2', quantity: 20, costBasis: 110, acquisitionDate: '2025-02-01' },
        { id: 'lot3', quantity: 30, costBasis: 120, acquisitionDate: '2025-03-01' },
      ]
      const { closedResults, mutations } = fifoClose(lots, 25, 150)

      expect(closedResults).toHaveLength(2)

      // First lot fully closed
      expect(closedResults[0].lotId).toBe('lot1')
      expect(closedResults[0].quantity).toBe(10)
      expect(mutations[0].type).toBe('fullClose')

      // Second lot partially closed (need 15 more from 20)
      expect(closedResults[1].lotId).toBe('lot2')
      expect(closedResults[1].quantity).toBe(15)
      expect(mutations[1].type).toBe('partialClose')
      expect(mutations[1].update.quantity).toBe(5) // 20 - 15 remaining
    })

    it('closes all lots when selling total quantity', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01' },
        { id: 'lot2', quantity: 20, costBasis: 110, acquisitionDate: '2025-02-01' },
      ]
      const { closedResults, mutations, remaining } = fifoClose(lots, 30, 150)

      expect(closedResults).toHaveLength(2)
      expect(remaining).toBe(0)
      expect(mutations[0].type).toBe('fullClose')
      expect(mutations[1].type).toBe('fullClose')
    })
  })

  describe('sell more than available', () => {
    it('closes all lots and has remaining quantity left over', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults, remaining } = fifoClose(lots, 50, 150)

      expect(closedResults).toHaveLength(1)
      expect(closedResults[0].quantity).toBe(10) // only what's available
      expect(remaining).toBe(40) // 50 - 10 = 40 unfulfilled
    })

    it('handles empty lots array gracefully', () => {
      const { closedResults, remaining } = fifoClose([], 10, 150)
      expect(closedResults).toHaveLength(0)
      expect(remaining).toBe(10)
    })
  })

  describe('sell exactly total quantity', () => {
    it('remaining is 0', () => {
      const lots = [
        { id: 'lot1', quantity: 5, costBasis: 100, acquisitionDate: '2025-01-01' },
        { id: 'lot2', quantity: 5, costBasis: 110, acquisitionDate: '2025-02-01' },
      ]
      const { remaining } = fifoClose(lots, 10, 150)
      expect(remaining).toBe(0)
    })
  })

  describe('realized gain calculation', () => {
    it('calculates gain as (sellPrice - costBasis) * qty', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults } = fifoClose(lots, 10, 150)
      expect(closedResults[0].realizedGain).toBe((150 - 100) * 10) // 500
    })

    it('calculates negative gain (loss) correctly', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 150, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults } = fifoClose(lots, 10, 100)
      expect(closedResults[0].realizedGain).toBe((100 - 150) * 10) // -500
    })

    it('calculates zero gain when sell price equals cost basis', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults } = fifoClose(lots, 10, 100)
      expect(closedResults[0].realizedGain).toBe(0)
    })

    it('calculates gain correctly across lots with different cost bases', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 80, acquisitionDate: '2025-01-01' },
        { id: 'lot2', quantity: 10, costBasis: 120, acquisitionDate: '2025-02-01' },
      ]
      const { closedResults } = fifoClose(lots, 20, 100)
      // lot1: (100-80)*10 = 200
      // lot2: (100-120)*10 = -200
      expect(closedResults[0].realizedGain).toBe(200)
      expect(closedResults[1].realizedGain).toBe(-200)
      // Total realized gain = 0
      const totalGain = closedResults.reduce((sum, r) => sum + r.realizedGain, 0)
      expect(totalGain).toBe(0)
    })

    it('gain for partial sell uses partial quantity', () => {
      const lots = [
        { id: 'lot1', quantity: 100, costBasis: 50, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults } = fifoClose(lots, 25, 80)
      expect(closedResults[0].realizedGain).toBe((80 - 50) * 25) // 750
    })
  })

  describe('institution filtering', () => {
    it('prefers lots from the specified institution', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01', institution: 'Schwab' },
        { id: 'lot2', quantity: 10, costBasis: 90, acquisitionDate: '2024-12-01', institution: 'IBKR' },
      ]
      // lot2 is older but wrong institution; lot1 matches institution
      const { closedResults } = fifoClose(lots, 5, 150, 'Schwab')
      expect(closedResults[0].lotId).toBe('lot1')
    })

    it('falls back to all lots if no lots match the institution', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01', institution: 'Schwab' },
        { id: 'lot2', quantity: 10, costBasis: 90, acquisitionDate: '2024-12-01', institution: 'IBKR' },
      ]
      // No lots match 'Fidelity', so all lots are used and FIFO applies
      const { closedResults } = fifoClose(lots, 5, 150, 'Fidelity')
      expect(closedResults[0].lotId).toBe('lot2') // oldest
    })
  })

  describe('edge cases', () => {
    it('handles zero quantity to close', () => {
      const lots = [
        { id: 'lot1', quantity: 10, costBasis: 100, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults, remaining } = fifoClose(lots, 0, 150)
      expect(closedResults).toHaveLength(0)
      expect(remaining).toBe(0)
    })

    it('handles lots with no acquisitionDate (sorted as empty string)', () => {
      const lots = [
        { id: 'lot2', quantity: 10, costBasis: 110, acquisitionDate: '2025-02-01' },
        { id: 'lot1', quantity: 10, costBasis: 100 }, // no date sorts first (empty string)
      ]
      const { closedResults } = fifoClose(lots, 10, 150)
      expect(closedResults[0].lotId).toBe('lot1') // empty string sorts before any date
    })

    it('handles very small fractional quantities', () => {
      const lots = [
        { id: 'lot1', quantity: 0.001, costBasis: 50000, acquisitionDate: '2025-01-01' },
      ]
      const { closedResults } = fifoClose(lots, 0.001, 60000)
      expect(closedResults[0].quantity).toBe(0.001)
      expect(closedResults[0].realizedGain).toBeCloseTo(10, 2) // (60000-50000)*0.001
    })
  })
})
