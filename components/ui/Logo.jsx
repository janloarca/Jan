'use client'

import { useState } from 'react'
import { BOLT_PATH, BOLT_VIEWBOX, boltStrokeWidth } from '@/lib/brandBolt'

// The one place the Chispudo mark is drawn. Every screen that shows the
// brand — header, landing page, login/terms/privacy, install prompt,
// onboarding — renders THIS component instead of its own copy of a bolt +
// "Chispudo" text, so the mark can only ever look like one thing.
//
// variant="full": bolt + wordmark, for headers and anywhere there's room.
// variant="icon": bolt alone, for tight spaces (small buttons, standalone
//   marks) — it carries its own accessible name since there's no visible
//   text to do that job.
//
// Color comes from CSS variables (--accent-blue / --text-primary) by default,
// so light and dark mode are automatic — no separate light/dark branches to
// keep in sync. `interactive` fades the mark slightly on hover for when it's
// wrapped in a link/button; `disabled` dims it, same convention (opacity, not
// a second color palette) a disabled button elsewhere in the app already
// uses. `tone="inverted"` is the one explicit exception: solid white, for
// when the mark sits ON a solid brand-blue tile (e.g. InstallPrompt's icon
// badge) rather than on the page background — a real second color, not a
// theme fork, so it's opt-in per call site instead of automatic.
export default function Logo({
  variant = 'full',
  size = 20,
  disabled = false,
  interactive = false,
  tone = 'brand',
  className = '',
  style = {},
  // Lets a caller keep an existing heading level (Header's h1) on the
  // wordmark instead of always emitting a plain span — the mark's own
  // markup shouldn't dictate a page's heading structure.
  as: WordmarkTag = 'span',
  // Native browser tooltip on the whole mark (e.g. Header's tagline) —
  // passed straight through as the standard HTML `title` attribute.
  title,
}) {
  const [hovered, setHovered] = useState(false)
  const strokeWidth = boltStrokeWidth(size)
  const boltColor = disabled ? 'var(--text-muted)' : tone === 'inverted' ? '#ffffff' : 'var(--accent-blue)'
  const wordmarkColor = disabled ? 'var(--text-muted)' : tone === 'inverted' ? '#ffffff' : 'var(--text-primary)'
  const fade = !disabled && interactive && hovered ? 0.75 : 1

  const bolt = (
    <svg
      width={size}
      height={size}
      viewBox={BOLT_VIEWBOX}
      aria-hidden={variant === 'full' ? 'true' : undefined}
      role={variant === 'icon' ? 'img' : undefined}
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {variant === 'icon' && <title>Chispudo</title>}
      <path
        d={BOLT_PATH}
        fill={boltColor}
        stroke={boltColor}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )

  const hoverProps = interactive
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : {}

  if (variant === 'icon') {
    return (
      <span
        className={className}
        title={title}
        {...hoverProps}
        style={{
          display: 'inline-flex',
          opacity: disabled ? 0.4 : fade,
          transition: interactive ? 'opacity 0.15s ease' : undefined,
          ...style,
        }}
      >
        {bolt}
      </span>
    )
  }

  // Text carries the accessible name in full mode (it's real visible text),
  // so the icon next to it is purely decorative (aria-hidden above).
  return (
    <span
      className={className}
      title={title}
      {...hoverProps}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.4),
        opacity: disabled ? 0.4 : fade,
        transition: interactive ? 'opacity 0.15s ease' : undefined,
        ...style,
      }}
    >
      {bolt}
      <WordmarkTag
        style={{
          // 900, no 800: era el ÚNICO consumidor del 800 de Inter en toda la
          // app, y ese peso se quitó de la carga para pagar el 700 de
          // JetBrains Mono (ver app/layout.jsx). El 900 ya venía cargado.
          fontWeight: 900,
          fontSize: Math.round(size * 0.9),
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: wordmarkColor,
          whiteSpace: 'nowrap',
          margin: 0,
        }}
      >
        Chispudo
      </WordmarkTag>
    </span>
  )
}
