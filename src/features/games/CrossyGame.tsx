import { useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react'
import type { GameProps } from './SnakeGame'
import { PadButton } from './controls'
import { COLS, VIEW_ROWS, move, newCrossy, stepCrossy, type CrossyState } from './crossy'

const PX = 34

export default function CrossyGame({ onScore, onOver }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<CrossyState>(newCrossy())
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }
  const touch = useRef<{ x: number; y: number } | null>(null)
  const doneRef = useRef(false)

  const act = useCallback((dx: number, dy: number) => {
    if (doneRef.current) return
    state.current = move(state.current, dx, dy)
    cb.current.onScore(state.current.best)
  }, [])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const draw = () => {
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      const s = state.current
      const base = Math.max(0, s.row - 3) // unterste sichtbare Reihe
      ctx.fillStyle = '#080c1a'
      ctx.fillRect(0, 0, COLS * PX, VIEW_ROWS * PX)
      for (let i = 0; i < VIEW_ROWS; i++) {
        const idx = base + i
        const row = s.rows[idx]
        if (!row) continue
        const y = (VIEW_ROWS - 1 - i) * PX
        ctx.fillStyle = row.type === 'road' ? '#1e293b' : idx % 2 ? '#14532d' : '#166534'
        ctx.fillRect(0, y, COLS * PX, PX)
        if (row.type === 'road') {
          ctx.fillStyle = 'rgba(255,255,255,0.12)'
          for (let x = 0; x < COLS; x++) ctx.fillRect(x * PX + 6, y + PX / 2 - 1, PX - 12, 2)
          for (const c of row.cars) {
            ctx.fillStyle = row.dir > 0 ? '#f87171' : '#60a5fa'
            ctx.beginPath()
            ctx.roundRect(c.x * PX + 2, y + 5, c.len * PX - 4, PX - 10, 6)
            ctx.fill()
            ctx.fillStyle = '#fef9c3'
            ctx.fillRect((row.dir > 0 ? c.x + c.len : c.x) * PX - (row.dir > 0 ? 7 : -3), y + 9, 4, PX - 18)
          }
        } else {
          for (const t of row.trees) {
            ctx.fillStyle = '#052e16'
            ctx.beginPath()
            ctx.arc(t * PX + PX / 2, y + PX / 2, PX * 0.38, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#15803d'
            ctx.beginPath()
            ctx.arc(t * PX + PX / 2, y + PX / 2 - 2, PX * 0.3, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      const py = (VIEW_ROWS - 1 - (s.row - base)) * PX
      ctx.fillStyle = s.over ? '#ef4444' : '#f8fafc'
      ctx.beginPath()
      ctx.roundRect(s.col * PX + 7, py + 7, PX - 14, PX - 12, 5)
      ctx.fill()
      ctx.fillStyle = '#fb923c'
      ctx.fillRect(s.col * PX + PX / 2 - 3, py + 3, 6, 5)
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(s.col * PX + PX / 2 - 2, py + 1, 4, 3)
      if (s.idle > 4 && !s.over) {
        ctx.fillStyle = 'rgba(251,113,133,0.9)'
        ctx.font = 'bold 14px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Weiter! Der Adler kommt …', (COLS * PX) / 2, 20)
      }
    }
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      state.current = stepCrossy(state.current, dt)
      draw()
      if (state.current.over && !doneRef.current) {
        doneRef.current = true
        cb.current.onOver(state.current.best)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'ArrowUp' || k === 'w') act(0, 1)
      else if (k === 'ArrowDown' || k === 's') act(0, -1)
      else if (k === 'ArrowLeft' || k === 'a') act(-1, 0)
      else if (k === 'ArrowRight' || k === 'd') act(1, 0)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      doneRef.current = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
    }
  }, [act])

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvas}
        width={COLS * PX}
        height={VIEW_ROWS * PX}
        className="w-full max-w-[340px] touch-none select-none rounded-2xl border border-white/10"
        onPointerDown={(e) => (touch.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const t = touch.current
          touch.current = null
          if (!t) return
          const dx = e.clientX - t.x
          const dy = e.clientY - t.y
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return act(0, 1)
          if (Math.abs(dx) > Math.abs(dy)) act(dx > 0 ? 1 : -1, 0)
          else act(0, dy < 0 ? 1 : -1)
        }}
      />
      <div className="flex w-full max-w-[340px] items-center justify-between gap-2">
        <PadButton label="Links" size="lg" onPress={() => act(-1, 0)}><ArrowLeft size={36} /></PadButton>
        <div className="flex flex-col gap-2">
          <PadButton label="Vor" onPress={() => act(0, 1)}><ArrowUp size={28} /></PadButton>
          <PadButton label="Zurück" onPress={() => act(0, -1)}><ArrowDown size={28} /></PadButton>
        </div>
        <PadButton label="Rechts" size="lg" onPress={() => act(1, 0)}><ArrowRight size={36} /></PadButton>
      </div>
      <p className="text-xs text-slate-500">Pfeiltasten/WASD, Wischen oder Tippen (= vorwärts). Kommt man nicht weiter, holt dich der Adler.</p>
    </div>
  )
}
