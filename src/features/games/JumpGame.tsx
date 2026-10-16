import { useEffect, useRef } from 'react'
import { ArrowUp } from 'lucide-react'
import { Joystick } from './joystick'
import { JH, JW, PH, PLAT_H, PW, jumpScore, newJump, stepJump, type JumpState } from './jump'
import { plusOverlay } from './plusfx'
import type { GameProps } from './SnakeGame'

export default function JumpGame({ onScore, onOver, plus }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<JumpState>(newJump())
  const input = useRef({ stick: 0, left: false, right: false, jump: false })
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
      const g = ctx.createLinearGradient(0, 0, 0, JH)
      g.addColorStop(0, '#0b1230')
      g.addColorStop(1, '#23356e')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, JW, JH)
      // ferne Hügel (Parallax)
      ctx.fillStyle = '#16224b'
      for (let i = -1; i < 6; i++) {
        const bx = i * 140 - ((s.cam * 0.3) % 140)
        ctx.beginPath()
        ctx.arc(bx + 70, JH + 10, 90, Math.PI, 0)
        ctx.fill()
      }
      ctx.save()
      ctx.translate(-s.cam, 0)
      for (const p of s.plats) {
        ctx.fillStyle = '#334155'
        ctx.fillRect(p.x, p.y, p.w, PLAT_H)
        ctx.fillStyle = '#34d399'
        ctx.fillRect(p.x, p.y, p.w, 5)
      }
      for (const c of s.coins) {
        if (c.got) continue
        ctx.fillStyle = '#fbbf24'
        ctx.beginPath()
        ctx.arc(c.x, c.y, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#b45309'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      // Figur
      ctx.fillStyle = '#f472b6'
      ctx.fillRect(s.x, s.y, PW, PH)
      ctx.fillStyle = '#fff'
      ctx.fillRect(s.x + (s.vx >= 0 ? 10 : 3), s.y + 6, 5, 5)
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(s.x + (s.vx >= 0 ? 12 : 4), s.y + 8, 2, 2)
      ctx.restore()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 22px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(String(jumpScore(s)), 12, 30)
      if (plusOn.current) plusOverlay(ctx, JW, JH)
    }
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.033)
      last = now
      const i = input.current
      const move = i.stick !== 0 ? i.stick : (i.right ? 1 : 0) - (i.left ? 1 : 0)
      state.current = stepJump(state.current, dt, { move, jump: i.jump }, Math.random)
      draw()
      const sc = jumpScore(state.current)
      if (sc !== lastScore) {
        lastScore = sc
        cb.current.onScore(sc)
      }
      if (state.current.over && !done) {
        done = true
        cb.current.onOver(sc)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const key = (e: KeyboardEvent, down: boolean) => {
      const k = e.key
      if (k === 'ArrowLeft' || k === 'a') { input.current.left = down; e.preventDefault() }
      if (k === 'ArrowRight' || k === 'd') { input.current.right = down; e.preventDefault() }
      if (k === ' ' || k === 'ArrowUp' || k === 'w') { input.current.jump = down; e.preventDefault() }
    }
    const kd = (e: KeyboardEvent) => key(e, true)
    const ku = (e: KeyboardEvent) => key(e, false)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      done = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas ref={canvas} width={JW} height={JH} className="w-full max-w-[640px] touch-none select-none rounded-2xl border border-white/10" />
      <div className="flex w-full max-w-[640px] items-center justify-between px-2">
        <Joystick onChange={(x) => { input.current.stick = x }} />
        <PadButtonHold label="Springen" onDown={() => { input.current.jump = true }} onUp={() => { input.current.jump = false }} />
      </div>
      <p className="text-xs text-slate-500">Joystick links = laufen, Knopf rechts = springen (Tastatur: Pfeile/WASD und Leertaste). Sammle Münzen (+5), jede 50 Pixel Strecke = 1 Punkt.</p>
    </div>
  )
}

/** Sprungknopf: gedrückt halten = aktiv. */
function PadButtonHold({ label, onDown, onUp }: { label: string; onDown: () => void; onUp: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); onDown() }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
      className="flex h-28 w-28 touch-none select-none items-center justify-center rounded-full border border-white/25 bg-fuchsia-400/25 text-white shadow-lg active:scale-95 active:bg-fuchsia-400/45"
    >
      <ArrowUp size={40} />
    </button>
  )
}
