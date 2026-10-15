import { useEffect, useRef, useState } from 'react'
import { MOLE_HOLES, MOLE_SECONDS, moleGap, moleUpTime, nextHole } from './mole'
import type { GameProps } from './SnakeGame'

export default function MoleGame({ onScore, onOver, plus }: GameProps) {
  const [hole, setHole] = useState<number | null>(null)
  const [hit, setHit] = useState<number | null>(null)
  const [left, setLeft] = useState(MOLE_SECONDS)
  const score = useRef(0)
  const alive = useRef(true)
  const current = useRef<number | null>(null)
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }

  useEffect(() => {
    const start = performance.now()
    let spawn = 0
    let hide = 0
    const elapsed = () => (performance.now() - start) / 1000
    const show = () => {
      if (!alive.current) return
      const h = nextHole(current.current)
      current.current = h
      setHole(h)
      hide = window.setTimeout(() => {
        current.current = null
        setHole(null)
        spawn = window.setTimeout(show, moleGap(elapsed()))
      }, moleUpTime(elapsed()))
    }
    spawn = window.setTimeout(show, 600)
    const clock = window.setInterval(() => {
      const rest = Math.max(0, Math.ceil(MOLE_SECONDS - elapsed()))
      setLeft(rest)
      if (rest <= 0 && alive.current) {
        alive.current = false
        window.clearTimeout(spawn)
        window.clearTimeout(hide)
        setHole(null)
        cb.current.onOver(score.current)
      }
    }, 200)
    return () => {
      alive.current = false
      window.clearTimeout(spawn)
      window.clearTimeout(hide)
      window.clearInterval(clock)
    }
  }, [])

  function whack(i: number) {
    if (!alive.current || current.current !== i) return
    current.current = null
    setHole(null)
    setHit(i)
    window.setTimeout(() => setHit(null), 180)
    score.current += 1
    cb.current.onScore(score.current)
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="font-mono text-lg text-accent-cyan">{left}s</p>
      <div className={`grid w-full max-w-[360px] grid-cols-3 gap-3 ${plus ? 'rounded-2xl p-2 shadow-glow' : ''}`}>
        {Array.from({ length: MOLE_HOLES }, (_, i) => (
          <button
            key={i}
            type="button"
            onPointerDown={(e) => { e.preventDefault(); whack(i) }}
            aria-label={hole === i ? 'Maulwurf' : 'Loch'}
            className={`flex aspect-square touch-none select-none items-center justify-center rounded-full border-4 text-5xl transition ${
              hit === i ? 'border-emerald-400 bg-emerald-400/20' : 'border-amber-900/60 bg-amber-950/70'
            }`}
          >
            {hole === i ? '🐹' : hit === i ? '💥' : ''}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">Tippe auf jeden Maulwurf, bevor er verschwindet. {MOLE_SECONDS} Sekunden, er wird immer schneller.</p>
    </div>
  )
}
