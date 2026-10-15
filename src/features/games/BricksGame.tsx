import { useEffect, useRef } from 'react'
import { BALL_R, BH, BRICK_H, BRICK_W, BW, COLS_B, PADDLE_H, PADDLE_W, PADDLE_Y, TOP, brickRect, launch, newBricks, stepBricks, type BricksState } from './bricks'
import { plusOverlay } from './plusfx'
import type { GameProps } from './SnakeGame'

const ROW_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#a78bfa']

export default function BricksGame({ onScore, onOver, plus }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<BricksState>(newBricks())
  const target = useRef(BW / 2)
  const keys = useRef({ left: false, right: false })
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }
  const plusOn = useRef(!!plus)
  plusOn.current = !!plus

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let done = false
    let lastScore = 0
    const draw = () => {
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      const s = state.current
      ctx.fillStyle = '#080c1a'
      ctx.fillRect(0, 0, BW, BH)
      s.bricks.forEach((alive, i) => {
        if (!alive) return
        const r = brickRect(i)
        ctx.fillStyle = ROW_COLORS[Math.floor(i / COLS_B) % ROW_COLORS.length]
        ctx.fillRect(r.x + 1.5, r.y + 1.5, BRICK_W - 3, BRICK_H - 3)
      })
      ctx.fillStyle = '#e2e8f0'
      ctx.fillRect(s.paddleX - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H)
      ctx.beginPath()
      ctx.fillStyle = '#fff'
      ctx.arc(s.x, s.y, BALL_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 20px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(String(s.score), 10, 28)
      ctx.textAlign = 'right'
      ctx.fillText('❤'.repeat(Math.max(s.lives, 0)), BW - 10, 28)
      ctx.textAlign = 'center'
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(`Level ${s.level}`, BW / 2, 28)
      if (!s.launched && !s.over) ctx.fillText('Tippen zum Abschießen', BW / 2, TOP + 6 * BRICK_H + 60)
      if (plusOn.current) plusOverlay(ctx, BW, BH)
    }
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.03)
      last = now
      if (keys.current.left) target.current -= 380 * dt
      if (keys.current.right) target.current += 380 * dt
      target.current = Math.max(0, Math.min(BW, target.current))
      state.current = stepBricks(state.current, dt, target.current)
      draw()
      if (state.current.score !== lastScore) {
        lastScore = state.current.score
        cb.current.onScore(lastScore)
      }
      if (state.current.over && !done) {
        done = true
        cb.current.onOver(state.current.score)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') { keys.current.left = down; e.preventDefault() }
      if (e.key === 'ArrowRight' || e.key === 'd') { keys.current.right = down; e.preventDefault() }
      if (down && (e.key === ' ' || e.key === 'ArrowUp')) { state.current = launch(state.current); e.preventDefault() }
    }
    const kd = (e: KeyboardEvent) => onKey(e, true)
    const ku = (e: KeyboardEvent) => onKey(e, false)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      done = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    target.current = ((e.clientX - r.left) / r.width) * BW
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvas}
        width={BW}
        height={BH}
        className="max-h-[62vh] w-auto max-w-full touch-none select-none rounded-2xl border border-white/10"
        onPointerDown={(e) => { move(e); state.current = launch(state.current) }}
        onPointerMove={move}
      />
      <p className="text-xs text-slate-500">Schläger mit Finger/Maus oder Pfeiltasten bewegen, Tippen oder Leertaste schießt den Ball ab. Jeder Stein = 1 Punkt.</p>
    </div>
  )
}
