import { useRef, useState } from 'react'

/**
 * Bildschirm-Joystick (links/rechts) für iPad und Handy. Liefert einen Wert von −1 bis 1.
 * Reagiert sofort beim Antippen, Totzone in der Mitte, Finger darf aus dem Kreis hinaus.
 */
export function Joystick({ onChange, size = 132 }: { onChange: (x: number) => void; size?: number }) {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState(0)
  const id = useRef<number | null>(null)
  const radius = size / 2 - 22

  const update = (clientX: number) => {
    const r = base.current?.getBoundingClientRect()
    if (!r) return
    const dx = clientX - (r.left + r.width / 2)
    const v = Math.max(-1, Math.min(1, dx / radius))
    setKnob(v)
    onChange(Math.abs(v) < 0.15 ? 0 : v)
  }
  const end = () => {
    id.current = null
    setKnob(0)
    onChange(0)
  }

  return (
    <div
      ref={base}
      role="slider"
      aria-label="Joystick: links und rechts"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Math.round(knob * 10) / 10}
      className="relative touch-none select-none rounded-full border border-white/20 bg-white/10"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        e.preventDefault()
        id.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e.clientX)
      }}
      onPointerMove={(e) => { if (id.current === e.pointerId) update(e.clientX) }}
      onPointerUp={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute inset-x-3 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
      <div
        className="absolute top-1/2 h-11 w-11 -translate-y-1/2 rounded-full border border-white/40 bg-white/30 shadow-lg"
        style={{ left: `calc(50% - 22px + ${knob * radius}px)` }}
      />
    </div>
  )
}
