// src/components/ui/InfoTooltip.jsx
// Capability — Lead Intelligence Explainability V1 (interaction fix pass).
//
// ROOT CAUSE of "hovering does nothing" (found by inspecting the actual
// prior implementation, not assumed):
//   A) Hover was genuinely never wired — only onClick existed on the
//      trigger button. No onMouseEnter/onMouseLeave anywhere.
//   C) BOTH real host cards (DecisionHero.jsx, DistressBanner.jsx) use
//      `overflow-hidden` on their outer wrapper (for rounded-corner
//      clipping) — so even with hover added, an absolutely-positioned
//      child popover would still be invisible, clipped by that ancestor.
//   (B was ruled out — the real reasons/missing content was already
//   wired through correctly in the prior pass.)
//
// Fix: render the popover into document.body via a portal (escapes any
// ancestor's overflow-hidden/z-index stacking entirely), positioned from
// the trigger's real getBoundingClientRect() with simple viewport-aware
// flipping. Opens on hover, click (pins it open), or keyboard focus.
// Closes on mouse leave (unless pinned by click), Escape, or outside click.
import { useState, useRef, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

const WIDTH = 320

export default function InfoTooltip({ title, definition, thisLead, reasons = [], missing = [], note }) {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [coords, setCoords] = useState(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const open = hovered || pinned

  const computePosition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const spaceBelow = vh - r.bottom
    const placeAbove = spaceBelow < 220 && r.top > 220
    let left = r.left
    if (left + WIDTH > vw - 8) left = Math.max(8, vw - WIDTH - 8) // never run off the right edge
    const top = placeAbove ? undefined : r.bottom + 6
    const bottom = placeAbove ? vh - r.top + 6 : undefined
    setCoords({ left, top, bottom })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    computePosition()
    window.addEventListener('scroll', computePosition, true)
    window.addEventListener('resize', computePosition)
    return () => {
      window.removeEventListener('scroll', computePosition, true)
      window.removeEventListener('resize', computePosition)
    }
  }, [open, computePosition])

  useLayoutEffect(() => {
    if (!pinned) return
    const onClick = (e) => {
      if (triggerRef.current?.contains(e.target)) return
      if (popoverRef.current?.contains(e.target)) return
      setPinned(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') { setPinned(false); setHovered(false) } }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [pinned])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={`Explain ${title}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setPinned(v => !v)}
        className="ml-0.5 w-3.5 h-3.5 inline-flex items-center justify-center rounded-full text-[9px] font-bold border border-[color:var(--color-text-dim)] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent-text)] hover:border-[color:var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]"
      >
        i
      </button>
      {open && coords && createPortal(
        <div
          ref={popoverRef}
          role="tooltip"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ position: 'fixed', left: coords.left, top: coords.top, bottom: coords.bottom, width: WIDTH, zIndex: 9999 }}
          className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] shadow-2xl p-3.5 text-left"
        >
          <div className="text-[11.5px] font-bold uppercase tracking-wide text-[color:var(--color-text)]">{title}</div>
          <p className="text-[11.5px] text-[color:var(--color-text-muted)] mt-0.5 leading-snug">{definition}</p>
          {thisLead != null && (
            <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-2 font-bold uppercase tracking-wide">
              This lead: <span className="text-[color:var(--color-accent-text)]">{thisLead}</span>
            </div>
          )}
          {reasons.length > 0 && (
            <>
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mt-2 mb-0.5">Why this score</div>
              <ul className="space-y-0.5">
                {reasons.map((r, i) => <li key={i} className="text-[11px] text-[color:var(--color-text)]">✓ {r}</li>)}
              </ul>
            </>
          )}
          {missing.length > 0 && (
            <>
              <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-bold mt-2 mb-0.5">Missing / Watch</div>
              <ul className="space-y-0.5">
                {missing.map((m, i) => <li key={i} className="text-[11px] text-[color:var(--color-text-dim)]">⚠ {m}</li>)}
              </ul>
            </>
          )}
          {note && <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-2 pt-2 border-t border-[color:var(--color-line)] italic">{note}</div>}
        </div>,
        document.body
      )}
    </>
  )
}
