import './globals.css'

export const metadata = {
  title: 'Portfolio Tracker - chispu.xyz',
  description: 'Track your investment portfolio',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
