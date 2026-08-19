'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

export default function Tooltip({ text, children }) {
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

  const toggle = useCallback((e) => {
    e.stopPropagation()
    setVisible((v) => !v)
  }, [])

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
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={toggle}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
    >
      {children}
      {visible && (
        <span
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
  return (
    <Tooltip text={text}>
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
          marginLeft: '4px',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        i
      </span>
    </Tooltip>
  )
}
