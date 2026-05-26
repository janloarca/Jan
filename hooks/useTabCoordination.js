import { useEffect, useCallback, useRef } from 'react'

const CHANNEL_NAME = 'chispudo-tabs'

export function useTabCoordination() {
  const channelRef = useRef(null)
  const locksRef = useRef(new Set())

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = ch

    ch.onmessage = (e) => {
      if (e.data?.type === 'lock') locksRef.current.add(e.data.key)
      if (e.data?.type === 'unlock') locksRef.current.delete(e.data.key)
    }

    return () => ch.close()
  }, [])

  const acquireLock = useCallback((key) => {
    if (locksRef.current.has(key)) return false
    locksRef.current.add(key)
    channelRef.current?.postMessage({ type: 'lock', key })
    return true
  }, [])

  const releaseLock = useCallback((key) => {
    locksRef.current.delete(key)
    channelRef.current?.postMessage({ type: 'unlock', key })
  }, [])

  const isLocked = useCallback((key) => locksRef.current.has(key), [])

  return { acquireLock, releaseLock, isLocked }
}
