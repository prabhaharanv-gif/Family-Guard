import { useRef, useState } from 'react'

/**
 * Pull-to-refresh wrapper.
 *
 * Wrap any scrollable page content. When the user drags down from the very top,
 * a spinner appears; releasing past the threshold calls `onRefresh()`.
 *
 * Usage:
 *   <PullToRefresh onRefresh={async () => { await reload() }}>
 *     ...page content...
 *   </PullToRefresh>
 */
export default function PullToRefresh({ onRefresh, children }) {
  const startY = useRef(0)
  const pulling = useRef(false)
  const [pull, setPull] = useState(0)          // current pull distance in px
  const [refreshing, setRefreshing] = useState(false)

  const THRESHOLD = 70                          // px to trigger a refresh
  const MAX = 110                               // max visual pull

  const onTouchStart = (e) => {
    // Only start a pull if the scroll container is already at the top
    const el = e.currentTarget
    if (el.scrollTop <= 0 && !refreshing) {
      startY.current = e.touches[0].clientY
      pulling.current = true
    }
  }

  const onTouchMove = (e) => {
    if (!pulling.current || refreshing) return
    const dy = e.touches[0].clientY - startY.current
    if (dy > 0) {
      // Resistance curve so it feels rubber-bandy
      const dist = Math.min(MAX, dy * 0.5)
      setPull(dist)
    }
  }

  const onTouchEnd = async () => {
    if (!pulling.current) return
    pulling.current = false
    if (pull >= THRESHOLD && !refreshing) {
      setRefreshing(true)
      setPull(THRESHOLD)
      try { await onRefresh?.() } catch (_) {}
      setRefreshing(false)
    }
    setPull(0)
  }

  const rotate = Math.min(360, (pull / THRESHOLD) * 360)
  const ready = pull >= THRESHOLD

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}
    >
      {/* Spinner zone */}
      <div style={{
        height: pull, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: pulling.current ? 'none' : 'height 0.25s ease',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '3px solid #F0E4EA', borderTopColor: '#951345',
          transform: `rotate(${refreshing ? 0 : rotate}deg)`,
          animation: refreshing ? 'ptr-spin 0.7s linear infinite' : 'none',
          opacity: pull > 4 ? 1 : 0,
        }} />
      </div>

      <style>{`
        @keyframes ptr-spin { to { transform: rotate(360deg); } }
      `}</style>

      {children}
    </div>
  )
}
