import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Große Bildschirmtaste für Touch-Geräte (iPad inklusive). Reagiert sofort beim Antippen;
 * mit `repeat` wiederholt sie die Aktion, solange man gedrückt hält.
 */
export function PadButton({ label, onPress, repeat = false, size = 'md', children }: {
  label: string
  onPress: () => void
  repeat?: boolean
  size?: 'md' | 'lg'
  children: ReactNode
}) {
  const timers = useRef<{ delay: number; every: number }>({ delay: 0, every: 0 })
  const press = useRef(onPress)
  press.current = onPress

  const stop = () => {
    window.clearTimeout(timers.current.delay)
    window.clearInterval(timers.current.every)
  }
  useEffect(() => stop, [])

  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault()
        stop()
        press.current()
        if (repeat) {
          timers.current.delay = window.setTimeout(() => {
            timers.current.every = window.setInterval(() => press.current(), 90)
          }, 260)
        }
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex touch-none select-none items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-slate-100 shadow-lg active:scale-95 active:bg-white/25 ${
        size === 'lg' ? 'h-24 w-28 sm:w-36' : 'h-16 w-16'
      }`}
    >
      {children}
    </button>
  )
}
