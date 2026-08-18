import { ImageResponse } from 'next/og'
import { BOLT_PATH, BOLT_VIEWBOX } from '@/lib/brandBolt'

// La tarjeta que se ve cuando alguien comparte chispu.xyz en WhatsApp, X o
// Slack. Hasta ahora `app/layout.jsx` declaraba `twitter.card:
// 'summary_large_image'` (o sea "acá va una imagen grande") y no había NINGUNA
// imagen, así que cada link compartido salía pelado.
//
// Se genera en el build, no es un PNG que alguien tenga que rehacer a mano cada
// vez que cambie la marca. El rayo sale de `lib/brandBolt.js`, la MISMA fuente
// que dibuja `components/ui/Logo.jsx`: el componente no se puede reusar acá
// (es 'use client' y usa useState, y Satori no corre hooks), pero el path sí,
// así que la marca de la tarjeta social no puede divergir de la de la app.
//
// Colores fijos y a juego con la landing, que también es de paleta fija.
//
// Ojo al editar: Satori soporta un SUBCONJUNTO de CSS. Solo flexbox (nada de
// grid), y todo elemento con más de un hijo necesita `display: flex` explícito.
export const runtime = 'nodejs'
export const alt = 'Chispudo: track your entire portfolio, not just stocks'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INK = '#111827'
const BODY = '#374151'
const MUTED = '#6B7280'
const BLUE = '#2563EB'

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#FFFFFF',
          padding: '72px 80px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="56" height="56" viewBox={BOLT_VIEWBOX} fill={BLUE}>
            <path d={BOLT_PATH} />
          </svg>
          <span style={{ fontSize: 44, fontWeight: 800, color: INK, marginLeft: 16, letterSpacing: '-0.02em' }}>
            Chispudo
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 78, fontWeight: 800, color: INK, lineHeight: 1.05, letterSpacing: '-0.03em' }}>
            Track your entire portfolio.
          </div>
          <div style={{ fontSize: 78, fontWeight: 800, color: BLUE, lineHeight: 1.05, letterSpacing: '-0.03em' }}>
            Not just stocks.
          </div>
          <div style={{ fontSize: 30, color: BODY, marginTop: 28, maxWidth: 900 }}>
            Bonds, real estate, DeFi, SAFE notes, private equity, bank accounts. Built for Latin America.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex' }}>
            {['Wealth', 'Cash flow', 'The sheet', 'Friends'].map((label, i) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 24,
                  color: BODY,
                  marginRight: i === 3 ? 0 : 28,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    marginRight: 10,
                    backgroundColor: ['#2563EB', '#00764F', '#B274DC', '#E07227'][i],
                  }}
                />
                {label}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 24, color: MUTED }}>chispu.xyz</div>
        </div>
      </div>
    ),
    size
  )
}
