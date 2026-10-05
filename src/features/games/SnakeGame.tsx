import { useCallback, useEffect, useRef } from 'react'
import { RotateCcw, RotateCw } from 'lucide-react'
import { PadButton } from './controls'
import { SNAKE_SIZE, newSnake, snakeDelay, step, turn, type Dir, type SnakeState } from './snake'

const PX = 20
const KEYS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }

export interface GameProps {
  onScore: (score: number) => void
  onOver: (score: number) => void
}

export default function SnakeGame({ onScore, onOver }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<SnakeState>(newSnake())
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }

  const draw = useCallback(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const s = state.current
    ctx.fillStyle = '#080c1a'
    ctx.fillRect(0, 0, SNAKE_SIZE * PX, SNAKE_SIZE * PX)
    ctx.strokeStyle = 'rgba(148,163,184,0.07)'
    for (let i = 1; i < SNAKE_SIZE; i++) {
      ctx.beginPath()
      ctx.moveTo(i * PX, 0)
      ctx.lineTo(i * PX, SNAKE_SIZE * PX)
      ctx.moveTo(0, i * PX)
      ctx.lineTo(SNAKE_SIZE * PX, i * PX)
      ctx.stroke()
    }
    ctx.fillStyle = '#fb7185'
    ctx.shadowColor = '#fb7185'
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.arc(s.apple.x * PX + PX / 2, s.apple.y * PX + PX / 2, PX * 0.38, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    s.body.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? '#67e8f9' : `hsl(${190 - Math.min(i, 30) * 3} 80% ${55 - Math.min(i, 30) * 0.6}%)`
      ctx.beginPath()
      ctx.roundRect(p.x * PX + 1, p.y * PX + 1, PX - 2, PX - 2, 5)
      ctx.fill()
    })
  }, [])

  useEffect(() => {
    let timer = 0
    let dead = false
    const loop = () => {
      if (dead) return
      const next = step(state.current)
      state.current = next
      draw()
      cb.current.onScore(next.score)
      if (next.over) {
        dead = true
        cb.current.onOver(next.score)
        return
      }
      timer = window.setTimeout(loop, snakeDelay(next.score))
    }
    draw()
    timer = window.setTimeout(loop, 1200)
    return () => {
      dead = true
      window.clearTimeout(timer)
    }
  }, [draw])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
      if (!d) return
      e.preventDefault()
      state.current = turn(state.current, d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const touch = useRef<{ x: number; y: number } | null>(null)
  /** Relative Drehung: aus Sicht der Schlange nach links oder rechts abbiegen. */
  const rel = (side: 'left' | 'right') => {
    const order: Dir[] = ['up', 'right', 'down', 'left']
    const i = order.indexOf(state.current.next)
    state.current = turn(state.current, order[(i + (side === 'right' ? 1 : 3)) % 4])
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvas}
        width={SNAKE_SIZE * PX}
        height={SNAKE_SIZE * PX}
        className="w-full max-w-[360px] touch-none rounded-2xl border border-white/10"
        onPointerDown={(e) => (touch.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const t = touch.current
          touch.current = null
          if (!t) return
          const dx = e.clientX - t.x
          const dy = e.clientY - t.y
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return
          state.current = turn(state.current, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
        }}
      />
      <div className="flex w-full max-w-[360px] items-center justify-between">
        <PadButton label="Nach links abbiegen" size="lg" onPress={() => rel('left')}><RotateCcw size={36} /></PadButton>
        <PadButton label="Nach rechts abbiegen" size="lg" onPress={() => rel('right')}><RotateCw size={36} /></PadButton>
      </div>
      <p className="text-xs text-slate-500">Tasten unten: links/rechts abbiegen · Wischen oder Pfeiltasten gehen auch</p>
    </div>
  )
}
