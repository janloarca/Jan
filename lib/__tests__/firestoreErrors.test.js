import { isFirestoreQuotaError } from '../firestoreErrors'

describe('isFirestoreQuotaError', () => {
  it('recognizes the real gRPC error string Firestore sends', () => {
    expect(isFirestoreQuotaError('8: 8 RESOURCE_EXHAUSTED: Quota exceeded.')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isFirestoreQuotaError('quota EXCEEDED')).toBe(true)
  })

  it('does not fire on an unrelated error', () => {
    expect(isFirestoreQuotaError('permission-denied: Missing permissions')).toBe(false)
    expect(isFirestoreQuotaError('Internal server error')).toBe(false)
  })

  it('handles null/undefined/empty without throwing', () => {
    expect(isFirestoreQuotaError(null)).toBe(false)
    expect(isFirestoreQuotaError(undefined)).toBe(false)
    expect(isFirestoreQuotaError('')).toBe(false)
  })
})
