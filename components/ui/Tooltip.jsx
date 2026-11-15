'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

export default function Tooltip({ text, children, focusable = false, label = null }) {
  const [visible, setVisible] = useState(false)
  const wrapperRef = useRef(null)
  const timeoutRef = useRef(null)

  const show = useCallback(() => {
    clearTimeout(timeoutRef.current)
    setVisible(true)
  }, [])

  const hide = useCallback(() => {
    timeoutRef.current = setTimeout(() => setVisible(false), 120)
  }, [])

  // FASE SH (B7): en un teléfono un toque dispara PRIMERO un mouseenter emulado
  // (que abría la ayuda) y DESPUÉS el click (que la volvía a cerrar), así que en
  // táctil la "i" nunca mostraba nada. El hover queda solo para un mouse de
  // verdad (pointerType), y el click alterna solo en táctil; con mouse, el click
  // deja la ayuda abierta en vez de cerrarla debajo del cursor.
  const lastPointer = useRef('mouse')
  const onPointerDown = useCallback((e) => { lastPointer.current = e.pointerType || 'mouse' }, [])
  const onPointerEnter = useCallback((e) => { if (e.pointerType === 'mouse') show() }, [show])
  const onPointerLeave = useCallback((e) => { if (e.pointerType === 'mouse') hide() }, [hide])
  const toggle = useCallback((e) => {
    e.stopPropagation()
    if (lastPointer.current === 'mouse') { clearTimeout(timeoutRef.current); setVisible(true); return }
    setVisible((v) => !v)
  }, [])

  // FASE SI (B10): la "i" era invisible para el teclado y para un lector de
  // pantalla: un span sin tabIndex no recibe foco y su texto solo existía al
  // pasar el mouse. Con `focusable` el disparador es un botón de verdad: entra
  // al orden de tabulación, se anuncia con su texto, abre al enfocarlo o con
  // Enter/Espacio, y Esc lo cierra.
  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); e.stopPropagation()
      clearTimeout(timeoutRef.current)
      setVisible((v) => !v)
    } else if (e.key === 'Escape' && visible) {
      e.stopPropagation()
      setVisible(false)
    }
  }, [visible])
  const keyboardProps = focusable ? {
    role: 'button',
    tabIndex: 0,
    'aria-label': label || (typeof text === 'string' ? text : 'Más información'),
    'aria-expanded': visible,
    onKeyDown,
    onFocus: show,
    onBlur: () => { clearTimeout(timeoutRef.current); setVisible(false) },
  } : {}

  useEffect(() => {
    if (!visible) return
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setVisible(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [visible])

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current)
  }, [])

  return (
    <span
      ref={wrapperRef}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={toggle}
      {...keyboardProps}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '8px 12px',
            backgroundColor: 'var(--bg-card)',
            backdropFilter: 'var(--glass-blur)',
            WebkitBackdropFilter: 'var(--glass-blur)',
            color: 'var(--text-primary)',
            fontSize: '12px',
            lineHeight: '1.4',
            borderRadius: '10px',
            border: 'var(--glass-border)',
            boxShadow: 'var(--shadow-elevated)',
            maxWidth: '250px',
            minWidth: '160px',
            width: 'max-content',
            zIndex: 50,
            pointerEvents: 'none',
            whiteSpace: 'normal',
            textAlign: 'left',
            fontWeight: 400,
          }}
        >
          {text}
          {/* Arrow */}
          <span
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid var(--glass-border-color)',
            }}
          />
          <span
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginTop: '-1px',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid var(--bg-card)',
            }}
          />
        </span>
      )}
    </span>
  )
}

export function InfoTip({ text }) {
  // FASE SH (B7): el círculo se ve de 16px pero en un teléfono eso es un blanco
  // de 16px, bajo los 24 que pide WCAG 2.5.8. Un envoltorio con 4px de relleno
  // agranda el área tocable a 24x24, y los márgenes negativos devuelven el
  // mismo espacio de antes (4+16+4-4 = 20 de ancho, 24-8 = 16 de alto), así que
  // el encabezado donde va embebido no se mueve ni un píxel.
  return (
    <Tooltip text={text} focusable>
      <span aria-hidden="true" style={{ display: 'inline-flex', padding: '4px', margin: '-4px -4px -4px 0', flexShrink: 0 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            // 14px con la "i" a 10px quedaba en el límite de lo que se distingue
            // de una mota. Sube a 16/11, que es el cambio más grande que no mueve
            // el alto de línea de los encabezados donde va embebida.
            width: '16px',
            height: '16px',
            fontSize: '11px',
            lineHeight: 1,
            color: 'var(--text-muted)',
            borderRadius: '50%',
            border: '1px solid var(--border-primary)',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          i
        </span>
      </span>
    </Tooltip>
  )
}
