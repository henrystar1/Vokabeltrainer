import { useEffect, useRef, useState } from 'react'
import { CLICKER_SECONDS, CLICKS_PER_POINT, clickerRaw, clickerScore, clicksToNext } from './clicker'
import type { GameProps } from './SnakeGame'

interface Pop { id: number; x: number; y: number }

export default function ClickerGame({ onScore, onOver, plus }: GameProps) {
  const [clicks, setClicks] = useState(0)
  const [left, setLeft] = useState<number | null>(null)
  const [pops, setPops] = useState<Pop[]>([])
  const [press, setPress] = useState(false)
  const clicksRef = useRef(0)
  const startedAt = useRef<number | null>(null)
  const over = useRef(false)
  const lastScore = useRef(0)
  const popId = useRef(0)
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }

  useEffect(() => {
    const clock = window.setInterval(() => {
      if (startedAt.current === null || over.current) return
      const rest = Math.max(0, CLICKER_SECONDS - (performance.now() - startedAt.current) / 1000)
      setLeft(Math.ceil(rest))
      if (rest <= 0) {
        over.current = true
        cb.current.onOver(clickerScore(clicksRef.current))
      }
    }, 100)
    return () => {
      over.current = true
      window.clearInterval(clock)
    }
  }, [])

  function click(e: React.PointerEvent) {
    e.preventDefault()
    if (over.current) return
    if (startedAt.current === null) {
      startedAt.current = performance.now()
      setLeft(CLICKER_SECONDS)
    }
    clicksRef.current += 1
    setClicks(clicksRef.current)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const id = popId.current++
    setPops((p) => [...p.slice(-6), { id, x: e.clientX - rect.left, y: e.clientY - rect.top }])
    window.setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 600)
    setPress(true)
    window.setTimeout(() => setPress(false), 70)
    const sc = clickerScore(clicksRef.current)
    if (sc !== lastScore.current) {
      lastScore.current = sc
      cb.current.onScore(sc)
    }
  }

  const raw = clickerRaw(clicks)
  const score = clickerScore(clicks)
  const toNext = clicksToNext(clicks)
  const prog = 1 - toNext / (CLICKS_PER_POINT * 2)

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-center">
        <p className="font-mono text-5xl text-accent-cyan">{raw.toFixed(1)}</p>
        <p className="mt-1 text-sm text-slate-300">Gewertet: <b className="font-mono text-emerald-300">{score}</b> <span className="text-slate-500">(nur gerade Zahlen zählen)</span></p>
      </div>
      <button
        type="button"
        onPointerDown={click}
        aria-label="Klicken"
        className={`relative flex h-56 w-56 touch-none select-none items-center justify-center overflow-hidden rounded-full border-4 border-white/20 bg-gradient-to-br from-cyan-400 via-violet-500 to-fuchsia-500 text-2xl font-bold text-white shadow-[0_0_50px_rgba(139,92,246,0.5)] transition-transform ${press ? 'scale-95' : 'scale-100'} ${plus ? 'ring-4 ring-fuchsia-300/40' : ''}`}
      >
        {left === null ? 'Tippen!' : '+0,1'}
        {pops.map((p) => (
          <span key={p.id} className="pointer-events-none absolute animate-ping text-sm font-semibold text-white" style={{ left: p.x - 12, top: p.y - 12 }}>+0,1</span>
        ))}
      </button>
      <div className="w-full max-w-[320px]">
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${prog * 100}%` }} />
        </div>
        <p className="mt-1 text-center text-xs text-slate-400">Noch {toNext} Klicks bis zum nächsten gewerteten Stand ({score + 2})</p>
      </div>
      <p className="font-mono text-lg text-slate-300">{left === null ? `${CLICKER_SECONDS} s – startet mit dem ersten Klick` : `${left} s`}</p>
    </div>
  )
}
