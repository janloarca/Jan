import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(active = true) {
  const ref = useRef(null)
  const previousFocus = useRef(null)

  useEffect(() => {
    if (!active || !ref.current) return
    previousFocus.current = document.activeElement

    const container = ref.current
    const focusables = () => [...container.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)

    const first = focusables()[0]
    if (first) first.focus()

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const els = focusables()
      if (els.length === 0) return
      const firstEl = els[0]
      const lastEl = els[els.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      if (previousFocus.current && previousFocus.current.focus) {
        previousFocus.current.focus()
      }
    }
  }, [active])

  return ref
}
