import { useEffect, useRef } from 'react'
import type { GameProps } from './SnakeGame'
import { BIRD_R, BIRD_X, FH, FW, GROUND, PIPE_GAP, PIPE_W, flap, newFlappy, stepFlappy, type FlappyState } from './flappy'

export default function FlappyGame({ onScore, onOver }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<FlappyState>(newFlappy())
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let done = false
    let lastScore = 0
    const draw = () => {
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      const s = state.current
      const g = ctx.createLinearGradient(0, 0, 0, FH)
      g.addColorStop(0, '#0b1230')
      g.addColorStop(1, '#1b2a5c')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, FW, FH)
      for (const p of s.pipes) {
        ctx.fillStyle = '#34d399'
        ctx.fillRect(p.x, 0, PIPE_W, p.gapY - PIPE_GAP / 2)
        ctx.fillRect(p.x, p.gapY + PIPE_GAP / 2, PIPE_W, FH)
        ctx.fillStyle = '#059669'
        ctx.fillRect(p.x - 3, p.gapY - PIPE_GAP / 2 - 14, PIPE_W + 6, 14)
        ctx.fillRect(p.x - 3, p.gapY + PIPE_GAP / 2, PIPE_W + 6, 14)
      }
      ctx.fillStyle = '#334155'
      ctx.fillRect(0, FH - GROUND, FW, GROUND)
      ctx.save()
      ctx.translate(BIRD_X, s.y)
      ctx.rotate(Math.max(-0.5, Math.min(1.1, s.vy / 500)))
      ctx.fillStyle = '#fbbf24'
      ctx.beginPath()
      ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fb923c'
      ctx.beginPath()
      ctx.moveTo(BIRD_R - 2, -2)
      ctx.lineTo(BIRD_R + 8, 2)
      ctx.lineTo(BIRD_R - 2, 5)
      ctx.fill()
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(4, -4, 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 34px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(s.score), FW / 2, 56)
      if (!s.started) {
        ctx.font = '14px system-ui, sans-serif'
        ctx.fillStyle = '#cbd5e1'
        ctx.fillText('Tippen zum Flattern', FW / 2, FH / 2 + 60)
      }
    }
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      state.current = stepFlappy(state.current, dt)
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w') {
        e.preventDefault()
        state.current = flap(state.current)
      }
    }
    // Ein Tipp irgendwo auf dem Bildschirm lässt den Vogel flattern (außer auf Knöpfen/Links/Dialogen).
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t?.closest('button, a, input, select, textarea, [role="dialog"], [data-no-flap]')) return
      state.current = flap(state.current)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      done = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvas}
        width={FW}
        height={FH}
        className="max-h-[62vh] w-auto max-w-full touch-none select-none rounded-2xl border border-white/10"
      />
      <p className="text-xs text-slate-500">Tippe irgendwo auf den Bildschirm oder drücke die Leertaste = flattern. Durch die Lücken fliegen.</p>
    </div>
  )
}
