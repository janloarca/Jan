import AuthGate from '@/components/AuthGate'

export const dynamic = 'force-dynamic'

export default function SpreadsheetLayout({ children }) {
  return <AuthGate>{children}</AuthGate>
}
