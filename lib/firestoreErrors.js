// Firestore's daily free-tier (Spark plan) quota shows up as a raw gRPC code
// ("8 RESOURCE_EXHAUSTED: Quota exceeded") that means nothing to a user and,
// critically, resolves on its own within hours — it is not a bug to fix, just
// a limit to wait out (or a reason to upgrade to Blaze if it recurs often).
//
// Extracted from components/SettingsModal.jsx, which had this same detector
// written inline for the email-test button (FASE IE9). A second caller
// (components/finance/AutoCaptureModal.jsx) writing its own copy of the same
// regex is exactly how the two drift apart later — one place, shared.
export function isFirestoreQuotaError(raw) {
  return /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(raw || ''))
}
