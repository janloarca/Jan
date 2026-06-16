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
            backgroundColor: '#1C1C1E',
            color: '#ffffff',
            fontSize: '12px',
            lineHeight: '1.4',
            borderRadius: '8px',
            border: '1px solid #38383A',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
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
              borderTop: '6px solid #38383A',
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
              borderTop: '5px solid #1C1C1E',
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
          width: '14px',
          height: '14px',
          fontSize: '10px',
          lineHeight: 1,
          color: '#7c8a9c',
          borderRadius: '50%',
          border: '1px solid #5a6577',
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
