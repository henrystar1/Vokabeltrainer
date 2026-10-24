import { useEffect, useRef, useState } from 'react'

/**
 * Bildschirm-Joystick (links/rechts) für iPad und Handy. Liefert einen Wert von −1 bis 1.
 * Reagiert sofort beim Antippen, Totzone in der Mitte, Finger darf aus dem Kreis hinaus.
 *
 * Robust gegen "hängende" Eingaben: Der Stick wird auf 0 gesetzt, wenn der Finger losgelassen wird, wenn das Ziel
 * verloren geht (lostpointercapture, pointercancel, auch ein Textmarkieren/Kontextmenü am iPad), wenn das Fenster den
 * Fokus verliert oder der Tab verdeckt wird. Zusätzlich überwacht ein Fenster-Listener alle Finger: sind keine mehr
 * auf dem Bildschirm, ist der Stick sofort wieder in der Mitte. Texte werden nie markiert.
 */
export function Joystick({ onChange, size = 132 }: { onChange: (x: number) => void; size?: number }) {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState(0)
  const id = useRef<number | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  const radius = size / 2 - 22

  const update = (clientX: number) => {
    const r = base.current?.getBoundingClientRect()
    if (!r) return
    const dx = clientX - (r.left + r.width / 2)
    const v = Math.max(-1, Math.min(1, dx / radius))
    setKnob(v)
    cb.current(Math.abs(v) < 0.2 ? 0 : v)
  }
  const end = () => {
    id.current = null
    setKnob(0)
    cb.current(0)
  }

  useEffect(() => {
    const stop = () => { if (id.current !== null) end() }
    const up = (e: PointerEvent) => { if (id.current === e.pointerId) end() }
    // Letzter Finger weg, aber kein pointerup angekommen (iOS: Markieren, Lupe, Systemgeste)
    const touchEnd = (e: TouchEvent) => { if (e.touches.length === 0) stop() }
    const hidden = () => { if (document.hidden) stop() }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('touchend', touchEnd)
    window.addEventListener('touchcancel', touchEnd)
    window.addEventListener('blur', stop)
    window.addEventListener('pagehide', stop)
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('selectstart', stopSelect)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('touchend', touchEnd)
      window.removeEventListener('touchcancel', touchEnd)
      window.removeEventListener('blur', stop)
      window.removeEventListener('pagehide', stop)
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('selectstart', stopSelect)
      cb.current(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={base}
      role="slider"
      aria-label="Joystick: links und rechts"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Math.round(knob * 10) / 10}
      className="relative touch-none select-none rounded-full border border-white/20 bg-white/10"
      style={{ width: size, height: size, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }}
      onPointerDown={(e) => {
        e.preventDefault()
        id.current = e.pointerId
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* Zeiger schon weg */ }
        update(e.clientX)
      }}
      onPointerMove={(e) => {
        if (id.current !== e.pointerId) return
        // Maus: Taste wurde außerhalb losgelassen → nicht weiterlaufen
        if (e.pointerType === 'mouse' && e.buttons === 0) { end(); return }
        update(e.clientX)
      }}
      onPointerUp={(e) => { if (id.current === e.pointerId) end() }}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="pointer-events-none absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
      <div
        className="pointer-events-none absolute top-1/2 h-11 w-11 -translate-y-1/2 rounded-full border border-white/40 bg-white/30 shadow-lg"
        style={{ left: `calc(50% - 22px + ${knob * radius}px)` }}
      />
    </div>
  )
}

function stopSelect(e: Event) { e.preventDefault() }
