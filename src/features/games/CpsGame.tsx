import { useEffect, useRef, useState } from 'react'
import { CPS_SECONDS, currentCps, peakCps } from './cps'
import type { GameProps } from './SnakeGame'

export default function CpsGame({ onScore, onOver, plus }: GameProps) {
  const [now, setNow] = useState(0)
  const [started, setStarted] = useState(false)
  const [left, setLeft] = useState(CPS_SECONDS)
  const [count, setCount] = useState(0)
  const [press, setPress] = useState(false)
  const times = useRef<number[]>([])
  const t0 = useRef<number | null>(null)
  const over = useRef(false)
  const lastPeak = useRef(0)
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }

  useEffect(() => {
    const clock = window.setInterval(() => {
      if (t0.current === null || over.current) return
      const t = performance.now() - t0.current
      setNow(t)
      setLeft(Math.max(0, Math.ceil(CPS_SECONDS - t / 1000)))
      if (t >= CPS_SECONDS * 1000) {
        over.current = true
        cb.current.onOver(peakCps(times.current))
      }
    }, 50)
    return () => {
      over.current = true
      window.clearInterval(clock)
    }
  }, [])

  function click(e: React.PointerEvent) {
    e.preventDefault()
    if (over.current) return
    if (t0.current === null) {
      t0.current = performance.now()
      setStarted(true)
    }
    const t = performance.now() - t0.current
    if (t >= CPS_SECONDS * 1000) return
    times.current.push(t)
    setCount(times.current.length)
    setNow(t)
    setPress(true)
    window.setTimeout(() => setPress(false), 60)
    const p = peakCps(times.current)
    if (p !== lastPeak.current) {
      lastPeak.current = p
      cb.current.onScore(p)
    }
  }

  const cur = currentCps(times.current, now)
  const peak = peakCps(times.current)
  const avg = now > 0 ? count / (Math.min(now, CPS_SECONDS * 1000) / 1000) : 0

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="grid w-full max-w-[340px] grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white/5 p-2"><p className="label-mono">Jetzt</p><p className="font-mono text-2xl text-accent-cyan">{cur}</p></div>
        <div className="rounded-xl bg-white/5 p-2"><p className="label-mono">Bestwert</p><p className="font-mono text-2xl text-amber-300">{peak}</p></div>
        <div className="rounded-xl bg-white/5 p-2"><p className="label-mono">Schnitt</p><p className="font-mono text-2xl text-slate-200">{avg.toFixed(1)}</p></div>
      </div>
      <button
        type="button"
        onPointerDown={click}
        aria-label="Klicken"
        className={`flex h-56 w-full max-w-[340px] touch-none select-none items-center justify-center rounded-3xl border-4 border-white/20 bg-gradient-to-br from-amber-400 via-rose-500 to-fuchsia-600 text-3xl font-bold text-white shadow-[0_0_50px_rgba(244,63,94,0.4)] transition-transform ${press ? 'scale-[0.97]' : 'scale-100'} ${plus ? 'ring-4 ring-fuchsia-300/40' : ''}`}
      >
        {started ? count : 'Los!'}
      </button>
      <div className="w-full max-w-[340px]">
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-rose-400" style={{ width: `${started ? Math.min(100, (now / (CPS_SECONDS * 1000)) * 100) : 0}%` }} />
        </div>
        <p className="mt-1 text-center font-mono text-sm text-slate-300">{started ? `${left} s` : `${CPS_SECONDS} s – starten mit dem ersten Klick`}</p>
      </div>
      <p className="text-center text-xs text-slate-500">Klicke so schnell du kannst. Gewertet wird dein bester Moment: die meisten Klicks innerhalb einer Sekunde.</p>
    </div>
  )
}
