import './globals.css'

export const metadata = {
  title: 'Portfolio Tracker - chispu.xyz',
  description: 'Track your investment portfolio',
}

export default function RootLayout({ children }) {
  const themeScript = `
    (function() {
      try {
        var saved = localStorage.getItem('chispudo-theme');
        if (saved === 'light' || saved === 'dark') {
          document.documentElement.setAttribute('data-theme', saved);
        } else {
          var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        }
      } catch(e) {}
    })();
  `

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
