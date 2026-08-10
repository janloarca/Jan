import { useState, useLayoutEffect, useCallback, useRef } from 'react'

// FASE GP. Mobile pill/tab rows (period selector, institution filter, Settings
// tabs) scroll horizontally but give zero visual sign of it: `scrollbarWidth:
// 'none'` hides the native scrollbar on purpose (it looked cluttered), so the
// last pill just gets clipped at the phone's edge with nothing telling the
// user there's more to swipe to (user report: "Configuracion" tabs and the
// institution filter both cut off mid-word on an iPhone, no cue to scroll).
//
// This measures the scroll container's OWN state (scrollLeft vs scrollWidth)
// and returns a CSS mask that fades only the edges that actually hide
// content — never a decorative fade on a row that already shows everything
// (a fixed fade would falsely hint "swipe" on desktop, where these same rows
// usually fit in full). Pure UI affordance: never changes what's rendered or
// what data feeds it.
export function useEdgeFade(deps = []) {
  const [node, setNode] = useState(null)
  const [fade, setFade] = useState({ left: false, right: false })
  const roRef = useRef(null)

  const measure = useCallback((el) => {
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setFade({
      left: scrollLeft > 2,
      right: scrollLeft + clientWidth < scrollWidth - 2,
    })
  }, [])

  const ref = useCallback((el) => setNode(el), [])

  useLayoutEffect(() => {
    if (!node) return
    measure(node)
    const onScroll = () => measure(node)
    node.addEventListener('scroll', onScroll, { passive: true })
    roRef.current = new ResizeObserver(() => measure(node))
    roRef.current.observe(node)
    return () => {
      node.removeEventListener('scroll', onScroll)
      roRef.current?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, measure, ...deps])

  const gradient = (() => {
    if (!fade.left && !fade.right) return null
    const stops = []
    stops.push(fade.left ? 'transparent 0' : 'black 0')
    if (fade.left) stops.push('black 24px')
    if (fade.right) stops.push('black calc(100% - 24px)')
    stops.push(fade.right ? 'transparent 100%' : 'black 100%')
    return `linear-gradient(to right, ${stops.join(', ')})`
  })()

  const maskStyle = gradient ? { WebkitMaskImage: gradient, maskImage: gradient } : {}

  return { ref, maskStyle }
}
