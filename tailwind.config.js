/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'theme-base': 'var(--bg-primary)',
        'theme-surface': 'var(--bg-secondary)',
        'theme-card': 'var(--bg-card)',
        'theme-elevated': 'var(--bg-card-hover)',
        'theme-input': 'var(--bg-input)',
        'theme-tertiary': 'var(--bg-tertiary)',
        'glass-border': 'var(--border-primary)',
        'glass-subtle': 'var(--border-subtle)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'SF Pro Display', 'system-ui', 'Helvetica Neue', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'kpi': ['2.25rem', { lineHeight: '1.15', fontWeight: '700', letterSpacing: '0.01em' }],
        'h1': ['1.375rem', { lineHeight: '1.3', fontWeight: '700', letterSpacing: '0.01em' }],
        'h2': ['1.0625rem', { lineHeight: '1.4', fontWeight: '600' }],
        'h3': ['0.9375rem', { lineHeight: '1.4', fontWeight: '600' }],
        'body': ['0.9375rem', { lineHeight: '1.47' }],
        'caption': ['0.8125rem', { lineHeight: '1.38' }],
        'micro': ['0.75rem', { lineHeight: '1.33' }],
        'display': ['2.5rem', { lineHeight: '1.1', fontWeight: '800', letterSpacing: '-0.02em' }],
      },
    },
  },
  plugins: [],
}
