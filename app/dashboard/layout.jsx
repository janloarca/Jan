import AuthGate from '@/components/AuthGate'

export const dynamic = 'force-dynamic'

export default function DashboardLayout({ children }) {
  return <AuthGate>{children}</AuthGate>
}
