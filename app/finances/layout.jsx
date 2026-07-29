import AuthGate from '@/components/AuthGate'

export const dynamic = 'force-dynamic'

export default function FinancesLayout({ children }) {
  return <AuthGate>{children}</AuthGate>
}
