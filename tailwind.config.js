/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'SF Pro Display', 'system-ui', 'Helvetica Neue', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'kpi': ['2.125rem', { lineHeight: '1.15', fontWeight: '700', letterSpacing: '0.01em' }],
        'h1': ['1.375rem', { lineHeight: '1.3', fontWeight: '700', letterSpacing: '0.01em' }],
        'h2': ['1.0625rem', { lineHeight: '1.4', fontWeight: '600' }],
        'h3': ['0.9375rem', { lineHeight: '1.4', fontWeight: '600' }],
        'body': ['0.9375rem', { lineHeight: '1.47' }],
        'caption': ['0.8125rem', { lineHeight: '1.38' }],
        'micro': ['0.6875rem', { lineHeight: '1.27' }],
      },
    },
  },
  plugins: [],
}
