import AuthGate from '@/components/AuthGate'

// Sin force-dynamic: el contenido ya se renderiza en cliente detrás del
// AuthGate, así que el shell puede ser estático. Pinta al instante y Next.js
// puede prefetchear la ruta completa entre secciones.
export default function DashboardLayout({ children }) {
  return <AuthGate>{children}</AuthGate>
}
